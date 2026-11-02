import { resolveGeminiBaseUrl } from "../channels.js";
import { ProviderError, classifyHttpError, classifyTransportError, PUBLIC_MESSAGES } from "./errors.js";
import { requestOptions } from "./transport.js";

// Google's Gemini API (Nano Banana), or a relay that forwards it:
// POST {base}/models/{model}:generateContent. Sizes are an aspect ratio plus
// 1K / 2K / 4K rather than WIDTHxHEIGHT; the worker measures what comes back.
// Nano Banana has no 画质 parameter and draws one image per call, so a job of
// n images makes n calls side by side.

const IMAGE_SIZE = { hd: "2K", uhd: "4K" };   // 标准 is the default 1K, so nothing is sent
const RATIOS = new Set(["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]);
const BLOCKED = new Set(["SAFETY", "IMAGE_SAFETY", "PROHIBITED_CONTENT", "IMAGE_PROHIBITED_CONTENT", "BLOCKLIST", "SPII"]);
const CHANNEL_STATUS = new Set(["UNAUTHENTICATED", "PERMISSION_DENIED", "FAILED_PRECONDITION", "NOT_FOUND"]);
const TRANSIENT_STATUS = new Set(["INTERNAL", "UNAVAILABLE", "DEADLINE_EXCEEDED", "ABORTED"]);

function headers(channel) {
  const auth = channel.options.geminiAuth === "bearer" ? { Authorization: `Bearer ${channel.apiKey}` } : { "x-goog-api-key": channel.apiKey };
  return { ...channel.options.extraHeaders, ...auth };
}

// The response without its base64 image data, for error details.
const strip = (json) => JSON.stringify(json, (key, value) => (key === "data" && typeof value === "string" ? `<${value.length} chars>` : value)).slice(0, 2000);

// Google's errors carry a status such as INVALID_ARGUMENT; relays often answer
// in the OpenAI shape, which classifyHttpError already reads.
function classifyError(status, json, raw) {
  const err = (json && typeof json === "object" && json.error) || {};
  const code = String(err.status || "");
  if (!code) return classifyHttpError(status, json, raw);
  const message = String(err.message || raw.slice(0, 300) || `HTTP ${status}`);
  const reasons = (Array.isArray(err.details) ? err.details : []).map((d) => d?.reason).filter(Boolean).join(" ");
  const detail = JSON.stringify({ status, code, message, reasons: reasons || undefined }).slice(0, 2000);
  // A bad key, a project without access, "User location is not supported", an
  // unknown model: this channel can't serve anyone, so try the next one.
  if (CHANNEL_STATUS.has(code) || /API_KEY_INVALID|API key not valid|API key expired/i.test(`${reasons} ${message}`)) {
    return new ProviderError("channel", message, { status, code, detail, publicMessage: PUBLIC_MESSAGES.unavailable });
  }
  if (code === "RESOURCE_EXHAUSTED") {
    // Per-minute limits pass; a prepaid balance that ran out doesn't.
    const broke = /prepay|credits? (are|is) depleted|billing account|余额|欠费/i.test(message);
    return new ProviderError(broke ? "channel" : "transient", message, { status, code, detail,
      publicMessage: broke ? PUBLIC_MESSAGES.unavailable : PUBLIC_MESSAGES.busy });
  }
  if (TRANSIENT_STATUS.has(code)) return new ProviderError("transient", message, { status, code, detail, publicMessage: PUBLIC_MESSAGES.busy });
  // INVALID_ARGUMENT: almost always a setting this model doesn't take (a size,
  // an aspect ratio, image output). Another channel may take it.
  return new ProviderError("channel", message, { status, code: code || `HTTP_${status}`, detail, publicMessage: PUBLIC_MESSAGES.rejected });
}

function refusal(reason, ratings, detail) {
  const sexual = (Array.isArray(ratings) ? ratings : []).some((r) => /SEXUALLY_EXPLICIT/.test(r?.category || "")
    && (r.blocked || /HIGH|MEDIUM/.test(r.probability || "")));
  return new ProviderError("user", `Blocked by the safety filter: ${reason}`, { code: "moderation_blocked", detail,
    publicMessage: sexual ? PUBLIC_MESSAGES.moderationSexual : PUBLIC_MESSAGES.moderation });
}

// Token counts in the OpenAI shape the cost estimate reads.
function usageOf(meta) {
  if (!meta || typeof meta !== "object") return null;
  const sum = (list, modality) => (Array.isArray(list) ? list : [])
    .filter((d) => d?.modality === modality).reduce((n, d) => n + (Number(d.tokenCount) || 0), 0);
  const input = Number(meta.promptTokenCount) || 0;
  const output = (Number(meta.candidatesTokenCount) || 0) + (Number(meta.thoughtsTokenCount) || 0);
  if (!input && !output) return null;
  const imageIn = sum(meta.promptTokensDetails, "IMAGE");
  const imageOut = sum(meta.candidatesTokensDetails, "IMAGE") || Number(meta.candidatesTokenCount) || 0;
  return {
    input_tokens: input, input_tokens_details: { text_tokens: input - imageIn, image_tokens: imageIn },
    output_tokens: output, output_tokens_details: { image_tokens: imageOut, text_tokens: Math.max(0, output - imageOut) },
    total_tokens: Number(meta.totalTokenCount) || input + output
  };
}

// The final image of the first candidate. With thinking on, the model may
// also return draft "thought" images; the last non-thought image is the result.
function readImage(json) {
  const block = json.promptFeedback?.blockReason;
  if (block) throw refusal(block, json.promptFeedback.safetyRatings, strip(json));
  const candidate = Array.isArray(json.candidates) ? json.candidates[0] : null;
  const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
  const image = parts.filter((p) => !p?.thought && (p?.inlineData || p?.inline_data)?.data).at(-1);
  if (image) return Buffer.from((image.inlineData || image.inline_data).data, "base64");
  const reason = String(candidate?.finishReason || "");
  if (BLOCKED.has(reason)) throw refusal(reason, candidate.safetyRatings, strip(json));
  const text = parts.filter((p) => !p?.thought && typeof p?.text === "string").map((p) => p.text).join(" ").trim();
  // Words instead of a picture ("I can't edit photos of …"), a copyright stop
  // or an explicit NO_IMAGE: the model declined this request.
  if (text || /RECITATION|NO_IMAGE|IMAGE_OTHER/.test(reason)) {
    throw new ProviderError("user", `No image (${reason || "STOP"}): ${text.slice(0, 300)}`, { code: "NO_IMAGE", detail: strip(json),
      publicMessage: PUBLIC_MESSAGES.rejected });
  }
  throw new ProviderError("transient", `Response contained no image (${reason || "no candidates"})`, { code: "EMPTY_RESPONSE",
    detail: strip(json), publicMessage: PUBLIC_MESSAGES.busy });
}

async function generateOnce(url, body, channel, timeoutMs) {
  let res, raw;
  try {
    res = await fetch(url, { method: "POST", headers: { ...headers(channel), "Content-Type": "application/json" }, body,
      ...requestOptions(timeoutMs, channel.options.connectTimeoutSec) });
    raw = await res.text();
  } catch (err) {
    throw classifyTransportError(err, timeoutMs);
  }
  let json = null;
  try { json = JSON.parse(raw); } catch { /* not JSON */ }
  if (!res.ok) throw classifyError(res.status, json, raw);
  if (!json || typeof json !== "object") {
    throw new ProviderError("transient", "Unexpected response body", { code: "BAD_RESPONSE", detail: raw.slice(0, 500),
      publicMessage: PUBLIC_MESSAGES.busy });
  }
  return { image: readImage(json), usage: usageOf(json.usageMetadata) };
}

// request: the worker's fields plus ratio and tier, which pick the aspect ratio
// and the 1K / 2K / 4K size. quality, moderation and output format don't apply.
export async function run(channel, request) {
  const base = resolveGeminiBaseUrl(channel.base_url);
  const timeoutMs = (channel.options.timeoutSec || request.timeoutSec) * (request.timeoutScale || 1) * 1000;
  const imageConfig = {};
  if (RATIOS.has(request.ratio)) imageConfig.aspectRatio = request.ratio;
  if (IMAGE_SIZE[request.tier]) imageConfig.imageSize = IMAGE_SIZE[request.tier];
  // References first, in the order the prompt numbers them ("Image 1 is …").
  const parts = request.images.map((img) => ({ inlineData: { mimeType: img.mime, data: img.buffer.toString("base64") } }));
  parts.push({ text: request.prompt });
  const body = JSON.stringify({
    contents: [{ role: "user", parts }],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"], ...(Object.keys(imageConfig).length ? { imageConfig } : {}) }
  });
  const url = `${base}/models/${channel.model}:generateContent`;
  const settled = await Promise.allSettled(Array.from({ length: request.n || 1 }, () => generateOnce(url, body, channel, timeoutMs)));
  const done = settled.filter((s) => s.status === "fulfilled").map((s) => s.value);
  // Keep what was drawn (the worker refunds the shortfall); with nothing,
  // report the most telling failure: a refusal before anything else.
  if (!done.length) {
    const errors = settled.map((s) => s.reason);
    throw errors.find((e) => e?.kind === "user") || errors.find((e) => e?.kind === "channel") || errors[0];
  }
  const usages = done.map((d) => d.usage).filter(Boolean);
  const usage = usages.length ? usages.reduce((a, b) => ({
    input_tokens: a.input_tokens + b.input_tokens,
    input_tokens_details: { text_tokens: a.input_tokens_details.text_tokens + b.input_tokens_details.text_tokens,
      image_tokens: a.input_tokens_details.image_tokens + b.input_tokens_details.image_tokens },
    output_tokens: a.output_tokens + b.output_tokens,
    output_tokens_details: { image_tokens: a.output_tokens_details.image_tokens + b.output_tokens_details.image_tokens,
      text_tokens: a.output_tokens_details.text_tokens + b.output_tokens_details.text_tokens },
    total_tokens: a.total_tokens + b.total_tokens
  })) : null;
  return { images: done.map((d) => d.image), usage, size: request.size, revisedPrompt: "" };
}

// GET {base}/models, following pages. Relays that only copy the OpenAI list
// format ({ data: [{ id }] }) are read too.
export async function listModels(channel) {
  const base = resolveGeminiBaseUrl(channel.base_url);
  const timeoutMs = Math.max(20, channel.options.connectTimeoutSec || 30) * 1000;
  const models = [];
  let pageToken = "";
  for (let page = 0; page < 10; page++) {
    let res, raw;
    try {
      res = await fetch(`${base}/models?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`,
        { headers: headers(channel), ...requestOptions(timeoutMs, channel.options.connectTimeoutSec) });
      raw = await res.text();
    } catch (err) {
      throw classifyTransportError(err, timeoutMs);
    }
    let json = null;
    try { json = JSON.parse(raw); } catch { /* not JSON */ }
    if (!res.ok) throw classifyError(res.status, json, raw);
    const list = Array.isArray(json?.models) ? json.models : Array.isArray(json?.data) ? json.data : null;
    if (!list) throw new ProviderError("transient", "Unexpected response body", { code: "BAD_RESPONSE", detail: raw.slice(0, 300) });
    for (const m of list) {
      const methods = m?.supportedGenerationMethods;
      if (Array.isArray(methods) && !methods.includes("generateContent")) continue;
      models.push({ id: String(m?.name || m?.id || "").replace(/^models\//, ""), name: m?.displayName || "" });
    }
    pageToken = json.nextPageToken || "";
    if (!pageToken) break;
  }
  return models;
}

// The "test" button: list the models (free) and look for this one.
export async function ping(channel) {
  const started = Date.now();
  try {
    const ids = (await listModels(channel)).map((m) => m.id);
    const hasModel = ids.length ? ids.includes(channel.model) : null;
    return {
      ok: true, ms: Date.now() - started, modelListed: hasModel,
      message: hasModel === false ? `连接成功，但模型列表中没有 ${channel.model}（部分中转站不返回完整列表，可用“试生成”确认）`
        : "连接成功，API Key 有效"
    };
  } catch (err) {
    const perr = err instanceof ProviderError ? err : classifyTransportError(err, 30_000);
    const prefix = perr.status ? "" : "无法连接：";
    return { ok: false, status: perr.status || undefined, code: perr.code, message: `${prefix}${perr.message}`, ms: Date.now() - started };
  }
}

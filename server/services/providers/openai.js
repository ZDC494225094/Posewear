import { resolveBaseUrl } from "../channels.js";
import { ProviderError, classifyHttpError, PUBLIC_MESSAGES } from "./errors.js";

const MAX_DOWNLOAD_BYTES = 40 * 1024 * 1024;

// Some relays return image URLs instead of base64. Only follow https URLs, or
// URLs on the channel's own host, so a misbehaving relay can't point the
// server at internal addresses.
async function download(url, timeoutMs, base) {
  let target;
  try { target = new URL(url); } catch { throw new ProviderError("transient", "Invalid image URL", { code: "BAD_URL" }); }
  const sameHost = target.host === new URL(base).host;
  if (target.protocol !== "https:" && !(sameHost && target.protocol === "http:")) {
    throw new ProviderError("transient", "Image URL must use https", { code: "BAD_URL" });
  }
  const res = await fetch(target, { signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
  if (!res.ok) throw new ProviderError("transient", `Image download failed: HTTP ${res.status}`, { code: "DOWNLOAD_FAILED" });
  const length = Number(res.headers.get("content-length") || 0);
  if (length > MAX_DOWNLOAD_BYTES) throw new ProviderError("transient", "Image too large", { code: "DOWNLOAD_TOO_LARGE" });
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > MAX_DOWNLOAD_BYTES) throw new ProviderError("transient", "Image too large", { code: "DOWNLOAD_TOO_LARGE" });
  return buffer;
}

// One call to the OpenAI Image API (or a compatible relay).
// Text only -> POST /images/generations (JSON); with references -> POST /images/edits (multipart).
export async function run(channel, request) {
  const base = resolveBaseUrl(channel.base_url);
  const opts = channel.options;
  const omit = new Set(opts.omitParams);
  const timeoutMs = (opts.timeoutSec || request.timeoutSec) * 1000;

  const fields = { model: channel.model, prompt: request.prompt };
  if (!omit.has("n")) fields.n = request.n;
  if (request.size) fields.size = request.size;
  if (!omit.has("quality")) fields.quality = request.quality;
  if (!omit.has("moderation")) fields.moderation = request.moderation;
  if (!omit.has("output_format")) fields.output_format = request.outputFormat;
  if (!omit.has("output_compression") && request.outputFormat !== "png") fields.output_compression = request.outputCompression;
  if (!omit.has("safety_identifier") && request.safetyIdentifier) fields.safety_identifier = request.safetyIdentifier;

  const headers = { ...opts.extraHeaders, Authorization: `Bearer ${channel.apiKey}` };
  let res;
  try {
    if (!request.images.length) {
      res = await fetch(`${base}/images/generations`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(fields),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } else {
      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
      if (opts.inputFidelity !== "omit") form.append("input_fidelity", opts.inputFidelity);
      for (const image of request.images) {
        form.append(opts.imageField, new Blob([image.buffer], { type: image.mime }), image.name);
      }
      res = await fetch(`${base}/images/edits`, { method: "POST", headers, body: form, signal: AbortSignal.timeout(timeoutMs) });
    }
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      throw new ProviderError("transient", `Request timed out after ${Math.round(timeoutMs / 1000)}s`,
        { code: "TIMEOUT", publicMessage: PUBLIC_MESSAGES.busy });
    }
    throw new ProviderError("transient", `Network error: ${err?.cause?.code || err?.message || err}`,
      { code: "NETWORK", publicMessage: PUBLIC_MESSAGES.unavailable });
  }

  const raw = await res.text();
  let json = null;
  try { json = JSON.parse(raw); } catch { /* not JSON */ }
  if (!res.ok) throw classifyHttpError(res.status, json, raw);
  if (!json || !Array.isArray(json.data)) {
    throw new ProviderError("transient", "Unexpected response body", { code: "BAD_RESPONSE", detail: raw.slice(0, 500),
      publicMessage: PUBLIC_MESSAGES.busy });
  }
  const images = [];
  for (const item of json.data) {
    if (item?.b64_json) images.push(Buffer.from(item.b64_json, "base64"));
    else if (item?.url) images.push(await download(item.url, timeoutMs, base));
  }
  if (!images.length) {
    throw new ProviderError("transient", "Response contained no images", { code: "EMPTY_RESPONSE", detail: raw.slice(0, 500),
      publicMessage: PUBLIC_MESSAGES.busy });
  }
  return { images, usage: json.usage || null, size: json.size || request.size, revisedPrompt: json.data[0]?.revised_prompt || "" };
}

// Cheap connectivity check for the admin "test" button: GET /models costs nothing.
export async function ping(channel) {
  const base = resolveBaseUrl(channel.base_url);
  const started = Date.now();
  let res;
  try {
    res = await fetch(`${base}/models`, {
      headers: { ...channel.options.extraHeaders, Authorization: `Bearer ${channel.apiKey}` },
      signal: AbortSignal.timeout(20_000)
    });
  } catch (err) {
    return { ok: false, message: `无法连接：${err?.cause?.code || err?.message || err}`, ms: Date.now() - started };
  }
  const raw = await res.text();
  let json = null;
  try { json = JSON.parse(raw); } catch { /* ignore */ }
  if (!res.ok) {
    return { ok: false, status: res.status, message: json?.error?.message || raw.slice(0, 200) || `HTTP ${res.status}`, ms: Date.now() - started };
  }
  const ids = Array.isArray(json?.data) ? json.data.map((m) => m.id) : [];
  const hasModel = ids.length ? ids.includes(channel.model) : null;
  return {
    ok: true, status: res.status, ms: Date.now() - started, modelListed: hasModel,
    message: hasModel === false ? `连接成功，但模型列表中没有 ${channel.model}（部分中转站不返回完整列表，可用“试生成”确认）`
      : "连接成功，API Key 有效"
  };
}

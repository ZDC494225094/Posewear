#!/usr/bin/env node
// A local stand-in for the OpenAI Image API and the Gemini API (Nano Banana),
// used by the test suite and handy for trying the full pipeline without a key:
//
//   node scripts/fake-openai.js 8787
//   then set an OpenAI channel's Base URL to http://127.0.0.1:8787/v1, or a
//   Gemini channel's to http://127.0.0.1:8787, with any key starting with sk-.
//
// Put "[fake:moderation]", "[fake:503]", "[fake:quota]" or "[fake:param]" in a
// prompt to simulate the corresponding upstream error, "[fake:slow]" for a
// response that takes 1.5 s, "[fake:1k]" for a relay that ignores the
// requested size and always answers 1024×1024, "[fake:cap2048]" for one that
// keeps the shape but caps the long edge at 2048, or "[fake:nousage]" for a relay
// that returns no token usage. A model ID ending in "-1k" always answers
// 1024×1024 and one containing "-capNNNN" caps the long edge at NNNN, for size
// checks (their prompt is fixed). With keepBodies, recorded requests keep their files.
import http from "node:http";
import { pathToFileURL } from "node:url";
import sharp from "sharp";

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// Minimal multipart/form-data parser: enough for the Image API's fields.
function parseMultipart(buffer, contentType) {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  if (!boundary) return { fields: {}, files: [] };
  const sep = Buffer.from(`--${boundary[1] || boundary[2]}`);
  const fields = {};
  const files = [];
  let start = buffer.indexOf(sep);
  while (start >= 0) {
    const next = buffer.indexOf(sep, start + sep.length);
    if (next < 0) break;
    const part = buffer.subarray(start + sep.length + 2, next - 2);
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd > 0) {
      const headers = part.subarray(0, headerEnd).toString("utf8");
      const body = part.subarray(headerEnd + 4);
      const name = /name="([^"]+)"/.exec(headers)?.[1];
      const filename = /filename="([^"]*)"/.exec(headers)?.[1];
      const type = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1];
      if (filename !== undefined) files.push({ field: name, filename, type, size: body.length, body });
      else if (name) fields[name] = body.toString("utf8");
    }
    start = next;
  }
  return { fields, files };
}

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

// Nano Banana's output at 1K for each aspect ratio; 2K and 4K are twice and four times as wide and tall.
const GEMINI_1K = { "1:1": [1024, 1024], "2:3": [848, 1264], "3:2": [1264, 848], "3:4": [896, 1200], "4:3": [1200, 896],
  "4:5": [928, 1152], "5:4": [1152, 928], "9:16": [768, 1376], "16:9": [1376, 768], "21:9": [1584, 672] };
const GEMINI_SCALE = { "1K": 1, "2K": 2, "4K": 4 };
const GEMINI_MODELS = [
  { name: "models/gemini-3-pro-image", displayName: "Nano Banana Pro", supportedGenerationMethods: ["generateContent", "countTokens"] },
  { name: "models/gemini-3-flash", displayName: "Gemini 3 Flash", supportedGenerationMethods: ["generateContent", "countTokens"] },
  { name: "models/gemini-3.1-flash-image", displayName: "Nano Banana 2", supportedGenerationMethods: ["generateContent", "countTokens"] },
  { name: "models/gemini-embedding-001", displayName: "Gemini Embedding", supportedGenerationMethods: ["embedContent"] }
];
const googleError = (res, code, status, message, details) => json(res, code, { error: { code, message, status, ...(details ? { details } : {}) } });

// The Gemini API (generateContent), with the same "[fake:…]" markers plus
// "[fake:blocked]" (prompt blocked), "[fake:noimage]" (a reply in words) and
// "[fake:location]" (a region Google doesn't serve). The model list comes in two pages.
async function gemini(req, res, url, { requests, keepBodies, log }) {
  const key = req.headers["x-goog-api-key"] || String(req.headers.authorization || "").replace(/^Bearer /, "");
  if (!/^(AIza|sk-)/.test(key)) {
    return googleError(res, 400, "INVALID_ARGUMENT", "API key not valid. Please pass a valid API key.",
      [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "API_KEY_INVALID" }]);
  }
  if (req.method === "GET" && url.pathname === "/v1beta/models") {
    requests.push({ endpoint: "gemini-models", auth: req.headers["x-goog-api-key"] ? "x-goog-api-key" : "bearer", query: url.search });
    return url.searchParams.get("pageToken") === "p2" ? json(res, 200, { models: GEMINI_MODELS.slice(2) })
      : json(res, 200, { models: GEMINI_MODELS.slice(0, 2), nextPageToken: "p2" });
  }
  const route = /^\/v1beta\/models\/([^/:]+):generateContent$/.exec(url.pathname);
  if (req.method !== "POST" || !route) return googleError(res, 404, "NOT_FOUND", "Not found");
  const body = JSON.parse((await readBody(req)).toString("utf8"));
  const parts = body.contents?.[0]?.parts || [];
  const prompt = parts.filter((p) => typeof p.text === "string").map((p) => p.text).join("\n");
  const record = {
    endpoint: "gemini", model: route[1], auth: req.headers["x-goog-api-key"] ? "x-goog-api-key" : "bearer", prompt,
    generationConfig: body.generationConfig, parts: parts.map((p) => (p.inlineData ? p.inlineData.mimeType : "text")),
    files: parts.filter((p) => p.inlineData).map((p) => ({ type: p.inlineData.mimeType, size: Buffer.from(p.inlineData.data, "base64").length,
      ...(keepBodies ? { body: Buffer.from(p.inlineData.data, "base64") } : {}) }))
  };
  requests.push(record);
  if (log) console.log(record);
  const references = record.files.length;
  const usage = (k) => (prompt.includes("[fake:nousage]") ? undefined : {
    promptTokenCount: 300 + 560 * references, candidatesTokenCount: k === 4 ? 2000 : 1120,
    totalTokenCount: 300 + 560 * references + (k === 4 ? 2000 : 1120),
    promptTokensDetails: [{ modality: "TEXT", tokenCount: 300 }, ...(references ? [{ modality: "IMAGE", tokenCount: 560 * references }] : [])],
    candidatesTokensDetails: [{ modality: "IMAGE", tokenCount: k === 4 ? 2000 : 1120 }]
  });
  if (prompt.includes("[fake:slow]")) await new Promise((r) => setTimeout(r, 1500));
  if (prompt.includes("[fake:503]")) return googleError(res, 503, "UNAVAILABLE", "The model is overloaded. Please try again later.");
  if (prompt.includes("[fake:quota]")) {
    return googleError(res, 429, "RESOURCE_EXHAUSTED", "You exceeded your current quota, please check your plan and billing details.");
  }
  if (prompt.includes("[fake:location]")) return googleError(res, 400, "FAILED_PRECONDITION", "User location is not supported for the API use.");
  if (prompt.includes("[fake:blocked]")) return json(res, 200, { promptFeedback: { blockReason: "PROHIBITED_CONTENT" }, usageMetadata: usage(1) });
  if (prompt.includes("[fake:moderation]")) {
    return json(res, 200, { candidates: [{ finishReason: "IMAGE_SAFETY",
      safetyRatings: [{ category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", probability: "HIGH", blocked: true }] }], usageMetadata: usage(1) });
  }
  if (prompt.includes("[fake:noimage]")) {
    return json(res, 200, { candidates: [{ content: { role: "model", parts: [{ text: "I can't help with editing this photo." }] },
      finishReason: "STOP" }], usageMetadata: usage(1) });
  }
  const config = body.generationConfig?.imageConfig || {};
  const k = GEMINI_SCALE[config.imageSize || "1K"];
  if (!k) return googleError(res, 400, "INVALID_ARGUMENT", "imageSize must be one of 1K, 2K, 4K.");
  const [w, h] = GEMINI_1K[config.aspectRatio] || GEMINI_1K["1:1"];
  const scale = prompt.includes("[fake:1k]") ? 1 : k;
  const image = await sharp({ create: { width: w * scale, height: h * scale, channels: 3, background: { r: 90, g: 140, b: 200 } } }).png().toBuffer();
  // A draft "thought" image comes first, as with thinking on; the last plain image is the result.
  const draft = await sharp({ create: { width: 256, height: 256, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer();
  json(res, 200, {
    candidates: [{ content: { role: "model", parts: [
      { text: "Planning the composition.", thought: true },
      { inlineData: { mimeType: "image/png", data: draft.toString("base64") }, thought: true },
      { text: "Here is the image." },
      { inlineData: { mimeType: "image/png", data: image.toString("base64") } }
    ] }, finishReason: "STOP" }],
    usageMetadata: usage(scale), modelVersion: route[1]
  });
}

export function createFakeOpenAI({ log = false, keepBodies = false } = {}) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/v1beta/")) return gemini(req, res, url, { requests, keepBodies, log });
    if (req.headers.authorization !== "Bearer sk-test" && !String(req.headers.authorization || "").startsWith("Bearer sk-")) {
      return json(res, 401, { error: { message: "Incorrect API key provided", type: "invalid_request_error", code: "invalid_api_key" } });
    }
    if (req.method === "GET" && url.pathname === "/v1/models") {
      return json(res, 200, { object: "list", data: ["gpt-5.5", "gpt-image-2", "nano-banana-pro", "gpt-image-2.5-sunburst", "flux-kontext-pro"]
        .map((id) => ({ id, object: "model", owned_by: "relay" })) });
    }
    const isEdit = url.pathname === "/v1/images/edits";
    const isGen = url.pathname === "/v1/images/generations";
    if (req.method !== "POST" || (!isEdit && !isGen)) return json(res, 404, { error: { message: "Not found" } });

    const raw = await readBody(req);
    let fields, files = [];
    if (isEdit) ({ fields, files } = parseMultipart(raw, req.headers["content-type"]));
    else fields = JSON.parse(raw.toString("utf8"));
    const record = { endpoint: isEdit ? "edits" : "generations", fields, files: files.map(({ body, ...f }) => (keepBodies ? { ...f, body } : f)) };
    requests.push(record);
    if (log) console.log(record);

    const prompt = String(fields.prompt || "");
    if (prompt.includes("[fake:slow]")) await new Promise((r) => setTimeout(r, 1500));
    if (prompt.includes("[fake:moderation]")) {
      return json(res, 400, { error: { message: "Your request was rejected by the safety system.", type: "image_generation_user_error",
        code: "moderation_blocked", moderation_details: { moderation_stage: "input", categories: ["sexual"] } } });
    }
    if (prompt.includes("[fake:503]")) return json(res, 503, { error: { message: "The server is overloaded", type: "server_error" } });
    if (prompt.includes("[fake:quota]")) {
      return json(res, 429, { error: { message: "You exceeded your current quota", type: "insufficient_quota", code: "insufficient_quota" } });
    }
    if (prompt.includes("[fake:param]")) {
      return json(res, 400, { error: { message: "Unknown parameter: 'moderation'.", type: "invalid_request_error", code: "unknown_parameter" } });
    }
    if (fields.input_fidelity && String(fields.model).startsWith("gpt-image-2")) {
      return json(res, 400, { error: { message: "input_fidelity is not supported for this model", type: "invalid_request_error", code: "unsupported_parameter" } });
    }

    const model = String(fields.model || "");
    let [w, h] = (prompt.includes("[fake:1k]") || /-1k$/.test(model) ? "1024x1024" : String(fields.size || "1024x1024")).split("x").map(Number);
    const cap = prompt.includes("[fake:cap2048]") ? 2048 : Number(/-cap(\d{3,4})/.exec(model)?.[1]) || 0;
    if (cap && Math.max(w, h) > cap) {
      const k = cap / Math.max(w, h);
      [w, h] = [Math.round(w * k), Math.round(h * k)];
    }
    const n = Number(fields.n || 1);
    const data = [];
    for (let i = 0; i < n; i++) {
      const png = await sharp({ create: { width: w || 1024, height: h || 1024, channels: 3, background: { r: 200, g: 120 + i * 20, b: 90 } } })
        .png().toBuffer();
      data.push({ b64_json: png.toString("base64") });
    }
    json(res, 200, {
      created: Math.floor(Date.now() / 1000), data, size: fields.size, quality: fields.quality, output_format: "png",
      usage: prompt.includes("[fake:nousage]") ? undefined
        : { input_tokens: 1500, input_tokens_details: { text_tokens: 300, image_tokens: 1200 }, output_tokens: 6000, total_tokens: 7500 }
    });
  });
  return { server, requests };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const port = Number(process.argv[2]) || 8787;
  const { server } = createFakeOpenAI({ log: true });
  server.listen(port, "127.0.0.1", () => console.log(`Fake OpenAI Image API on http://127.0.0.1:${port}/v1 (any key starting with sk-)`));
}

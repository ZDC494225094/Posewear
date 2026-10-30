#!/usr/bin/env node
// A local stand-in for the OpenAI Image API, used by the test suite and handy
// for trying the full pipeline without an API key:
//
//   node scripts/fake-openai.js 8787
//   then set a channel's Base URL to http://127.0.0.1:8787/v1 with any API key.
//
// Put "[fake:moderation]", "[fake:503]", "[fake:quota]" or "[fake:param]" in a
// prompt to simulate the corresponding upstream error.
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

export function createFakeOpenAI({ log = false } = {}) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (req.headers.authorization !== "Bearer sk-test" && !String(req.headers.authorization || "").startsWith("Bearer sk-")) {
      return json(res, 401, { error: { message: "Incorrect API key provided", type: "invalid_request_error", code: "invalid_api_key" } });
    }
    if (req.method === "GET" && url.pathname === "/v1/models") {
      return json(res, 200, { object: "list", data: [{ id: "gpt-image-2" }, { id: "gpt-image-2.5-sunburst" }] });
    }
    const isEdit = url.pathname === "/v1/images/edits";
    const isGen = url.pathname === "/v1/images/generations";
    if (req.method !== "POST" || (!isEdit && !isGen)) return json(res, 404, { error: { message: "Not found" } });

    const raw = await readBody(req);
    let fields, files = [];
    if (isEdit) ({ fields, files } = parseMultipart(raw, req.headers["content-type"]));
    else fields = JSON.parse(raw.toString("utf8"));
    const record = { endpoint: isEdit ? "edits" : "generations", fields, files: files.map(({ body, ...f }) => f) };
    requests.push(record);
    if (log) console.log(record);

    const prompt = String(fields.prompt || "");
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

    const [w, h] = String(fields.size || "1024x1024").split("x").map(Number);
    const n = Number(fields.n || 1);
    const data = [];
    for (let i = 0; i < n; i++) {
      const png = await sharp({ create: { width: w || 1024, height: h || 1024, channels: 3, background: { r: 200, g: 120 + i * 20, b: 90 } } })
        .png().toBuffer();
      data.push({ b64_json: png.toString("base64") });
    }
    json(res, 200, {
      created: Math.floor(Date.now() / 1000), data, size: fields.size, quality: fields.quality, output_format: "png",
      usage: { input_tokens: 1500, input_tokens_details: { text_tokens: 300, image_tokens: 1200 }, output_tokens: 6000, total_tokens: 7500 }
    });
  });
  return { server, requests };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const port = Number(process.argv[2]) || 8787;
  const { server } = createFakeOpenAI({ log: true });
  server.listen(port, "127.0.0.1", () => console.log(`Fake OpenAI Image API on http://127.0.0.1:${port}/v1 (any key starting with sk-)`));
}

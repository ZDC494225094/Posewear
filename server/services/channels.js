import { db } from "../db.js";
import { encryptSecret, decryptSecret, maskSecret } from "../lib/crypto.js";
import { badRequest, notFound } from "../lib/errors.js";

// A channel is one way to reach an image model: an API key plus base URL and
// model id. Several channels give failover; the worker tries them by priority.

export const KNOWN_MODELS = [
  { id: "gpt-image-2", label: "gpt-image-2（推荐）", sizeMode: "flexible", inputFidelity: "omit" },
  { id: "gpt-image-2-2026-04-21", label: "gpt-image-2 固定快照", sizeMode: "flexible", inputFidelity: "omit" },
  { id: "gpt-image-2.5-sunburst", label: "gpt-image-2.5-sunburst", sizeMode: "flexible", inputFidelity: "omit" },
  { id: "gpt-image-2.5-flare", label: "gpt-image-2.5-flare", sizeMode: "flexible", inputFidelity: "omit" },
  { id: "gpt-image-1.5", label: "gpt-image-1.5", sizeMode: "fixed", inputFidelity: "high" },
  { id: "gpt-image-1-mini", label: "gpt-image-1-mini", sizeMode: "fixed", inputFidelity: "low" }
];

const DEFAULT_OPTIONS = {
  sizeMode: "flexible",      // flexible | fixed | auto
  inputFidelity: "omit",     // omit | high | low  (gpt-image-2 requires omit)
  timeoutSec: 0,             // 0 = use the global setting
  maxConcurrency: 0,         // 0 = unlimited
  omitParams: [],            // e.g. ["moderation", "safety_identifier"] for strict relays
  imageField: "image[]",     // multipart field name for input images; some relays expect "image"
  extraHeaders: {},
  mockDelayMs: 1800
};

const OMITTABLE = ["moderation", "safety_identifier", "output_format", "output_compression", "quality", "n"];

function cleanOptions(input = {}, base = DEFAULT_OPTIONS) {
  const o = { ...DEFAULT_OPTIONS, ...base, ...input };
  const headers = {};
  if (o.extraHeaders && typeof o.extraHeaders === "object") {
    for (const [k, v] of Object.entries(o.extraHeaders).slice(0, 10)) {
      const key = String(k).trim();
      if (/^[A-Za-z0-9-]{1,64}$/.test(key) && !/^(authorization|content-type|content-length|host)$/i.test(key)) {
        headers[key] = String(v).slice(0, 500);
      }
    }
  }
  return {
    sizeMode: ["flexible", "fixed", "auto"].includes(o.sizeMode) ? o.sizeMode : "flexible",
    inputFidelity: ["omit", "high", "low"].includes(o.inputFidelity) ? o.inputFidelity : "omit",
    timeoutSec: Math.max(0, Math.min(900, Math.round(Number(o.timeoutSec) || 0))),
    maxConcurrency: Math.max(0, Math.min(100, Math.round(Number(o.maxConcurrency) || 0))),
    omitParams: (Array.isArray(o.omitParams) ? o.omitParams : String(o.omitParams || "").split(/[,\s]+/))
      .map((p) => String(p).trim()).filter((p) => OMITTABLE.includes(p)),
    imageField: o.imageField === "image" ? "image" : "image[]",
    extraHeaders: headers,
    mockDelayMs: Math.max(0, Math.min(60_000, Math.round(Number(o.mockDelayMs) || 0)))
  };
}

// Accept "https://api.openai.com", ".../v1" or a relay path; default to /v1.
export function resolveBaseUrl(raw) {
  let base = String(raw || "").trim().replace(/\/+$/, "");
  if (!base) return "https://api.openai.com/v1";
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  if (/\/images\/(generations|edits)$/.test(base)) base = base.replace(/\/images\/(generations|edits)$/, "");
  if (!/\/v\d+[a-z]*$/i.test(base) && !/\/openai$/i.test(base)) base += "/v1";
  return base;
}

function row(id) {
  const r = db.prepare("SELECT * FROM channels WHERE id = ?").get(id);
  if (!r) throw notFound("渠道不存在");
  return r;
}

export function hydrate(r) {
  let options = {};
  try { options = JSON.parse(r.options || "{}"); } catch { /* defaults */ }
  let apiKey = "";
  try { apiKey = decryptSecret(r.api_key_enc); } catch { apiKey = ""; }
  return { ...r, enabled: !!r.enabled, options: cleanOptions(options), apiKey };
}

export function adminDto(r) {
  const c = hydrate(r);
  return {
    id: c.id, name: c.name, kind: c.kind, baseUrl: c.base_url, resolvedBaseUrl: c.kind === "openai" ? resolveBaseUrl(c.base_url) : "",
    model: c.model, options: c.options, enabled: c.enabled, priority: c.priority,
    apiKey: { __secret: true, set: !!c.apiKey, hint: maskSecret(c.apiKey) },
    successCount: c.success_count, failureCount: c.failure_count,
    lastOkAt: c.last_ok_at, lastError: c.last_error, lastErrorAt: c.last_error_at,
    createdAt: c.created_at, updatedAt: c.updated_at
  };
}

export function list() {
  return db.prepare("SELECT * FROM channels ORDER BY priority DESC, id").all().map(adminDto);
}

export function enabledChannels() {
  return db.prepare("SELECT * FROM channels WHERE enabled = 1 ORDER BY priority DESC, id").all().map(hydrate);
}

export function get(id) {
  return hydrate(row(id));
}

function validate(input, existing) {
  const kind = input.kind ?? existing?.kind ?? "openai";
  if (!["openai", "mock"].includes(kind)) throw badRequest("INVALID_INPUT", "渠道类型不正确");
  const name = String(input.name ?? existing?.name ?? "").trim().slice(0, 60);
  if (!name) throw badRequest("INVALID_INPUT", "请填写渠道名称");
  const model = String(input.model ?? existing?.model ?? "gpt-image-2").trim().slice(0, 100);
  if (!/^[\w.:/-]{1,100}$/.test(model)) throw badRequest("INVALID_INPUT", "模型 ID 格式不正确");
  const baseUrl = String(input.baseUrl ?? existing?.base_url ?? "").trim().slice(0, 300);
  if (baseUrl && !/^https?:\/\/[^\s]+$/i.test(baseUrl) && !/^[\w.-]+(:\d+)?(\/[^\s]*)?$/.test(baseUrl)) {
    throw badRequest("INVALID_INPUT", "Base URL 格式不正确");
  }
  let existingOptions = {};
  try { existingOptions = existing ? JSON.parse(existing.options || "{}") : {}; } catch { /* ignore */ }
  const options = cleanOptions(input.options || {}, existingOptions);
  const priority = Math.max(-1000, Math.min(1000, Math.round(Number(input.priority ?? existing?.priority ?? 0)) || 0));
  const enabled = input.enabled === undefined ? (existing ? !!existing.enabled : true) : !!input.enabled;
  return { kind, name, model, baseUrl, options, priority, enabled };
}

function keyFromInput(input, existing) {
  const key = input.apiKey;
  if (key && typeof key === "object" && key.__secret) return existing?.api_key_enc || "";
  if (typeof key === "string") return key.trim() ? encryptSecret(key.trim()) : "";
  return existing?.api_key_enc || "";
}

export function create(input) {
  const c = validate(input);
  const now = Date.now();
  const info = db.prepare(`INSERT INTO channels (name, kind, base_url, api_key_enc, model, options, enabled, priority,
    created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(c.name, c.kind, c.baseUrl,
    keyFromInput(input), c.model, JSON.stringify(c.options), c.enabled ? 1 : 0, c.priority, now, now);
  return adminDto(row(info.lastInsertRowid));
}

export function update(id, input) {
  const existing = row(id);
  const c = validate(input, existing);
  db.prepare(`UPDATE channels SET name = ?, kind = ?, base_url = ?, api_key_enc = ?, model = ?, options = ?,
    enabled = ?, priority = ?, updated_at = ? WHERE id = ?`).run(c.name, c.kind, c.baseUrl,
    keyFromInput(input, existing), c.model, JSON.stringify(c.options), c.enabled ? 1 : 0, c.priority, Date.now(), id);
  return adminDto(row(id));
}

export function remove(id) {
  row(id);
  db.prepare("DELETE FROM channels WHERE id = ?").run(id);
}

export function markSuccess(id) {
  db.prepare("UPDATE channels SET success_count = success_count + 1, last_ok_at = ? WHERE id = ?").run(Date.now(), id);
}

export function markFailure(id, message) {
  db.prepare("UPDATE channels SET failure_count = failure_count + 1, last_error = ?, last_error_at = ? WHERE id = ?")
    .run(String(message || "").slice(0, 500), Date.now(), id);
}

export function hasUsableChannel() {
  return db.prepare("SELECT 1 FROM channels WHERE enabled = 1 AND (kind = 'mock' OR api_key_enc <> '') LIMIT 1").get() !== undefined;
}

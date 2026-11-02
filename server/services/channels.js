import { db } from "../db.js";
import { encryptSecret, decryptSecret, maskSecret } from "../lib/crypto.js";
import { badRequest, notFound } from "../lib/errors.js";
import { TIERS, TIER_RANK } from "./sizes.js";
import { QUALITIES, profileFor, IMAGE_MODEL_HINT } from "./models.js";

// A channel is one way to reach an image model: an API key plus base URL and
// model id. Several channels give failover; the worker tries them by priority.
// kind "openai" speaks the OpenAI Image API (or a relay's copy of it), kind
// "gemini" Google's generateContent (Nano Banana), kind "mock" draws placeholders.

export const KINDS = ["openai", "gemini", "mock"];
export const DEFAULT_MODEL = { openai: "gpt-image-2", gemini: "gemini-3.1-flash-image", mock: "mock" };

// The channel's cost for the dashboard's margin numbers. "auto" is the
// model's official price (models.js); "token" and "image" are what the admin
// pays this relay: per 1M tokens, or per image of each 清晰度.
const DEFAULT_PRICING = { mode: "auto", currency: "usd", textInput: 0, imageInput: 0, imageOutput: 0, textOutput: 0,
  standard: 0, hd: 0, uhd: 0 };

const DEFAULT_OPTIONS = {
  sizeMode: "flexible",      // flexible | fixed | auto  (OpenAI kind)
  inputFidelity: "omit",     // omit | high | low  (gpt-image-2 requires omit)
  maxTier: "uhd",            // the largest 清晰度 this channel is used for
  qualities: QUALITIES,      // the 画质 it takes; others go to other channels
  pricing: DEFAULT_PRICING,
  geminiAuth: "goog",        // goog: x-goog-api-key header | bearer: Authorization header (some relays)
  timeoutSec: 0,             // 0 = use the global setting
  connectTimeoutSec: 30,     // TCP/TLS deadline, separate from the full request
  maxConcurrency: 0,         // 0 = unlimited
  omitParams: [],            // e.g. ["moderation", "safety_identifier"] for strict relays
  imageField: "image[]",     // multipart field name for input images; some relays expect "image"
  extraHeaders: {},
  mockDelayMs: 1800
};

const OMITTABLE = ["moderation", "safety_identifier", "output_format", "output_compression", "quality", "n"];

const price = (v) => Math.round(Math.max(0, Math.min(10_000, Number(v) || 0)) * 1e6) / 1e6;

function cleanPricing(p) {
  const v = { ...DEFAULT_PRICING, ...(p && typeof p === "object" ? p : {}) };
  return {
    mode: ["auto", "token", "image"].includes(v.mode) ? v.mode : "auto",
    currency: v.currency === "cny" ? "cny" : "usd",
    textInput: price(v.textInput), imageInput: price(v.imageInput), imageOutput: price(v.imageOutput),
    textOutput: price(v.textOutput), standard: price(v.standard), hd: price(v.hd), uhd: price(v.uhd)
  };
}

function cleanOptions(input = {}, base = DEFAULT_OPTIONS) {
  const o = { ...DEFAULT_OPTIONS, ...base, ...input };
  const headers = {};
  if (o.extraHeaders && typeof o.extraHeaders === "object") {
    for (const [k, v] of Object.entries(o.extraHeaders).slice(0, 10)) {
      const key = String(k).trim();
      if (/^[A-Za-z0-9-]{1,64}$/.test(key) && !/^(authorization|content-type|content-length|host|x-goog-api-key)$/i.test(key)) {
        headers[key] = String(v).slice(0, 500);
      }
    }
  }
  const qualities = Array.isArray(o.qualities) ? QUALITIES.filter((q) => o.qualities.includes(q)) : QUALITIES;
  return {
    sizeMode: ["flexible", "fixed", "auto"].includes(o.sizeMode) ? o.sizeMode : "flexible",
    inputFidelity: ["omit", "high", "low"].includes(o.inputFidelity) ? o.inputFidelity : "omit",
    maxTier: TIERS.includes(o.maxTier) ? o.maxTier : "uhd",
    qualities: qualities.length ? qualities : QUALITIES,
    // A partial pricing object (from the API) changes only the fields it names.
    pricing: cleanPricing({ ...(base.pricing || {}), ...(input.pricing || {}) }),
    geminiAuth: o.geminiAuth === "bearer" ? "bearer" : "goog",
    timeoutSec: Math.max(0, Math.min(900, Math.round(Number(o.timeoutSec) || 0))),
    connectTimeoutSec: Math.max(1, Math.min(120, Math.round(Number(o.connectTimeoutSec) || 30))),
    maxConcurrency: Math.max(0, Math.min(100, Math.round(Number(o.maxConcurrency) || 0))),
    omitParams: (Array.isArray(o.omitParams) ? o.omitParams : String(o.omitParams || "").split(/[,\s]+/))
      .map((p) => String(p).trim()).filter((p) => OMITTABLE.includes(p)),
    imageField: o.imageField === "image" ? "image" : "image[]",
    extraHeaders: headers,
    mockDelayMs: Math.max(0, Math.min(60_000, Math.round(Number(o.mockDelayMs) || 0)))
  };
}

// Google's endpoint by default; a relay's root, its /v1beta, or a pasted
// .../models/<id>:generateContent URL all resolve to the version root.
export function resolveGeminiBaseUrl(raw) {
  let base = String(raw || "").trim().replace(/\/+$/, "");
  if (!base) return "https://generativelanguage.googleapis.com/v1beta";
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  base = base.replace(/\/models\/[^/]+:\w+$/i, "").replace(/\/models$/i, "");
  if (!/\/v\d+(?:alpha|beta)?\d*$/i.test(base)) base += "/v1beta";
  return base;
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
  let sizeLimit = null;
  try { sizeLimit = r.size_limit ? JSON.parse(r.size_limit) : null; } catch { /* none */ }
  return { ...r, enabled: !!r.enabled, options: cleanOptions(options), apiKey, sizeLimit };
}

const resolvedBase = (c) => (c.kind === "openai" ? resolveBaseUrl(c.base_url) : c.kind === "gemini" ? resolveGeminiBaseUrl(c.base_url) : "");

export function adminDto(r) {
  const c = hydrate(r);
  const profile = c.kind === "mock" ? null : profileFor(c.model);
  return {
    id: c.id, name: c.name, kind: c.kind, baseUrl: c.base_url, resolvedBaseUrl: resolvedBase(c),
    model: c.model, profile: profile ? { id: profile.id, label: profile.label, kind: profile.kind } : null,
    options: c.options, enabled: c.enabled, priority: c.priority,
    apiKey: { __secret: true, set: !!c.apiKey, hint: maskSecret(c.apiKey) },
    successCount: c.success_count, failureCount: c.failure_count,
    lastOkAt: c.last_ok_at, lastError: c.last_error, lastErrorAt: c.last_error_at,
    maxTier: maxTier(c), sizeLimit: c.sizeLimit,
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
  if (!KINDS.includes(kind)) throw badRequest("INVALID_INPUT", "渠道类型不正确");
  const name = String(input.name ?? existing?.name ?? "").trim().slice(0, 60);
  if (!name) throw badRequest("INVALID_INPUT", "请填写渠道名称");
  const model = String(input.model ?? existing?.model ?? DEFAULT_MODEL[kind]).trim().slice(0, 100);
  if (!/^[\w.:/-]{1,100}$/.test(model)) throw badRequest("INVALID_INPUT", "模型 ID 格式不正确");
  const baseUrl = String(input.baseUrl ?? existing?.base_url ?? "").trim().slice(0, 300);
  if (baseUrl && !/^https?:\/\/[^\s]+$/i.test(baseUrl) && !/^[\w.-]+(:\d+)?(\/[^\s]*)?$/.test(baseUrl)) {
    throw badRequest("INVALID_INPUT", "Base URL 格式不正确");
  }
  let existingOptions = {};
  try { existingOptions = existing ? JSON.parse(existing.options || "{}") : {}; } catch { /* ignore */ }
  if (Array.isArray(input.options?.qualities) && !QUALITIES.some((q) => input.options.qualities.includes(q))) {
    throw badRequest("INVALID_INPUT", "至少选择一种画质");
  }
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
  const key = keyFromInput(input, existing);
  // What the size check learned is kept unless the endpoint, key, model, API
  // or size mode changed (switching relays); renaming or pausing a channel, or
  // changing its 画质 or cost, keeps it.
  const sameEndpoint = c.kind === existing.kind && c.baseUrl === existing.base_url && key === existing.api_key_enc
    && c.model === existing.model && c.options.sizeMode === hydrate(existing).options.sizeMode;
  db.prepare(`UPDATE channels SET name = ?, kind = ?, base_url = ?, api_key_enc = ?, model = ?, options = ?,
    enabled = ?, priority = ?, size_limit = ${sameEndpoint ? "size_limit" : "NULL"}, updated_at = ? WHERE id = ?`).run(c.name, c.kind,
    c.baseUrl, key, c.model, JSON.stringify(c.options), c.enabled ? 1 : 0, c.priority, Date.now(), id);
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

// The highest tier a channel is set up for: its 最高清晰度, but on the OpenAI
// API only with custom sizes (gpt-image-2, 2.5); the fixed sizes of
// gpt-image-1.5 and 1-mini and "auto" stay at 1024-class images.
export function capTier(channel) {
  if (channel.kind === "mock") return "uhd";
  if (channel.kind === "openai" && channel.options.sizeMode !== "flexible") return "standard";
  return channel.options.maxTier;
}

// The highest tier a channel can deliver: what it is set up for, and no more
// than a relay delivered (size_limit) when it answered a larger size with a
// smaller image, until the channel is saved again.
export function maxTier(channel) {
  const cap = capTier(channel);
  const learned = channel.kind === "mock" ? null : channel.sizeLimit?.maxTier;
  return learned && TIER_RANK[learned] < TIER_RANK[cap] ? learned : cap;
}

export const serves = (channel, tier) => TIER_RANK[tier] <= TIER_RANK[maxTier(channel)];
export const takesQuality = (channel, quality) => channel.options.qualities.includes(quality);

function usableChannels() {
  return db.prepare("SELECT kind, options, size_limit FROM channels WHERE enabled = 1 AND (kind = 'mock' OR api_key_enc <> '')").all()
    .map((r) => {
      let options = {}, sizeLimit = null;
      try { options = JSON.parse(r.options || "{}"); } catch { /* defaults */ }
      try { sizeLimit = r.size_limit ? JSON.parse(r.size_limit) : null; } catch { /* none */ }
      return { kind: r.kind, options: cleanOptions(options), sizeLimit };
    });
}

// The highest tier usable channels deliver, counting only those that take
// `quality` when one is given; null without such a channel.
export function bestTier(quality) {
  let best = null;
  for (const c of usableChannels()) {
    if (quality && !takesQuality(c, quality)) continue;
    const tier = maxTier(c);
    if (best === null || TIER_RANK[tier] > TIER_RANK[best]) best = tier;
  }
  return best;
}

export const tierAvailable = (tier, quality) => { const best = bestTier(quality); return best !== null && TIER_RANK[tier] <= TIER_RANK[best]; };

// The 画质 some usable channel takes; all of them while none is usable (a job
// then fails with NO_CHANNEL anyway).
export function offeredQualities() {
  const usable = usableChannels();
  return usable.length ? QUALITIES.filter((q) => usable.some((c) => takesQuality(c, q))) : QUALITIES;
}

export const qualityAvailable = (quality) => offeredQualities().includes(quality);

// The channel a job of this tier and 画质 would go to first, for estimates.
export function primaryChannel(tier = "standard", quality = "") {
  const fits = enabledChannels().filter((c) => (c.kind === "mock" || c.apiKey) && serves(c, tier));
  return fits.find((c) => !quality || takesQuality(c, quality)) || fits[0] || null;
}

// Unsaved editor values as a channel the providers can call, so the model list
// can be fetched before saving. A saved channel's key stands in while the
// form still shows it masked.
export function draft(input, existingId) {
  const existing = existingId ? row(existingId) : null;
  const kind = KINDS.includes(input.kind) ? input.kind : existing?.kind || "openai";
  const baseUrl = String(input.baseUrl ?? existing?.base_url ?? "").trim().slice(0, 300);
  if (baseUrl && !/^https?:\/\/[^\s]+$/i.test(baseUrl) && !/^[\w.-]+(:\d+)?(\/[^\s]*)?$/.test(baseUrl)) {
    throw badRequest("INVALID_INPUT", "Base URL 格式不正确");
  }
  const key = input.apiKey;
  let apiKey = typeof key === "string" ? key.trim() : "";
  if (!apiKey && existing && (key === undefined || (key && typeof key === "object" && key.__secret))) {
    try { apiKey = decryptSecret(existing.api_key_enc); } catch { apiKey = ""; }
  }
  let existingOptions = {};
  try { existingOptions = existing ? JSON.parse(existing.options || "{}") : {}; } catch { /* ignore */ }
  return { id: existing?.id || 0, kind, base_url: baseUrl, apiKey, model: String(input.model ?? existing?.model ?? DEFAULT_MODEL[kind]),
    options: cleanOptions(input.options || {}, existingOptions), sizeLimit: null };
}

// A model list as the editor shows it: models PoseWear recognises first, then
// ones that look like image models, then the rest (relays list chat models too).
export function describeModels(list) {
  const seen = new Set();
  const items = [];
  for (const m of list) {
    const id = String(m.id || "").trim();
    if (!id || seen.has(id) || !/^[\w.:/-]{1,100}$/.test(id)) continue;
    seen.add(id);
    const profile = profileFor(id);
    items.push({ id, name: String(m.name || "").slice(0, 100), profile: profile?.id || null, image: !!profile || IMAGE_MODEL_HINT.test(id) });
  }
  const rank = (m) => (m.profile ? 0 : m.image ? 1 : 2);
  return items.sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, 1000);
}

export function clearSizeLimit(id) {
  db.prepare("UPDATE channels SET size_limit = NULL WHERE id = ?").run(id);
}

// A channel answered `requested` with a smaller image: hold it to maxTier. A
// result of a job sent before the channel was last saved is ignored, since the
// channel may point somewhere else now.
export function limitSizes(id, { maxTier, requested, delivered, since = Date.now() }) {
  const sizeLimit = { maxTier, requested, delivered, at: Date.now() };
  db.prepare("UPDATE channels SET size_limit = ? WHERE id = ? AND updated_at <= ?").run(JSON.stringify(sizeLimit), id, since);
  return sizeLimit;
}

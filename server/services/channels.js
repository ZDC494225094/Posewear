import { db, tx } from "../db.js";
import { encryptSecret, decryptSecret, maskSecret } from "../lib/crypto.js";
import { badRequest, notFound } from "../lib/errors.js";
import { TIERS, TIER_RANK } from "./sizes.js";
import { QUALITIES, profileFor, IMAGE_MODEL_HINT } from "./models.js";

// A channel is one way to reach image models: an API, a base URL and a key.
// kind "openai" speaks the OpenAI Image API (or a relay's copy of it), kind
// "gemini" Google's generateContent (Nano Banana), kind "mock" draws
// placeholders. A channel offers one or more models (channel_models), each with
// its own 清晰度, 画质 and cost. For a job the worker tries, in order, the
// models 清晰度分配 (tier_routes) names for its tier, or else every model that
// draws that tier, by channel priority.

export const KINDS = ["openai", "gemini", "mock"];
export const DEFAULT_MODEL = { openai: "gpt-image-2", gemini: "gemini-3.1-flash-image", mock: "mock" };

// A model's cost for the dashboard's margin numbers. "auto" is the model's
// official price (models.js); "token" and "image" are what the admin pays the
// relay: per 1M tokens, or per image of each 清晰度.
const DEFAULT_PRICING = { mode: "auto", currency: "usd", textInput: 0, imageInput: 0, imageOutput: 0, textOutput: 0,
  standard: 0, hd: 0, uhd: 0 };

// How to reach the API: one set per channel.
const CHANNEL_OPTIONS = {
  geminiAuth: "goog",        // goog: x-goog-api-key header | bearer: Authorization header (some relays)
  timeoutSec: 0,             // 0 = use the global setting
  connectTimeoutSec: 30,     // TCP/TLS deadline, separate from the full request
  maxConcurrency: 0,         // 0 = unlimited; counts every model of the channel (one account's rate limit)
  omitParams: [],            // e.g. ["moderation", "safety_identifier"] for strict relays
  imageField: "image[]",     // multipart field name for input images; some relays expect "image"
  extraHeaders: {},
  mockDelayMs: 1800
};

// What a model draws and costs: one set per model.
const MODEL_OPTIONS = {
  sizeMode: "flexible",      // flexible | fixed | auto  (OpenAI API)
  inputFidelity: "omit",     // omit | high | low  (gpt-image-2 requires omit)
  maxTier: "uhd",            // the largest 清晰度 the model is used for
  qualities: QUALITIES,      // the 画质 it takes; others go to other models
  pricing: DEFAULT_PRICING
};
const MODEL_KEYS = Object.keys(MODEL_OPTIONS);

const OMITTABLE = ["moderation", "safety_identifier", "output_format", "output_compression", "quality", "n"];

const parse = (json, fallback) => { try { return json ? JSON.parse(json) : fallback; } catch { return fallback; } };
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj && obj[k] !== undefined).map((k) => [k, obj[k]]));
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

function cleanChannelOptions(input = {}, base = {}) {
  const o = { ...CHANNEL_OPTIONS, ...base, ...input };
  const headers = {};
  if (o.extraHeaders && typeof o.extraHeaders === "object") {
    for (const [k, v] of Object.entries(o.extraHeaders).slice(0, 10)) {
      const key = String(k).trim();
      if (/^[A-Za-z0-9-]{1,64}$/.test(key) && !/^(authorization|content-type|content-length|host|x-goog-api-key)$/i.test(key)) {
        headers[key] = String(v).slice(0, 500);
      }
    }
  }
  return {
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

function cleanModelOptions(input = {}, base = {}) {
  const o = { ...MODEL_OPTIONS, ...base, ...input };
  const qualities = Array.isArray(o.qualities) ? QUALITIES.filter((q) => o.qualities.includes(q)) : QUALITIES;
  return {
    sizeMode: ["flexible", "fixed", "auto"].includes(o.sizeMode) ? o.sizeMode : "flexible",
    inputFidelity: ["omit", "high", "low"].includes(o.inputFidelity) ? o.inputFidelity : "omit",
    maxTier: TIERS.includes(o.maxTier) ? o.maxTier : "uhd",
    qualities: qualities.length ? qualities : QUALITIES,
    // A partial pricing object (from the API) changes only the fields it names.
    pricing: cleanPricing({ ...(base.pricing || {}), ...(input.pricing || {}) })
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

const resolvedBase = (c) => (c.kind === "openai" ? resolveBaseUrl(c.base_url) : c.kind === "gemini" ? resolveGeminiBaseUrl(c.base_url) : "");

function channelRow(id) {
  const r = db.prepare("SELECT * FROM channels WHERE id = ?").get(id);
  if (!r) throw notFound("渠道不存在");
  return r;
}

function modelRow(id) {
  const r = db.prepare("SELECT * FROM channel_models WHERE id = ?").get(id);
  if (!r) throw notFound("模型不存在");
  return r;
}

function hydrateChannel(r, { keys = true } = {}) {
  let apiKey = "";
  if (keys) { try { apiKey = decryptSecret(r.api_key_enc); } catch { apiKey = ""; } }
  return { ...r, enabled: !!r.enabled, options: cleanChannelOptions(parse(r.options, {})), apiKey };
}

function hydrateModel(m) {
  return { ...m, enabled: !!m.enabled, options: cleanModelOptions(parse(m.options, {})),
    sizeLimit: parse(m.size_limit, null), sizes: parse(m.sizes, null) };
}

// What the providers and the worker call: a channel with one of its models.
// id stays the channel's (concurrency is per account); modelId is the model's.
function target(c, m) {
  return { ...c, model: m.model, modelId: m.id, modelSort: m.sort, options: { ...c.options, ...m.options },
    sizeLimit: m.sizeLimit, sizes: m.sizes };
}

const modelsOf = (channelId) => db.prepare("SELECT * FROM channel_models WHERE channel_id = ? ORDER BY sort, id").all(channelId).map(hydrateModel);

// Channel–model pairs in failover order (channel priority, then model order).
function targets({ usable = false, keys = true } = {}) {
  const chans = db.prepare(`SELECT * FROM channels ${usable ? "WHERE enabled = 1 AND (kind = 'mock' OR api_key_enc <> '')" : ""}
    ORDER BY priority DESC, id`).all().map((c) => hydrateChannel(c, { keys }));
  const byChannel = new Map();
  for (const m of db.prepare(`SELECT * FROM channel_models ${usable ? "WHERE enabled = 1" : ""} ORDER BY sort, id`).all()) {
    if (!byChannel.has(m.channel_id)) byChannel.set(m.channel_id, []);
    byChannel.get(m.channel_id).push(hydrateModel(m));
  }
  return chans.flatMap((c) => (byChannel.get(c.id) || []).map((m) => target(c, m)));
}

// Enabled channels with a key (or mock) and their enabled models.
export const usableTargets = () => targets({ usable: true });

// A model with its channel, for the admin's tests.
export function getTarget(modelId) {
  const m = hydrateModel(modelRow(modelId));
  return target(hydrateChannel(channelRow(m.channel_id)), m);
}

export function getChannel(id) {
  return hydrateChannel(channelRow(id));
}

export function enabledChannels() {
  return db.prepare("SELECT * FROM channels WHERE enabled = 1 ORDER BY priority DESC, id").all().map(hydrateChannel);
}

export function hasUsableChannel() {
  return db.prepare(`SELECT 1 FROM channels c JOIN channel_models m ON m.channel_id = c.id
    WHERE c.enabled = 1 AND m.enabled = 1 AND (c.kind = 'mock' OR c.api_key_enc <> '') LIMIT 1`).get() !== undefined;
}

// ---------- what a model can do

// The highest tier a model is set up for: its 最高清晰度, but on the OpenAI
// API only with custom sizes (gpt-image-2, 2.5); the fixed sizes of
// gpt-image-1.5 and 1-mini and "auto" stay at 1024-class images.
export function capTier(t) {
  if (t.kind === "mock") return "uhd";
  if (t.kind === "openai" && t.options.sizeMode !== "flexible") return "standard";
  return t.options.maxTier;
}

// The highest tier a model can deliver: what it is set up for, and no more
// than it delivered (size_limit) when a size check or a job got a smaller
// image than asked for, until the model or its channel is changed.
export function maxTier(t) {
  const cap = capTier(t);
  const learned = t.kind === "mock" ? null : t.sizeLimit?.maxTier;
  return learned && TIER_RANK[learned] < TIER_RANK[cap] ? learned : cap;
}

export const serves = (t, tier) => TIER_RANK[tier] <= TIER_RANK[maxTier(t)];
export const takesQuality = (t, quality) => t.options.qualities.includes(quality);

// ---------- 清晰度分配

export function routes() {
  const out = { standard: [], hd: [], uhd: [] };
  for (const r of db.prepare("SELECT tier, model_id FROM tier_routes ORDER BY tier, sort, model_id").all()) out[r.tier]?.push(r.model_id);
  return out;
}

export function setRoutes(input) {
  const known = new Set(db.prepare("SELECT id FROM channel_models").all().map((r) => r.id));
  const clean = Object.fromEntries(TIERS.map((tier) => [tier,
    [...new Set((Array.isArray(input?.[tier]) ? input[tier] : []).map(Number).filter((id) => known.has(id)))].slice(0, 20)]));
  tx(() => {
    db.prepare("DELETE FROM tier_routes").run();
    const insert = db.prepare("INSERT INTO tier_routes (tier, model_id, sort) VALUES (?, ?, ?)");
    for (const tier of TIERS) clean[tier].forEach((id, i) => insert.run(tier, id, i));
  })();
  return routes();
}

// The models of `pool` that draw `tier`, in the order to try them: the ones
// 清晰度分配 names for it, in that order; when none of those can be used
// (disabled, no key, not in the pool), every model of the pool that draws it.
export function routeOrder(pool, tier, assigned = routes()) {
  const fits = pool.filter((t) => serves(t, tier));
  const routed = (assigned[tier] || []).map((id) => fits.find((t) => t.modelId === id)).filter(Boolean);
  return routed.length ? routed : fits;
}

// The highest tier usable models deliver, counting only those that take
// `quality` when one is given; null without such a model.
export function bestTier(quality) {
  let best = null;
  for (const t of targets({ usable: true, keys: false })) {
    if (quality && !takesQuality(t, quality)) continue;
    const tier = maxTier(t);
    if (best === null || TIER_RANK[tier] > TIER_RANK[best]) best = tier;
  }
  return best;
}

export const tierAvailable = (tier, quality) => { const best = bestTier(quality); return best !== null && TIER_RANK[tier] <= TIER_RANK[best]; };

// The 画质 some usable model takes; all of them while none is usable (a job
// then fails with NO_CHANNEL anyway).
export function offeredQualities() {
  const usable = targets({ usable: true, keys: false });
  return usable.length ? QUALITIES.filter((q) => usable.some((t) => takesQuality(t, q))) : QUALITIES;
}

export const qualityAvailable = (quality) => offeredQualities().includes(quality);

// The model a job of this tier and 画质 would go to first, for estimates.
export function primaryChannel(tier = "standard", quality = "") {
  const ordered = routeOrder(usableTargets(), tier);
  return ordered.find((t) => !quality || takesQuality(t, quality)) || ordered[0] || null;
}

// ---------- admin

function modelDto(m, c) {
  const t = target(c, m);
  const profile = c.kind === "mock" ? null : profileFor(m.model);
  return {
    id: m.id, channelId: m.channel_id, model: m.model, enabled: m.enabled, sort: m.sort,
    profile: profile ? { id: profile.id, label: profile.label, kind: profile.kind } : null,
    options: m.options, sizes: m.sizes, sizeLimit: m.sizeLimit, capTier: capTier(t), maxTier: maxTier(t),
    successCount: m.success_count, failureCount: m.failure_count,
    lastOkAt: m.last_ok_at, lastError: m.last_error, lastErrorAt: m.last_error_at, updatedAt: m.updated_at
  };
}

function channelDto(r) {
  const c = hydrateChannel(r);
  const models = modelsOf(c.id).map((m) => modelDto(m, c));
  const first = models[0];
  return {
    id: c.id, name: c.name, kind: c.kind, baseUrl: c.base_url, resolvedBaseUrl: resolvedBase(c),
    enabled: c.enabled, priority: c.priority,
    apiKey: { __secret: true, set: !!c.apiKey, hint: maskSecret(c.apiKey) },
    successCount: c.success_count, failureCount: c.failure_count,
    lastOkAt: c.last_ok_at, lastError: c.last_error, lastErrorAt: c.last_error_at,
    createdAt: c.created_at, updatedAt: c.updated_at,
    models,
    // The channel's settings with its first model's, flat, and that model's
    // ID and sizes, as API clients from before models were separate read them.
    options: { ...c.options, ...(first ? first.options : cleanModelOptions()) },
    model: first?.model || "", profile: first?.profile || null, maxTier: first?.maxTier || "standard", sizeLimit: first?.sizeLimit || null
  };
}

export function list() {
  return db.prepare("SELECT * FROM channels ORDER BY priority DESC, id").all().map(channelDto);
}

export const adminDto = (id) => channelDto(channelRow(id));

const validModel = (raw) => {
  const model = String(raw ?? "").trim().slice(0, 100);
  if (!/^[\w.:/-]{1,100}$/.test(model)) throw badRequest("INVALID_INPUT", "模型 ID 格式不正确");
  return model;
};

function checkQualities(options) {
  if (Array.isArray(options?.qualities) && !QUALITIES.some((q) => options.qualities.includes(q))) {
    throw badRequest("INVALID_INPUT", "至少选择一种画质");
  }
}

function validateChannel(input, existing) {
  const kind = input.kind ?? existing?.kind ?? "openai";
  if (!KINDS.includes(kind)) throw badRequest("INVALID_INPUT", "渠道类型不正确");
  const name = String(input.name ?? existing?.name ?? "").trim().slice(0, 60);
  if (!name) throw badRequest("INVALID_INPUT", "请填写渠道名称");
  const baseUrl = String(input.baseUrl ?? existing?.base_url ?? "").trim().slice(0, 300);
  if (baseUrl && !/^https?:\/\/[^\s]+$/i.test(baseUrl) && !/^[\w.-]+(:\d+)?(\/[^\s]*)?$/.test(baseUrl)) {
    throw badRequest("INVALID_INPUT", "Base URL 格式不正确");
  }
  const options = cleanChannelOptions(input.options || {}, parse(existing?.options, {}));
  const priority = Math.max(-1000, Math.min(1000, Math.round(Number(input.priority ?? existing?.priority ?? 0)) || 0));
  const enabled = input.enabled === undefined ? (existing ? !!existing.enabled : true) : !!input.enabled;
  return { kind, name, baseUrl, options, priority, enabled };
}

function keyFromInput(input, existing) {
  const key = input.apiKey;
  if (key && typeof key === "object" && key.__secret) return existing?.api_key_enc || "";
  if (typeof key === "string") return key.trim() ? encryptSecret(key.trim()) : "";
  return existing?.api_key_enc || "";
}

// A model PoseWear knows starts with its largest size and, on the OpenAI API,
// how it takes sizes; settings given with it win.
function insertModel(channelId, kind, model, options) {
  checkQualities(options);
  const profile = kind === "mock" ? null : profileFor(model);
  const defaults = profile ? { maxTier: profile.maxTier,
    ...(kind === "openai" && profile.kind === "openai" ? { sizeMode: profile.sizeMode, inputFidelity: profile.inputFidelity } : {}) } : {};
  const sort = db.prepare("SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM channel_models WHERE channel_id = ?").get(channelId).n;
  const now = Date.now();
  return db.prepare(`INSERT INTO channel_models (channel_id, model, enabled, sort, options, created_at, updated_at)
    VALUES (?, ?, 1, ?, ?, ?, ?)`).run(channelId, model, sort, JSON.stringify(cleanModelOptions({ ...defaults, ...pick(options, MODEL_KEYS) })),
    now, now).lastInsertRowid;
}

export function create(input) {
  const c = validateChannel(input);
  // A first model when one is named (API clients, the first-run seed); the
  // admin page adds models after saving the connection.
  const model = input.model !== undefined ? validModel(input.model) : c.kind === "mock" ? "mock" : null;
  const now = Date.now();
  const id = tx(() => {
    const info = db.prepare(`INSERT INTO channels (name, kind, base_url, api_key_enc, model, options, enabled, priority,
      created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(c.name, c.kind, c.baseUrl,
      keyFromInput(input), model || DEFAULT_MODEL[c.kind], JSON.stringify(c.options), c.enabled ? 1 : 0, c.priority, now, now);
    if (model) insertModel(info.lastInsertRowid, c.kind, model, input.options);
    return info.lastInsertRowid;
  })();
  return adminDto(id);
}

export function update(id, input) {
  const existing = channelRow(id);
  const c = validateChannel(input, existing);
  const key = keyFromInput(input, existing);
  // Pointing the channel somewhere else (another API, relay or key): what its
  // models' size checks learned no longer holds. Renaming or pausing keeps it.
  const moved = c.kind !== existing.kind || c.baseUrl !== existing.base_url || key !== existing.api_key_enc;
  const legacy = pick(input.options || {}, MODEL_KEYS);
  tx(() => {
    db.prepare(`UPDATE channels SET name = ?, kind = ?, base_url = ?, api_key_enc = ?, options = ?, enabled = ?, priority = ?,
      updated_at = ? WHERE id = ?`).run(c.name, c.kind, c.baseUrl, key, JSON.stringify(c.options), c.enabled ? 1 : 0, c.priority, Date.now(), id);
    if (moved) db.prepare("UPDATE channel_models SET size_limit = NULL, sizes = NULL, updated_at = ? WHERE channel_id = ?").run(Date.now(), id);
    // A model ID or model settings sent with the channel (clients from before
    // models were separate) apply to its first model.
    if (input.model !== undefined || Object.keys(legacy).length) {
      const first = modelsOf(id)[0];
      if (first) changeModel(first, { model: input.model, options: legacy });
      else if (input.model !== undefined) insertModel(id, c.kind, validModel(input.model), legacy);
    }
  })();
  return adminDto(id);
}

export function remove(id) {
  channelRow(id);
  // Its models and their place in 清晰度分配 go with it (foreign keys cascade).
  db.prepare("DELETE FROM channels WHERE id = ?").run(id);
}

// Add models to a channel by ID; ones it already has are skipped.
export function addModels(channelId, list) {
  const c = channelRow(channelId);
  const have = new Set(modelsOf(channelId).map((m) => m.model));
  const added = tx(() => {
    const ids = [];
    for (const item of (Array.isArray(list) ? list : []).slice(0, 50)) {
      const model = validModel(typeof item === "string" ? item : item?.model);
      if (have.has(model)) continue;
      have.add(model);
      ids.push(insertModel(channelId, c.kind, model, typeof item === "object" ? item.options : undefined));
    }
    return ids;
  })();
  if (added.length) db.prepare("UPDATE channels SET updated_at = ? WHERE id = ?").run(Date.now(), channelId);
  return added;
}

// A new model ID or size handling forgets what size checks learned.
function changeModel(m, { model, enabled, sort, options }) {
  checkQualities(options);
  const id = model === undefined ? m.model : validModel(model);
  if (id !== m.model && db.prepare("SELECT 1 FROM channel_models WHERE channel_id = ? AND model = ?").get(m.channel_id, id)) {
    throw badRequest("MODEL_EXISTS", "这个渠道已经有这个模型了");
  }
  const next = cleanModelOptions(options || {}, m.options);
  const reset = id !== m.model || next.sizeMode !== m.options.sizeMode;
  db.prepare(`UPDATE channel_models SET model = ?, enabled = ?, sort = ?, options = ?,
    size_limit = ${reset ? "NULL" : "size_limit"}, sizes = ${reset ? "NULL" : "sizes"}, updated_at = ? WHERE id = ?`).run(id,
    enabled === undefined ? (m.enabled ? 1 : 0) : (enabled ? 1 : 0),
    sort === undefined ? m.sort : Math.max(0, Math.min(1000, Math.round(Number(sort)) || 0)),
    JSON.stringify(next), Date.now(), m.id);
}

export function updateModel(id, input) {
  changeModel(hydrateModel(modelRow(id)), input || {});
  return modelRow(id).channel_id;
}

export function removeModel(id) {
  const m = modelRow(id);
  db.prepare("DELETE FROM channel_models WHERE id = ?").run(id);
  return m.channel_id;
}

// ---------- outcomes

export function markSuccess(t) {
  const now = Date.now();
  db.prepare("UPDATE channels SET success_count = success_count + 1, last_ok_at = ? WHERE id = ?").run(now, t.id);
  if (t.modelId) db.prepare("UPDATE channel_models SET success_count = success_count + 1, last_ok_at = ? WHERE id = ?").run(now, t.modelId);
}

export function markFailure(t, message) {
  const now = Date.now();
  const text = String(message || "").slice(0, 500);
  db.prepare("UPDATE channels SET failure_count = failure_count + 1, last_error = ?, last_error_at = ? WHERE id = ?").run(text, now, t.id);
  if (t.modelId) {
    db.prepare("UPDATE channel_models SET failure_count = failure_count + 1, last_error = ?, last_error_at = ? WHERE id = ?").run(text, now, t.modelId);
  }
}

// A size check's results per tier ({ hd: { ok, requested, delivered, at }, … }),
// and what they mean for the model: clear the limit when it drew the largest
// size asked for, else hold it to what it drew.
export function recordSizes(modelId, sizes, reached) {
  const m = hydrateModel(modelRow(modelId));
  db.prepare("UPDATE channel_models SET sizes = ?, size_limit = ? WHERE id = ?")
    .run(JSON.stringify({ ...(m.sizes || {}), ...sizes }), reached.ok ? null : JSON.stringify(reached.limit), modelId);
}

export function clearSizeLimit(modelId) {
  db.prepare("UPDATE channel_models SET size_limit = NULL WHERE id = ?").run(modelId);
}

// A model answered `requested` with a smaller image: hold it to maxTier. A
// result of a job sent before the model or its channel was last changed is
// ignored, since it may point somewhere else now.
export function limitSizes(modelId, { maxTier, requested, delivered, since = Date.now() }) {
  const sizeLimit = { maxTier, requested, delivered, at: Date.now() };
  db.prepare("UPDATE channel_models SET size_limit = ? WHERE id = ? AND updated_at <= ?").run(JSON.stringify(sizeLimit), modelId, since);
  return sizeLimit;
}

// ---------- model lists

// Unsaved editor values as a channel the providers can call, so the model list
// can be fetched before saving. A saved channel's key stands in while the
// form still shows it masked.
export function draft(input, existingId) {
  const existing = existingId ? channelRow(existingId) : null;
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
  return { id: existing?.id || 0, kind, base_url: baseUrl, apiKey, model: "",
    options: { ...cleanChannelOptions(input.options || {}, parse(existing?.options, {})), ...cleanModelOptions() }, sizeLimit: null };
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

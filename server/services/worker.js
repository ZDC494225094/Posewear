import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { db, tx } from "../db.js";
import * as settings from "./settings.js";
import * as credits from "./credits.js";
import * as library from "./library.js";
import * as uploads from "./uploads.js";
import * as channels from "./channels.js";
import * as assetJobs from "./asset-jobs.js";
import * as wedding from "./wedding.js";
import * as fees from "./asset-fees.js";
import { InputError } from "./asset-jobs.js";
import { providerFor, ProviderError, PUBLIC_MESSAGES } from "./providers/index.js";
import { summarizeFailures } from "./providers/errors.js";
import { finalizeImage, withoutWatermark } from "./image-post.js";
import { apiCostUsd } from "./pricing.js";
import { sizeForChannel, flexibleSize, dims, deliveredTier, TIERS, TIER_RANK } from "./sizes.js";
import { genRoot, imageFile } from "./generations.js";
import { randomId, sha256 } from "../lib/crypto.js";
import { config } from "../config.js";
import { log } from "../lib/logger.js";

// In-process job queue backed by the generations table. Jobs survive restarts:
// anything left "running" is put back in the queue on startup.

const running = new Map();          // generation id -> { promise, userId }
const channelActive = new Map();    // channel id -> in-flight count
let preparing = 0;                  // claimed jobs that have not reached a channel yet
let timer = null;
let stopping = false;
let lastSweep = 0;

export function start() {
  const recovered = db.prepare("UPDATE generations SET status = 'queued', next_attempt_at = NULL WHERE status = 'running'").run();
  if (recovered.changes) log.warn(`Re-queued ${recovered.changes} generation(s) interrupted by a restart`);
  timer = setInterval(tick, 1500);
  timer.unref();
  setImmediate(tick);
}

export async function stop() {
  stopping = true;
  if (timer) clearInterval(timer);
  await Promise.allSettled([...running.values()].map((r) => r.promise));
}

export function kick() {
  if (timer && !stopping) setImmediate(tick);
}

export function stats() {
  return { running: running.size, channelActive: Object.fromEntries(channelActive) };
}

// Oldest queued job, preferring users with nothing running, so one large
// order (a wedding album, a batch of assets) doesn't hold up everyone else.
// started_at is the first start: a retry or a wait for a free channel doesn't
// restart the clock the studio shows.
const claimSql = (fair) => db.prepare(`UPDATE generations SET status = 'running', started_at = COALESCE(started_at, ?), attempts = attempts + 1
  WHERE id = (SELECT id FROM generations WHERE status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
    ${fair ? "AND user_id NOT IN (SELECT value FROM json_each(?))" : ""}
    ORDER BY created_at LIMIT 1)
  RETURNING *`);
const claimFair = claimSql(true);
const claimAny = claimSql(false);

function claim() {
  const now = Date.now();
  const busy = JSON.stringify([...new Set([...running.values()].map((r) => r.userId))]);
  return claimFair.get(now, now, busy) || claimAny.get(now, now);
}

// Slots left on the channels, so jobs aren't claimed (and their images
// prepared) only to wait for a channel. No usable channel: let runJob fail them.
function channelRoom() {
  const usable = channels.enabledChannels().filter((c) => c.kind === "mock" || c.apiKey);
  if (!usable.length || usable.some((c) => !c.options.maxConcurrency)) return Infinity;
  return usable.reduce((n, c) => n + Math.max(0, c.options.maxConcurrency - (channelActive.get(c.id) || 0)), 0);
}

function tick() {
  if (stopping) return;
  sweep();
  const limit = settings.get("generation").workerConcurrency;
  while (running.size < limit && channelRoom() > preparing) {
    const job = claim();
    if (!job) break;
    preparing += 1;
    const entry = { userId: job.user_id, prepared: false };
    entry.promise = runJob(job, () => { if (!entry.prepared) { entry.prepared = true; preparing -= 1; } })
      .catch((err) => log.error(`Generation ${job.id} crashed`, err))
      .finally(() => {
        if (!entry.prepared) { entry.prepared = true; preparing -= 1; }
        running.delete(job.id);
        kick();
      });
    running.set(job.id, entry);
  }
}

// A job marked running that this worker isn't running was orphaned by an error
// while recording its outcome; put it back in the queue.
function sweep() {
  if (Date.now() - lastSweep < 60_000) return;
  lastSweep = Date.now();
  const stale = db.prepare("SELECT id FROM generations WHERE status = 'running' AND started_at < ?").all(Date.now() - 60_000);
  for (const { id } of stale) {
    if (running.has(id)) continue;
    db.prepare("UPDATE generations SET status = 'queued', next_attempt_at = NULL WHERE id = ? AND status = 'running'").run(id);
    log.warn(`Re-queued generation ${id}, which was left running`);
  }
}

// ---------- inputs

async function prepare(file, { lineArt, maxEdge }) {
  const pipeline = sharp(file, { limitInputPixels: 80_000_000 }).rotate()
    .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true });
  // Line-art poses compress well as PNG; photos go as JPEG, which every relay accepts.
  return lineArt
    ? { buffer: await pipeline.flatten({ background: "#ffffff" }).png().toBuffer(), mime: "image/png", ext: "png" }
    : { buffer: await pipeline.flatten({ background: "#ffffff" }).jpeg({ quality: 92 }).toBuffer(), mime: "image/jpeg", ext: "jpg" };
}

async function loadInputs(job) {
  const maxEdge = settings.get("generation").inputMaxEdge;
  const images = [];
  // 超分 sends only the image being redrawn, without its "AI生成" label, at up
  // to 2048 px so the model sees its detail.
  if (job.upscale_of) {
    const row = db.prepare("SELECT path FROM generation_images WHERE id = ?").get(job.upscale_of);
    if (!row || !fs.existsSync(imageFile(row.path))) throw new InputError("要超分的图片已被删除");
    const source = await withoutWatermark(imageFile(row.path));
    return [{ ...(await prepare(source, { lineArt: false, maxEdge: Math.max(maxEdge, 2048) })), name: "image.jpg" }];
  }
  if (job.kind === "asset" || job.shoot_id) {
    const inputs = job.kind === "asset" ? assetJobs.inputFiles(job) : wedding.inputFiles(job);
    for (const input of inputs) {
      images.push({ ...(await prepare(input.file, { lineArt: !!input.lineArt, maxEdge })), name: input.name });
    }
    return images.map((img) => ({ ...img, name: `${img.name}.${img.ext}` }));
  }
  if (job.pose_id) {
    const asset = library.getAsset(job.pose_id);
    const file = asset && library.aiSourceFile(asset);
    if (!file || !fs.existsSync(file)) throw new InputError("姿势参考图文件缺失");
    images.push({ ...(await prepare(file, { lineArt: true, maxEdge })), name: "pose" });
  }
  if (job.outfit_id) {
    const asset = library.getAsset(job.outfit_id);
    const file = asset && library.aiSourceFile(asset);
    if (!file || !fs.existsSync(file)) throw new InputError("服装参考图文件缺失");
    images.push({ ...(await prepare(file, { lineArt: false, maxEdge })), name: "outfit" });
  } else if (job.outfit_upload_id) {
    const row = db.prepare("SELECT * FROM uploads WHERE id = ?").get(job.outfit_upload_id);
    if (!row || row.deleted_at) throw new InputError("上传的服装图片已被删除");
    images.push({ ...(await prepare(uploads.uploadFile(row), { lineArt: false, maxEdge })), name: "outfit" });
  }
  if (job.person_upload_id) {
    const row = db.prepare("SELECT * FROM uploads WHERE id = ?").get(job.person_upload_id);
    if (!row || row.deleted_at) throw new InputError("人物照片已被删除");
    images.push({ ...(await prepare(uploads.uploadFile(row), { lineArt: false, maxEdge })), name: "person" });
  } else if (job.person_image_id) {
    const row = db.prepare("SELECT path FROM generation_images WHERE id = ?").get(job.person_image_id);
    if (!row || !fs.existsSync(imageFile(row.path))) throw new InputError("作为人物的作品图片已被删除");
    images.push({ ...(await prepare(imageFile(row.path), { lineArt: false, maxEdge })), name: "person" });
  }
  // Scene and items follow the person, in the order the prompt numbers them.
  const extras = [...(job.scene_asset_id ? [[job.scene_asset_id, "scene", "场景"]] : []),
    ...JSON.parse(job.item_ids || "[]").map((id, i) => [id, `item-${i + 1}`, "物品"])];
  for (const [id, name, label] of extras) {
    const asset = library.getAsset(id);
    const file = asset && library.aiSourceFile(asset);
    if (!file || !fs.existsSync(file)) throw new InputError(`${label}参考图文件缺失`);
    images.push({ ...(await prepare(file, { lineArt: false, maxEdge })), name });
  }
  return images.map((img) => ({ ...img, name: `${img.name}.${img.ext}` }));
}

// ---------- outcomes

const refundRemaining = (job, reason) => {
  const fresh = db.prepare("SELECT cost_credits, refunded_credits FROM generations WHERE id = ?").get(job.id);
  const amount = fresh.cost_credits - fresh.refunded_credits;
  if (amount > 0) {
    credits.adjust(job.user_id, amount, "refund", { refType: "generation", refId: job.id, note: reason });
    db.prepare("UPDATE generations SET refunded_credits = refunded_credits + ? WHERE id = ?").run(amount, job.id);
  }
};

// The refund includes any usage fee; the held fee is released, not paid out.
// Free jobs (admin asset generation) have nothing to refund, so their message says nothing about it.
const fail = tx((job, { code, publicMessage, detail }) => {
  let message = publicMessage || PUBLIC_MESSAGES.internal;
  if (!job.cost_credits) message = message.replace(/，本次点数已退回。$/, "。").replace(/本次点数已退回。$/, "");
  db.prepare(`UPDATE generations SET status = 'failed', error_code = ?, error_message = ?, error_detail = ?,
    finished_at = ?, next_attempt_at = NULL WHERE id = ?`)
    .run(code || "FAILED", message, String(detail || "").slice(0, 4000), Date.now(), job.id);
  refundRemaining(job, "生成失败退回");
  fees.release(job.id);
});

function requeue(job, delayMs, { countAttempt = true, detail = "" } = {}) {
  db.prepare(`UPDATE generations SET status = 'queued', next_attempt_at = ?, error_detail = ?,
    attempts = attempts - ? WHERE id = ?`).run(Date.now() + delayMs, String(detail).slice(0, 4000), countAttempt ? 0 : 1, job.id);
}

async function saveResults(job, result, channel, size, short = false) {
  const stored = [];
  const month = new Date().toISOString().slice(0, 7);
  const dir = path.join(genRoot, month);
  fs.mkdirSync(dir, { recursive: true });
  const images = result.images.slice(0, job.n);
  try {
    await writeImages(job, images, month, stored);
  } catch (err) {
    removeImages(stored);
    throw err;
  }
  const cost = apiCostUsd({ usage: result.usage, quality: job.quality, size, n: images.length, channel });
  try {
    recordResults(job, stored, channel, size, result, cost, short);
  } catch (err) {
    removeImages(stored);
    throw err;
  }
}

async function writeImages(job, images, month, stored) {
  for (let i = 0; i < images.length; i++) {
    const imageId = randomId(14);
    const final = await finalizeImage(images[i], { imageId, generationId: job.id });
    const base = `${month}/${job.id}-${i}-${imageId}`;
    const entry = { imageId, idx: i, rel: `${base}.${final.format}`, thumbRel: `${base}.thumb.webp`, viewRel: `${base}.view.webp`, final };
    stored.push(entry);
    fs.writeFileSync(imageFile(entry.rel), final.buffer);
    fs.writeFileSync(imageFile(entry.thumbRel), final.thumb);
    if (final.view) fs.writeFileSync(imageFile(entry.viewRel), final.view);
  }
}

// Files of a result that couldn't be recorded.
function removeImages(stored) {
  for (const s of stored) for (const rel of [s.rel, s.thumbRel, s.viewRel]) fs.rmSync(imageFile(rel), { force: true });
}

function recordResults(job, stored, channel, size, result, cost, short) {
  tx(() => {
    const insert = db.prepare(`INSERT INTO generation_images (id, generation_id, user_id, idx, path, thumb_path,
      width, height, bytes, format, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const s of stored) {
      insert.run(s.imageId, job.id, job.user_id, s.idx, s.rel, s.thumbRel, s.final.width, s.final.height,
        s.final.buffer.length, s.final.format, Date.now());
    }
    db.prepare(`UPDATE generations SET status = 'succeeded', finished_at = ?, channel_id = ?, model = ?, size = ?,
      usage = ?, api_cost_usd = ?, error_code = NULL, error_message = NULL, error_detail = NULL, next_attempt_at = NULL
      WHERE id = ?`).run(Date.now(), channel.id, channel.model, size,
      result.usage ? JSON.stringify(result.usage) : null, cost, job.id);
    // Asset owners are paid once per successful job.
    fees.settle(job.id);
    // The model may return fewer images than asked for; refund the shortfall
    // of the per-image price (the usage fee is per job and stays charged).
    if (stored.length < job.n) {
      const perImage = Math.floor((job.cost_credits - job.asset_fee) / job.n);
      const amount = perImage * (job.n - stored.length);
      if (amount > 0) {
        credits.adjust(job.user_id, amount, "refund", { refType: "generation", refId: job.id,
          note: `返回 ${stored.length}/${job.n} 张，退回差额` });
        db.prepare("UPDATE generations SET refunded_credits = refunded_credits + ? WHERE id = ?").run(amount, job.id);
      }
    }
    // A studio work that came back below its tier is charged for the tier it got.
    if (short && !job.shoot_id && !job.upscale_of) chargeAsDelivered(job, stored);
  })();
}

// Refund the difference between the tier asked for and the tier delivered,
// and record the delivered tier, so the work shows and costs what it is.
function chargeAsDelivered(job, stored) {
  const gen = settings.get("generation");
  const { width, height } = stored[0].final;
  const tier = deliveredTier(width * height, job.ratio, job.tier);
  const quality = gen.qualities.find((q) => q.id === job.quality);
  const multiplier = gen.tiers.find((t) => t.id === tier)?.multiplier ?? 1;
  const paid = Math.floor((job.cost_credits - job.asset_fee) / job.n);
  const amount = Math.max(0, paid - Math.ceil((quality?.credits ?? 0) * multiplier)) * stored.length;
  const label = gen.tiers.find((t) => t.id === tier)?.label || tier;
  const message = `生成渠道只返回了 ${width}×${height} 的图，按「${label}」清晰度收费${amount ? `，已退回 ${amount} 点` : ""}。`;
  db.prepare("UPDATE generations SET tier = ?, error_code = 'SIZE_DOWNGRADED', error_message = ? WHERE id = ?").run(tier, message, job.id);
  if (amount > 0) {
    credits.adjust(job.user_id, amount, "refund", { refType: "generation", refId: job.id, note: message });
    db.prepare("UPDATE generations SET refunded_credits = refunded_credits + ? WHERE id = ?").run(amount, job.id);
  }
}

// The request deadline grows with the size: 2K ×1.5, 4K ×2 (240 s -> 360 s, 480 s).
const TIMEOUT_SCALE = { standard: 1, hd: 1.5, uhd: 2 };

async function imageDims(image) {
  try {
    const meta = await sharp(image, { limitInputPixels: 80_000_000 }).metadata();
    return meta.width && meta.height ? [meta.width, meta.height] : null;
  } catch { return null; }
}

// ---------- main

const TIER_TEXT = { hd: "2K", uhd: "4K" };
const hasRoom = (c) => !c.options.maxConcurrency || (channelActive.get(c.id) || 0) < c.options.maxConcurrency;

// onPrepared: called once the inputs are ready and the job is about to use a channel.
async function runJob(job, onPrepared = () => {}) {
  const gen = settings.get("generation");
  // Each candidate is a channel with one of its models (a "target").
  const usable = channels.usableTargets();
  // 画质: a studio work goes only to channels that take its 画质 (the admin can
  // send 精细 to one model and 草稿 to another). Wedding photos, 超分 and asset
  // jobs prefer them but use any channel rather than fail.
  const takes = (c) => channels.takesQuality(c, job.quality);
  const studio = job.kind === "work" && !job.shoot_id && !job.upscale_of;
  if (studio && usable.length && !usable.some(takes)) {
    const label = gen.qualities.find((q) => q.id === job.quality)?.label || job.quality;
    fail(job, { code: "QUALITY_UNSUPPORTED", detail: `No enabled channel takes quality ${job.quality}`,
      publicMessage: `生成渠道现在不接「${label}」画质，本次点数已退回，可以换个画质再试。` });
    return;
  }
  const pool = studio ? usable.filter(takes) : usable;
  // Works and wedding photos at 2K or 4K, and 超分, go only to channels that
  // deliver that size; a fixed-size one would answer with a 1024-class image.
  // Asset jobs are resized to their spec, so any channel will do.
  if (job.kind === "work" && job.tier !== "standard" && pool.length && !pool.some((c) => channels.serves(c, job.tier))) {
    // No channel delivers that size any more (one fell short since the job was queued).
    const lower = TIERS.slice(0, TIER_RANK[job.tier]).reverse().find((t) => pool.some((c) => channels.serves(c, t)));
    if (job.shoot_id && lower) {
      // A wedding album is finished at the largest size still delivered rather than left with gaps.
      job = { ...job, tier: lower, size: flexibleSize(job.ratio, lower) };
      db.prepare("UPDATE generations SET tier = ?, size = ? WHERE id = ?").run(job.tier, job.size, job.id);
    } else {
      fail(job, { code: "TIER_UNSUPPORTED", detail: `No enabled channel delivers ${job.tier}`,
        publicMessage: `生成渠道现在出不了 ${TIER_TEXT[job.tier]} 的尺寸，本次点数已退回，可以换成更低的清晰度再试。` });
      return;
    }
  }
  // 清晰度分配 decides the order: the models assigned to the job's tier, or
  // every model that draws it. An asset job draws at its configured tier when a
  // model can, else at standard size like before.
  const assigned = channels.routes();
  const ordered = job.kind === "work" ? channels.routeOrder(pool, job.tier, assigned)
    : [channels.routeOrder(pool, job.tier, assigned), channels.routeOrder(pool, "standard", assigned)].find((list) => list.length) || [];
  const preferred = ordered.filter(takes);
  const candidates = preferred.length ? preferred : ordered;
  if (!candidates.length) {
    fail(job, { code: "NO_CHANNEL", publicMessage: PUBLIC_MESSAGES.unavailable, detail: "No enabled channel with an API key" });
    return;
  }
  // Every channel that could take it is at its cap: wait without preparing the
  // inputs or using up an attempt.
  if (!candidates.some(hasRoom)) {
    onPrepared();
    requeue(job, 3000, { countAttempt: false });
    return;
  }
  let inputs;
  try {
    inputs = await loadInputs(job);
  } catch (err) {
    const message = err instanceof InputError ? `${err.message}，本次点数已退回。` : PUBLIC_MESSAGES.internal;
    fail(job, { code: "INPUT_UNAVAILABLE", publicMessage: message, detail: err.stack || err.message });
    return;
  }
  const free = candidates.filter(hasRoom);
  onPrepared();
  if (!free.length) {
    // Every channel is at its concurrency cap; wait without using up an attempt.
    requeue(job, 3000, { countAttempt: false });
    return;
  }

  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(job.user_id);
  const safetyIdentifier = user ? sha256(`${config.appSecret}:user:${user.id}`).slice(0, 32) : undefined;
  const errors = [];
  for (const channel of free) {
    // An asset job may ask more than a channel draws; it gets the channel's largest.
    const tier = channels.serves(channel, job.tier) ? job.tier : channels.maxTier(channel);
    const size = job.upscale_of ? job.size
      : channel.kind === "gemini" ? flexibleSize(job.ratio, tier) : sizeForChannel(job.ratio, tier, channel.options.sizeMode);
    channelActive.set(channel.id, (channelActive.get(channel.id) || 0) + 1);
    const sentAt = Date.now();
    let result;
    try {
      result = await providerFor(channel).run(channel, {
        prompt: job.prompt_final, images: inputs, size, ratio: job.ratio, tier, quality: job.quality, n: job.n,
        moderation: gen.moderation, outputFormat: "png", outputCompression: gen.outputCompression,
        // Larger images take longer; timing out would pay for the image and then retry it.
        safetyIdentifier, timeoutSec: gen.requestTimeoutSec, timeoutScale: TIMEOUT_SCALE[job.tier] || 1
      });
    } catch (err) {
      const perr = err instanceof ProviderError ? err
        : new ProviderError("transient", err?.message || String(err), { code: "INTERNAL", publicMessage: PUBLIC_MESSAGES.internal });
      errors.push({ channel: channel.id, kind: perr.kind, code: perr.code, status: perr.status, message: perr.message,
        publicMessage: perr.publicMessage, detail: perr.detail || undefined });
      if (perr.kind === "user") {
        channels.markSuccess(channel); // the channel worked; the request was refused
        fail(job, { code: perr.code || "REJECTED", publicMessage: perr.publicMessage || PUBLIC_MESSAGES.rejected,
          detail: JSON.stringify(errors) });
        log.info(`Generation ${job.id} rejected by model: ${perr.code} ${perr.message}`);
        return;
      }
      channels.markFailure(channel, `${perr.code || ""} ${perr.message}`.trim());
      log.warn(`Generation ${job.id} failed on channel #${channel.id} (${perr.kind}): ${perr.message}`);
      continue;
    } finally {
      channelActive.set(channel.id, Math.max(0, (channelActive.get(channel.id) || 1) - 1));
    }
    // The channel delivered (and was paid). A failure from here on is ours:
    // don't blame the channel or ask another one, refund and stop.
    channels.markSuccess(channel);
    // What really came back: some relays take the size and answer a 1024-class
    // image. A 2K or 4K job that got under 80% of its pixels holds the channel to
    // what it delivered; a 超分 that came back no larger isn't one.
    const got = await imageDims(result.images[0]);
    const delivered = got ? `${got[0]}x${got[1]}` : result.size && result.size !== "auto" ? result.size : size;
    const wanted = dims(size);
    const short = tier !== "standard" && !!got && !!wanted && got[0] * got[1] < wanted[0] * wanted[1] * 0.8;
    if (short) {
      channels.limitSizes(channel.modelId, { maxTier: deliveredTier(got[0] * got[1], job.ratio, tier),
        requested: size, delivered, since: sentAt });
      log.warn(`Generation ${job.id}: channel #${channel.id} answered ${size} with ${delivered}`);
      if (job.upscale_of) {
        fail(job, { code: "UPSCALE_TOO_SMALL", publicMessage: "生成渠道没有返回更高分辨率的图片，本次点数已退回。",
          detail: `asked for ${size}, channel #${channel.id} returned ${delivered}` });
        return;
      }
    }
    try {
      const save = job.kind === "asset" ? assetJobs.saveResults : saveResults;
      await save(job, result, channel, delivered, short);
    } catch (err) {
      log.error(`Generation ${job.id}: saving the result from channel #${channel.id} failed`, err);
      fail(job, { code: "SAVE_FAILED", publicMessage: PUBLIC_MESSAGES.internal, detail: err.stack || err.message });
      return;
    }
    log.info(`Generation ${job.id} succeeded on channel #${channel.id} (${result.images.length} image(s))`);
    return;
  }

  const transient = errors.some((e) => e.kind === "transient");
  if (transient && job.attempts < gen.maxAttempts) {
    const delay = Math.min(120_000, 5000 * 2 ** (job.attempts - 1));
    requeue(job, delay, { detail: JSON.stringify(errors) });
    log.info(`Generation ${job.id} will retry in ${Math.round(delay / 1000)}s (attempt ${job.attempts}/${gen.maxAttempts})`);
    return;
  }
  fail(job, summarizeFailures(errors));
}

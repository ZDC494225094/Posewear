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
import * as fees from "./asset-fees.js";
import { InputError } from "./asset-jobs.js";
import { providerFor, ProviderError, PUBLIC_MESSAGES } from "./providers/index.js";
import { finalizeImage } from "./image-post.js";
import { apiCostUsd } from "./pricing.js";
import { sizeForChannel } from "./sizes.js";
import { genRoot, imageFile } from "./generations.js";
import { randomId, sha256 } from "../lib/crypto.js";
import { config } from "../config.js";
import { log } from "../lib/logger.js";

// In-process job queue backed by the generations table. Jobs survive restarts:
// anything left "running" is put back in the queue on startup.

const running = new Map();          // generation id -> promise
const channelActive = new Map();    // channel id -> in-flight count
let timer = null;
let stopping = false;

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
  await Promise.allSettled([...running.values()]);
}

export function kick() {
  if (timer && !stopping) setImmediate(tick);
}

export function stats() {
  return { running: running.size, channelActive: Object.fromEntries(channelActive) };
}

const claim = db.prepare(`UPDATE generations SET status = 'running', started_at = ?, attempts = attempts + 1
  WHERE id = (SELECT id FROM generations WHERE status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
    ORDER BY created_at LIMIT 1)
  RETURNING *`);

function tick() {
  if (stopping) return;
  const limit = settings.get("generation").workerConcurrency;
  while (running.size < limit) {
    const job = claim.get(Date.now(), Date.now());
    if (!job) break;
    const promise = runJob(job)
      .catch((err) => log.error(`Generation ${job.id} crashed`, err))
      .finally(() => { running.delete(job.id); kick(); });
    running.set(job.id, promise);
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
  if (job.kind === "asset") {
    for (const input of assetJobs.inputFiles(job)) {
      images.push({ ...(await prepare(input.file, { lineArt: input.lineArt, maxEdge })), name: input.name });
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

async function saveResults(job, result, channel, size) {
  const stored = [];
  const month = new Date().toISOString().slice(0, 7);
  const dir = path.join(genRoot, month);
  fs.mkdirSync(dir, { recursive: true });
  const images = result.images.slice(0, job.n);
  for (let i = 0; i < images.length; i++) {
    const imageId = randomId(14);
    const final = await finalizeImage(images[i], { imageId, generationId: job.id });
    const rel = `${month}/${job.id}-${i}-${imageId}.${final.format}`;
    const thumbRel = `${month}/${job.id}-${i}-${imageId}.thumb.webp`;
    fs.writeFileSync(imageFile(rel), final.buffer);
    fs.writeFileSync(imageFile(thumbRel), final.thumb);
    stored.push({ imageId, idx: i, rel, thumbRel, final });
  }
  const cost = apiCostUsd({ usage: result.usage, quality: job.quality, size, n: images.length });
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
  })();
}

// ---------- main

async function runJob(job) {
  const gen = settings.get("generation");
  let inputs;
  try {
    inputs = await loadInputs(job);
  } catch (err) {
    const message = err instanceof InputError ? `${err.message}，本次点数已退回。` : PUBLIC_MESSAGES.internal;
    fail(job, { code: "INPUT_UNAVAILABLE", publicMessage: message, detail: err.stack || err.message });
    return;
  }

  const candidates = channels.enabledChannels().filter((c) => c.kind === "mock" || c.apiKey);
  if (!candidates.length) {
    fail(job, { code: "NO_CHANNEL", publicMessage: PUBLIC_MESSAGES.unavailable, detail: "No enabled channel with an API key" });
    return;
  }
  const free = candidates.filter((c) => !c.options.maxConcurrency || (channelActive.get(c.id) || 0) < c.options.maxConcurrency);
  if (!free.length) {
    // Every channel is at its concurrency cap; wait without using up an attempt.
    requeue(job, 3000, { countAttempt: false });
    return;
  }

  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(job.user_id);
  const safetyIdentifier = user ? sha256(`${config.appSecret}:user:${user.id}`).slice(0, 32) : undefined;
  const errors = [];
  for (const channel of free) {
    const size = sizeForChannel(job.ratio, job.tier, channel.options.sizeMode);
    channelActive.set(channel.id, (channelActive.get(channel.id) || 0) + 1);
    try {
      const result = await providerFor(channel).run(channel, {
        prompt: job.prompt_final, images: inputs, size, quality: job.quality, n: job.n,
        moderation: gen.moderation, outputFormat: "png", outputCompression: gen.outputCompression,
        safetyIdentifier, timeoutSec: gen.requestTimeoutSec
      });
      const save = job.kind === "asset" ? assetJobs.saveResults : saveResults;
      await save(job, result, channel, result.size && result.size !== "auto" ? result.size : size);
      channels.markSuccess(channel.id);
      log.info(`Generation ${job.id} succeeded on channel #${channel.id} (${result.images.length} image(s))`);
      return;
    } catch (err) {
      const perr = err instanceof ProviderError ? err
        : new ProviderError("transient", err?.message || String(err), { code: "INTERNAL", publicMessage: PUBLIC_MESSAGES.internal });
      errors.push({ channel: channel.id, kind: perr.kind, code: perr.code, status: perr.status, message: perr.message });
      if (perr.kind === "user") {
        channels.markSuccess(channel.id); // the channel worked; the request was refused
        fail(job, { code: perr.code || "REJECTED", publicMessage: perr.publicMessage || PUBLIC_MESSAGES.rejected,
          detail: JSON.stringify(errors) + (perr.detail ? `\n${perr.detail}` : "") });
        log.info(`Generation ${job.id} rejected by model: ${perr.code} ${perr.message}`);
        return;
      }
      channels.markFailure(channel.id, `${perr.code || ""} ${perr.message}`.trim());
      log.warn(`Generation ${job.id} failed on channel #${channel.id} (${perr.kind}): ${perr.message}`);
    } finally {
      channelActive.set(channel.id, Math.max(0, (channelActive.get(channel.id) || 1) - 1));
    }
  }

  const transient = errors.some((e) => e.kind === "transient");
  if (transient && job.attempts < gen.maxAttempts) {
    const delay = Math.min(120_000, 5000 * 2 ** (job.attempts - 1));
    requeue(job, delay, { detail: JSON.stringify(errors) });
    log.info(`Generation ${job.id} will retry in ${Math.round(delay / 1000)}s (attempt ${job.attempts}/${gen.maxAttempts})`);
    return;
  }
  const last = errors.at(-1);
  fail(job, {
    code: last?.kind === "channel" ? "CHANNEL_ERROR" : "UPSTREAM_ERROR",
    publicMessage: transient ? PUBLIC_MESSAGES.busy : PUBLIC_MESSAGES.unavailable,
    detail: JSON.stringify(errors)
  });
}

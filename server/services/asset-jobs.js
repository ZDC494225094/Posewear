import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { db, tx } from "../db.js";
import * as settings from "./settings.js";
import * as credits from "./credits.js";
import * as library from "./library.js";
import * as taxonomy from "./taxonomy.js";
import * as uploads from "./uploads.js";
import * as channels from "./channels.js";
import { findBannedWord } from "./prompt.js";
import { apiCostUsd } from "./pricing.js";
import { flexibleSize } from "./sizes.js";
import { aigcLabel } from "./image-post.js";
import { addPngText } from "../lib/png-text.js";
import { randomId } from "../lib/crypto.js";
import { badRequest, forbidden, notFound, HttpError } from "../lib/errors.js";
import { enforce } from "../lib/rate-limit.js";
import { startOfLocalDay } from "../lib/time.js";
import * as v from "../lib/validate.js";

// Generating library assets with the image model. Jobs are rows in the
// generations table (kind = 'asset') and run on the same worker and channels
// as studio works. Admin jobs make commercial platform assets; user jobs make
// private assets the owner may later share.

// Output specs. Poses and outfits match the imported catalog; scenes are
// landscape photos, items square product shots.
export const SPEC = {
  pose: { ratio: "3:4", width: 900, height: 1200, thumb: [300, 400] },
  outfit: { ratio: "2:3", width: 1366, height: 2048, thumb: [360, 540] },
  scene: { ratio: "3:2", width: 1536, height: 1024, thumb: [480, 320] },
  item: { ratio: "1:1", width: 1024, height: 1024, thumb: [400, 400] }
};
const ANGLE_KEYS = library.ANGLES.map((a) => a.key);
const angleOf = (key) => library.ANGLES.find((a) => a.key === key) || library.ANGLES[0];

export class InputError extends Error {}

// Fill {placeholders}. A line whose placeholder has no value is dropped, so
// optional parts (description, category hint) disappear cleanly.
export function fillTemplate(template, values) {
  return String(template || "").split("\n").map((line) => {
    let missing = false;
    const out = line.replace(/\{(\w+)\}/g, (all, key) => {
      if (!(key in values)) return all;
      const value = String(values[key] ?? "").trim();
      if (!value) missing = true;
      return value;
    });
    return missing ? "" : out.trim();
  }).filter(Boolean).join("\n");
}

function buildPrompt({ type, major, minor, description, angle, withRef, fromPose }) {
  const cfg = settings.get("assets");
  const template = type === "pose" && fromPose ? cfg.poseAnglePrompt : cfg[`${type}${withRef ? "RefPrompt" : "Prompt"}`];
  return fillTemplate(template, {
    category: minor ? `${minor.name_en || minor.name_zh} (${minor.name_zh}), part of ${major.name_en || major.name_zh} (${major.name_zh})` : "",
    hint: minor?.hint || major?.hint || "",
    description,
    angle: type === "pose" ? cfg.angles[angle] || cfg.angles["正面"] : ""
  });
}

// ---------- create

function validate(user, input, { admin }) {
  const cfg = settings.get("assets");
  const gen = settings.get("generation");
  if (!gen.enabled) throw forbidden(gen.maintenanceMessage || "生成服务维护中", "GENERATION_DISABLED");
  if (!admin && !cfg.userGeneration) throw forbidden("素材生成暂未开放", "ASSET_GEN_DISABLED");
  const description = v.str(input.description, "description", { optional: true, max: 300 });
  const banned = findBannedWord(description);
  if (banned) throw badRequest("PROMPT_BLOCKED", `描述中包含不允许的内容（“${banned}”），请修改后再试`);

  // More camera angles for an existing pose: one job per missing angle,
  // each drawn from the pose's first image so the figure stays the same.
  if (input.sourceAssetId) {
    const source = library.getAsset(input.sourceAssetId);
    if (!source || source.type !== "pose") throw badRequest("SOURCE_UNAVAILABLE", "原姿势不存在");
    const allowed = admin ? source.root === "custom" : source.owner_id === user.id;
    if (!allowed) throw forbidden(admin ? "导入的姿势已有完整角度" : "只能为自己的姿势补全角度", "SOURCE_NOT_ALLOWED");
    // Admins may extend a draft that is not listed yet; the rating rules still apply.
    if (!library.usableForAI(admin ? { ...source, enabled: 1 } : source)) throw badRequest("SOURCE_UNAVAILABLE", "这个姿势不能用于 AI 生成");
    const taken = new Set(library.groupAngles(source.group_key));
    const requested = [...new Set((Array.isArray(input.angles) ? input.angles : [input.angle]).map(String))];
    const angles = requested.filter((a) => ANGLE_KEYS.includes(a) && !taken.has(a));
    if (!angles.length) throw badRequest("ANGLES_EXIST", "请选择还没有的角度");
    return { type: "pose", source, angles, description: "" };
  }

  const type = v.oneOf(input.type, "type", library.ASSET_TYPES);
  const minor = taxonomy.get(Number(input.categoryId));
  if (!minor || minor.type !== type || !minor.parent_id) throw badRequest("INVALID_CATEGORY", "请选择素材的小类");
  if (!taxonomy.generatable(minor, { admin })) throw badRequest("CATEGORY_CLOSED", "这个分类暂不开放生成");
  const major = taxonomy.get(minor.parent_id);
  const n = v.int(input.n ?? 1, "n", { min: 1, max: cfg.maxPerJob });
  const angle = type === "pose" ? v.oneOf(input.angle || "正面", "angle", ANGLE_KEYS) : "";
  const ref = input.referenceUploadId ? uploads.getOwnedUpload(user, input.referenceUploadId, "reference") : null;
  if (ref && !ref.consent_at) throw badRequest("CONSENT_REQUIRED", "请先确认参考图的使用授权");
  return { type, major, minor, n, angle, description, ref };
}

export function unitCost(type, { admin = false } = {}) {
  if (admin) return 0;
  return settings.get("assets")[`${type}Credits`] ?? 0;
}

export function createJobs(user, input, { admin = false, ip = null } = {}) {
  enforce(`assetgen:${user.id}`, 12, 60_000, "提交太频繁，请稍后再试");
  const r = validate(user, input, { admin });
  if (!channels.hasUsableChannel()) throw new HttpError(503, "NO_CHANNEL", "生成服务尚未配置完成，请联系管理员");
  const cfg = settings.get("assets");
  const gen = settings.get("generation");
  const plan = r.source ? r.angles.map((angle) => ({ angle, n: 1 })) : [{ angle: r.angle, n: r.n }];

  const active = db.prepare("SELECT COUNT(*) AS n FROM generations WHERE user_id = ? AND status IN ('queued','running')")
    .get(user.id).n;
  const maxActive = admin ? Math.max(20, gen.maxActivePerUser) : gen.maxActivePerUser;
  if (active + plan.length > maxActive) {
    throw new HttpError(429, "TOO_MANY_ACTIVE", `最多同时进行 ${maxActive} 个任务，请等当前任务完成`);
  }
  if (!admin && cfg.dailyLimitPerUser > 0) {
    const today = db.prepare("SELECT COUNT(*) AS n FROM generations WHERE user_id = ? AND kind = 'asset' AND created_at >= ?")
      .get(user.id, startOfLocalDay()).n;
    if (today + plan.length > cfg.dailyLimitPerUser) {
      throw new HttpError(429, "DAILY_LIMIT", `今日素材生成次数已达上限（${cfg.dailyLimitPerUser} 次），明天再来吧`);
    }
  }

  const unit = unitCost(r.type, { admin });
  const size = flexibleSize(SPEC[r.type].ratio, cfg.tier);
  const source = r.source;
  const columns = source
    ? { series: source.series, series_zh: source.series_zh, series_en: source.series_en, category: source.category,
      category_zh: source.category_zh, category_en: source.category_en, category_ja: source.category_ja }
    : library.categoryColumns(r.minor);
  const categoryLabel = source ? `${source._series.zh} · ${source._category.zh}` : `${r.major.name_zh} · ${r.minor.name_zh}`;
  const name = source ? source.name_zh || source.name : (r.description || r.minor.name_zh).slice(0, 36);
  const license = admin
    ? (input.license === "noncommercial" ? "noncommercial" : "commercial")
    // The platform can't verify rights to an uploaded reference image.
    : r.ref ? "noncommercial" : "commercial";

  const insert = db.prepare(`INSERT INTO generations (id, user_id, status, kind, mode, params, ref_upload_id, source_asset_id,
    prompt_user, prompt_final, ratio, tier, size, quality, n, cost_credits, client_ip, created_at)
    VALUES (?, ?, 'queued', 'asset', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const ids = [];
  tx(() => {
    for (const step of plan) {
      const id = randomId(12);
      const cost = unit * step.n;
      const params = {
        type: r.type, angle: step.angle, description: r.description, categoryId: r.minor?.id ?? null,
        categoryLabel, columns, name, license, rating: source ? source.rating : r.minor.rating,
        // New angles are listed exactly when the pose they extend is.
        platform: admin, publish: source ? !!source.enabled : admin ? input.publish !== false : true,
        groupKey: source?.group_key || null,
        sortBase: source ? source.sort - Math.max(0, ANGLE_KEYS.indexOf(source.angle)) : null,
        sourceName: source ? name : null, assetIds: []
      };
      const prompt = buildPrompt({ type: r.type, major: r.major, minor: r.minor, description: r.description,
        angle: step.angle, withRef: !!r.ref, fromPose: !!source });
      if (cost > 0) {
        credits.adjust(user.id, -cost, "asset_generation", { refType: "generation", refId: id,
          note: `${library.TYPE_LABELS[r.type]}素材 ${step.n} 张 · ${categoryLabel}` });
      }
      insert.run(id, user.id, r.ref || source ? "edit" : "generate", JSON.stringify(params), r.ref?.id || null,
        source?.id || null, r.description, prompt, SPEC[r.type].ratio, cfg.tier, size, cfg.quality, step.n, cost, ip, Date.now());
      ids.push(id);
    }
  })();
  return listJobs({ ids, admin });
}

// ---------- read

export function jobDto(row, { admin = false } = {}) {
  const p = JSON.parse(row.params || "{}");
  const toDto = admin ? library.adminDto : library.ownerDto;
  return {
    id: row.id, status: row.status, type: p.type, angle: p.type === "pose" ? angleOf(p.angle) : null,
    category: p.categoryLabel, categoryId: p.categoryId, description: p.description, n: row.n,
    cost: row.cost_credits, refunded: row.refunded_credits, reference: !!row.ref_upload_id,
    sourceAssetId: row.source_asset_id, sourceName: p.sourceName, platform: !!p.platform,
    errorCode: row.error_code, errorMessage: row.error_message,
    assets: (p.assetIds || []).map((id) => library.getAsset(id)).filter(Boolean).map(toDto),
    createdAt: row.created_at, startedAt: row.started_at, finishedAt: row.finished_at,
    ...(admin ? { userId: row.user_id, userEmail: row.user_email, promptFinal: row.prompt_final, errorDetail: row.error_detail,
      apiCostUsd: row.api_cost_usd, channelName: row.channel_name, attempts: row.attempts } : {})
  };
}

// Jobs by ids, or a page of jobs (one user's, or all for the admin view).
export function listJobs({ ids, userId, status, scope, type, admin = false, offset = 0, size = 20 }) {
  const where = ["g.kind = 'asset'"];
  const params = [];
  if (ids) {
    if (!ids.length) return [];
    where.push(`g.id IN (${ids.map(() => "?").join(",")})`);
    params.push(...ids);
  }
  if (userId) { where.push("g.user_id = ?"); params.push(userId); }
  if (status === "active") where.push("g.status IN ('queued','running')");
  else if (status) { where.push("g.status = ?"); params.push(status); }
  if (scope === "platform") where.push("json_extract(g.params, '$.platform') = 1");
  if (scope === "user") where.push("json_extract(g.params, '$.platform') = 0");
  if (type) { where.push("json_extract(g.params, '$.type') = ?"); params.push(type); }
  const sql = where.join(" AND ");
  const rows = db.prepare(`SELECT g.*, u.email AS user_email, c.name AS channel_name FROM generations g
    JOIN users u ON u.id = g.user_id LEFT JOIN channels c ON c.id = g.channel_id
    WHERE ${sql} ORDER BY g.created_at DESC LIMIT ? OFFSET ?`).all(...params, ids ? ids.length : size, ids ? 0 : offset);
  const items = rows.map((row) => jobDto(row, { admin }));
  if (ids) return items;
  const total = db.prepare(`SELECT COUNT(*) AS n FROM generations g WHERE ${sql}`).get(...params).n;
  return { total, items };
}

// What made an asset: its generation job's category, description, reference
// image and the pose it extends. Uploaded and imported assets have no job.
export function assetInfo(assetId, { admin = false, userId = null } = {}) {
  const asset = library.getAsset(assetId);
  if (!asset || (!admin && asset.owner_id !== userId)) throw notFound("素材不存在");
  const toDto = admin ? library.adminDto : library.ownerDto;
  const row = asset.job_id
    ? db.prepare(`SELECT g.*, u.email AS user_email FROM generations g JOIN users u ON u.id = g.user_id
        WHERE g.id = ? AND g.kind = 'asset'`).get(asset.job_id)
    : null;
  if (!row) return { asset: toDto(asset), job: null };
  const p = JSON.parse(row.params || "{}");
  const ref = row.ref_upload_id ? db.prepare("SELECT deleted_at, expires_at FROM uploads WHERE id = ?").get(row.ref_upload_id) : null;
  const refAlive = ref && !ref.deleted_at && (!ref.expires_at || ref.expires_at > Date.now());
  const source = row.source_asset_id ? library.getAsset(row.source_asset_id) : null;
  return {
    asset: toDto(asset),
    job: {
      id: row.id, category: p.categoryLabel, description: p.description,
      angle: p.type === "pose" ? angleOf(p.angle) : null,
      reference: row.ref_upload_id ? { thumb: refAlive ? `/media/uploads/${row.ref_upload_id}/thumb` : null,
        url: refAlive ? `/media/uploads/${row.ref_upload_id}` : null } : null,
      source: source ? toDto(source) : row.source_asset_id ? { id: row.source_asset_id } : null,
      createdAt: row.created_at, finishedAt: row.finished_at,
      ...(admin ? { userEmail: row.user_email, platform: !!p.platform, promptFinal: row.prompt_final, apiCostUsd: row.api_cost_usd } : {})
    }
  };
}

// ---------- worker hooks

export function inputFiles(job) {
  if (job.source_asset_id) {
    const asset = library.getAsset(job.source_asset_id);
    const file = asset && library.aiSourceFile(asset);
    if (!file || !fs.existsSync(file)) throw new InputError("原姿势图片已不存在");
    return [{ file, lineArt: true, name: "pose" }];
  }
  if (job.ref_upload_id) {
    const row = db.prepare("SELECT * FROM uploads WHERE id = ?").get(job.ref_upload_id);
    if (!row || row.deleted_at) throw new InputError("参考图已被删除");
    return [{ file: uploads.uploadFile(row), lineArt: false, name: "reference" }];
  }
  return [];
}

// Fit a model output to the library spec: poses on white, outfits and items on
// their own background colour, scenes cropped to fill the frame; PNG original
// with the AIGC label, WebP thumb and (photos only) preview.
async function writeFiles(type, id, buffer, generationId) {
  const spec = SPEC[type];
  const dir = path.join(library.customRoot, type, id);
  fs.mkdirSync(dir, { recursive: true });
  const input = sharp(buffer, { limitInputPixels: 80_000_000 });
  let background = { r: 255, g: 255, b: 255 };
  if (type === "outfit" || type === "item") {
    const corner = await input.clone().extract({ left: 0, top: 0, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
    background = { r: corner[0], g: corner[1], b: corner[2] };
  }
  let pipeline = input.clone().flatten({ background })
    .resize({ width: spec.width, height: spec.height, fit: type === "scene" ? "cover" : "contain", background, kernel: "lanczos3" });
  if (type === "pose") pipeline = pipeline.greyscale().toColourspace("srgb");
  let original = await pipeline.png({ compressionLevel: 9 }).toBuffer();
  if (settings.get("safety").aigcMetadata) original = addPngText(original, "AIGC", aigcLabel({ imageId: id, generationId }));
  fs.writeFileSync(path.join(dir, "original.png"), original);
  await sharp(original).resize({ width: spec.thumb[0], height: spec.thumb[1], fit: "contain", background })
    .webp({ quality: 82 }).toFile(path.join(dir, "thumb.webp"));
  if (type !== "pose") await sharp(original).webp({ quality: 88 }).toFile(path.join(dir, "preview.webp"));
}

function assetFields(job, p, id, i, count) {
  const angle = p.type === "pose" ? angleOf(p.angle) : null;
  const name = count > 1 ? `${p.name} ${i + 1}` : p.name;
  // Platform assets lead the library; users' assets follow the catalog.
  const sort = p.sortBase !== null && p.sortBase !== undefined ? p.sortBase + ANGLE_KEYS.indexOf(p.angle)
    : (p.platform ? -50000 : 500000) + (angle ? ANGLE_KEYS.indexOf(angle.key) : 0);
  return {
    id, type: p.type, group_key: p.groupKey || id, ...p.columns,
    name, name_zh: name, name_en: name,
    angle: angle?.key || "", angle_zh: angle?.zh || "", angle_en: angle?.en || "",
    keywords: p.type === "pose" ? "" : p.description,
    thumb_path: `${p.type}/${id}/thumb.webp`, preview_path: p.type === "pose" ? "" : `${p.type}/${id}/preview.webp`,
    original_path: `${p.type}/${id}/original.png`,
    rating: p.rating, enabled: p.publish ? 1 : 0, sort, source: "ai",
    owner_id: p.platform ? null : job.user_id, license: p.license,
    visibility: p.platform ? "public" : "private", job_id: job.id
  };
}

export async function saveResults(job, result, channel, size) {
  const p = JSON.parse(job.params || "{}");
  const images = result.images.slice(0, job.n);
  const made = [];
  for (const image of images) {
    const id = `g${library.ID_PREFIX[p.type]}_${randomId(10)}`;
    await writeFiles(p.type, id, image, job.id);
    made.push(id);
  }
  const cost = apiCostUsd({ usage: result.usage, quality: job.quality, size, n: images.length });
  tx(() => {
    made.forEach((id, i) => library.insertAsset(assetFields(job, p, id, i, made.length)));
    db.prepare(`UPDATE generations SET status = 'succeeded', finished_at = ?, channel_id = ?, model = ?, size = ?,
      usage = ?, api_cost_usd = ?, params = ?, error_code = NULL, error_message = NULL, error_detail = NULL,
      next_attempt_at = NULL WHERE id = ?`).run(Date.now(), channel.id, channel.model, size,
      result.usage ? JSON.stringify(result.usage) : null, cost, JSON.stringify({ ...p, assetIds: made }), job.id);
    if (made.length < job.n && job.cost_credits > 0) {
      const amount = Math.floor(job.cost_credits / job.n) * (job.n - made.length);
      if (amount > 0) {
        credits.adjust(job.user_id, amount, "refund", { refType: "generation", refId: job.id,
          note: `返回 ${made.length}/${job.n} 张，退回差额` });
        db.prepare("UPDATE generations SET refunded_credits = refunded_credits + ? WHERE id = ?").run(amount, job.id);
      }
    }
  })();
  library.invalidate();
}

import fs from "node:fs";
import path from "node:path";
import { db, tx } from "../db.js";
import { config } from "../config.js";
import * as settings from "./settings.js";
import * as credits from "./credits.js";
import * as library from "./library.js";
import * as uploads from "./uploads.js";
import * as channels from "./channels.js";
import * as fees from "./asset-fees.js";
import { buildPrompt, findBannedWord } from "./prompt.js";
import { creditCost, unitCost } from "./pricing.js";
import { flexibleSize } from "./sizes.js";
import { randomId } from "../lib/crypto.js";
import { badRequest, forbidden, notFound, HttpError } from "../lib/errors.js";
import { enforce } from "../lib/rate-limit.js";
import { startOfLocalDay } from "../lib/time.js";
import * as v from "../lib/validate.js";

export const genRoot = path.join(config.dataDir, "generations");

export function imageFile(rel) {
  const full = path.resolve(genRoot, rel);
  if (!full.startsWith(path.resolve(genRoot) + path.sep)) throw new Error("Invalid generation path");
  return full;
}

function imagesFor(ids) {
  if (!ids.length) return new Map();
  const rows = db.prepare(`SELECT * FROM generation_images WHERE generation_id IN (${ids.map(() => "?").join(",")})
    ORDER BY idx`).all(...ids);
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.generation_id)) map.set(row.generation_id, []);
    map.get(row.generation_id).push({
      id: row.id, idx: row.idx, width: row.width, height: row.height, format: row.format,
      url: `/media/gen/${row.id}/full`, thumb: `/media/gen/${row.id}/thumb`,
      download: `/media/gen/${row.id}/full?download=1`
    });
  }
  return map;
}

// `license` covers the library assets used: commercial only if every one is.
// Uploaded images are the user's own responsibility and don't count.
function refSummary(row) {
  const pose = row.pose_id ? library.getAsset(row.pose_id) : null;
  const outfit = row.outfit_id ? library.getAsset(row.outfit_id) : null;
  const used = [pose, outfit].filter(Boolean);
  return {
    pose: pose ? { id: pose.id, thumb: library.dto(pose).thumb, name: pose.name_zh || pose.name } : row.pose_id ? { id: row.pose_id } : null,
    outfit: outfit ? { id: outfit.id, thumb: library.dto(outfit).thumb, name: outfit.name_zh || outfit.name }
      : row.outfit_upload_id ? { upload: true } : null,
    person: !!row.person_upload_id,
    license: !used.length ? null : used.every((a) => a.license === "commercial") ? "commercial" : "noncommercial"
  };
}

// What the owner sees. Admin views add internal fields on top.
export function dto(row, images = []) {
  return {
    id: row.id, status: row.status, mode: row.mode,
    style: row.style, scene: row.scene, prompt: row.prompt_user,
    ratio: row.ratio, tier: row.tier, size: row.size, quality: row.quality, n: row.n,
    cost: row.cost_credits, refunded: row.refunded_credits, assetFee: row.asset_fee,
    errorCode: row.error_code, errorMessage: row.error_message,
    isPublic: !!row.is_public, hidden: !!row.hidden, featured: !!row.featured, approved: !!row.approved,
    refs: refSummary(row),
    images,
    createdAt: row.created_at, startedAt: row.started_at, finishedAt: row.finished_at, publishedAt: row.published_at
  };
}

export function withImages(rows) {
  const map = imagesFor(rows.map((r) => r.id));
  return rows.map((r) => dto(r, map.get(r.id) || []));
}

// ---------- create

export function validateRequest(user, input) {
  const gen = settings.get("generation");
  if (!gen.enabled) throw forbidden(gen.maintenanceMessage || "生成服务维护中", "GENERATION_DISABLED");

  const quality = v.oneOf(input.quality ?? gen.defaultQuality, "quality",
    gen.qualities.filter((q) => q.enabled).map((q) => q.id));
  const tier = v.oneOf(input.tier ?? gen.defaultTier, "tier", gen.tiers.filter((t) => t.enabled).map((t) => t.id));
  const ratio = v.oneOf(input.ratio ?? gen.defaultRatio, "ratio", gen.ratios);
  const n = v.int(input.n ?? 1, "n", { min: 1, max: gen.maxN });
  const style = input.style ? gen.styles.find((s) => s.id === input.style) : null;
  if (input.style && !style) throw badRequest("INVALID_STYLE", "所选风格不存在");
  const scene = input.scene ? gen.scenes.find((s) => s.id === input.scene) : null;
  if (input.scene && !scene) throw badRequest("INVALID_SCENE", "所选场景不存在");
  const userText = v.str(input.prompt, "prompt", { optional: true, max: 1000 });
  const banned = findBannedWord(userText);
  if (banned) throw badRequest("PROMPT_BLOCKED", `描述中包含不允许的内容（“${banned}”），请修改后再试`);

  const personUpload = input.personUploadId ? uploads.getOwnedUpload(user, input.personUploadId, "person") : null;
  if (personUpload && !gen.allowPersonPhoto) throw forbidden("当前未开放人物照片功能", "PERSON_DISABLED");
  if (personUpload && !personUpload.consent_at) throw badRequest("CONSENT_REQUIRED", "请先确认人物照片的使用授权");
  const withPerson = !!personUpload;
  const viewer = { loggedIn: true, userId: user.id };

  let pose = null;
  if (input.poseId) {
    pose = library.getAsset(input.poseId);
    if (!pose || pose.type !== "pose" || !library.visible(pose, viewer)) {
      throw badRequest("POSE_UNAVAILABLE", "所选姿势已下架，请重新选择");
    }
    if (!library.usableForAI(pose, { withPerson })) {
      throw badRequest(withPerson ? "POSE_NOT_ALLOWED_WITH_PERSON" : "POSE_NOT_ALLOWED",
        withPerson ? "使用人物照片时只能搭配普通级姿势，请换一个姿势或移除人物照片" : "该姿势仅供浏览，不能用于 AI 生成");
    }
    if (withPerson && pose.people > 1) throw badRequest("PERSON_WITH_DUO", "双人姿势不能搭配人物照片");
  }

  let outfit = null, outfitUpload = null;
  if (input.outfitId && input.outfitUploadId) throw badRequest("INVALID_INPUT", "服装只能选择一个来源");
  if (input.outfitId) {
    outfit = library.getAsset(input.outfitId);
    if (!outfit || outfit.type !== "outfit" || !library.visible(outfit, viewer)) {
      throw badRequest("OUTFIT_UNAVAILABLE", "所选服装已下架，请重新选择");
    }
    if (!library.usableForAI(outfit, { withPerson })) {
      throw badRequest(withPerson ? "OUTFIT_NOT_ALLOWED_WITH_PERSON" : "OUTFIT_NOT_ALLOWED",
        withPerson ? "使用人物照片时只能搭配普通级服装，请换一套服装或移除人物照片" : "该服装仅供浏览，不能用于 AI 生成");
    }
  } else if (input.outfitUploadId) {
    if (!gen.allowOutfitUpload) throw forbidden("当前未开放自定义服装图片", "OUTFIT_UPLOAD_DISABLED");
    outfitUpload = uploads.getOwnedUpload(user, input.outfitUploadId, "outfit");
  }

  if (!pose && !outfit && !outfitUpload && !personUpload) {
    if (!gen.allowTextOnly) throw badRequest("REFERENCE_REQUIRED", "请至少选择一张参考图");
    if (!userText) throw badRequest("PROMPT_REQUIRED", "没有参考图时，请写下想要的画面描述");
  }

  // Shared assets from other users cost their price once per job.
  const assetFees = [pose, outfit].filter(Boolean).map((asset) => ({ asset, price: library.feeFor(asset, user.id) }))
    .filter((f) => f.price > 0);
  const assetFee = assetFees.reduce((sum, f) => sum + f.price, 0);

  return { gen, quality, tier, ratio, n, style, scene, userText, pose, outfit, outfitUpload, personUpload, assetFees, assetFee };
}

export function estimate(user, input) {
  const r = validateRequest(user, input);
  return { cost: creditCost(r) + r.assetFee, assetFee: r.assetFee, unit: unitCost(r.quality, r.tier), size: flexibleSize(r.ratio, r.tier) };
}

export function create(user, input, { ip }) {
  enforce(`gen:${user.id}`, 20, 60_000, "提交太频繁，请稍后再试");
  const r = validateRequest(user, input);
  if (!channels.hasUsableChannel()) {
    throw new HttpError(503, "NO_CHANNEL", "生成服务尚未配置完成，请联系管理员");
  }
  const active = db.prepare("SELECT COUNT(*) AS n FROM generations WHERE user_id = ? AND status IN ('queued','running')")
    .get(user.id).n;
  if (active >= r.gen.maxActivePerUser) {
    throw new HttpError(429, "TOO_MANY_ACTIVE", `最多同时进行 ${r.gen.maxActivePerUser} 个任务，请等当前任务完成`);
  }
  if (r.gen.dailyLimitPerUser > 0) {
    const today = db.prepare("SELECT COUNT(*) AS n FROM generations WHERE user_id = ? AND kind = 'work' AND created_at >= ?")
      .get(user.id, startOfLocalDay()).n;
    if (today >= r.gen.dailyLimitPerUser) {
      throw new HttpError(429, "DAILY_LIMIT", `今日生成次数已达上限（${r.gen.dailyLimitPerUser} 次），明天再来吧`);
    }
  }

  const cost = creditCost(r) + r.assetFee;
  const prompt = buildPrompt({
    pose: r.pose, outfit: r.outfit || r.outfitUpload, outfitKeywords: r.outfit?.keywords || "",
    person: !!r.personUpload, style: r.style, scene: r.scene, userText: r.userText
  });
  const id = randomId(12);
  const now = Date.now();
  const hasImages = !!(r.pose || r.outfit || r.outfitUpload || r.personUpload);

  tx(() => {
    const label = r.gen.qualities.find((q) => q.id === r.quality)?.label || r.quality;
    credits.adjust(user.id, -cost, "generation", { refType: "generation", refId: id,
      note: `${r.n} 张 · ${label}${r.assetFee ? ` · 含素材使用费 ${r.assetFee} 点` : ""}` });
    db.prepare(`INSERT INTO generations (id, user_id, status, mode, pose_id, outfit_id, outfit_upload_id, person_upload_id,
      style, scene, prompt_user, prompt_final, ratio, tier, size, quality, n, cost_credits, asset_fee, consent_at, client_ip, created_at)
      VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, user.id, hasImages ? "edit" : "generate", r.pose?.id || null, r.outfit?.id || null,
      r.outfitUpload?.id || null, r.personUpload?.id || null, r.style?.id || "", r.scene?.id || "",
      r.userText, prompt, r.ratio, r.tier, flexibleSize(r.ratio, r.tier), r.quality, r.n, cost, r.assetFee,
      r.personUpload ? r.personUpload.consent_at : null, ip, now);
    if (r.assetFees.length) fees.hold(id, user.id, r.assetFees);
    library.bumpUse([r.pose?.id, r.outfit?.id]);
  })();

  return getOwned(user, id);
}

// ---------- read

export function getOwned(user, id) {
  const row = db.prepare("SELECT * FROM generations WHERE id = ? AND user_id = ? AND kind = 'work' AND deleted_at IS NULL").get(String(id), user.id);
  if (!row) throw notFound("作品不存在或已删除");
  return withImages([row])[0];
}

export function listOwned(user, { status, offset, size }) {
  const where = ["user_id = ?", "kind = 'work'", "deleted_at IS NULL"];
  const params = [user.id];
  if (status === "active") where.push("status IN ('queued','running')");
  else if (["succeeded", "failed"].includes(status)) { where.push("status = ?"); params.push(status); }
  else if (status === "public") where.push("is_public = 1");
  const sql = where.join(" AND ");
  const total = db.prepare(`SELECT COUNT(*) AS n FROM generations WHERE ${sql}`).get(...params).n;
  const rows = db.prepare(`SELECT * FROM generations WHERE ${sql} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, size, offset);
  return { total, items: withImages(rows) };
}

export function statusOf(user, ids) {
  const list = ids.slice(0, 50).map(String);
  if (!list.length) return [];
  const rows = db.prepare(`SELECT * FROM generations WHERE user_id = ? AND kind = 'work' AND id IN (${list.map(() => "?").join(",")})`)
    .all(user.id, ...list);
  return withImages(rows);
}

export function softDelete(user, id) {
  const row = db.prepare("SELECT * FROM generations WHERE id = ? AND user_id = ? AND kind = 'work' AND deleted_at IS NULL").get(String(id), user.id);
  if (!row) throw notFound("作品不存在或已删除");
  if (row.status === "queued" || row.status === "running") throw badRequest("JOB_ACTIVE", "任务进行中，完成后才能删除");
  removeFiles(row.id);
  db.prepare("UPDATE generations SET deleted_at = ?, is_public = 0 WHERE id = ?").run(Date.now(), row.id);
}

export function removeFiles(generationId) {
  const imgs = db.prepare("SELECT path, thumb_path FROM generation_images WHERE generation_id = ?").all(generationId);
  for (const img of imgs) {
    for (const rel of [img.path, img.thumb_path]) {
      try { fs.rmSync(imageFile(rel), { force: true }); } catch { /* ignore */ }
    }
  }
}

export function setPublic(user, id, isPublic) {
  const row = db.prepare("SELECT * FROM generations WHERE id = ? AND user_id = ? AND kind = 'work' AND deleted_at IS NULL").get(String(id), user.id);
  if (!row) throw notFound("作品不存在或已删除");
  const safety = settings.get("safety");
  if (isPublic) {
    if (!safety.showcaseEnabled) throw forbidden("灵感广场暂未开放", "SHOWCASE_DISABLED");
    if (row.status !== "succeeded") throw badRequest("NOT_READY", "只有生成成功的作品可以发布");
    // Hard rule: images made from a real person's photo are never published.
    if (row.person_upload_id) throw badRequest("PERSON_NOT_PUBLISHABLE", "使用了人物照片的作品不能公开发布");
    if (row.hidden) throw forbidden("该作品已被管理员隐藏，不能公开", "HIDDEN_BY_ADMIN");
  }
  db.prepare("UPDATE generations SET is_public = ?, published_at = ? WHERE id = ?")
    .run(isPublic ? 1 : 0, isPublic ? Date.now() : null, row.id);
  return getOwned(user, id);
}

// Public works for the showcase. With review on, only admin-approved works
// appear; otherwise any published, non-hidden work. Featured works sort first.
export function showcase({ offset, size, featuredOnly = false }) {
  const safety = settings.get("safety");
  if (!safety.showcaseEnabled) return { total: 0, items: [] };
  const filter = [safety.showcaseReview ? "AND g.approved = 1" : "", featuredOnly ? "AND g.featured = 1" : ""].join(" ");
  const base = `FROM generations g JOIN users u ON u.id = g.user_id WHERE g.is_public = 1 AND g.hidden = 0
    AND g.deleted_at IS NULL AND g.status = 'succeeded' AND g.person_upload_id IS NULL AND u.status = 'active' ${filter}`;
  const total = db.prepare(`SELECT COUNT(*) AS n ${base}`).get().n;
  const rows = db.prepare(`SELECT g.*, u.nickname AS author ${base} ORDER BY g.featured DESC, g.published_at DESC LIMIT ? OFFSET ?`)
    .all(size, offset);
  const map = imagesFor(rows.map((r) => r.id));
  return {
    total,
    items: rows.map((r) => ({
      id: r.id, author: r.author, style: r.style, scene: r.scene, ratio: r.ratio, featured: !!r.featured,
      refs: refSummary(r), images: map.get(r.id) || [], publishedAt: r.published_at
    }))
  };
}

// ---------- admin

export function adminList({ status, kind, userId, q, isPublic, offset, size }) {
  const where = ["1 = 1"];
  const params = [];
  if (status) { where.push("g.status = ?"); params.push(status); }
  if (kind) { where.push("g.kind = ?"); params.push(kind); }
  if (userId) { where.push("g.user_id = ?"); params.push(Number(userId)); }
  if (isPublic === "1") where.push("g.is_public = 1");
  if (isPublic === "pending") where.push("g.is_public = 1 AND g.approved = 0 AND g.hidden = 0 AND g.deleted_at IS NULL");
  if (q) { where.push("(g.id = ? OR u.email LIKE ? OR g.prompt_user LIKE ?)"); params.push(q, `%${q}%`, `%${q}%`); }
  const sql = where.join(" AND ");
  const total = db.prepare(`SELECT COUNT(*) AS n FROM generations g JOIN users u ON u.id = g.user_id WHERE ${sql}`).get(...params).n;
  const rows = db.prepare(`SELECT g.*, u.email AS user_email, c.name AS channel_name FROM generations g
    JOIN users u ON u.id = g.user_id LEFT JOIN channels c ON c.id = g.channel_id
    WHERE ${sql} ORDER BY g.created_at DESC LIMIT ? OFFSET ?`).all(...params, size, offset);
  const map = imagesFor(rows.map((r) => r.id));
  return {
    total,
    items: rows.map((r) => ({
      ...dto(r, map.get(r.id) || []),
      userId: r.user_id, userEmail: r.user_email, channelName: r.channel_name, model: r.model,
      attempts: r.attempts, errorDetail: r.error_detail, apiCostUsd: r.api_cost_usd,
      usage: r.usage ? JSON.parse(r.usage) : null, promptFinal: r.prompt_final,
      deleted: !!r.deleted_at, clientIp: r.client_ip, hasPerson: !!r.person_upload_id,
      personUploadId: r.person_upload_id, outfitUploadId: r.outfit_upload_id,
      kind: r.kind, refUploadId: r.ref_upload_id, assetJob: r.kind === "asset" ? JSON.parse(r.params || "{}") : null
    }))
  };
}

export function adminUpdate(id, { hidden, featured, approved }) {
  const row = db.prepare("SELECT * FROM generations WHERE id = ?").get(String(id));
  if (!row) throw notFound("作品不存在");
  if (hidden !== undefined) db.prepare("UPDATE generations SET hidden = ? WHERE id = ?").run(hidden ? 1 : 0, row.id);
  if (approved !== undefined) db.prepare("UPDATE generations SET approved = ? WHERE id = ?").run(approved ? 1 : 0, row.id);
  if (featured !== undefined) {
    if (featured && row.person_upload_id) throw badRequest("PERSON_NOT_PUBLISHABLE", "使用了人物照片的作品不能推荐");
    db.prepare("UPDATE generations SET featured = ? WHERE id = ?").run(featured ? 1 : 0, row.id);
  }
  return db.prepare("SELECT * FROM generations WHERE id = ?").get(row.id);
}

export function adminDelete(id) {
  const row = db.prepare("SELECT * FROM generations WHERE id = ?").get(String(id));
  if (!row) throw notFound("作品不存在");
  if (row.status === "queued" || row.status === "running") throw badRequest("JOB_ACTIVE", "任务进行中，不能删除");
  removeFiles(row.id);
  db.prepare("UPDATE generations SET deleted_at = ?, is_public = 0, featured = 0 WHERE id = ?").run(Date.now(), row.id);
}

export function featuredForHome(limit = 8) {
  return showcase({ offset: 0, size: limit, featuredOnly: true }).items;
}

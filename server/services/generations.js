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
import { flexibleSize, upscaleSize } from "./sizes.js";
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

// The WebP display copy saved next to an image (made on first view for old ones).
export const viewRel = (rel) => rel.replace(/\.[a-z]+$/, ".view.webp");

function imagesFor(ids) {
  if (!ids.length) return new Map();
  const rows = db.prepare(`SELECT * FROM generation_images WHERE generation_id IN (${ids.map(() => "?").join(",")})
    ORDER BY idx`).all(...ids);
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.generation_id)) map.set(row.generation_id, []);
    map.get(row.generation_id).push({
      id: row.id, idx: row.idx, width: row.width, height: row.height, format: row.format,
      url: `/media/gen/${row.id}/full`, thumb: `/media/gen/${row.id}/thumb`, view: `/media/gen/${row.id}/view`,
      download: `/media/gen/${row.id}/full?download=1`
    });
  }
  return map;
}

const itemIdsOf = (row) => {
  try { return JSON.parse(row.item_ids || "[]"); } catch { return []; }
};

function assetRef(id) {
  if (!id) return null;
  const asset = library.getAsset(id);
  if (!asset) return { id };
  const shown = library.displayDto(asset);
  return { id: asset.id, thumb: shown.thumb, preview: shown.preview, name: asset.name_zh || asset.name };
}

function outfitUploadRef(id, owner) {
  const out = { upload: true };
  if (!owner) return out;
  const upload = db.prepare("SELECT * FROM uploads WHERE id = ?").get(id);
  const alive = upload && !upload.deleted_at && (!upload.expires_at || upload.expires_at > Date.now());
  return { ...out, id, thumb: alive ? `/media/uploads/${id}/thumb` : null,
    url: alive ? `/media/uploads/${id}` : null };
}

// The person reference. Others only learn whether there was one and of which
// kind; the owner (and admins) also get the source and a thumbnail while the
// image still exists.
function personRef(row, owner) {
  if (row.person_kind === "none") return null;
  const out = { kind: row.person_kind };
  if (!owner) return out;
  if (row.person_upload_id) {
    const upload = db.prepare("SELECT deleted_at, expires_at, virtual FROM uploads WHERE id = ?").get(row.person_upload_id);
    const alive = upload && !upload.deleted_at && (!upload.expires_at || upload.expires_at > Date.now());
    return { ...out, source: "upload", id: row.person_upload_id, virtual: upload?.virtual || "none",
      thumb: alive ? `/media/uploads/${row.person_upload_id}/thumb` : null, url: alive ? `/media/uploads/${row.person_upload_id}` : null };
  }
  const image = db.prepare(`SELECT i.id FROM generation_images i JOIN generations g ON g.id = i.generation_id
    WHERE i.id = ? AND g.deleted_at IS NULL`).get(row.person_image_id);
  return { ...out, source: "image", id: row.person_image_id, thumb: image ? `/media/gen/${image.id}/thumb` : null,
    url: image ? `/media/gen/${image.id}/view` : null };
}

// `license` covers the library assets used: commercial only if every one is.
// Uploaded images are the user's own responsibility and don't count.
function refSummary(row, { owner = false } = {}) {
  const pose = row.pose_id ? library.getAsset(row.pose_id) : null;
  const outfit = row.outfit_id ? library.getAsset(row.outfit_id) : null;
  const scene = row.scene_asset_id ? library.getAsset(row.scene_asset_id) : null;
  const itemIds = itemIdsOf(row);
  const items = itemIds.map((id) => library.getAsset(id)).filter(Boolean);
  const used = [pose, outfit, scene, ...items].filter(Boolean);
  return {
    pose: assetRef(row.pose_id),
    outfit: row.outfit_id ? assetRef(row.outfit_id) : row.outfit_upload_id ? outfitUploadRef(row.outfit_upload_id, owner) : null,
    scene: assetRef(row.scene_asset_id),
    items: itemIds.map(assetRef),
    person: personRef(row, owner),
    license: !used.length ? null : used.every((a) => a.license === "commercial") ? "commercial" : "noncommercial"
  };
}

// What the owner sees. Admin views add internal fields on top.
export function dto(row, images = [], { owner = true } = {}) {
  return {
    id: row.id, status: row.status, mode: row.mode,
    style: row.style, scene: row.scene, camera: row.camera, realism: !!row.realism, prompt: row.prompt_user,
    ratio: row.ratio, tier: row.tier, size: row.size, quality: row.quality, n: row.n,
    cost: row.cost_credits, refunded: row.refunded_credits, assetFee: row.asset_fee,
    errorCode: row.error_code, errorMessage: row.error_message,
    isPublic: !!row.is_public, hidden: !!row.hidden, featured: !!row.featured, approved: !!row.approved,
    personKind: row.person_kind, userHidden: !!row.user_hidden, favorite: !!row.favorite,
    upscaleOf: row.upscale_of || null,
    refs: refSummary(row, { owner }),
    images,
    createdAt: row.created_at, startedAt: row.started_at, finishedAt: row.finished_at, publishedAt: row.published_at,
    attempts: row.attempts
  };
}

// The owner's works. Each image says which 超分 sizes it can still go to.
export function withImages(rows) {
  const map = imagesFor(rows.map((r) => r.id));
  return rows.map((r) => dto(r, (map.get(r.id) || []).map((img) => ({ ...img,
    upscale: { hd: upscaleSize(img.width, img.height, "hd"), uhd: upscaleSize(img.width, img.height, "uhd") } }))));
}

// ---------- create

// An image from one of the user's own finished works, used as the person.
function ownedWorkImage(user, imageId) {
  const row = db.prepare(`SELECT i.id, i.path, g.person_kind, g.consent_at FROM generation_images i
    JOIN generations g ON g.id = i.generation_id
    WHERE i.id = ? AND g.user_id = ? AND g.kind = 'work' AND g.status = 'succeeded' AND g.deleted_at IS NULL`)
    .get(String(imageId), user.id);
  if (!row) throw badRequest("PERSON_IMAGE_GONE", "所选的作品图片已删除，请重新选择人物");
  return row;
}

// The person reference and its kind. A photo counts as a real person unless an
// admin approved it as virtual; an image from the user's own work counts as
// virtual unless that work used a real person's photo.
function resolvePerson(user, input, gen) {
  if (input.personUploadId && input.personImageId) throw badRequest("INVALID_INPUT", "人物只能选择一个来源");
  if (input.personUploadId) {
    if (!gen.allowPersonPhoto) throw forbidden("当前未开放人物照片功能", "PERSON_DISABLED");
    const upload = uploads.getOwnedUpload(user, input.personUploadId, "person");
    if (upload.virtual === "approved") return { kind: "virtual", uploadId: upload.id, consentAt: null };
    if (!upload.consent_at) {
      if (upload.virtual === "pending") throw badRequest("VIRTUAL_PENDING", "这张虚拟人形象还在审核中，通过后才能使用");
      if (upload.virtual === "rejected") throw badRequest("VIRTUAL_REJECTED", "这张图片未通过虚拟人审核，不能使用");
      throw badRequest("CONSENT_REQUIRED", "请先确认人物照片的使用授权");
    }
    return { kind: "real", uploadId: upload.id, consentAt: upload.consent_at };
  }
  if (input.personImageId) {
    const image = ownedWorkImage(user, input.personImageId);
    if (image.person_kind !== "real") return { kind: "virtual", imageId: image.id, consentAt: null };
    if (!gen.allowPersonPhoto) throw forbidden("当前未开放人物照片功能", "PERSON_DISABLED");
    if (!image.consent_at) throw badRequest("CONSENT_REQUIRED", "这张作品用了人物照片，缺少使用授权记录");
    return { kind: "real", imageId: image.id, consentAt: image.consent_at };
  }
  return null;
}

// One library reference: it must exist, be the right type, be visible to the
// user, be in what they have unlocked and be allowed for AI generation (with a
// real person, general only).
function libraryRef(id, type, { viewer, withPerson, gone, label }) {
  const asset = library.getAsset(id);
  if (!asset || asset.type !== type || !library.visible(asset, viewer)) throw badRequest(gone, `所选${label}已下架，请重新选择`);
  if (!library.accessible(asset, viewer)) throw forbidden(`这个${label}需要充值解锁后才能使用`, "LIBRARY_LOCKED");
  if (!library.usableForAI(asset, { withPerson })) {
    const code = `${type.toUpperCase()}_NOT_ALLOWED${withPerson ? "_WITH_PERSON" : ""}`;
    throw badRequest(code, withPerson ? `使用真人照片时不能搭配敏感级${label}，请换一个或移除人物照片` : `该${label}仅供浏览，不能用于 AI 生成`);
  }
  return asset;
}

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
  let scene = input.scene ? gen.scenes.find((s) => s.id === input.scene) : null;
  if (input.scene && !scene) throw badRequest("INVALID_SCENE", "所选场景不存在");
  const camera = input.camera ? gen.cameras.find((c) => c.id === input.camera) : null;
  if (input.camera && !camera) throw badRequest("INVALID_CAMERA", "所选镜头不存在");
  const realism = !!input.realism;
  const userText = v.str(input.prompt, "prompt", { optional: true, max: 1000 });
  const banned = findBannedWord(userText);
  if (banned) throw badRequest("PROMPT_BLOCKED", `描述中包含不允许的内容（“${banned}”），请修改后再试`);

  const person = resolvePerson(user, input, gen);
  // The extra rules apply to real people only; a virtual person goes with any
  // pose, outfit, scene or item the user may use for AI generation.
  const withPerson = person?.kind === "real";
  const viewer = library.viewerFor(user);

  let pose = null;
  if (input.poseId) {
    pose = libraryRef(input.poseId, "pose", { viewer, withPerson, gone: "POSE_UNAVAILABLE", label: "姿势" });
    if (withPerson && pose.people > 1) throw badRequest("PERSON_WITH_DUO", "双人姿势不能搭配真人照片");
  }

  let outfit = null, outfitUpload = null;
  if (input.outfitId && input.outfitUploadId) throw badRequest("INVALID_INPUT", "服装只能选择一个来源");
  if (input.outfitId) {
    outfit = libraryRef(input.outfitId, "outfit", { viewer, withPerson, gone: "OUTFIT_UNAVAILABLE", label: "服装" });
  } else if (input.outfitUploadId) {
    if (!gen.allowOutfitUpload) throw forbidden("当前未开放自定义服装图片", "OUTFIT_UPLOAD_DISABLED");
    outfitUpload = uploads.getOwnedUpload(user, input.outfitUploadId, "outfit");
  }

  const sceneAsset = input.sceneAssetId
    ? libraryRef(input.sceneAssetId, "scene", { viewer, withPerson, gone: "SCENE_UNAVAILABLE", label: "场景" }) : null;
  // A scene image takes the place of the scene preset.
  if (sceneAsset) scene = null;
  const itemIds = [...new Set((Array.isArray(input.itemIds) ? input.itemIds : []).map(String).filter(Boolean))];
  if (itemIds.length > settings.MAX_ITEMS) throw badRequest("TOO_MANY_ITEMS", `最多选择 ${settings.MAX_ITEMS} 件物品`);
  const items = itemIds.map((id) => libraryRef(id, "item", { viewer, withPerson, gone: "ITEM_UNAVAILABLE", label: "物品" }));

  if (!pose && !outfit && !outfitUpload && !person && !sceneAsset && !items.length) {
    if (!gen.allowTextOnly) throw badRequest("REFERENCE_REQUIRED", "请至少选择一张参考图");
    if (!userText) throw badRequest("PROMPT_REQUIRED", "没有参考图时，请写下想要的画面描述");
  }

  // Shared assets from other users cost their price once per job.
  const assetFees = [pose, outfit, sceneAsset, ...items].filter(Boolean)
    .map((asset) => ({ asset, price: library.feeFor(asset, user.id) })).filter((f) => f.price > 0);
  const assetFee = assetFees.reduce((sum, f) => sum + f.price, 0);

  return { gen, quality, tier, ratio, n, style, scene, camera, realism, userText, pose, outfit, outfitUpload, person,
    sceneAsset, items, assetFees, assetFee };
}

export function estimate(user, input) {
  const r = validateRequest(user, input);
  return { cost: creditCost(r) + r.assetFee, assetFee: r.assetFee, unit: unitCost(r.quality, r.tier), size: flexibleSize(r.ratio, r.tier) };
}

// Only studio work counts: a wedding album or an asset batch in progress doesn't block the studio.
function checkCaps(user, gen) {
  const active = db.prepare(`SELECT COUNT(*) AS n FROM generations WHERE user_id = ? AND status IN ('queued','running')
    AND kind = 'work' AND shoot_id IS NULL`).get(user.id).n;
  if (active >= gen.maxActivePerUser) {
    throw new HttpError(429, "TOO_MANY_ACTIVE", `最多同时进行 ${gen.maxActivePerUser} 个任务，请等当前任务完成`);
  }
  if (gen.dailyLimitPerUser > 0) {
    const today = db.prepare("SELECT COUNT(*) AS n FROM generations WHERE user_id = ? AND kind = 'work' AND shoot_id IS NULL AND created_at >= ?")
      .get(user.id, startOfLocalDay()).n;
    if (today >= gen.dailyLimitPerUser) {
      throw new HttpError(429, "DAILY_LIMIT", `今日生成次数已达上限（${gen.dailyLimitPerUser} 次），明天再来吧`);
    }
  }
}

export function create(user, input, { ip }) {
  enforce(`gen:${user.id}`, 20, 60_000, "提交太频繁，请稍后再试");
  const r = validateRequest(user, input);
  if (!channels.hasUsableChannel()) {
    throw new HttpError(503, "NO_CHANNEL", "生成服务尚未配置完成，请联系管理员");
  }
  const qualityLabel = r.gen.qualities.find((q) => q.id === r.quality)?.label || r.quality;
  if (!channels.qualityAvailable(r.quality)) {
    throw new HttpError(503, "QUALITY_UNSUPPORTED", `当前的生成渠道不接「${qualityLabel}」画质，请换一个画质`);
  }
  if (r.tier !== "standard" && !channels.tierAvailable(r.tier, r.quality)) {
    const label = r.gen.tiers.find((t) => t.id === r.tier)?.label || r.tier;
    throw new HttpError(503, "TIER_UNSUPPORTED", channels.tierAvailable(r.tier)
      ? `接「${qualityLabel}」画质的生成渠道出不了「${label}」的尺寸，请换个画质或选择更低的清晰度`
      : `当前的生成渠道出不了「${label}」的尺寸，请选择更低的清晰度`);
  }
  checkCaps(user, r.gen);

  const cost = creditCost(r) + r.assetFee;
  const personKind = r.person?.kind || "none";
  const prompt = buildPrompt({
    pose: r.pose, outfit: r.outfit || r.outfitUpload, outfitKeywords: r.outfit?.keywords || "",
    personKind, style: r.style, scene: r.scene, sceneAsset: r.sceneAsset, items: r.items,
    camera: r.camera, realism: r.realism, userText: r.userText
  });
  const id = randomId(12);
  const now = Date.now();
  const hasImages = !!(r.pose || r.outfit || r.outfitUpload || r.person || r.sceneAsset || r.items.length);

  tx(() => {
    const label = r.gen.qualities.find((q) => q.id === r.quality)?.label || r.quality;
    credits.adjust(user.id, -cost, "generation", { refType: "generation", refId: id,
      note: `${r.n} 张 · ${label}${r.assetFee ? ` · 含素材使用费 ${r.assetFee} 点` : ""}` });
    db.prepare(`INSERT INTO generations (id, user_id, status, mode, pose_id, outfit_id, outfit_upload_id, person_upload_id,
      person_image_id, person_kind, scene_asset_id, item_ids, style, scene, camera, realism, prompt_user, prompt_final,
      ratio, tier, size, quality, n, cost_credits, asset_fee, consent_at, client_ip, created_at)
      VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, user.id, hasImages ? "edit" : "generate", r.pose?.id || null, r.outfit?.id || null,
      r.outfitUpload?.id || null, r.person?.uploadId || null, r.person?.imageId || null, personKind,
      r.sceneAsset?.id || null, r.items.length ? JSON.stringify(r.items.map((a) => a.id)) : null,
      r.style?.id || "", r.scene?.id || "", r.camera?.id || "", r.realism ? 1 : 0, r.userText, prompt, r.ratio, r.tier,
      flexibleSize(r.ratio, r.tier), r.quality,
      r.n, cost, r.assetFee, r.person?.consentAt ?? null, ip, now);
    if (r.assetFees.length) fees.hold(id, user.id, r.assetFees);
    library.bumpUse([r.pose?.id, r.outfit?.id, r.sceneAsset?.id, ...r.items.map((a) => a.id)]);
  })();

  return getOwned(user, id);
}

// ---------- 超分

const UPSCALE_TEXT = { hd: "2K", uhd: "4K" };

// Redraw one image of a finished work at 2K or 4K. The result is a new work
// that keeps the source's references, person kind and admin hiding, so it is
// shared (or kept private) on the same terms; it costs the 超分 price and no
// asset usage fees.
export function upscale(user, generationId, input, { ip }) {
  enforce(`gen:${user.id}`, 20, 60_000, "提交太频繁，请稍后再试");
  const gen = settings.get("generation");
  if (!gen.enabled) throw forbidden(gen.maintenanceMessage || "生成服务维护中", "GENERATION_DISABLED");
  if (!gen.upscale.enabled) throw forbidden("超分暂未开放", "UPSCALE_DISABLED");
  const target = v.oneOf(input.target, "target", ["hd", "uhd"]);
  const source = ownedRow(user, generationId);
  const image = source.status === "succeeded"
    ? db.prepare("SELECT * FROM generation_images WHERE id = ? AND generation_id = ?").get(String(input.imageId || ""), source.id) : null;
  if (!image) throw notFound("图片不存在或已删除");
  if (source.person_kind === "real" && !gen.allowPersonPhoto) throw forbidden("当前未开放人物照片功能", "PERSON_DISABLED");
  const size = upscaleSize(image.width, image.height, target);
  if (!size) throw badRequest("ALREADY_LARGE", `这张图已经是${UPSCALE_TEXT[target]}或更大，不需要超分`);
  if (!channels.tierAvailable(target)) {
    throw new HttpError(503, "UPSCALE_UNSUPPORTED", `当前的生成渠道出不了 ${UPSCALE_TEXT[target]} 的尺寸，暂时不能超分到 ${UPSCALE_TEXT[target]}`);
  }
  checkCaps(user, gen);

  const cost = target === "uhd" ? gen.upscale.uhdCredits : gen.upscale.hdCredits;
  const id = randomId(12);
  tx(() => {
    credits.adjust(user.id, -cost, "generation", { refType: "generation", refId: id,
      note: `超分 ${UPSCALE_TEXT[target]} · ${size.replace("x", "×")}` });
    db.prepare(`INSERT INTO generations (id, user_id, status, mode, pose_id, outfit_id, outfit_upload_id, person_upload_id,
      person_image_id, person_kind, scene_asset_id, item_ids, style, scene, camera, realism, prompt_user, prompt_final,
      ratio, tier, size, quality, n, cost_credits, asset_fee, consent_at, hidden, upscale_of, client_ip, created_at)
      VALUES (?, ?, 'queued', 'edit', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0, ?, ?, ?, ?, ?)`).run(
      id, user.id, source.pose_id, source.outfit_id, source.outfit_upload_id, source.person_upload_id,
      source.person_image_id, source.person_kind, source.scene_asset_id, source.item_ids, source.style, source.scene,
      source.camera, source.realism, source.prompt_user, settings.get("prompt").upscale,
      source.ratio, target, size, gen.upscale.quality, cost, source.consent_at, source.hidden, image.id, ip, Date.now());
  })();
  return getOwned(user, id);
}

// ---------- read

function ownedRow(user, id) {
  const row = db.prepare(`SELECT * FROM generations WHERE id = ? AND user_id = ? AND kind = 'work' AND shoot_id IS NULL
    AND deleted_at IS NULL`).get(String(id), user.id);
  if (!row) throw notFound("作品不存在或已删除");
  return row;
}

export function getOwned(user, id) {
  return withImages([ownedRow(user, id)])[0];
}

// status: "" (all), active, succeeded, failed, public, favorite, or hidden.
// Works the user hid show up only under "hidden".
export function listOwned(user, { status, offset, size }) {
  const where = ["user_id = ?", "kind = 'work'", "shoot_id IS NULL", "deleted_at IS NULL", status === "hidden" ? "user_hidden = 1" : "user_hidden = 0"];
  const params = [user.id];
  if (status === "active") where.push("status IN ('queued','running')");
  else if (["succeeded", "failed"].includes(status)) { where.push("status = ?"); params.push(status); }
  else if (status === "public") where.push("is_public = 1");
  else if (status === "favorite") where.push("favorite = 1");
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
  const row = ownedRow(user, id);
  if (row.status === "queued" || row.status === "running") throw badRequest("JOB_ACTIVE", "任务进行中，完成后才能删除");
  removeFiles(row.id);
  db.prepare("UPDATE generations SET deleted_at = ?, is_public = 0 WHERE id = ?").run(Date.now(), row.id);
}

export function removeFiles(generationId) {
  const imgs = db.prepare("SELECT path, thumb_path FROM generation_images WHERE generation_id = ?").all(generationId);
  for (const img of imgs) {
    for (const rel of [img.path, img.thumb_path, viewRel(img.path)]) {
      try { fs.rmSync(imageFile(rel), { force: true }); } catch { /* ignore */ }
    }
  }
}

// The owner's own filing: hide a work from their lists, or favourite it.
export function setFlags(user, id, { hidden, favorite }) {
  const row = ownedRow(user, id);
  if (hidden !== undefined) db.prepare("UPDATE generations SET user_hidden = ? WHERE id = ?").run(hidden ? 1 : 0, row.id);
  if (favorite !== undefined) db.prepare("UPDATE generations SET favorite = ? WHERE id = ?").run(favorite ? 1 : 0, row.id);
  return getOwned(user, id);
}

// A work made from a real person's photo goes public only when the setting
// allows it and the owner confirms, each time, that the person agreed to it
// being shown (portrait rights). The person's photo itself never goes public.
export function setPublic(user, id, isPublic, { portraitConsent = false } = {}) {
  const row = ownedRow(user, id);
  const safety = settings.get("safety");
  const real = row.person_kind === "real";
  if (isPublic) {
    if (!safety.showcaseEnabled) throw forbidden("灵感广场暂未开放", "SHOWCASE_DISABLED");
    if (row.status !== "succeeded") throw badRequest("NOT_READY", "只有生成成功的作品可以发布");
    if (real && !safety.realPersonPublic) throw badRequest("PERSON_NOT_PUBLISHABLE", "使用了真人照片的作品暂不能公开发布");
    if (real && !portraitConsent) {
      throw badRequest("PORTRAIT_CONSENT_REQUIRED", "公开使用了真人照片的作品前，请确认照片中的人同意公开展示");
    }
    if (row.hidden) throw forbidden("该作品已被管理员隐藏，不能公开", "HIDDEN_BY_ADMIN");
  }
  db.prepare(`UPDATE generations SET is_public = ?, published_at = ?,
    publish_consent_at = CASE WHEN ? THEN ? ELSE publish_consent_at END WHERE id = ?`)
    .run(isPublic ? 1 : 0, isPublic ? Date.now() : null, isPublic && real ? 1 : 0, Date.now(), row.id);
  return getOwned(user, id);
}

// Whether real-person works may show: never when publishing them is off, and
// with 真人作品审核 on (the default) only once an admin approved them.
export function realPersonShown(safety = settings.get("safety")) {
  if (!safety.realPersonPublic) return "g.person_kind != 'real'";
  return safety.realPersonReview ? "(g.person_kind != 'real' OR g.approved = 1)" : "1 = 1";
}

// Public works for the showcase. With review on, only admin-approved works
// appear; otherwise any published, non-hidden work. Featured works sort first.
const publicWorks = () => `FROM generations g JOIN users u ON u.id = g.user_id WHERE g.is_public = 1 AND g.hidden = 0
  AND g.deleted_at IS NULL AND g.status = 'succeeded' AND ${realPersonShown()} AND u.status = 'active'`;

// withTotal: false skips counting every public work (the home page shows no total).
export function showcase({ offset, size, featuredOnly = false, withTotal = true }) {
  const safety = settings.get("safety");
  if (!safety.showcaseEnabled) return { total: 0, items: [] };
  const filter = [safety.showcaseReview ? "AND g.approved = 1" : "", featuredOnly ? "AND g.featured = 1" : ""].join(" ");
  const total = withTotal ? db.prepare(`SELECT COUNT(*) AS n ${publicWorks()} ${filter}`).get().n : null;
  const rows = db.prepare(`SELECT g.*, u.nickname AS author ${publicWorks()} ${filter}
    ORDER BY g.featured DESC, g.published_at DESC LIMIT ? OFFSET ?`).all(size, offset);
  const map = imagesFor(rows.map((r) => r.id));
  return {
    total,
    items: rows.map((r) => ({
      id: r.id, author: r.author, style: r.style, scene: r.scene, camera: r.camera, realism: !!r.realism, ratio: r.ratio, featured: !!r.featured,
      refs: refSummary(r), images: map.get(r.id) || [], publishedAt: r.published_at
    }))
  };
}

// Home page examples: public works made from exactly one library pose and one
// library outfit (no person, scene or item images), shown as
// pose + outfit = result. Featured works first.
export function homeCombos(viewer, limit = 6) {
  const safety = settings.get("safety");
  if (!safety.showcaseEnabled) return [];
  const rows = db.prepare(`SELECT g.* ${publicWorks()} ${safety.showcaseReview ? "AND g.approved = 1" : ""}
      AND g.pose_id IS NOT NULL AND g.outfit_id IS NOT NULL AND g.person_kind = 'none'
      AND g.scene_asset_id IS NULL AND g.item_ids IS NULL
    ORDER BY g.featured DESC, g.published_at DESC LIMIT 40`).all();
  const images = imagesFor(rows.map((r) => r.id));
  const out = [];
  for (const row of rows) {
    const pose = library.getAsset(row.pose_id);
    const outfit = library.getAsset(row.outfit_id);
    const result = images.get(row.id)?.[0];
    if (!result || !library.visible(pose, viewer) || !library.visible(outfit, viewer)) continue;
    out.push({ id: row.id, pose: library.displayDto(pose), outfit: library.displayDto(outfit), result, style: row.style, ratio: row.ratio });
    if (out.length >= limit) break;
  }
  return out;
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
  const gen = settings.get("generation");
  const labelOf = (list, id) => (id ? list.find((x) => x.id === id)?.label || id : "");
  return {
    total,
    items: rows.map((r) => ({
      ...dto(r, map.get(r.id) || []),
      // The names the studio showed, for the admin's detail view.
      labels: { quality: labelOf(gen.qualities, r.quality), tier: labelOf(gen.tiers, r.tier), style: labelOf(gen.styles, r.style),
        scene: labelOf(gen.scenes, r.scene), camera: labelOf(gen.cameras || [], r.camera) },
      userId: r.user_id, userEmail: r.user_email, channelName: r.channel_name, model: r.model,
      attempts: r.attempts, errorDetail: r.error_detail, apiCostUsd: r.api_cost_usd,
      usage: r.usage ? JSON.parse(r.usage) : null, promptFinal: r.prompt_final,
      deleted: !!r.deleted_at, clientIp: r.client_ip, hasPerson: r.person_kind !== "none",
      personUploadId: r.person_upload_id, outfitUploadId: r.outfit_upload_id,
      kind: r.kind, refUploadId: r.ref_upload_id, sourceAssetId: r.source_asset_id, assetJob: r.kind === "asset" ? JSON.parse(r.params || "{}") : null,
      shootId: r.shoot_id, publishConsentAt: r.publish_consent_at
    }))
  };
}

export function adminUpdate(id, { hidden, featured, approved }) {
  const row = db.prepare("SELECT * FROM generations WHERE id = ?").get(String(id));
  if (!row) throw notFound("作品不存在");
  if (hidden !== undefined) db.prepare("UPDATE generations SET hidden = ? WHERE id = ?").run(hidden ? 1 : 0, row.id);
  if (approved !== undefined) db.prepare("UPDATE generations SET approved = ? WHERE id = ?").run(approved ? 1 : 0, row.id);
  if (featured !== undefined) {
    if (featured && row.person_kind === "real" && !settings.get("safety").realPersonPublic) {
      throw badRequest("PERSON_NOT_PUBLISHABLE", "「内容安全」里没有开放公开真人照片作品，不能推荐");
    }
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
  return showcase({ offset: 0, size: limit, featuredOnly: true, withTotal: false }).items;
}

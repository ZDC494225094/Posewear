import fs from "node:fs";
import sharp from "sharp";
import { db, tx } from "../db.js";
import * as settings from "./settings.js";
import * as credits from "./credits.js";
import * as library from "./library.js";
import * as taxonomy from "./taxonomy.js";
import * as uploads from "./uploads.js";
import * as channels from "./channels.js";
import * as assetJobs from "./asset-jobs.js";
import { InputError } from "./asset-jobs.js";
import { imageFile, removeFiles } from "./generations.js";
import { flexibleSize } from "./sizes.js";
import { apiCostUsd } from "./pricing.js";
import { randomId } from "../lib/crypto.js";
import { badRequest, forbidden, notFound, HttpError } from "../lib/errors.js";
import { DAY } from "../lib/time.js";
import * as v from "../lib/validate.js";

// 婚纱影楼. A couple buys a package (looks × shots per look), uploads photos of
// both people, and for every look picks a scene, the two outfits and the
// bride's styling. Every photo of the album is a work (a generations row with
// shoot_id) run by the normal worker; the package is paid up front, the photo
// jobs cost nothing themselves. wedding_photos keeps one slot per photo with
// its latest job, earlier versions and the version the couple chose.
//
// Admins keep the scenes: an empty location plate (a library scene asset) and
// sample photos made with a virtual couple (works with shoot_id "sample:<id>").

export const CATEGORIES = { studio: "影棚内景", outdoor: "外景", chinese: "中式" };
const OUTFIT_MAJORS = { bride: "wedding-bride", groom: "wedding-groom" };
// [key, 名称, English for the prompt]
export const STYLING = {
  hair: [
    ["low-bun", "低盘发", "an elegant low bun with soft face-framing strands"],
    ["high-bun", "高盘发", "a sleek high updo"],
    ["waves", "披发微卷", "long loose waves"],
    ["braid", "编发", "a romantic side braid with small flowers"],
    ["chinese-updo", "中式发髻", "a traditional Chinese bridal updo with gold hairpins"]
  ],
  headpiece: [
    ["veil", "长头纱", "a long sheer cathedral veil"],
    ["short-veil", "短头纱", "a short shoulder-length veil"],
    ["flowers", "花环", "a delicate fresh-flower crown"],
    ["tiara", "皇冠", "a fine crystal tiara"],
    ["phoenix", "凤冠", "an ornate gold Chinese phoenix crown (fengguan) with tassels"],
    ["none", "不戴头饰", ""]
  ],
  makeup: [
    ["natural", "清透自然", "natural, fresh bridal makeup"],
    ["korean", "韩式", "soft Korean-style makeup with dewy skin"],
    ["retro", "复古红唇", "classic makeup with a red lip"],
    ["chinese", "中式", "traditional Chinese bridal makeup with red lips and defined brows"]
  ]
};
const MAX_PHOTOS = 5;      // per person, uploaded
const REFS_PER_PERSON = 3; // per person, sent to the model
const MAX_EXTRA = 3;       // extra shots per look

const styleEn = (kind, key) => STYLING[kind].find(([k]) => k === key)?.[2] || "";
const styleZh = (kind, key) => STYLING[kind].find(([k]) => k === key)?.[1] || "";
const fill = (template, values) =>
  String(template || "").replace(/\{(\w+)\}/g, (all, key) => (key in values ? String(values[key]) : all));
const parse = (text, fallback) => { try { return JSON.parse(text); } catch { return fallback; } };

function cfg() {
  return settings.get("wedding");
}

// ---------- scenes

const sceneRow = (id) => db.prepare("SELECT * FROM wedding_scenes WHERE id = ?").get(Number(id)) || null;

// The location plate: one an admin picked, else the result of its plate job.
function plateAsset(scene) {
  const chosen = scene.plate_asset_id && library.getAsset(scene.plate_asset_id);
  if (chosen && chosen.enabled) return chosen;
  if (!scene.plate_job_id) return null;
  const job = db.prepare("SELECT status, params FROM generations WHERE id = ?").get(scene.plate_job_id);
  const id = job?.status === "succeeded" ? parse(job.params, {}).assetIds?.[0] : null;
  return (id && library.getAsset(id)) || null;
}

function plateJobStatus(scene) {
  if (!scene.plate_job_id) return null;
  return db.prepare("SELECT status FROM generations WHERE id = ?").get(scene.plate_job_id)?.status || null;
}

function samplesOf(sceneId) {
  return db.prepare(`SELECT i.id, i.width, i.height FROM generation_images i JOIN generations g ON g.id = i.generation_id
    WHERE g.shoot_id = ? AND g.status = 'succeeded' AND g.deleted_at IS NULL ORDER BY g.created_at DESC, i.idx`)
    .all(`sample:${sceneId}`)
    .map((r) => ({ id: r.id, width: r.width, height: r.height,
      thumb: `/media/wedding/sample/${r.id}/thumb`, url: `/media/wedding/sample/${r.id}/full` }));
}

function sceneDto(scene, { admin = false } = {}) {
  const plate = plateAsset(scene);
  const out = {
    id: scene.id, key: scene.key, name: scene.name, category: scene.category, categoryText: CATEGORIES[scene.category],
    description: scene.description,
    plate: plate ? { id: plate.id, thumb: library.dto(plate).thumb, preview: library.dto(plate).preview } : null,
    samples: samplesOf(scene.id),
    recommend: { bride: scene.bride_outfit, groom: scene.groom_outfit, hair: scene.hair, headpiece: scene.headpiece, makeup: scene.makeup }
  };
  if (admin) {
    const active = db.prepare("SELECT COUNT(*) AS n FROM generations WHERE shoot_id = ? AND status IN ('queued','running')")
      .get(`sample:${scene.id}`).n;
    Object.assign(out, { prompt: scene.prompt, light: scene.light, enabled: !!scene.enabled, sort: scene.sort,
      plateAssetId: scene.plate_asset_id, plateJob: plateJobStatus(scene), samplesActive: active });
  }
  return out;
}

const enabledScenes = () => db.prepare("SELECT * FROM wedding_scenes WHERE enabled = 1 ORDER BY sort, id").all();

// ---------- outfits

// Choices for one role: every minor of the bridal or groom's major, with up to
// six library outfits filed under it that may be used with a real person.
function outfitOptions(role, viewer) {
  const majorKey = OUTFIT_MAJORS[role];
  const major = taxonomy.tree("outfit").find((m) => m.key === majorKey);
  if (!major) return [];
  return major.children.map((c) => ({
    categoryId: c.id, key: c.key, name: c.zh,
    assets: library.queryFlat("outfit", { series: majorKey, category: c.key }, viewer, { limit: 12 }).items
      .filter((a) => a.aiWithPerson).slice(0, 6)
  }));
}

function outfitMinor(role, categoryId) {
  const minor = taxonomy.get(Number(categoryId));
  const major = minor?.parent_id ? taxonomy.get(minor.parent_id) : null;
  if (!minor || minor.type !== "outfit" || major?.key !== OUTFIT_MAJORS[role]) {
    throw badRequest("INVALID_OUTFIT", role === "bride" ? "请为每套造型选择新娘礼服" : "请为每套造型选择新郎礼服");
  }
  return { minor, major };
}

// ---------- catalog for the wizard

export function catalog(viewer) {
  const c = cfg();
  return {
    enabled: c.enabled && settings.get("generation").enabled,
    packages: c.packages.map((p) => ({ ...p, shots: Math.min(p.shots, c.shots.length), photos: p.looks * Math.min(p.shots, c.shots.length) })),
    extraPhotoPrice: c.extraPhotoPrice, retakePrice: c.retakePrice, freeRetries: c.freeRetries, retentionDays: c.retentionDays,
    maxExtra: MAX_EXTRA, maxPhotos: MAX_PHOTOS, refsPerPerson: REFS_PER_PERSON,
    shots: c.shots.map(({ key, name, people, ratio }) => ({ key, name, people, ratio })),
    scenes: enabledScenes().map((s) => sceneDto(s)),
    categories: CATEGORIES,
    outfits: { bride: outfitOptions("bride", viewer), groom: outfitOptions("groom", viewer) },
    styling: Object.fromEntries(Object.entries(STYLING).map(([kind, list]) => [kind, list.map(([key, name]) => ({ key, name }))]))
  };
}

// ---------- the couple's photos

// A photo of the bride or groom: a consented person upload kept for the
// wedding retention period, with warnings about light and resolution.
export async function uploadPhoto(user, file, { consent = false } = {}) {
  if (!consent) throw badRequest("CONSENT_REQUIRED", "请先确认两位新人都同意使用照片，并且都已年满 18 周岁");
  const saved = await uploads.saveUpload(user, "person", file, { consent: true });
  db.prepare("UPDATE uploads SET expires_at = ? WHERE id = ?").run(Date.now() + cfg().retentionDays * DAY, saved.id);
  const row = db.prepare("SELECT * FROM uploads WHERE id = ?").get(saved.id);
  return { upload: uploads.dto(row), warnings: await photoWarnings(uploads.uploadFile(row)) };
}

async function photoWarnings(file) {
  const out = [];
  try {
    const meta = await sharp(file).metadata();
    if (Math.min(meta.width, meta.height) < 640) out.push("分辨率偏低，五官细节可能不够");
    const { channels: ch } = await sharp(file).resize(256, 256, { fit: "inside" }).stats();
    const light = 0.299 * ch[0].mean + 0.587 * ch[1].mean + 0.114 * ch[2].mean;
    if (light < 60) out.push("照片偏暗");
    else if (light > 225) out.push("照片偏亮，可能过曝");
  } catch { /* the upload itself already passed decoding */ }
  return out;
}

function personUploads(user, ids, label) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(String).filter(Boolean))];
  if (!list.length) throw badRequest("PHOTOS_REQUIRED", `请上传${label}的照片，至少 1 张正脸`);
  if (list.length > MAX_PHOTOS) throw badRequest("TOO_MANY_PHOTOS", `${label}最多 ${MAX_PHOTOS} 张照片`);
  return list.map((id) => {
    const row = uploads.getOwnedUpload(user, id, "person");
    if (!row.consent_at && row.virtual !== "approved") throw badRequest("CONSENT_REQUIRED", `${label}的照片缺少使用授权，请重新上传`);
    return row.id;
  });
}

// ---------- packages and price

function packageOf(key) {
  const pkg = cfg().packages.find((p) => p.key === key);
  if (!pkg) throw badRequest("INVALID_PACKAGE", "套系不存在，请重新选择");
  return pkg;
}

export function quote(input) {
  const c = cfg();
  const pkg = packageOf(input.packageKey);
  const base = Math.min(pkg.shots, c.shots.length);
  const extra = v.int(input.extraPerLook ?? 0, "extraPerLook", { min: 0, max: Math.max(0, Math.min(MAX_EXTRA, c.shots.length - base)) });
  const perLook = base + extra;
  return { pkg, extra, perLook, photos: pkg.looks * perLook, price: pkg.price + extra * pkg.looks * c.extraPhotoPrice };
}

function cleanLooks(user, looks, count) {
  if (!Array.isArray(looks) || looks.length !== count) throw badRequest("INVALID_LOOKS", `这个套系需要选择 ${count} 套造型`);
  const viewer = { loggedIn: true, userId: user.id };
  return looks.map((look, i) => {
    const scene = sceneRow(look?.sceneId);
    if (!scene || !scene.enabled) throw badRequest("SCENE_UNAVAILABLE", `第 ${i + 1} 套造型的场景已下线，请重新选择`);
    const outfit = (role) => {
      const { minor } = outfitMinor(role, look?.[role]?.categoryId);
      let assetId = null;
      if (look[role].assetId) {
        const asset = library.getAsset(look[role].assetId);
        if (!asset || asset.type !== "outfit" || asset.category !== minor.key || !library.visible(asset, viewer)
          || !library.usableForAI(asset, { withPerson: true })) {
          throw badRequest("OUTFIT_UNAVAILABLE", `第 ${i + 1} 套造型的礼服已下架，请重新选择`);
        }
        assetId = asset.id;
      }
      return { categoryId: minor.id, assetId };
    };
    const pick = (kind, value) => {
      if (!STYLING[kind].some(([k]) => k === value)) throw badRequest("INVALID_STYLING", "造型选项不正确，请重新选择");
      return value;
    };
    return { sceneId: scene.id, bride: outfit("bride"), groom: outfit("groom"),
      hair: pick("hair", look.hair), headpiece: pick("headpiece", look.headpiece), makeup: pick("makeup", look.makeup) };
  });
}

// ---------- prompts and model inputs

// What one photo is made from, in the order the images are sent: the bride's
// photos, the groom's, her outfit, his outfit, the location plate. The plan is
// stored with the job so the worker sends exactly what the prompt describes.
function plan({ look, shot, bride = [], groom = [], virtual = false }) {
  const p = cfg().prompt;
  const scene = sceneRow(look.sceneId);
  const lines = [p.intro];
  const inputs = [];
  let n = 0;
  const range = (count) => {
    const from = n + 1;
    n += count;
    return count === 1 ? `Image ${from} shows` : `Images ${from}–${n} show`;
  };
  const withBride = shot.people !== "groom";
  const withGroom = shot.people !== "bride";
  if (virtual) lines.push(p.virtualCouple);
  else {
    const b = withBride ? bride.slice(0, REFS_PER_PERSON) : [];
    const g = withGroom ? groom.slice(0, REFS_PER_PERSON) : [];
    if (b.length) { lines.push(fill(p.bride, { images: range(b.length) })); inputs.push(...b.map((id) => ({ upload: id }))); }
    if (g.length) { lines.push(fill(p.groom, { images: range(g.length) })); inputs.push(...g.map((id) => ({ upload: id }))); }
  }
  for (const role of ["bride", "groom"]) {
    if (role === "bride" ? !withBride : !withGroom) continue;
    const minor = taxonomy.get(look[role].categoryId);
    const asset = look[role].assetId ? library.getAsset(look[role].assetId) : null;
    const name = minor ? (minor.name_en || minor.name_zh).toLowerCase() : "wedding attire";
    if (asset) {
      lines.push(fill(role === "bride" ? p.brideOutfit : p.groomOutfit, { n: ++n, name }));
      inputs.push({ asset: asset.id });
    } else {
      lines.push(fill(p.outfitText, { role, value: minor?.hint || name }));
    }
  }
  const plate = scene ? plateAsset(scene) : null;
  if (plate) { lines.push(fill(p.scene, { n: ++n })); inputs.push({ asset: plate.id }); }
  if (scene?.prompt) lines.push(fill(p.sceneText, { value: scene.prompt }));
  const styling = [
    withBride ? `the bride has ${styleEn("hair", look.hair)}${styleEn("headpiece", look.headpiece) ? ` and ${styleEn("headpiece", look.headpiece)}` : ""}, with ${styleEn("makeup", look.makeup)}` : "",
    withGroom ? "the groom has neat, natural hair and a clean, groomed look" : ""
  ].filter(Boolean).join("; ");
  lines.push(fill(p.styling, { value: styling }));
  lines.push(fill(p.shot, { value: shot.prompt }));
  if (scene?.light) lines.push(fill(p.light, { value: scene.light }));
  lines.push(p.camera, p.realism, p.safety, p.outro);
  return { prompt: lines.map((l) => String(l || "").trim()).filter(Boolean).join("\n"), inputs };
}

const insertJob = () => db.prepare(`INSERT INTO generations (id, user_id, status, kind, mode, shoot_id, params, person_kind,
  prompt_user, prompt_final, ratio, tier, size, quality, n, cost_credits, consent_at, client_ip, created_at)
  VALUES (?, ?, 'queued', 'work', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?)`);

// Queue the job for one photo slot and point the slot at it.
function queuePhoto(shoot, photo, { ip = null } = {}) {
  const c = cfg();
  const looks = parse(shoot.looks, []);
  const shot = c.shots.find((s) => s.key === photo.shot) || c.shots[0];
  const built = plan({ look: looks[photo.look], shot, bride: parse(shoot.bride_uploads, []), groom: parse(shoot.groom_uploads, []) });
  const id = randomId(12);
  insertJob().run(id, shoot.user_id, built.inputs.length ? "edit" : "generate", shoot.id,
    JSON.stringify({ photoId: photo.id, look: photo.look, shot: shot.key, inputs: built.inputs }), "real", shot.name, built.prompt,
    shot.ratio, c.tier, flexibleSize(shot.ratio, c.tier), c.quality, shoot.consent_at, ip, Date.now());
  db.prepare("UPDATE wedding_photos SET generation_id = ?, updated_at = ? WHERE id = ?").run(id, Date.now(), photo.id);
  return id;
}

// Files for the worker, from the plan stored with the job.
export function inputFiles(job) {
  const params = parse(job.params, {});
  return (params.inputs || []).map((input, i) => {
    if (input.upload) {
      const row = db.prepare("SELECT * FROM uploads WHERE id = ?").get(input.upload);
      if (!row || row.deleted_at || (row.expires_at && row.expires_at <= Date.now())) {
        throw new InputError("新人照片已过期或被删除，请在相册里重新上传照片");
      }
      return { file: uploads.uploadFile(row), name: `person-${i + 1}` };
    }
    const asset = library.getAsset(input.asset);
    const file = asset && library.aiSourceFile(asset);
    if (!file || !fs.existsSync(file)) throw new InputError("礼服或场景图已下架，请重新选择造型");
    return { file, name: `${asset.type}-${i + 1}` };
  });
}

// ---------- shoots

export function createShoot(user, input, { ip = null } = {}) {
  const c = cfg();
  if (!c.enabled || !settings.get("generation").enabled) throw forbidden("婚纱影楼暂未开放", "WEDDING_DISABLED");
  if (!channels.hasUsableChannel()) throw new HttpError(503, "NO_CHANNEL", "生成服务尚未配置完成，请联系管理员");
  if (!v.bool(input.consent)) throw badRequest("CONSENT_REQUIRED", "请先确认两位新人都同意使用照片，并且都已年满 18 周岁");
  const q = quote(input);
  const title = v.str(input.title, "title", { optional: true, max: 30 });
  const bride = personUploads(user, input.brideUploadIds, "新娘");
  const groom = personUploads(user, input.groomUploadIds, "新郎");
  const looks = cleanLooks(user, input.looks, q.pkg.looks);
  const id = randomId(12);
  const now = Date.now();
  const shots = c.shots.slice(0, q.perLook);
  tx(() => {
    credits.adjust(user.id, -q.price, "wedding", { refType: "wedding", refId: id, note: `${q.pkg.name}套系 · ${q.photos} 张` });
    db.prepare(`INSERT INTO wedding_shoots (id, user_id, title, package, extra_per_look, photos, cost_credits, retakes_left,
      bride_uploads, groom_uploads, looks, consent_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, user.id, title, JSON.stringify(q.pkg), q.extra, q.photos, q.price, q.pkg.retakes,
      JSON.stringify(bride), JSON.stringify(groom), JSON.stringify(looks), now, now, now);
    const shoot = db.prepare("SELECT * FROM wedding_shoots WHERE id = ?").get(id);
    const insert = db.prepare(`INSERT INTO wedding_photos (id, shoot_id, idx, look, shot, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    let idx = 0;
    looks.forEach((look, lookIndex) => {
      for (const shot of shots) {
        const photoId = randomId(12);
        insert.run(photoId, id, idx++, lookIndex, shot.key, now, now);
        queuePhoto(shoot, { id: photoId, look: lookIndex, shot: shot.key }, { ip });
      }
    });
    keepUploads([...bride, ...groom]);
  })();
  return album(user, id);
}

// The couple's photos stay for the retention period after the latest activity.
function keepUploads(ids) {
  const until = Date.now() + cfg().retentionDays * DAY;
  const stmt = db.prepare("UPDATE uploads SET expires_at = MAX(COALESCE(expires_at, 0), ?) WHERE id = ? AND expires_at IS NOT NULL");
  for (const id of ids) stmt.run(until, id);
}

function ownedShoot(user, id, { admin = false } = {}) {
  const row = db.prepare("SELECT * FROM wedding_shoots WHERE id = ? AND deleted_at IS NULL").get(String(id));
  if (!row || (!admin && row.user_id !== user.id)) throw notFound("相册不存在或已删除");
  return row;
}

function photoOf(shoot, photoId) {
  const row = db.prepare("SELECT * FROM wedding_photos WHERE id = ? AND shoot_id = ?").get(String(photoId), shoot.id);
  if (!row) throw notFound("照片不存在");
  return row;
}

function imagesOf(genIds) {
  if (!genIds.length) return new Map();
  const rows = db.prepare(`SELECT * FROM generation_images WHERE generation_id IN (${genIds.map(() => "?").join(",")}) ORDER BY idx`)
    .all(...genIds);
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.generation_id)) map.set(r.generation_id, []);
    map.get(r.generation_id).push({ id: r.id, width: r.width, height: r.height, format: r.format,
      thumb: `/media/gen/${r.id}/thumb`, url: `/media/gen/${r.id}/full`, download: `/media/gen/${r.id}/full?download=1` });
  }
  return map;
}

const alive = (row) => row && !row.deleted_at && (!row.expires_at || row.expires_at > Date.now());

export function album(user, id, { admin = false } = {}) {
  const shoot = ownedShoot(user, id, { admin });
  const c = cfg();
  const looks = parse(shoot.looks, []);
  const photos = db.prepare("SELECT * FROM wedding_photos WHERE shoot_id = ? ORDER BY idx").all(shoot.id);
  const genIds = photos.flatMap((p) => [...parse(p.history, []), p.generation_id]).filter(Boolean);
  const gens = new Map(genIds.length ? db.prepare(`SELECT id, status, error_message, created_at, started_at, finished_at FROM generations
    WHERE id IN (${genIds.map(() => "?").join(",")})`).all(...genIds).map((g) => [g.id, g]) : []);
  const images = imagesOf(genIds);
  const shotOf = (key) => c.shots.find((s) => s.key === key) || { key, name: key, people: "couple", ratio: "2:3" };
  const items = photos.map((p) => {
    const latest = gens.get(p.generation_id);
    // Versions oldest first; each successful job gives one image.
    const versions = [...parse(p.history, []), p.generation_id].flatMap((g) => (gens.get(g)?.status === "succeeded" ? images.get(g) || [] : []));
    const chosen = versions.find((img) => img.id === p.image_id) || versions.at(-1) || null;
    const shot = shotOf(p.shot);
    return {
      id: p.id, idx: p.idx, look: p.look, shot: { key: shot.key, name: shot.name, people: shot.people, ratio: shot.ratio },
      status: p.cancelled ? "cancelled" : latest?.status || "queued",
      errorMessage: latest?.status === "failed" ? latest.error_message : null,
      startedAt: latest?.started_at || null,
      image: chosen, versions, favorite: !!p.favorite, freeRetry: latest?.status === "failed" && p.failures < c.freeRetries
    };
  });
  const lookDtos = looks.map((look, i) => {
    const scene = sceneRow(look.sceneId);
    const outfit = (role) => {
      const minor = taxonomy.get(look[role].categoryId);
      const asset = look[role].assetId ? library.getAsset(look[role].assetId) : null;
      return { name: minor?.name_zh || "礼服", thumb: asset ? library.dto(asset).thumb : null };
    };
    return {
      index: i, scene: scene ? { id: scene.id, name: scene.name, categoryText: CATEGORIES[scene.category],
        thumb: samplesOf(scene.id)[0]?.thumb || (plateAsset(scene) ? library.dto(plateAsset(scene)).thumb : null) } : { name: "场景已下线" },
      bride: outfit("bride"), groom: outfit("groom"),
      styling: { hair: styleZh("hair", look.hair), headpiece: styleZh("headpiece", look.headpiece), makeup: styleZh("makeup", look.makeup) }
    };
  });
  const uploadRows = (ids) => ids.map((uid) => db.prepare("SELECT * FROM uploads WHERE id = ?").get(uid)).filter(Boolean)
    .map((u) => ({ id: u.id, thumb: alive(u) ? `/media/uploads/${u.id}/thumb` : null, alive: alive(u), expiresAt: u.expires_at }));
  const count = (status) => items.filter((it) => it.status === status).length;
  const progress = { total: items.length, done: items.filter((it) => it.image && it.status !== "cancelled").length,
    active: count("queued") + count("running"), failed: count("failed"), cancelled: count("cancelled") };
  return {
    id: shoot.id, title: shoot.title, package: parse(shoot.package, {}), photos: shoot.photos, extraPerLook: shoot.extra_per_look,
    cost: shoot.cost_credits, refunded: shoot.refunded_credits, retakesLeft: shoot.retakes_left,
    retakePrice: c.retakePrice, freeRetries: c.freeRetries,
    status: progress.active ? "shooting" : progress.failed ? "attention" : "done",
    progress, looks: lookDtos, items,
    uploads: { bride: uploadRows(parse(shoot.bride_uploads, [])), groom: uploadRows(parse(shoot.groom_uploads, [])) },
    createdAt: shoot.created_at, updatedAt: shoot.updated_at,
    ...(admin ? { userId: shoot.user_id } : {})
  };
}

export function listShoots(user, { offset = 0, size = 24 } = {}) {
  const rows = db.prepare(`SELECT * FROM wedding_shoots WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(user.id, size, offset);
  const total = db.prepare("SELECT COUNT(*) AS n FROM wedding_shoots WHERE user_id = ? AND deleted_at IS NULL").get(user.id).n;
  return { total, items: rows.map(summary) };
}

// A shoot as a card: cover, progress and package.
function summary(shoot) {
  const counts = db.prepare(`SELECT
      SUM(g.status = 'succeeded') AS done, SUM(g.status IN ('queued','running')) AS active, SUM(g.status = 'failed') AS failed
    FROM wedding_photos p LEFT JOIN generations g ON g.id = p.generation_id WHERE p.shoot_id = ? AND p.cancelled = 0`).get(shoot.id);
  const cover = db.prepare(`SELECT i.id FROM wedding_photos p JOIN generations g ON g.id = p.generation_id
      JOIN generation_images i ON i.generation_id = g.id
    WHERE p.shoot_id = ? AND g.status = 'succeeded' ORDER BY p.favorite DESC, p.idx LIMIT 1`).get(shoot.id);
  const pkg = parse(shoot.package, {});
  return {
    id: shoot.id, title: shoot.title, packageName: pkg.name, photos: shoot.photos, cost: shoot.cost_credits,
    done: counts.done || 0, active: counts.active || 0, failed: counts.failed || 0,
    cover: cover ? `/media/gen/${cover.id}/thumb` : null, createdAt: shoot.created_at
  };
}

// Shoot the photo again. A failed photo is retried free a few times; a finished
// one uses the package's free retakes, then costs retakePrice.
export function retake(user, shootId, photoId, { ip = null } = {}) {
  const c = cfg();
  const shoot = ownedShoot(user, shootId);
  const photo = photoOf(shoot, photoId);
  if (photo.cancelled) throw badRequest("PHOTO_CANCELLED", "这张已经退回点数，不能再拍");
  const latest = photo.generation_id ? db.prepare("SELECT status FROM generations WHERE id = ?").get(photo.generation_id) : null;
  if (latest && ["queued", "running"].includes(latest.status)) throw badRequest("JOB_ACTIVE", "这张还在拍摄中，请稍等");
  for (const id of [...parse(shoot.bride_uploads, []), ...parse(shoot.groom_uploads, [])]) {
    if (!alive(db.prepare("SELECT * FROM uploads WHERE id = ?").get(id))) {
      throw badRequest("UPLOADS_EXPIRED", "新人照片已过保留期，请新建一套相册重新上传");
    }
  }
  const failed = latest?.status === "failed";
  const free = failed && photo.failures < c.freeRetries;
  const useRetake = !free && shoot.retakes_left > 0;
  const charge = free || useRetake ? 0 : c.retakePrice;
  tx(() => {
    if (charge) credits.adjust(user.id, -charge, "wedding", { refType: "wedding", refId: shoot.id, note: "婚纱照重拍" });
    db.prepare(`UPDATE wedding_shoots SET retakes_left = retakes_left - ?, updated_at = ? WHERE id = ?`)
      .run(useRetake ? 1 : 0, Date.now(), shoot.id);
    const history = [...parse(photo.history, []), ...(photo.generation_id ? [photo.generation_id] : [])];
    db.prepare(`UPDATE wedding_photos SET history = ?, image_id = NULL, failures = failures + ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(history), failed ? 1 : 0, Date.now(), photo.id);
    queuePhoto(shoot, photo, { ip });
    keepUploads([...parse(shoot.bride_uploads, []), ...parse(shoot.groom_uploads, [])]);
  })();
  return { charged: charge, free, usedRetake: useRetake };
}

// Keep one version of a photo (any successful take).
export function choose(user, shootId, photoId, imageId) {
  const shoot = ownedShoot(user, shootId);
  const photo = photoOf(shoot, photoId);
  const gens = [...parse(photo.history, []), photo.generation_id].filter(Boolean);
  const ok = gens.length && db.prepare(`SELECT 1 FROM generation_images i JOIN generations g ON g.id = i.generation_id
    WHERE i.id = ? AND g.status = 'succeeded' AND g.id IN (${gens.map(() => "?").join(",")})`).get(String(imageId), ...gens);
  if (!ok) throw badRequest("INVALID_INPUT", "这张照片没有这个版本");
  db.prepare("UPDATE wedding_photos SET image_id = ?, updated_at = ? WHERE id = ?").run(String(imageId), Date.now(), photo.id);
}

export function setFavorite(user, shootId, photoId, value) {
  const shoot = ownedShoot(user, shootId);
  const photo = photoOf(shoot, photoId);
  db.prepare("UPDATE wedding_photos SET favorite = ?, updated_at = ? WHERE id = ?").run(value ? 1 : 0, Date.now(), photo.id);
}

// Give up a photo that never came out: its share of the package comes back.
export function cancelPhoto(user, shootId, photoId) {
  const shoot = ownedShoot(user, shootId);
  const photo = photoOf(shoot, photoId);
  const latest = photo.generation_id ? db.prepare("SELECT status FROM generations WHERE id = ?").get(photo.generation_id) : null;
  const done = [...parse(photo.history, []), photo.generation_id].filter(Boolean)
    .some((g) => db.prepare("SELECT status FROM generations WHERE id = ?").get(g)?.status === "succeeded");
  if (photo.cancelled || latest?.status !== "failed" || done) throw badRequest("NOT_REFUNDABLE", "只有一直没拍成功的照片可以退回点数");
  const share = Math.floor(shoot.cost_credits / Math.max(1, shoot.photos));
  tx(() => {
    db.prepare("UPDATE wedding_photos SET cancelled = 1, updated_at = ? WHERE id = ?").run(Date.now(), photo.id);
    if (share > 0) {
      credits.adjust(user.id, share, "refund", { refType: "wedding", refId: shoot.id, note: "婚纱照未出片退回" });
      db.prepare("UPDATE wedding_shoots SET refunded_credits = refunded_credits + ?, updated_at = ? WHERE id = ?").run(share, Date.now(), shoot.id);
    }
  })();
  return { refunded: share };
}

export function rename(user, shootId, title) {
  const shoot = ownedShoot(user, shootId);
  db.prepare("UPDATE wedding_shoots SET title = ?, updated_at = ? WHERE id = ?")
    .run(v.str(title, "title", { optional: true, max: 30 }), Date.now(), shoot.id);
}

// Delete an album: its images, and the couple's photos unless another album
// still uses them.
export function removeShoot(user, shootId) {
  const shoot = ownedShoot(user, shootId);
  const active = db.prepare("SELECT COUNT(*) AS n FROM generations WHERE shoot_id = ? AND status IN ('queued','running')").get(shoot.id).n;
  if (active) throw badRequest("JOB_ACTIVE", "还有照片在拍摄中，完成后才能删除相册");
  const gens = db.prepare("SELECT id FROM generations WHERE shoot_id = ?").all(shoot.id);
  for (const g of gens) removeFiles(g.id);
  const now = Date.now();
  db.prepare("UPDATE generations SET deleted_at = ? WHERE shoot_id = ?").run(now, shoot.id);
  db.prepare("UPDATE wedding_shoots SET deleted_at = ?, updated_at = ? WHERE id = ?").run(now, now, shoot.id);
  const others = db.prepare("SELECT bride_uploads, groom_uploads FROM wedding_shoots WHERE user_id = ? AND deleted_at IS NULL").all(user.id)
    .flatMap((s) => [...parse(s.bride_uploads, []), ...parse(s.groom_uploads, [])]);
  for (const id of [...parse(shoot.bride_uploads, []), ...parse(shoot.groom_uploads, [])]) {
    if (others.includes(id)) continue;
    const row = db.prepare("SELECT * FROM uploads WHERE id = ?").get(id);
    if (row && !row.deleted_at) uploads.removeUploadFile(row);
  }
}

// The finished photos (the chosen version of each) for the album download.
export function downloadList(user, shootId) {
  const data = album(user, shootId);
  const name = (data.title || "婚纱照").replace(/[\\/:*?"<>|]+/g, "").trim() || "婚纱照";
  const files = [];
  for (const item of data.items) {
    if (!item.image || item.status === "cancelled") continue;
    const row = db.prepare("SELECT path, format FROM generation_images WHERE id = ?").get(item.image.id);
    if (!row) continue;
    const file = imageFile(row.path);
    if (!fs.existsSync(file)) continue;
    files.push({ name: `${name}-${String(item.idx + 1).padStart(2, "0")}-${item.shot.name}.${row.format}`, file });
  }
  if (!files.length) throw badRequest("NOTHING_TO_DOWNLOAD", "还没有拍好的照片");
  return { name, files };
}

// ---------- admin: scenes, samples, seed, shoots

// Choices for the scene editor: categories, outfit categories and styling.
export function sceneOptions() {
  const minors = (role) => (taxonomy.tree("outfit").find((m) => m.key === OUTFIT_MAJORS[role])?.children || [])
    .map((c) => ({ key: c.key, name: c.zh }));
  return {
    categories: CATEGORIES,
    outfits: { bride: minors("bride"), groom: minors("groom") },
    styling: Object.fromEntries(Object.entries(STYLING).map(([kind, list]) => [kind, list.map(([key, name]) => ({ key, name }))]))
  };
}

export function adminScenes() {
  return db.prepare("SELECT * FROM wedding_scenes ORDER BY sort, id").all().map((s) => sceneDto(s, { admin: true }));
}

const SCENE_KEY = /^[a-z0-9][a-z0-9-]{0,39}$/;

function cleanScene(input, existing) {
  const out = {};
  if (input.name !== undefined || !existing) out.name = v.str(input.name, "name", { min: 1, max: 20, message: "请填写场景名称" });
  if (input.category !== undefined || !existing) out.category = v.oneOf(input.category, "category", Object.keys(CATEGORIES));
  for (const [key, max] of [["description", 80], ["prompt", 600], ["light", 400]]) {
    if (input[key] !== undefined) out[key] = v.str(input[key], key, { optional: true, max });
  }
  for (const [key, field] of [["brideOutfit", "bride_outfit"], ["groomOutfit", "groom_outfit"]]) {
    if (input[key] !== undefined) out[field] = v.str(input[key], key, { optional: true, max: 40 });
  }
  for (const kind of ["hair", "headpiece", "makeup"]) {
    if (input[kind] !== undefined) {
      if (!STYLING[kind].some(([k]) => k === input[kind])) throw badRequest("INVALID_STYLING", "造型选项不正确");
      out[kind] = input[kind];
    }
  }
  if (input.enabled !== undefined) out.enabled = input.enabled ? 1 : 0;
  if (input.sort !== undefined) out.sort = Math.max(-100000, Math.min(100000, Math.round(Number(input.sort) || 0)));
  if (input.plateAssetId !== undefined) {
    if (input.plateAssetId) {
      const asset = library.getAsset(input.plateAssetId);
      if (!asset || asset.type !== "scene") throw badRequest("INVALID_INPUT", "底图需要是场景素材");
      out.plate_asset_id = asset.id;
    } else out.plate_asset_id = null;
  }
  return out;
}

export function saveScene(id, input) {
  const existing = id ? sceneRow(id) : null;
  if (id && !existing) throw notFound("场景不存在");
  const fields = cleanScene(input || {}, existing);
  const now = Date.now();
  if (!existing) {
    const key = String(input.key || "").trim() || `scene-${randomId(6).toLowerCase()}`;
    if (!SCENE_KEY.test(key)) throw badRequest("INVALID_KEY", "标识只能用小写字母、数字和 -");
    if (db.prepare("SELECT 1 FROM wedding_scenes WHERE key = ?").get(key)) throw badRequest("KEY_TAKEN", "已有这个标识");
    const sort = db.prepare("SELECT COALESCE(MAX(sort), 0) + 10 AS s FROM wedding_scenes").get().s;
    const row = { description: "", prompt: "", light: "", bride_outfit: "", groom_outfit: "", hair: "low-bun", headpiece: "veil",
      makeup: "natural", enabled: 1, sort, ...fields };
    const created = db.prepare(`INSERT INTO wedding_scenes (key, name, category, description, prompt, light, bride_outfit, groom_outfit,
      hair, headpiece, makeup, enabled, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      key, row.name, row.category, row.description, row.prompt, row.light, row.bride_outfit, row.groom_outfit,
      row.hair, row.headpiece, row.makeup, row.enabled, row.sort, now, now).lastInsertRowid;
    return sceneDto(sceneRow(created), { admin: true });
  }
  const keys = Object.keys(fields);
  if (keys.length) {
    db.prepare(`UPDATE wedding_scenes SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
      .run(...keys.map((k) => fields[k]), now, existing.id);
  }
  return sceneDto(sceneRow(existing.id), { admin: true });
}

export function deleteScene(id) {
  const scene = sceneRow(id);
  if (!scene) throw notFound("场景不存在");
  const used = db.prepare("SELECT COUNT(*) AS n FROM wedding_shoots WHERE deleted_at IS NULL AND looks LIKE ?")
    .get(`%"sceneId":${scene.id},%`).n;
  if (used) throw badRequest("SCENE_IN_USE", `有 ${used} 套相册用了这个场景，可以改为下线`);
  db.prepare("DELETE FROM wedding_scenes WHERE id = ?").run(scene.id);
}

// The empty location plate, made by the asset generator as a platform scene
// asset under 婚礼场景.
export function generatePlate(admin, id, { ip = null, limit = true } = {}) {
  const scene = sceneRow(id);
  if (!scene) throw notFound("场景不存在");
  const minor = taxonomy.minor("scene", "wedding", scene.category);
  if (!minor) throw badRequest("INVALID_CATEGORY", "缺少「婚礼场景」分类，请先在素材分类里恢复");
  const [job] = assetJobs.createJobs(admin, { type: "scene", categoryId: minor.id, publish: true,
    description: [scene.prompt, scene.light].filter(Boolean).join("; "), name: `${scene.name}（婚纱场景）` }, { admin: true, ip, limit });
  db.prepare("UPDATE wedding_scenes SET plate_job_id = ?, plate_asset_id = NULL, updated_at = ? WHERE id = ?").run(job.id, Date.now(), scene.id);
  return job;
}

// Sample photos with a virtual couple, shown to users when they pick scenes.
export function generateSamples(admin, id, count = 2, { ip = null } = {}) {
  const c = cfg();
  const scene = sceneRow(id);
  if (!scene) throw notFound("场景不存在");
  if (!channels.hasUsableChannel()) throw new HttpError(503, "NO_CHANNEL", "生成服务尚未配置完成");
  const viewer = { loggedIn: true, userId: admin.id };
  const options = { bride: outfitOptions("bride", viewer), groom: outfitOptions("groom", viewer) };
  const pickOutfit = (role, key) => {
    const option = options[role].find((o) => o.key === key) || options[role][0];
    return option ? { categoryId: option.categoryId, assetId: option.assets[0]?.id || null } : null;
  };
  const look = { sceneId: scene.id, bride: pickOutfit("bride", scene.bride_outfit), groom: pickOutfit("groom", scene.groom_outfit),
    hair: scene.hair || "low-bun", headpiece: scene.headpiece || "veil", makeup: scene.makeup || "natural" };
  if (!look.bride || !look.groom) throw badRequest("INVALID_CATEGORY", "缺少新娘礼服或新郎礼服分类");
  const shots = ["couple-full", "couple-walk", "couple-close", "wide"].map((key) => c.shots.find((s) => s.key === key)).filter(Boolean);
  const ids = [];
  const n = Math.max(1, Math.min(4, Number(count) || 2));
  tx(() => {
    for (let i = 0; i < n; i++) {
      const shot = shots[i % shots.length] || c.shots[0];
      const built = plan({ look, shot, virtual: true });
      const jobId = randomId(12);
      insertJob().run(jobId, admin.id, built.inputs.length ? "edit" : "generate", `sample:${scene.id}`,
        JSON.stringify({ sample: true, sceneId: scene.id, shot: shot.key, inputs: built.inputs }), "none", `示例 · ${scene.name}`,
        built.prompt, shot.ratio, c.tier, flexibleSize(shot.ratio, c.tier), c.quality, null, ip, Date.now());
      ids.push(jobId);
    }
  })();
  return ids;
}

export function deleteSample(imageId) {
  const row = db.prepare(`SELECT g.id FROM generation_images i JOIN generations g ON g.id = i.generation_id
    WHERE i.id = ? AND g.shoot_id LIKE 'sample:%'`).get(String(imageId));
  if (!row) throw notFound("示例图不存在");
  removeFiles(row.id);
  db.prepare("UPDATE generations SET deleted_at = ? WHERE id = ?").run(Date.now(), row.id);
}

// Public sample image file, or null.
export function sampleFile(imageId, variant) {
  const row = db.prepare(`SELECT i.path, i.thumb_path, g.shoot_id FROM generation_images i JOIN generations g ON g.id = i.generation_id
    WHERE i.id = ? AND g.shoot_id LIKE 'sample:%' AND g.deleted_at IS NULL AND g.status = 'succeeded'`).get(String(imageId));
  if (!row) return null;
  const scene = sceneRow(row.shoot_id.slice("sample:".length));
  if (!scene?.enabled) return null;
  return imageFile(variant === "thumb" ? row.thumb_path : row.path);
}

// What "补齐示例" would make: plates and two samples for every enabled scene
// that lacks them, and one outfit image for every bridal or groom's category
// without one. dryRun only counts it and estimates the model cost.
export function seed(admin, { dryRun = true, ip = null } = {}) {
  const c = cfg();
  const scenes = enabledScenes();
  const viewer = { loggedIn: true, userId: admin.id };
  const plates = scenes.filter((s) => !plateAsset(s) && !["queued", "running"].includes(plateJobStatus(s)));
  const samples = scenes.map((s) => {
    const have = samplesOf(s.id).length + db.prepare("SELECT COUNT(*) AS n FROM generations WHERE shoot_id = ? AND status IN ('queued','running')")
      .get(`sample:${s.id}`).n;
    return { scene: s, missing: Math.max(0, 2 - have) };
  }).filter((x) => x.missing);
  // Categories whose outfit image is already being made.
  const pending = new Set(db.prepare(`SELECT json_extract(params, '$.categoryId') AS c FROM generations
    WHERE kind = 'asset' AND status IN ('queued','running')`).all().map((r) => r.c));
  const outfits = ["bride", "groom"].flatMap((role) => outfitOptions(role, viewer).filter((o) => !o.assets.length && !pending.has(o.categoryId))
    .map((o) => ({ role, categoryId: o.categoryId })));
  const sampleCount = samples.reduce((n, x) => n + x.missing, 0);
  const assetCfg = settings.get("assets");
  const usd = apiCostUsd({ quality: assetCfg.quality, size: flexibleSize("3:2", assetCfg.tier), n: plates.length })
    + apiCostUsd({ quality: assetCfg.quality, size: flexibleSize("2:3", assetCfg.tier), n: outfits.length })
    + apiCostUsd({ quality: c.quality, size: flexibleSize("2:3", c.tier), n: sampleCount });
  const result = { plates: plates.length, samples: sampleCount, outfits: outfits.length, estimatedUsd: Math.round(usd * 100) / 100 };
  if (dryRun) return result;
  // Outfits first so the samples can already use them when they run later; samples
  // queued now use text descriptions where no outfit image exists yet.
  for (const role of ["bride", "groom"]) {
    const items = outfits.filter((o) => o.role === role).map((o) => ({ categoryId: o.categoryId, gender: role === "bride" ? "female" : "male" }));
    if (items.length) assetJobs.createBatch(admin, { type: "outfit", items, publish: true }, { admin: true, ip, limit: false });
  }
  // One seed is one admin action, so the per-minute submit limit does not apply.
  for (const s of plates) generatePlate(admin, s.id, { ip, limit: false });
  for (const x of samples) generateSamples(admin, x.scene.id, x.missing, { ip });
  return result;
}

export function adminShoots({ offset = 0, size = 30 } = {}) {
  const total = db.prepare("SELECT COUNT(*) AS n FROM wedding_shoots WHERE deleted_at IS NULL").get().n;
  const rows = db.prepare(`SELECT s.*, u.email AS user_email FROM wedding_shoots s JOIN users u ON u.id = s.user_id
    WHERE s.deleted_at IS NULL ORDER BY s.created_at DESC LIMIT ? OFFSET ?`).all(size, offset);
  return { total, items: rows.map((s) => ({ ...summary(s), userId: s.user_id, userEmail: s.user_email, refunded: s.refunded_credits,
    retakesLeft: s.retakes_left })) };
}

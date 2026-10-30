import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { db, tx } from "../db.js";
import { config } from "../config.js";
import * as settings from "./settings.js";
import * as taxonomy from "./taxonomy.js";
import { badRequest, forbidden, notFound } from "../lib/errors.js";
import { randomId } from "../lib/crypto.js";

export const RATINGS = ["general", "suggestive", "explicit"];
export const RATING_LABELS = { general: "普通", suggestive: "敏感", explicit: "限制" };
export const LICENSES = ["commercial", "noncommercial"];
// Camera angles used by the pose catalog, in display order.
export const ANGLES = [
  { key: "正面", zh: "正面", en: "Front" },
  { key: "斜め", zh: "斜侧", en: "Three-quarter" },
  { key: "横", zh: "侧面", en: "Side" },
  { key: "上から", zh: "俯视", en: "From above" },
  { key: "下から", zh: "仰视", en: "From below" }
];
export const customRoot = path.join(config.dataDir, "library-custom");

// The asset table is small (a few thousand rows), so filtering and search run
// against an in-memory index that is rebuilt whenever assets, categories or
// owners change.
let index = null;

const columnLabel = (row, field) => ({
  key: row[field],
  zh: row[`${field}_zh`] || row[field],
  en: row[`${field}_en`] || row[field],
  ...(row[`${field}_ja`] !== undefined ? { ja: row[`${field}_ja`] || row[field] } : {})
});

// Series (大类) and category (小类) labels come from the category tree when
// the asset's keys are in it, otherwise from the asset row itself.
function treeLabels(row) {
  const major = row.series ? taxonomy.major(row.type, row.series) : null;
  const minor = row.series ? taxonomy.minor(row.type, row.series, row.category) : null;
  return {
    series: major ? { key: row.series, zh: major.name_zh, en: major.name_en || major.name_zh } : columnLabel(row, "series"),
    category: minor ? { ...columnLabel(row, "category"), zh: minor.name_zh, en: minor.name_en || minor.name_zh }
      : columnLabel(row, "category")
  };
}

function buildIndex() {
  const rows = db.prepare(`SELECT a.*, u.nickname AS owner_name, u.status AS owner_status
    FROM assets a LEFT JOIN users u ON u.id = a.owner_id ORDER BY a.type, a.sort, a.created_at DESC, a.id`).all();
  const byId = new Map();
  const groups = new Map();
  for (const row of rows) {
    const labels = treeLabels(row);
    row._series = labels.series;
    row._category = labels.category;
    row._search = [row.id, row.code, row.series, labels.series.zh, labels.series.en, row.category, labels.category.zh,
      labels.category.en, row.category_ja, row.name, row.name_zh, row.name_en, row.angle, row.angle_zh,
      row.angle_en, row.keywords, row.owner_name].join(" ").toLowerCase();
    byId.set(row.id, row);
    if (row.type === "pose") {
      if (!groups.has(row.group_key)) groups.set(row.group_key, []);
      groups.get(row.group_key).push(row);
    }
  }
  return {
    poses: rows.filter((r) => r.type === "pose"),
    outfits: rows.filter((r) => r.type === "outfit"),
    byId,
    groups
  };
}

function idx() {
  if (!index) index = buildIndex();
  return index;
}

export function invalidate() {
  index = null;
}

export function counts() {
  const { poses, outfits, groups } = idx();
  return { poses: poses.length, poseGroups: groups.size, outfits: outfits.length };
}

// ---------- visibility rules

// viewer: { loggedIn, userId }. Owners always see their own assets; other
// users' assets are visible only when shared, approved and the owner is active.
export function visible(asset, viewer = {}) {
  if (!asset || !asset.enabled) return false;
  const own = !!asset.owner_id && asset.owner_id === viewer.userId;
  if (!own) {
    if (asset.owner_id && (asset.visibility !== "public" || asset.owner_status !== "active" ||
      asset.review === "pending" || asset.review === "rejected")) return false;
    if (asset.license !== "commercial" && settings.get("assets").commercialOnly) return false;
  }
  const safety = settings.get("safety");
  if (asset.rating === "explicit") return safety.showExplicit && !!viewer.loggedIn;
  if (asset.rating === "suggestive") return safety.showSuggestive;
  return true;
}

// Hard rules, not settings: restricted assets never go to the model, and a real
// person's photo may only be combined with general-rated references.
export function usableForAI(asset, { withPerson = false } = {}) {
  if (!asset || !asset.enabled || asset.rating === "explicit") return false;
  if (asset.rating === "suggestive") return !withPerson && settings.get("safety").suggestiveForAI;
  return true;
}

// Credits a user pays to use an asset: shared assets carry the owner's price.
export const feeFor = (asset, userId) => (asset?.owner_id && asset.owner_id !== userId ? asset.price : 0);

export function dto(row) {
  return {
    id: row.id,
    type: row.type,
    groupKey: row.group_key,
    code: row.code,
    series: row._series,
    category: row._category,
    name: { zh: row.name_zh || row.name, en: row.name_en || row.name },
    angle: row.type === "pose" ? columnLabel(row, "angle") : null,
    keywords: row.keywords,
    people: row.people,
    rating: row.rating,
    license: row.license,
    origin: row.owner_id ? "user" : "platform",
    generated: row.source === "ai",
    owner: row.owner_id ? { id: row.owner_id, name: row.owner_name || "用户" } : null,
    price: row.owner_id ? row.price : 0,
    ai: usableForAI(row),
    aiWithPerson: usableForAI(row, { withPerson: true }),
    thumb: `/media/library/${encodeURIComponent(row.id)}/thumb`,
    preview: `/media/library/${encodeURIComponent(row.id)}/preview`
  };
}

// What the owner (and admins) see on top of the public fields.
export function ownerDto(row) {
  return {
    ...dto(row),
    visibility: row.visibility, review: row.review, reviewNote: row.review_note,
    earned: row.earned, useCount: row.use_count, enabled: !!row.enabled,
    createdAt: row.created_at, publishedAt: row.published_at
  };
}

export function getAsset(id) {
  return idx().byId.get(String(id)) || null;
}

// Every visible angle of the pose an asset belongs to.
export function angles(asset, viewer) {
  if (asset.type !== "pose") return [];
  return (idx().groups.get(asset.group_key) || []).filter((r) => visible(r, viewer)).map(dto);
}

// Angle keys a pose group already has, visible or not.
export const groupAngles = (groupKey) => (idx().groups.get(groupKey) || []).map((r) => r.angle);

// ---------- browsing

// origin: "platform" | "user" (shared by users) | "mine"; license: "commercial" | "noncommercial".
function matches(row, f, viewer = {}) {
  if (f.series && row.series !== f.series) return false;
  if (f.category && row.category !== f.category) return false;
  if (f.angle && row.angle !== f.angle) return false;
  if (f.people && row.people !== f.people) return false;
  if (f.origin === "platform" && row.owner_id) return false;
  if (f.origin === "user" && !row.owner_id) return false;
  if (f.origin === "mine" && (!viewer.userId || row.owner_id !== viewer.userId)) return false;
  if (f.license && row.license !== f.license) return false;
  if (f.q && !f.q.split(/\s+/).every((term) => row._search.includes(term))) return false;
  return true;
}

export function queryPoses(filters, viewer, { offset = 0, limit = 48 } = {}) {
  const q = String(filters.q || "").trim().toLowerCase();
  const f = { ...filters, q };
  const { poses, groups } = idx();
  if (filters.view === "image") {
    const items = poses.filter((r) => visible(r, viewer) && matches(r, f, viewer));
    return { total: items.length, items: items.slice(offset, offset + limit).map(dto) };
  }
  // Group view: one card per pose with every visible angle, matching any angle.
  const keys = [];
  const seen = new Set();
  for (const row of poses) {
    if (seen.has(row.group_key) || !visible(row, viewer) || !matches(row, f, viewer)) continue;
    seen.add(row.group_key);
    keys.push(row.group_key);
  }
  const items = keys.slice(offset, offset + limit).map((key) => {
    const images = groups.get(key).filter((r) => visible(r, viewer));
    const cover = images.find((r) => filters.angle && r.angle === filters.angle) || images[0];
    return { key, cover: dto(cover), images: images.map(dto) };
  });
  return { total: keys.length, items };
}

export function queryOutfits(filters, viewer, { offset = 0, limit = 48 } = {}) {
  const q = String(filters.q || "").trim().toLowerCase();
  const f = { series: filters.series, category: filters.category, origin: filters.origin, license: filters.license, q };
  const items = idx().outfits.filter((r) => visible(r, viewer) && matches(r, f, viewer));
  return { total: items.length, items: items.slice(offset, offset + limit).map(dto) };
}

// Sort facets by the category tree; keys not in the tree keep catalog order after it.
function byTree(list, type, keyOf) {
  const order = taxonomy.order(type);
  const rank = (item) => keyOf(item, order);
  return list.map((item, i) => ({ item, i, r: rank(item) }))
    .sort((a, b) => (a.r[0] - b.r[0]) || (a.r[1] - b.r[1]) || (a.i - b.i)).map((x) => x.item);
}
const seriesRank = (s, order) => [order.majors.get(s.key) ?? Infinity, 0];
const categoryRank = (c, order) => [order.majors.get(c.series) ?? Infinity, order.minors.get(`${c.series}\u0000${c.key}`) ?? Infinity];

export function meta(viewer = {}) {
  const { poses, outfits, groups } = idx();
  const seriesMap = new Map(), categoryMap = new Map(), angleMap = new Map();
  const origins = { pose: { platform: new Set(), user: new Set(), mine: new Set(), commercial: new Set() },
    outfit: { platform: 0, user: 0, mine: 0, commercial: 0 } };
  for (const row of poses) {
    if (!visible(row, viewer)) continue;
    const s = seriesMap.get(row.series) || { ...row._series, groups: new Set(), images: 0 };
    s.groups.add(row.group_key); s.images += 1;
    seriesMap.set(row.series, s);
    const ck = `${row.series}\u0000${row.category}`;
    const c = categoryMap.get(ck) || { ...row._category, series: row.series, groups: new Set() };
    c.groups.add(row.group_key);
    categoryMap.set(ck, c);
    if (!angleMap.has(row.angle)) angleMap.set(row.angle, columnLabel(row, "angle"));
    const o = origins.pose;
    (row.owner_id ? o.user : o.platform).add(row.group_key);
    if (row.owner_id && row.owner_id === viewer.userId) o.mine.add(row.group_key);
    if (row.license === "commercial") o.commercial.add(row.group_key);
  }
  const outfitSeries = new Map(), outfitCats = new Map();
  for (const row of outfits) {
    if (!visible(row, viewer)) continue;
    const s = outfitSeries.get(row.series) || { ...row._series, count: 0 };
    s.count += 1;
    outfitSeries.set(row.series, s);
    const ck = `${row.series}\u0000${row.category}`;
    const c = outfitCats.get(ck) || { ...row._category, series: row.series, count: 0 };
    c.count += 1;
    outfitCats.set(ck, c);
    const o = origins.outfit;
    if (row.owner_id) o.user += 1; else o.platform += 1;
    if (row.owner_id && row.owner_id === viewer.userId) o.mine += 1;
    if (row.license === "commercial") o.commercial += 1;
  }
  const finalize = (item) => {
    const { groups: g, ...rest } = item;
    return { ...rest, count: g.size };
  };
  const angleRank = (a) => {
    const i = ANGLES.findIndex((x) => x.key === a.key);
    return i < 0 ? ANGLES.length : i;
  };
  const sizes = (o) => Object.fromEntries(Object.entries(o).map(([k, set]) => [k, set.size]));
  return {
    pose: {
      series: byTree([...seriesMap.values()].map(finalize), "pose", seriesRank),
      categories: byTree([...categoryMap.values()].map(finalize), "pose", categoryRank),
      angles: [...angleMap.values()].sort((a, b) => angleRank(a) - angleRank(b)),
      total: [...seriesMap.values()].reduce((n, s) => n + s.images, 0),
      groups: new Set(poses.filter((r) => visible(r, viewer)).map((r) => r.group_key)).size,
      origins: sizes(origins.pose)
    },
    outfit: {
      series: byTree([...outfitSeries.values()], "outfit", seriesRank),
      categories: byTree([...outfitCats.values()], "outfit", categoryRank),
      total: [...outfitCats.values()].reduce((n, c) => n + c.count, 0),
      origins: origins.outfit
    },
    totalGroups: groups.size
  };
}

// Uniform random pick: poses by group (then a random angle), so a pose drawn
// with five angles is not five times as likely as one with a single angle.
// Only platform assets (and the viewer's own), so a random pick never costs a fee.
export function random({ type, series, category, includeDuo = false, forAI = false, withPerson = false,
  exclude = "" }, viewer = {}) {
  const ok = (r) => visible(r, viewer) && (!forAI || usableForAI(r, { withPerson })) &&
    (!r.owner_id || r.owner_id === viewer.userId);
  if (type === "outfit") {
    const pool = idx().outfits.filter((r) => ok(r) && (!series || r.series === series) && (!category || r.category === category));
    const alternatives = pool.filter((r) => r.id !== exclude);
    const from = alternatives.length ? alternatives : pool;
    return from.length ? dto(from[Math.floor(Math.random() * from.length)]) : null;
  }
  const candidates = [];
  for (const [key, images] of idx().groups) {
    const usable = images.filter(ok);
    if (!usable.length) continue;
    const first = usable[0];
    if (!includeDuo && first.people > 1) continue;
    if (series && first.series !== series) continue;
    if (category && first.category !== category) continue;
    candidates.push({ key, usable });
  }
  const alternatives = candidates.filter((c) => c.key !== exclude);
  const from = alternatives.length ? alternatives : candidates;
  if (!from.length) return null;
  const group = from[Math.floor(Math.random() * from.length)];
  return dto(group.usable[Math.floor(Math.random() * group.usable.length)]);
}

// ---------- files

export function assetFile(asset, variant) {
  const rel = variant === "thumb" ? asset.thumb_path
    : variant === "preview" ? (asset.preview_path || asset.original_path)
    : asset.original_path;
  if (!rel || rel.includes("..")) return null;
  const root = asset.root === "custom" ? customRoot : config.libraryDir;
  const full = path.resolve(root, rel);
  if (!full.startsWith(path.resolve(root) + path.sep)) return null;
  return full;
}

// Source used as model input: outfit previews are already large enough and
// much smaller than the PNG originals.
export function aiSourceFile(asset) {
  return asset.type === "outfit" && asset.preview_path ? assetFile(asset, "preview") : assetFile(asset, "original");
}

export function bumpUse(ids) {
  const stmt = db.prepare("UPDATE assets SET use_count = use_count + 1 WHERE id = ?");
  for (const id of ids) if (id) stmt.run(id);
}

// ---------- writing

const COLUMNS = ["id", "type", "group_key", "code", "series", "series_zh", "series_en", "category", "category_zh",
  "category_en", "category_ja", "name", "name_zh", "name_en", "angle", "angle_zh", "angle_en", "keywords", "people",
  "root", "thumb_path", "preview_path", "original_path", "rating", "enabled", "sort", "source", "owner_id", "license",
  "visibility", "review", "price", "job_id", "created_at", "updated_at"];

// Insert one asset row. Callers write the files first (under customRoot).
export function insertAsset(fields) {
  const now = Date.now();
  const row = {
    group_key: fields.id, code: fields.id.slice(-6).toUpperCase(), series: "", series_zh: "", series_en: "",
    category: "", category_zh: "", category_en: "", category_ja: "", name: "", name_zh: "", name_en: "",
    angle: "", angle_zh: "", angle_en: "", keywords: "", people: 1, root: "custom", preview_path: "",
    rating: "general", enabled: 1, sort: 0, source: "custom", owner_id: null, license: "commercial",
    visibility: "public", review: "none", price: 0, job_id: null, created_at: now, updated_at: now,
    ...fields
  };
  db.prepare(`INSERT INTO assets (${COLUMNS.join(", ")}) VALUES (${COLUMNS.map(() => "?").join(", ")})`)
    .run(...COLUMNS.map((c) => row[c]));
}

// Series and category columns for a minor category from the tree.
export function categoryColumns(minor) {
  const major = taxonomy.get(minor.parent_id);
  return {
    series: major.key, series_zh: major.name_zh, series_en: major.name_en || major.name_zh,
    category: minor.key, category_zh: minor.name_zh, category_en: minor.name_en || minor.name_zh
  };
}

function minorCategory(type, categoryId) {
  const minor = taxonomy.get(categoryId);
  if (!minor || minor.type !== type || !minor.parent_id) throw badRequest("INVALID_CATEGORY", "请选择一个小类");
  return minor;
}

// Assets filed under a category, for the delete check.
export function categoryUsage(cat) {
  const rows = cat.type === "pose" ? idx().poses : idx().outfits;
  if (!cat.parent_id) return rows.filter((r) => r.series === cat.key).length;
  const parent = taxonomy.get(cat.parent_id);
  return rows.filter((r) => r.series === parent?.key && r.category === cat.key).length;
}

function removeFiles(asset) {
  if (asset.root !== "custom") return;
  fs.rmSync(path.join(customRoot, asset.type, asset.id), { recursive: true, force: true });
}

// ---------- admin

export function adminDto(row) {
  return { ...ownerDto(row), source: row.source, sort: row.sort, ratingLabel: RATING_LABELS[row.rating] };
}

export function adminList(f, { offset, size }) {
  const term = String(f.q || "").trim().toLowerCase();
  const pool = f.type === "outfit" ? idx().outfits : f.type === "pose" ? idx().poses : [...idx().poses, ...idx().outfits];
  const rows = pool.filter((r) => (!f.rating || r.rating === f.rating) &&
      (f.enabled === undefined || f.enabled === "" || r.enabled === Number(f.enabled)) &&
      (!f.series || r.series === f.series) && (!f.category || r.category === f.category) &&
      (!f.source || r.source === f.source) &&
      (!f.origin || (f.origin === "user" ? !!r.owner_id : !r.owner_id)) &&
      (!f.license || r.license === f.license) &&
      (!f.review || (r.review === f.review && (f.review !== "pending" || r.visibility === "public"))) &&
      (!f.ownerId || r.owner_id === Number(f.ownerId)) &&
      (!term || r._search.includes(term)));
  const page = rows.slice(offset, offset + size);
  const ownerIds = [...new Set(page.map((r) => r.owner_id).filter(Boolean))];
  const emails = new Map(ownerIds.length
    ? db.prepare(`SELECT id, email FROM users WHERE id IN (${ownerIds.map(() => "?").join(",")})`).all(...ownerIds).map((u) => [u.id, u.email])
    : []);
  return {
    total: rows.length,
    items: page.map((r) => ({ ...adminDto(r), ownerEmail: emails.get(r.owner_id) || null }))
  };
}

export function adminFacets() {
  const facets = { pose: { series: new Map(), categories: new Map() }, outfit: { series: new Map(), categories: new Map() } };
  const counts = { pose: { user: 0, pending: 0, commercial: 0 }, outfit: { user: 0, pending: 0, commercial: 0 } };
  for (const r of [...idx().poses, ...idx().outfits]) {
    const f = facets[r.type];
    if (r.series) f.series.set(r.series, { key: r.series, zh: r._series.zh });
    f.categories.set(`${r.series}\u0000${r.category}`, { key: r.category, zh: r._category.zh, series: r.series });
    const c = counts[r.type];
    if (r.owner_id) c.user += 1;
    if (r.review === "pending" && r.visibility === "public") c.pending += 1;
    if (r.license === "commercial") c.commercial += 1;
  }
  const ratingCounts = db.prepare("SELECT type, rating, enabled, COUNT(*) AS n FROM assets GROUP BY type, rating, enabled").all();
  const out = {};
  for (const type of ["pose", "outfit"]) {
    out[type] = {
      series: byTree([...facets[type].series.values()], type, seriesRank),
      categories: byTree([...facets[type].categories.values()], type, categoryRank),
      ...counts[type]
    };
  }
  return { ...out, ratingCounts };
}

const EDITABLE = ["rating", "enabled", "name", "name_zh", "name_en", "category_zh", "category_en", "keywords", "sort",
  "license", "review", "review_note", "series", "series_zh", "series_en", "category"];

function cleanPatch(patch, asset) {
  const out = {};
  if (patch.rating !== undefined) {
    if (!RATINGS.includes(patch.rating)) throw badRequest("INVALID_INPUT", "分级取值不正确");
    out.rating = patch.rating;
  }
  if (patch.enabled !== undefined) out.enabled = patch.enabled ? 1 : 0;
  if (patch.license !== undefined) {
    if (!LICENSES.includes(patch.license)) throw badRequest("INVALID_INPUT", "授权取值不正确");
    out.license = patch.license;
  }
  for (const key of ["name_zh", "name_en", "category_zh", "category_en"]) {
    if (patch[key] !== undefined) out[key] = String(patch[key]).trim().slice(0, 80);
  }
  if (out.name_zh !== undefined && asset?.owner_id) out.name = out.name_zh;
  if (patch.keywords !== undefined) out.keywords = String(patch.keywords).trim().slice(0, 300);
  if (patch.sort !== undefined) out.sort = Math.max(-100000, Math.min(100000, Math.round(Number(patch.sort) || 0)));
  if (patch.review !== undefined && asset) {
    if (!asset.owner_id) throw badRequest("NOT_USER_ASSET", "平台素材不需要审核");
    if (!["approved", "rejected"].includes(patch.review)) throw badRequest("INVALID_INPUT", "审核结果不正确");
    out.review = patch.review;
    out.review_note = String(patch.reviewNote ?? "").trim().slice(0, 200);
  }
  if (patch.categoryId !== undefined && asset) Object.assign(out, categoryColumns(minorCategory(asset.type, patch.categoryId)));
  return out;
}

export function updateAsset(id, patch) {
  const asset = getAsset(id);
  if (!asset) throw notFound("素材不存在");
  const clean = cleanPatch(patch, asset);
  const keys = Object.keys(clean).filter((k) => EDITABLE.includes(k));
  if (!keys.length) return adminDto(asset);
  db.prepare(`UPDATE assets SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
    .run(...keys.map((k) => clean[k]), Date.now(), id);
  invalidate();
  return adminDto(getAsset(id));
}

// Bulk update by explicit ids, or by filter (type + series/category/source/origin).
export const bulkUpdate = tx(({ ids, filter }, patch) => {
  const clean = cleanPatch({ rating: patch.rating, enabled: patch.enabled, license: patch.license });
  const keys = Object.keys(clean);
  if (!keys.length) throw badRequest("INVALID_INPUT", "没有要修改的字段");
  let targets = [];
  if (Array.isArray(ids) && ids.length) targets = ids.map(String).slice(0, 5000);
  else if (filter && (filter.type === "pose" || filter.type === "outfit")) {
    targets = (filter.type === "pose" ? idx().poses : idx().outfits)
      .filter((r) => (!filter.series || r.series === filter.series) && (!filter.category || r.category === filter.category) &&
        (!filter.source || r.source === filter.source) &&
        (!filter.origin || (filter.origin === "user" ? !!r.owner_id : !r.owner_id)))
      .map((r) => r.id);
  } else throw badRequest("INVALID_INPUT", "请指定素材或筛选条件");
  const stmt = db.prepare(`UPDATE assets SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`);
  const now = Date.now();
  let changed = 0;
  for (const id of targets) changed += stmt.run(...keys.map((k) => clean[k]), now, id).changes;
  invalidate();
  return { changed };
});

// Operator-uploaded asset: stored under DATA_DIR/library-custom with generated
// thumbnail and preview, so it behaves exactly like an imported one.
export async function createCustomAsset({ type, categoryId, category, categoryZh, categoryEn, nameZh, nameEn, keywords,
  rating, license = "commercial", series, seriesZh, seriesEn, people }, file) {
  if (!["pose", "outfit"].includes(type)) throw badRequest("INVALID_INPUT", "素材类型不正确");
  if (!RATINGS.includes(rating)) throw badRequest("INVALID_INPUT", "分级取值不正确");
  if (!LICENSES.includes(license)) throw badRequest("INVALID_INPUT", "授权取值不正确");
  const minor = categoryId ? minorCategory(type, Number(categoryId)) : null;
  if (!file?.buffer) throw badRequest("FILE_REQUIRED", "请上传图片");
  const image = sharp(file.buffer, { limitInputPixels: 60_000_000 });
  const info = await image.metadata().catch(() => null);
  if (!info || !["jpeg", "png", "webp"].includes(info.format)) {
    throw badRequest("INVALID_IMAGE", "仅支持 PNG、JPG、WebP 图片");
  }
  const id = `${type === "pose" ? "cp" : "co"}_${randomId(10)}`;
  const dir = path.join(customRoot, type, id);
  fs.mkdirSync(dir, { recursive: true });
  const base = sharp(file.buffer, { limitInputPixels: 60_000_000 }).rotate();
  await base.clone().resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).png()
    .toFile(path.join(dir, "original.png"));
  await base.clone().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 88 }).toFile(path.join(dir, "preview.webp"));
  await base.clone().resize({ width: 480, height: 640, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 }).toFile(path.join(dir, "thumb.webp"));
  const cat = String(category || "custom").trim().slice(0, 40) || "custom";
  const name = String(nameZh || "").slice(0, 80);
  insertAsset({
    id, type,
    ...(minor ? categoryColumns(minor) : {
      series: type === "pose" ? String(series || "custom").slice(0, 40) : "",
      series_zh: type === "pose" ? String(seriesZh || "自定义").slice(0, 40) : "",
      series_en: type === "pose" ? String(seriesEn || "Custom").slice(0, 40) : "",
      category: cat, category_zh: String(categoryZh || cat).slice(0, 40), category_en: String(categoryEn || cat).slice(0, 40)
    }),
    name, name_zh: name, name_en: String(nameEn || nameZh || "").slice(0, 80),
    angle: type === "pose" ? "正面" : "", angle_zh: type === "pose" ? "正面" : "", angle_en: type === "pose" ? "Front" : "",
    keywords: String(keywords || "").slice(0, 300), people: type === "pose" && Number(people) === 2 ? 2 : 1,
    thumb_path: `${type}/${id}/thumb.webp`, preview_path: `${type}/${id}/preview.webp`, original_path: `${type}/${id}/original.png`,
    rating, license, sort: 100000
  });
  invalidate();
  return adminDto(getAsset(id));
}

// Uploaded and generated assets can be deleted; imported ones only disabled.
export function deleteCustomAsset(id) {
  const asset = getAsset(id);
  if (!asset) throw notFound("素材不存在");
  if (asset.root !== "custom") throw badRequest("NOT_CUSTOM", "导入的素材不能删除，可以改为停用");
  db.prepare("DELETE FROM assets WHERE id = ?").run(id);
  removeFiles(asset);
  invalidate();
}

// ---------- assets owned by users

export function listOwned(userId, { type, offset, size }) {
  const pool = type === "outfit" ? idx().outfits : type === "pose" ? idx().poses : [...idx().poses, ...idx().outfits];
  const rows = pool.filter((r) => r.owner_id === userId).sort((a, b) => b.created_at - a.created_at || a.sort - b.sort);
  return { total: rows.length, items: rows.slice(offset, offset + size).map(ownerDto) };
}

export function ownerSummary(userId) {
  const row = db.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(visibility = 'public'), 0) AS shared,
      COALESCE(SUM(visibility = 'public' AND review = 'pending'), 0) AS pending, COALESCE(SUM(earned), 0) AS earned
    FROM assets WHERE owner_id = ?`).get(userId);
  const uses = db.prepare("SELECT COUNT(*) AS n FROM asset_fees WHERE owner_id = ? AND status = 'paid'").get(userId).n;
  return { ...row, paidUses: uses };
}

function ownedAsset(user, id) {
  const asset = getAsset(id);
  if (!asset || asset.owner_id !== user.id) throw notFound("素材不存在");
  return asset;
}

// Owner edits: name, sharing and price. Sharing goes through review when the
// operator turned it on; an approved asset stays approved when re-shared.
export function updateOwned(user, id, { name, visibility, price }) {
  const asset = ownedAsset(user, id);
  const cfg = settings.get("assets");
  const out = {};
  if (name !== undefined) {
    const value = String(name).trim().slice(0, 40);
    if (!value) throw badRequest("INVALID_INPUT", "名称不能为空");
    out.name = value;
    out.name_zh = value;
  }
  if (price !== undefined) {
    const value = Number(price);
    if (!Number.isInteger(value) || value < 0 || value > cfg.maxPrice) {
      throw badRequest("INVALID_PRICE", `使用点数需为 0–${cfg.maxPrice} 之间的整数`);
    }
    out.price = value;
  }
  if (visibility !== undefined) {
    if (!["public", "private"].includes(visibility)) throw badRequest("INVALID_INPUT", "公开设置不正确");
    out.visibility = visibility;
    if (visibility === "public") {
      if (!asset.enabled) throw forbidden("这个素材已被管理员下架，不能公开", "ASSET_DISABLED");
      out.review = !cfg.publicReview || asset.review === "approved" ? "approved" : "pending";
      if (out.review === "pending") out.review_note = "";
      if (asset.visibility !== "public") out.published_at = Date.now();
    }
  }
  const keys = Object.keys(out);
  if (keys.length) {
    db.prepare(`UPDATE assets SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
      .run(...keys.map((k) => out[k]), Date.now(), asset.id);
    invalidate();
  }
  return ownerDto(getAsset(asset.id));
}

export function deleteOwned(user, id) {
  const asset = ownedAsset(user, id);
  db.prepare("DELETE FROM assets WHERE id = ?").run(asset.id);
  removeFiles(asset);
  invalidate();
}

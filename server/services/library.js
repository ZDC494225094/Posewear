import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { db, tx } from "../db.js";
import { config } from "../config.js";
import * as settings from "./settings.js";
import { badRequest, notFound } from "../lib/errors.js";
import { randomId } from "../lib/crypto.js";

export const RATINGS = ["general", "suggestive", "explicit"];
export const RATING_LABELS = { general: "普通", suggestive: "敏感", explicit: "限制" };
export const customRoot = path.join(config.dataDir, "library-custom");

// The asset table is small (a few thousand rows), so filtering and search run
// against an in-memory index that is rebuilt whenever an admin edits assets.
let index = null;

function buildIndex() {
  const rows = db.prepare("SELECT * FROM assets ORDER BY type, sort, id").all();
  const byId = new Map();
  const groups = new Map();
  for (const row of rows) {
    row._search = [row.id, row.code, row.series, row.series_zh, row.series_en, row.category, row.category_zh,
      row.category_en, row.category_ja, row.name, row.name_zh, row.name_en, row.angle, row.angle_zh,
      row.angle_en, row.keywords].join(" ").toLowerCase();
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

export function visible(asset, viewer = {}) {
  if (!asset || !asset.enabled) return false;
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

const label = (row, field) => ({
  key: row[field],
  zh: row[`${field}_zh`] || row[field],
  en: row[`${field}_en`] || row[field],
  ...(row[`${field}_ja`] !== undefined ? { ja: row[`${field}_ja`] || row[field] } : {})
});

export function dto(row) {
  return {
    id: row.id,
    type: row.type,
    groupKey: row.group_key,
    code: row.code,
    series: label(row, "series"),
    category: label(row, "category"),
    name: { zh: row.name_zh || row.name, en: row.name_en || row.name },
    angle: row.type === "pose" ? label(row, "angle") : null,
    keywords: row.keywords,
    people: row.people,
    rating: row.rating,
    ai: usableForAI(row),
    aiWithPerson: usableForAI(row, { withPerson: true }),
    thumb: `/media/library/${encodeURIComponent(row.id)}/thumb`,
    preview: `/media/library/${encodeURIComponent(row.id)}/preview`
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

// ---------- browsing

function matches(row, { series, category, angle, q, people }) {
  if (series && row.series !== series) return false;
  if (category && row.category !== category) return false;
  if (angle && row.angle !== angle) return false;
  if (people && row.people !== people) return false;
  if (q && !q.split(/\s+/).every((term) => row._search.includes(term))) return false;
  return true;
}

export function queryPoses(filters, viewer, { offset = 0, limit = 48 } = {}) {
  const q = String(filters.q || "").trim().toLowerCase();
  const f = { ...filters, q };
  const { poses, groups } = idx();
  if (filters.view === "image") {
    const items = poses.filter((r) => visible(r, viewer) && matches(r, f));
    return { total: items.length, items: items.slice(offset, offset + limit).map(dto) };
  }
  // Group view: one card per pose with every visible angle, matching any angle.
  const keys = [];
  const seen = new Set();
  for (const row of poses) {
    if (seen.has(row.group_key) || !visible(row, viewer) || !matches(row, f)) continue;
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
  const items = idx().outfits.filter((r) => visible(r, viewer) && matches(r, { category: filters.category, q }));
  return { total: items.length, items: items.slice(offset, offset + limit).map(dto) };
}

export function meta(viewer) {
  const { poses, outfits, groups } = idx();
  const seriesMap = new Map(), categoryMap = new Map(), angleMap = new Map(), outfitCats = new Map();
  for (const row of poses) {
    if (!visible(row, viewer)) continue;
    const s = seriesMap.get(row.series) || { ...label(row, "series"), groups: new Set(), images: 0 };
    s.groups.add(row.group_key); s.images += 1;
    seriesMap.set(row.series, s);
    const ck = `${row.series}\u0000${row.category}`;
    const c = categoryMap.get(ck) || { ...label(row, "category"), series: row.series, groups: new Set() };
    c.groups.add(row.group_key);
    categoryMap.set(ck, c);
    if (!angleMap.has(row.angle)) angleMap.set(row.angle, label(row, "angle"));
  }
  for (const row of outfits) {
    if (!visible(row, viewer)) continue;
    const c = outfitCats.get(row.category) || { ...label(row, "category"), count: 0 };
    c.count += 1;
    outfitCats.set(row.category, c);
  }
  const finalize = (item) => {
    const { groups: g, ...rest } = item;
    return { ...rest, count: g.size };
  };
  return {
    pose: {
      series: [...seriesMap.values()].map(finalize),
      categories: [...categoryMap.values()].map(finalize),
      angles: [...angleMap.values()],
      total: [...seriesMap.values()].reduce((n, s) => n + s.images, 0),
      groups: new Set(poses.filter((r) => visible(r, viewer)).map((r) => r.group_key)).size
    },
    outfit: {
      categories: [...outfitCats.values()],
      total: [...outfitCats.values()].reduce((n, c) => n + c.count, 0)
    },
    totalGroups: groups.size
  };
}

// Uniform random pick: poses by group (then a random angle), so a pose drawn
// with five angles is not five times as likely as one with a single angle.
export function random({ type, series, category, includeDuo = false, forAI = false, withPerson = false,
  exclude = "" }, viewer) {
  const ok = (r) => visible(r, viewer) && (!forAI || usableForAI(r, { withPerson }));
  if (type === "outfit") {
    const pool = idx().outfits.filter((r) => ok(r) && (!category || r.category === category));
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

// ---------- admin

export function adminList({ type, rating, enabled, series, category, q, source }, { offset, size }) {
  const term = String(q || "").trim().toLowerCase();
  const rows = (type === "outfit" ? idx().outfits : type === "pose" ? idx().poses : [...idx().poses, ...idx().outfits])
    .filter((r) => (!rating || r.rating === rating) &&
      (enabled === undefined || enabled === "" || r.enabled === Number(enabled)) &&
      (!series || r.series === series) && (!category || r.category === category) &&
      (!source || r.source === source) &&
      (!term || r._search.includes(term)));
  return {
    total: rows.length,
    items: rows.slice(offset, offset + size).map((r) => ({
      ...dto(r), enabled: !!r.enabled, source: r.source, useCount: r.use_count, sort: r.sort,
      ratingLabel: RATING_LABELS[r.rating]
    }))
  };
}

export function adminFacets() {
  const facets = { pose: { series: new Map(), categories: new Map() }, outfit: { categories: new Map() } };
  for (const r of idx().poses) {
    facets.pose.series.set(r.series, r.series_zh || r.series);
    facets.pose.categories.set(r.category, r.category_zh || r.category);
  }
  for (const r of idx().outfits) facets.outfit.categories.set(r.category, r.category_zh || r.category);
  const list = (m) => [...m].map(([key, zh]) => ({ key, zh }));
  const ratingCounts = db.prepare("SELECT type, rating, enabled, COUNT(*) AS n FROM assets GROUP BY type, rating, enabled").all();
  return {
    pose: { series: list(facets.pose.series), categories: list(facets.pose.categories) },
    outfit: { categories: list(facets.outfit.categories) },
    ratingCounts
  };
}

const EDITABLE = ["rating", "enabled", "name_zh", "name_en", "category_zh", "category_en", "keywords", "sort"];

function cleanPatch(patch) {
  const out = {};
  if (patch.rating !== undefined) {
    if (!RATINGS.includes(patch.rating)) throw badRequest("INVALID_INPUT", "分级取值不正确");
    out.rating = patch.rating;
  }
  if (patch.enabled !== undefined) out.enabled = patch.enabled ? 1 : 0;
  for (const key of ["name_zh", "name_en", "category_zh", "category_en"]) {
    if (patch[key] !== undefined) out[key] = String(patch[key]).trim().slice(0, 80);
  }
  if (patch.keywords !== undefined) out.keywords = String(patch.keywords).trim().slice(0, 300);
  if (patch.sort !== undefined) out.sort = Math.max(-100000, Math.min(100000, Math.round(Number(patch.sort) || 0)));
  return out;
}

export function updateAsset(id, patch) {
  if (!getAsset(id)) throw notFound("素材不存在");
  const clean = cleanPatch(patch);
  const keys = Object.keys(clean).filter((k) => EDITABLE.includes(k));
  if (!keys.length) return dto(getAsset(id));
  db.prepare(`UPDATE assets SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
    .run(...keys.map((k) => clean[k]), Date.now(), id);
  invalidate();
  return dto(getAsset(id));
}

// Bulk update by explicit ids, or by filter (type + series/category).
export const bulkUpdate = tx(({ ids, filter }, patch) => {
  const clean = cleanPatch({ rating: patch.rating, enabled: patch.enabled });
  const keys = Object.keys(clean);
  if (!keys.length) throw badRequest("INVALID_INPUT", "没有要修改的字段");
  let targets = [];
  if (Array.isArray(ids) && ids.length) targets = ids.map(String).slice(0, 5000);
  else if (filter && (filter.type === "pose" || filter.type === "outfit")) {
    targets = (filter.type === "pose" ? idx().poses : idx().outfits)
      .filter((r) => (!filter.series || r.series === filter.series) && (!filter.category || r.category === filter.category))
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
export async function createCustomAsset({ type, category, categoryZh, categoryEn, nameZh, nameEn, keywords,
  rating, series, seriesZh, seriesEn, people }, file) {
  if (!["pose", "outfit"].includes(type)) throw badRequest("INVALID_INPUT", "素材类型不正确");
  if (!RATINGS.includes(rating)) throw badRequest("INVALID_INPUT", "分级取值不正确");
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
  const now = Date.now();
  const cat = String(category || "custom").trim().slice(0, 40) || "custom";
  db.prepare(`INSERT INTO assets (id, type, group_key, code, series, series_zh, series_en, category, category_zh,
    category_en, category_ja, name, name_zh, name_en, angle, angle_zh, angle_en, keywords, people, root,
    thumb_path, preview_path, original_path, rating, enabled, sort, source, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, 'custom', ?, ?, ?, ?, 1, ?, 'custom', ?, ?)`).run(
    id, type, id, id.slice(-6).toUpperCase(),
    type === "pose" ? String(series || "custom").slice(0, 40) : "",
    type === "pose" ? String(seriesZh || "自定义").slice(0, 40) : "",
    type === "pose" ? String(seriesEn || "Custom").slice(0, 40) : "",
    cat, String(categoryZh || cat).slice(0, 40), String(categoryEn || cat).slice(0, 40),
    String(nameZh || "").slice(0, 80), String(nameZh || "").slice(0, 80), String(nameEn || nameZh || "").slice(0, 80),
    type === "pose" ? "front" : "", type === "pose" ? "正面" : "", type === "pose" ? "Front" : "",
    String(keywords || "").slice(0, 300), type === "pose" && Number(people) === 2 ? 2 : 1,
    `${type}/${id}/thumb.webp`, `${type}/${id}/preview.webp`, `${type}/${id}/original.png`,
    rating, 100000, now, now);
  invalidate();
  return dto(getAsset(id));
}

export function deleteCustomAsset(id) {
  const asset = getAsset(id);
  if (!asset) throw notFound("素材不存在");
  if (asset.root !== "custom") throw badRequest("NOT_CUSTOM", "导入的素材不能删除，可以改为停用");
  db.prepare("DELETE FROM assets WHERE id = ?").run(id);
  fs.rmSync(path.join(customRoot, asset.type, asset.id), { recursive: true, force: true });
  invalidate();
}

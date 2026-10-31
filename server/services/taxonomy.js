import { db } from "../db.js";
import { badRequest, notFound } from "../lib/errors.js";
import { randomId } from "../lib/crypto.js";

// The two-level category tree (大类 → 小类) for every asset type. Assets
// reference it by key: series = major key, category = minor key. Small
// enough to keep in memory; rebuilt after every edit.

// Poses, outfits, scenes (backgrounds) and items (accessories and props).
export const ASSET_TYPES = ["pose", "outfit", "scene", "item"];
const RATINGS = ["general", "suggestive", "explicit"];
const KEY = /^[\p{L}\p{N}][\p{L}\p{N}_\-・]{0,39}$/u;
let cache = null;

function load() {
  if (cache) return cache;
  const rows = db.prepare("SELECT * FROM asset_categories ORDER BY type, parent_id IS NOT NULL, sort, id").all();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const majors = new Map();   // `${type}\u0000${key}` -> row
  const minors = new Map();   // `${type}\u0000${majorKey}\u0000${key}` -> row
  for (const r of rows) {
    if (r.parent_id === null) majors.set(`${r.type}\u0000${r.key}`, r);
  }
  for (const r of rows) {
    if (r.parent_id === null) continue;
    const parent = byId.get(r.parent_id);
    if (parent) minors.set(`${r.type}\u0000${parent.key}\u0000${r.key}`, r);
  }
  cache = { rows, byId, majors, minors };
  return cache;
}

export function invalidate() {
  cache = null;
}

export const get = (id) => load().byId.get(Number(id)) || null;
export const major = (type, key) => load().majors.get(`${type}\u0000${key}`) || null;
export const minor = (type, majorKey, key) => load().minors.get(`${type}\u0000${majorKey}\u0000${key}`) || null;

// Users generate only in general-rated, open categories; admins also in
// suggestive ones. Restricted categories never.
export function generatable(row, { admin = false } = {}) {
  if (!row || !row.parent_id || !row.gen_enabled || row.rating === "explicit") return false;
  return admin || row.rating === "general";
}

const node = (r) => ({
  id: r.id, key: r.key, zh: r.name_zh, en: r.name_en, hint: r.hint, rating: r.rating,
  genEnabled: !!r.gen_enabled, sort: r.sort
});

// Tree for one type. `forUser` drops hints and marks what the viewer may generate.
export function tree(type, { admin = false, forUser = false } = {}) {
  const { rows } = load();
  return rows.filter((r) => r.type === type && r.parent_id === null).map((m) => {
    const children = rows.filter((r) => r.parent_id === m.id).map((c) => {
      const out = { ...node(c), canGenerate: generatable(c, { admin }) };
      if (forUser) delete out.hint;
      return out;
    });
    const out = { ...node(m), children };
    if (forUser) delete out.hint;
    return out;
  });
}

// Display order of keys, for sorting library facets by the tree.
export function order(type) {
  const { rows, byId } = load();
  const majors = new Map(), minors = new Map();
  for (const r of rows) {
    if (r.type !== type) continue;
    if (r.parent_id === null) majors.set(r.key, majors.size);
    else minors.set(`${byId.get(r.parent_id)?.key}\u0000${r.key}`, minors.size);
  }
  return { majors, minors };
}

function clean(input, existing) {
  const out = {};
  if (input.nameZh !== undefined || !existing) {
    out.name_zh = String(input.nameZh ?? "").trim().slice(0, 30);
    if (!out.name_zh) throw badRequest("INVALID_INPUT", "请填写中文名");
  }
  if (input.nameEn !== undefined) out.name_en = String(input.nameEn).trim().slice(0, 60);
  if (input.hint !== undefined) out.hint = String(input.hint).trim().slice(0, 600);
  if (input.rating !== undefined) {
    if (!RATINGS.includes(input.rating)) throw badRequest("INVALID_INPUT", "分级取值不正确");
    out.rating = input.rating;
  }
  if (input.genEnabled !== undefined) out.gen_enabled = input.genEnabled ? 1 : 0;
  if (input.sort !== undefined) out.sort = Math.max(-100000, Math.min(100000, Math.round(Number(input.sort) || 0)));
  return out;
}

export function create(input) {
  const type = input.type;
  if (!ASSET_TYPES.includes(type)) throw badRequest("INVALID_INPUT", "类型不正确");
  const parent = input.parentId ? get(input.parentId) : null;
  if (input.parentId && (!parent || parent.type !== type || parent.parent_id !== null)) {
    throw badRequest("INVALID_INPUT", "上级分类不存在");
  }
  const key = String(input.key || "").trim() || `c-${randomId(6).toLowerCase()}`;
  if (!KEY.test(key)) throw badRequest("INVALID_KEY", "标识只能用字母、数字、中文、- 和 _，最长 40 个字符");
  const taken = parent ? minor(type, parent.key, key) : major(type, key);
  if (taken) throw badRequest("KEY_TAKEN", "同一级下已有这个标识");
  const fields = clean(input, null);
  const siblings = load().rows.filter((r) => r.type === type && r.parent_id === (parent ? parent.id : null));
  const now = Date.now();
  const id = db.prepare(`INSERT INTO asset_categories (type, parent_id, key, name_zh, name_en, hint, rating, gen_enabled, sort,
    created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    type, parent ? parent.id : null, key, fields.name_zh, fields.name_en || "", fields.hint || "",
    fields.rating || "general", fields.gen_enabled ?? 1,
    fields.sort ?? ((siblings.at(-1)?.sort || 0) + 10), now, now).lastInsertRowid;
  invalidate();
  return get(id);
}

// Keys are fixed once created: assets point at them.
export function update(id, input) {
  const row = get(id);
  if (!row) throw notFound("分类不存在");
  const fields = clean(input, row);
  const keys = Object.keys(fields);
  if (keys.length) {
    db.prepare(`UPDATE asset_categories SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
      .run(...keys.map((k) => fields[k]), Date.now(), row.id);
    invalidate();
  }
  return get(row.id);
}

// Deletes a category (and a major's minors). `inUse(row)` counts assets
// still filed under it; those must be moved first.
export function remove(id, inUse) {
  const row = get(id);
  if (!row) throw notFound("分类不存在");
  const used = inUse(row);
  if (used) throw badRequest("CATEGORY_IN_USE", `这个分类下还有 ${used} 个素材，请先把它们移到其他分类`);
  db.prepare("DELETE FROM asset_categories WHERE id = ?").run(row.id);
  invalidate();
}

export const dto = (row) => {
  if (!row) return null;
  const parent = row.parent_id ? get(row.parent_id) : null;
  return { ...node(row), type: row.type, parentId: row.parent_id, parentKey: parent?.key || null, parentZh: parent?.name_zh || null };
};

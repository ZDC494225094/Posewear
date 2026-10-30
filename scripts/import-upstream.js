#!/usr/bin/env node
// Import the pose and outfit catalogs from an ai-reference-gallery checkout.
//
//   node scripts/import-upstream.js --source ../_upstream --accept-license [--copy] [--reset-ratings]
//
// Without --copy the asset rows point at LIBRARY_DIR, which you set to the
// checkout's img/ folder. With --copy the images are copied into LIBRARY_DIR.
// Re-running updates labels and paths but keeps ratings and enabled flags that
// were changed in the admin panel, unless --reset-ratings is given.
import fs from "node:fs";
import path from "node:path";
import { config } from "../server/config.js";
import { db, migrate } from "../server/db.js";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const source = path.resolve(option("source", path.join(config.root, "..", "_upstream")));
const copy = has("copy");
const resetRatings = has("reset-ratings");

console.log(`Source checkout: ${source}`);
if (!fs.existsSync(path.join(source, "catalog.js")) || !fs.existsSync(path.join(source, "costume-catalog.js"))) {
  console.error("catalog.js / costume-catalog.js not found. Pass --source <path to ai-reference-gallery>.");
  process.exit(1);
}

if (!has("accept-license")) {
  const notice = fs.existsSync(path.join(source, "ASSETS.md"))
    ? fs.readFileSync(path.join(source, "ASSETS.md"), "utf8") : "";
  console.error(`
素材授权提示 / Asset licensing notice
------------------------------------
原项目的 MIT 许可证只覆盖代码，图片、缩略图和衍生索引不在其中。
商用前请先取得姿势素材（AI Pose Gallery）和服装素材（AI Costume Gallery）权利人的书面授权，
或替换为你自己拥有版权的素材。确认后加上 --accept-license 重新运行。

${notice.slice(0, 1200)}`);
  process.exit(2);
}

// The catalogs are `window.X = [...]` scripts. Parse the array as JSON rather
// than executing third-party code.
function readCatalog(file) {
  const text = fs.readFileSync(path.join(source, file), "utf8");
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error(`${file}: no array literal found`);
  const data = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(data) || !data.length) throw new Error(`${file}: empty catalog`);
  return data;
}

// Content ratings, from the series/category names in the source catalog:
// - general: everyday poses and outfits, usable with a person photo
// - suggestive: sensual poses, lingerie, swimwear; never combined with a person photo
// - explicit: sexual-position and nudity-adjacent poses; hidden and never sent to the model
function poseRating(item) {
  if (item.series === "2人絡み") return "explicit";
  if (item.series === "全身1人・セクシー系") return "suggestive";
  if (item.series === "上半身1人") {
    if (item.category === "かわいい系") return "general";
    if (item.category === "胸寄せ・谷間強調系") return "suggestive";
    return "explicit";
  }
  return "general";
}
const outfitRating = (item) => (["lingerie", "sexy", "swimwear"].includes(item.category) ? "suggestive" : "general");

const strip = (p) => String(p || "").replace(/^img\//, "");
const poses = readCatalog("catalog.js");
const outfits = readCatalog("costume-catalog.js");

const missing = [];
const sourceImg = path.join(source, "img");
for (const item of [...poses, ...outfits]) {
  for (const rel of [item.thumbnail, item.preview, item.original].filter(Boolean)) {
    if (!fs.existsSync(path.join(source, rel))) missing.push(rel);
  }
}
if (missing.length) {
  console.warn(`Warning: ${missing.length} referenced image files are missing, e.g. ${missing.slice(0, 3).join(", ")}`);
}

if (copy) {
  const target = config.libraryDir;
  if (path.resolve(target) === path.resolve(sourceImg)) {
    console.log("LIBRARY_DIR already points at the source img folder; nothing to copy.");
  } else {
    console.log(`Copying images to ${target} …`);
    fs.cpSync(sourceImg, target, { recursive: true, force: false, errorOnExist: false });
  }
} else if (path.resolve(config.libraryDir) !== path.resolve(sourceImg)) {
  console.log(`\nNote: LIBRARY_DIR is ${config.libraryDir}.`);
  console.log(`Either re-run with --copy, or set LIBRARY_DIR=${sourceImg} in .env.\n`);
}

migrate();
const now = Date.now();
const upsert = db.prepare(`INSERT INTO assets (id, type, group_key, code, series, series_zh, series_en, category,
  category_zh, category_en, category_ja, name, name_zh, name_en, angle, angle_zh, angle_en, keywords, people, root,
  thumb_path, preview_path, original_path, rating, enabled, sort, source, created_at, updated_at)
  VALUES (@id, @type, @group_key, @code, @series, @series_zh, @series_en, @category, @category_zh, @category_en,
  @category_ja, @name, @name_zh, @name_en, @angle, @angle_zh, @angle_en, @keywords, @people, 'library',
  @thumb_path, @preview_path, @original_path, @rating, 1, @sort, 'upstream', @now, @now)
  ON CONFLICT(id) DO UPDATE SET type = excluded.type, group_key = excluded.group_key, code = excluded.code,
    series = excluded.series, series_zh = excluded.series_zh, series_en = excluded.series_en,
    category = excluded.category, category_zh = excluded.category_zh, category_en = excluded.category_en,
    category_ja = excluded.category_ja, name = excluded.name, name_zh = excluded.name_zh, name_en = excluded.name_en,
    angle = excluded.angle, angle_zh = excluded.angle_zh, angle_en = excluded.angle_en,
    keywords = excluded.keywords, people = excluded.people, thumb_path = excluded.thumb_path,
    preview_path = excluded.preview_path, original_path = excluded.original_path, sort = excluded.sort,
    updated_at = excluded.updated_at
    ${resetRatings ? ", rating = excluded.rating, enabled = 1" : ""}`);

const ANGLE_ORDER = { "正面": 0, "斜め": 1, "横": 2, "上から": 3, "下から": 4 };
// Everyday poses lead the library; sensual and restricted series come after.
const SERIES_ORDER = { "全身1人・標準系": 0, "上半身1人": 1, "全身1人・セクシー系": 2, "2人絡み": 3 };
const stats = { pose: 0, outfit: 0, ratings: {} };

db.transaction(() => {
  poses.forEach((item, i) => {
    const rating = poseRating(item);
    stats.ratings[rating] = (stats.ratings[rating] || 0) + 1;
    upsert.run({
      id: item.id, type: "pose", group_key: item.pose_key, code: item.pose_number || "",
      series: item.series || "", series_zh: item.series_zh || "", series_en: item.series_en || "",
      category: item.category || "", category_zh: item.category_zh || "", category_en: item.category_en || "",
      category_ja: item.category || "",
      name: item.pose_name || "", name_zh: item.pose_name_zh || "",
      name_en: item.pose_name_en || `${item.category_en || ""} ${item.pose_number || ""}`.trim(),
      angle: item.angle || "", angle_zh: item.angle_zh || "", angle_en: item.angle_en || "",
      keywords: "", people: item.series === "2人絡み" ? 2 : 1,
      thumb_path: strip(item.thumbnail), preview_path: "", original_path: strip(item.original),
      rating, sort: (SERIES_ORDER[item.series] ?? 9) * 100000 + i * 10 + (ANGLE_ORDER[item.angle] ?? 9), now
    });
    stats.pose += 1;
  });
  outfits.forEach((item, i) => {
    const rating = outfitRating(item);
    stats.ratings[rating] = (stats.ratings[rating] || 0) + 1;
    upsert.run({
      id: item.id, type: "outfit", group_key: item.id, code: item.id,
      series: "", series_zh: "", series_en: "",
      category: item.category || "", category_zh: item.category_zh || "", category_en: item.category_en || "",
      category_ja: item.category_ja || "",
      name: item.id, name_zh: `${item.category_zh || ""}服装 ${item.id}`.trim(),
      name_en: `${item.category_en || ""} outfit ${item.id}`.trim(),
      angle: "", angle_zh: "", angle_en: "",
      keywords: item.keywords || "", people: 1,
      thumb_path: strip(item.thumbnail), preview_path: strip(item.preview), original_path: strip(item.original),
      rating, sort: i, now
    });
    stats.outfit += 1;
  });
})();

console.log(`Imported ${stats.pose} pose images and ${stats.outfit} outfits.`);
console.log(`Default ratings (new rows only unless --reset-ratings): ${JSON.stringify(stats.ratings)}`);
console.log("Ratings and visibility can be changed later in 后台 → 素材库.");

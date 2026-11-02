#!/usr/bin/env node
// Import the extra libraries into the asset table, copying their images into
// LIBRARY_DIR (portrait/, depth/, chara/):
//
//   node scripts/import-libraries.js --accept-license \
//     [--portrait <dir>] [--depth <dir>] [--charadb <dir>] [--reset-ratings]
//
//   --portrait  AI Portrait Gallery (ai-portrait-gallery.pages.dev, by あぎ, CC0):
//               images.js, full/<id>.png and thumb/<id>.webp. Each PNG becomes a
//               JPEG original (quality 92) and a 1024-px WebP preview. Portraits
//               whose PNG isn't there yet are skipped; run again to add them.
//   --depth     an ai-reference-gallery checkout with img/depth/original/<id>.png
//               and img/depth/thumbs/<id>.jpg (POSE-DB-02 by ギア): the depth map
//               of each library pose, stored on the pose.
//   --charadb   CharaDB (charadb-2fi.pages.dev, by たき), the official release:
//               data.js, img/, line/, thumb/. Outfits, poses (with line art) and
//               hairstyles and eyes, with Chinese names from scripts/data/library-zh.json.
//
// Re-running updates labels and paths but keeps ratings and enabled flags
// changed in the admin panel, unless --reset-ratings is given.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { config } from "../server/config.js";
import { db, migrate } from "../server/db.js";

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? path.resolve(args[i + 1]) : null;
};
const has = (name) => args.includes(`--${name}`);
const sources = { portrait: option("portrait"), depth: option("depth"), charadb: option("charadb") };
const resetRatings = has("reset-ratings");

if (!sources.portrait && !sources.depth && !sources.charadb) {
  console.error("Pass at least one of --portrait <dir>, --depth <dir>, --charadb <dir>.");
  process.exit(1);
}
if (!has("accept-license")) {
  console.error(`
素材授权提示 / Asset licensing notice
------------------------------------
- 人像库（ai-portrait-gallery，あぎ）：CC0，可商用；作者请求不要转载、再分发图片本身。
- 深度库（ai-pose-depth-gallery，ギア）：可在作品中商用；禁止批量下载、再分发和转载图片本身。
- 二次元库（CharaDB，たき）：图片仅作参考，禁止再分发和转载；生成这些图的底模（NoobAI-XL）许可证限制商用。
导入并在网站上展示这些图片前，请确认你已取得权利人的授权或自行承担相应责任。确认后加上 --accept-license 重新运行。`);
  process.exit(2);
}

migrate();
// Lookup tables without inherited keys, so odd values in the data ("constructor") find nothing.
const table = (entries) => Object.assign(Object.create(null), entries);
const zh = Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(path.join(config.root, "scripts", "data", "library-zh.json"), "utf8")))
  .map(([key, value]) => [key, table(value)]));
const now = Date.now();
const library = config.libraryDir;

const upsert = db.prepare(`INSERT INTO assets (id, type, group_key, code, series, series_zh, series_en, category,
  category_zh, category_en, category_ja, name, name_zh, name_en, angle, angle_zh, angle_en, keywords, people, root,
  thumb_path, preview_path, original_path, rating, enabled, sort, source, license, created_at, updated_at)
  VALUES (@id, @type, @group_key, @code, @series, @series_zh, @series_en, @category, @category_zh, @category_en,
  @category_ja, @name, @name_zh, @name_en, @angle, @angle_zh, @angle_en, @keywords, @people, 'library',
  @thumb_path, @preview_path, @original_path, @rating, @enabled, @sort, @source, 'commercial', @now, @now)
  ON CONFLICT(id) DO UPDATE SET group_key = excluded.group_key, code = excluded.code,
    series = excluded.series, series_zh = excluded.series_zh, series_en = excluded.series_en,
    category = excluded.category, category_zh = excluded.category_zh, category_en = excluded.category_en,
    category_ja = excluded.category_ja, name = excluded.name, name_zh = excluded.name_zh, name_en = excluded.name_en,
    angle = excluded.angle, angle_zh = excluded.angle_zh, angle_en = excluded.angle_en,
    keywords = excluded.keywords, people = excluded.people, thumb_path = excluded.thumb_path,
    preview_path = excluded.preview_path, original_path = excluded.original_path, sort = excluded.sort,
    updated_at = excluded.updated_at
    ${resetRatings ? ", rating = excluded.rating, enabled = excluded.enabled" : ""}`);
const row = (fields) => ({ group_key: fields.id, code: "", series_zh: "", series_en: "", category_zh: "", category_en: "",
  category_ja: "", name: "", name_en: "", angle: "", angle_zh: "", angle_en: "", keywords: "", people: 1, preview_path: "",
  rating: "general", enabled: 1, sort: 0, now, ...fields });

function copy(from, rel) {
  const to = path.join(library, rel);
  if (fs.existsSync(to) && fs.statSync(to).size === fs.statSync(from).size) return;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

// A few jobs at a time (image conversion is the slow part).
async function pool(items, limit, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

// IDs become file names and asset IDs; anything else in the data is skipped.
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

function readArray(file) {
  const text = fs.readFileSync(file, "utf8");
  const start = text.indexOf("["), end = text.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error(`${file}: no array literal found`);
  return JSON.parse(text.slice(start, end + 1));
}

// ---------- 人像库: AI portraits (face type), used as the person of a work

const HAIR = table({ "ショート": ["short", "短发", "Short hair"], "ミディアム": ["medium", "中发", "Medium hair"],
  "セミロング": ["semi-long", "中长发", "Semi-long hair"], "ロング": ["long", "长发", "Long hair"] });
const SECTION = table({ face: ["正脸参考", "Face reference", "正脸"], styling: ["造型参考", "Styling reference", "造型"] });

// The site keeps its images in img/full and img/thumb; plain full/ and thumb/ work too.
const portraitFile = (dir, kind, id, ext) =>
  [path.join(dir, "img", kind, `${id}.${ext}`), path.join(dir, kind, `${id}.${ext}`)].find((f) => fs.existsSync(f));

async function importPortraits(dir) {
  const items = readArray(path.join(dir, "images.js")).filter((it) => SAFE_ID.test(String(it?.id)));
  const ready = items.map((it, index) => ({ ...it, index, png: portraitFile(dir, "full", it.id, "png"), webp: portraitFile(dir, "thumb", it.id, "webp") }))
    .filter((it) => it.png && it.webp);
  console.log(`Portraits: ${ready.length} of ${items.length} downloaded`);
  let done = 0;
  await pool(ready, 4, async (it) => {
    const original = path.join(library, "portrait", "original", `${it.id}.jpg`);
    const preview = path.join(library, "portrait", "preview", `${it.id}.webp`);
    if (!fs.existsSync(original) || !fs.existsSync(preview)) {
      fs.mkdirSync(path.dirname(original), { recursive: true });
      fs.mkdirSync(path.dirname(preview), { recursive: true });
      await sharp(it.png).jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toFile(`${original}.part`);
      fs.renameSync(`${original}.part`, original);
      await sharp(it.png).resize({ width: 1024, height: 1024, fit: "inside" }).webp({ quality: 85 }).toFile(`${preview}.part`);
      fs.renameSync(`${preview}.part`, preview);
    }
    copy(it.webp, path.join("portrait", "thumb", `${it.id}.webp`));
    if (++done % 200 === 0) console.log(`  ${done} converted`);
  });
  db.transaction(() => {
    ready.forEach((it) => {
      const [key, lengthZh, lengthEn] = HAIR[it.hair] || ["medium", "中发", "Medium hair"];
      const [sectionZh, sectionEn, short] = SECTION[it.section] || SECTION.face;
      const style = zh.portraitStyles[it.style] || "";
      upsert.run(row({
        id: it.id, type: "face", code: it.id, series: it.section in SECTION ? it.section : "face", series_zh: sectionZh, series_en: sectionEn,
        category: key, category_zh: lengthZh, category_en: lengthEn, category_ja: it.hair || "",
        name: it.style || "", name_zh: style || `${lengthZh} · ${short}`, name_en: `${lengthEn}, ${it.section}`,
        keywords: [lengthZh, sectionZh, style, it.style].filter(Boolean).join(" "),
        thumb_path: `portrait/thumb/${it.id}.webp`, preview_path: `portrait/preview/${it.id}.webp`,
        original_path: `portrait/original/${it.id}.jpg`, sort: it.index, source: "portrait"
      }));
    });
  })();
  console.log(`Imported ${ready.length} portraits.`);
}

// ---------- 深度库: the depth map of each library pose

function importDepth(dir) {
  const poses = db.prepare("SELECT id FROM assets WHERE type = 'pose' AND root = 'library' AND source = 'upstream'").all();
  const set = db.prepare("UPDATE assets SET depth_path = ?, depth_thumb_path = ?, updated_at = ? WHERE id = ?");
  let found = 0;
  db.transaction(() => {
    for (const { id } of poses) {
      const original = path.join(dir, "img", "depth", "original", `${id}.png`);
      const thumb = path.join(dir, "img", "depth", "thumbs", `${id}.jpg`);
      if (!fs.existsSync(original) || !fs.existsSync(thumb)) continue;
      copy(original, path.join("depth", "original", `${id}.png`));
      copy(thumb, path.join("depth", "thumbs", `${id}.jpg`));
      set.run(`depth/original/${id}.png`, `depth/thumbs/${id}.jpg`, now, id);
      found += 1;
    }
  })();
  console.log(`Depth maps: ${found} of ${poses.length} library poses.`);
}

// ---------- 二次元库: CharaDB outfits, poses and hair

const OUTFIT_CATS = table({ "制服・学生": "chara-school", "カジュアル(春夏)": "chara-casual-ss", "カジュアル(秋冬)": "chara-casual-aw",
  "きれいめ・オフィス": "chara-office", "ドレス・パーティ": "chara-dress", "和服": "chara-wafuku", "水着": "chara-swim",
  "スポーツ・部活": "chara-sports", "職業・コスプレ": "chara-cosplay", "ファンタジー": "chara-fantasy", "部屋着・パジャマ": "chara-roomwear",
  "イベント・季節": "chara-events", "アイドル・ステージ": "chara-idol", "ゴスロリ・地雷系": "chara-gothic", "ミリタリー・SF": "chara-military" });
const POSE_CATS = table({ "立ち": "chara-stand", "座り": "chara-sit", "寝そべり": "chara-lie", "しゃがみ・膝立ち": "chara-crouch",
  "上半身・手の仕草": "chara-upper", "動き": "chara-motion", "2人": "chara-duo", "日常の動作": "chara-daily" });
const HAIR_CATS = table({ "髪型": "style", "前髪": "bangs", "髪色": "color", "髪飾り": "acc", "目の色": "eye-color", "瞳の形": "eye-shape" });
// Never shown or sent to the model: items that read as children (an elementary
// school uniform, school swimsuits, gym bloomers) and the most revealing
// swimwear. The terms of the library also forbid depicting minors.
const EXPLICIT = new Set(["O011", "O013", "O018", "O209", "O210", "O224", "O229", "O231", "O436"]);
// Suggestive (not combined with a real person's photo): besides swimwear,
// bunny suits, revealing outfits and a few bolder poses.
const SUGGESTIVE = new Set(["O111", "O170", "O171", "O172", "O193", "O195", "O241", "O248", "O249", "O303", "O304", "O321",
  "O398", "O401", "O408", "O435", "P059", "P065", "P082", "P156"]);
const COLOR = /\((黒|金|ピンク|銀)\)$/;
// After the main library in every listing (its poses sort up to about 320 000).
const CHARA_SORT = 1_000_000;

function charaName(item) {
  if (item.sub === "style_color" && COLOR.test(item.jp)) {
    const [suffix, color] = COLOR.exec(item.jp);
    return `${zh.chara[item.jp.slice(0, -suffix.length)]}（${zh.charaColors[color]}）`;
  }
  if (/-s$/.test(item.id)) return `${zh.chara[item.jp.replace(/\(横から\)$/, "")]}（侧面）`;
  return zh.chara[item.jp] || item.jp;
}

function importCharaDB(dir) {
  const text = fs.readFileSync(path.join(dir, "data.js"), "utf8");
  const data = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  const stats = { outfit: 0, pose: 0, hair: 0, missing: 0 };
  const file = (folder, id, ext) => path.join(dir, folder, `${id}.${ext}`);
  db.transaction(() => {
    data.items.forEach((item, i) => {
      if (!SAFE_ID.test(String(item?.id))) return;
      const id = `cd-${item.id}`;
      if (!fs.existsSync(file("img", item.id, "jpg")) || !fs.existsSync(file("thumb", item.id, "webp"))) { stats.missing += 1; return; }
      copy(file("img", item.id, "jpg"), `chara/img/${item.id}.jpg`);
      copy(file("thumb", item.id, "webp"), `chara/thumb/${item.id}.webp`);
      const line = item.set === "pose" && item.line && fs.existsSync(file("line", item.id, "png"));
      if (line) copy(file("line", item.id, "png"), `chara/line/${item.id}.png`);
      const name = charaName(item);
      const rating = EXPLICIT.has(item.id) ? "explicit" : SUGGESTIVE.has(item.id) || item.cat === "水着" ? "suggestive" : "general";
      const base = { id, code: item.id.replace(/-s$/, ""), series: "chara", name: item.jp, name_zh: name, name_en: item.tags || "",
        keywords: [name, item.jp, item.tags].filter(Boolean).join(" "), category_ja: item.cat,
        thumb_path: `chara/thumb/${item.id}.webp`, preview_path: `chara/img/${item.id}.jpg`, original_path: `chara/img/${item.id}.jpg`,
        rating, enabled: rating === "explicit" ? 0 : 1, sort: CHARA_SORT + i, source: "charadb" };
      if (item.set === "outfit") {
        upsert.run(row({ ...base, type: "outfit", series_zh: "二次元服装", series_en: "Anime outfits", category: OUTFIT_CATS[item.cat] || "chara-casual-ss" }));
      } else if (item.set === "pose") {
        const side = /-s$/.test(item.id);
        // The line art is the pose reference; the drawn character is its preview.
        upsert.run(row({ ...base, type: "pose", group_key: `cd-${base.code}`, series_zh: "二次元角色姿势", series_en: "Anime character poses",
          category: POSE_CATS[item.cat] || "chara-stand", angle: side ? "横" : "正面", angle_zh: side ? "侧面" : "正面", angle_en: side ? "Side" : "Front",
          people: item.cat === "2人" ? 2 : 1, original_path: line ? `chara/line/${item.id}.png` : base.original_path }));
      } else if (item.set === "hair") {
        upsert.run(row({ ...base, type: "hair", series_zh: "二次元发型 · 眼睛", series_en: "Anime hair & eyes", category: HAIR_CATS[item.cat] || "style" }));
      } else return;
      stats[item.set] += 1;
    });
  })();
  console.log(`CharaDB: ${stats.outfit} outfits, ${stats.pose} poses, ${stats.hair} hairstyles and eyes${stats.missing ? ` (${stats.missing} without images skipped)` : ""}.`);
}

if (sources.depth) importDepth(sources.depth);
if (sources.charadb) importCharaDB(sources.charadb);
if (sources.portrait) await importPortraits(sources.portrait);
console.log(`Images are in ${library}. Ratings and visibility can be changed in 后台 → 素材库.`);

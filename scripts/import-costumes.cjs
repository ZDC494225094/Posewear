"use strict";

// Development-only importer. The published gallery requires no Node.js or network.
// Run only for assets you are authorized to redistribute.
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const source = "https://ai-costume-gallery.pages.dev/";
const categories = {
  "春": ["spring", "春季", "Spring"],
  "夏": ["summer", "夏季", "Summer"],
  "秋": ["autumn", "秋季", "Autumn"],
  "冬": ["winter", "冬季", "Winter"],
  "ランジェリー": ["lingerie", "内衣", "Lingerie"],
  "パーティ": ["party", "派对", "Party"],
  "水着": ["swimwear", "泳装", "Swimwear"],
  "セクシー": ["sexy", "性感风格", "Sexy"]
};

async function fetchBuffer(relative) {
  const response = await fetch(new URL(relative, source), { signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`${relative}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function targetPath(row, kind) {
  const category = categories[row["カテゴリ"]]?.[0];
  if (!category) throw new Error("Unknown category for " + row.id);
  const folder = { "サムネ": "thumbs", "画像": "preview", "原寸": "original" }[kind];
  if (!folder) throw new Error("Unknown image kind: " + kind);
  return `img/costume/${category}/${folder}/${path.posix.basename(row[kind])}`;
}

function isValid(bytes, ext) {
  if (ext === "png") return bytes.length > 100 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  return bytes.length > 100 && bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
}

async function fetchAsset(relative, target) {
  const local = path.join(root, target);
  const ext = path.extname(relative).slice(1);
  if (fs.existsSync(local) && isValid(fs.readFileSync(local), ext)) return 0;
  fs.mkdirSync(path.dirname(local), { recursive: true });
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const bytes = await fetchBuffer(relative);
      if (!isValid(bytes, ext)) throw new Error(`Invalid ${ext} image: ${relative}`);
      const temp = `${local}.part`;
      fs.writeFileSync(temp, bytes);
      fs.renameSync(temp, local);
      return bytes.length;
    } catch (err) {
      if (attempt === 4) throw err;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
}

async function main() {
  const html = (await fetchBuffer("")).toString("utf8");
  const metaMatch = html.match(/const META=(\{[^\n]+\});/);
  const rowsMatch = html.match(/const D=(\[[^\n]+\]);/);
  if (!metaMatch || !rowsMatch) throw new Error("Source index format has changed");
  const meta = JSON.parse(metaMatch[1]);
  const rows = JSON.parse(rowsMatch[1]);
  if (rows.length !== meta.total || new Set(rows.map((row) => row.id)).size !== rows.length) {
    throw new Error("Source catalog count or IDs are invalid");
  }

  const catalog = rows.map((row) => {
    if (!/^[A-Z]{3}-\d{4}$/.test(row.id) || !categories[row["カテゴリ"]]) throw new Error(`Unknown item: ${row.id}`);
    const [category, category_zh, category_en] = categories[row["カテゴリ"]];
    for (const key of ["サムネ", "画像", "原寸"]) {
      if (!/^(thumbs|img|png)\/[A-Z]{3}-\d{4}\.(webp|png)$/.test(row[key])) throw new Error(`Unexpected path: ${row[key]}`);
    }
    return {
      id: row.id, category, category_zh, category_en, category_ja: row["カテゴリ"],
      keywords: row["キーワード"],
      thumbnail: targetPath(row, "サムネ"),
      preview: targetPath(row, "画像"),
      original: targetPath(row, "原寸")
    };
  });
  fs.writeFileSync(path.join(root, "costume-catalog.js"),
    `"use strict";\n// Licensed image metadata from ${source}\nwindow.COSTUME_GALLERY_CATALOG = ${JSON.stringify(catalog)};\n`, "utf8");
  console.log(`Saved costume-catalog.js: ${catalog.length} records`);
  if (process.argv.includes("--catalog-only")) return;

  const assets = rows.flatMap((row) => ["サムネ", "画像", "原寸"]
    .map((kind) => ({ source: row[kind], target: targetPath(row, kind) })));
  const failures = [];
  let next = 0, done = 0, bytes = 0;
  async function worker() {
    while (next < assets.length) {
      const asset = assets[next++];
      try {
        const downloaded = await fetchAsset(asset.source, asset.target);
        bytes += downloaded;
      }
      catch (err) { failures.push(`${asset.source}: ${err.message}`); }
      done++;
      if (done % 250 === 0 || done === assets.length) {
        console.log(`${done}/${assets.length} checked, ${(bytes / 1048576).toFixed(1)} MiB downloaded, ${failures.length} failures`);
      }
    }
  }
  await Promise.all(Array.from({ length: 12 }, () => worker()));
  if (failures.length) {
    console.error("Missing assets:\n" + failures.slice(0, 30).join("\n"));
    process.exitCode = 1;
  } else console.log(`Complete: ${assets.length} image assets verified`);
}

main().catch((err) => { console.error(err); process.exitCode = 1; });

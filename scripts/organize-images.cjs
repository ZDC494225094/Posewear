"use strict";

// One-time, restartable asset layout migration. Run with --dry-run to inspect.
// Moves existing files on disk without changing their bytes or downloading them.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const seriesFolders = {
  "全身1人・セクシー系": "solo-expressive",
  "全身1人・標準系": "solo-standard",
  "上半身1人": "solo-upper-body",
  "2人絡み": "duo"
};
const allowedCostumeCategories = new Set([
  "spring", "summer", "autumn", "winter", "lingerie", "party", "swimwear", "sexy"
]);

function readCatalog(file, key) {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, file), "utf8"), context);
  if (!Array.isArray(context.window[key])) throw new Error("Invalid catalog: " + file);
  return context.window[key];
}

const poses = readCatalog("catalog.js", "POSE_GALLERY_CATALOG");
const costumes = readCatalog("costume-catalog.js", "COSTUME_GALLERY_CATALOG");
const moves = [];

function collect(record, field, dest, legacyPattern) {
  const from = record[field].replaceAll("\\", "/");
  if (from !== dest && !legacyPattern.test(from)) {
    throw new Error("Unexpected path for " + record.id + ": " + from);
  }
  const absoluteSource = path.resolve(root, from);
  const absoluteTarget = path.resolve(root, dest);
  if (!absoluteSource.startsWith(root + path.sep) || !absoluteTarget.startsWith(root + path.sep)) {
    throw new Error("Unsafe asset path");
  }
  moves.push({ record, field, from, dest, absoluteSource, absoluteTarget });
}

for (const record of poses) {
  const folder = seriesFolders[record.series];
  if (!folder) throw new Error("Unknown pose series: " + record.series);
  collect(record, "thumbnail", `img/pose/${folder}/thumbs/${path.posix.basename(record.thumbnail)}`,
    /^thumbs\/[^/]+\.jpe?g$/);
  collect(record, "original", `img/pose/${folder}/original/${path.posix.basename(record.original)}`,
    /^img\/[^/]+\.png$/);
}

for (const record of costumes) {
  if (!allowedCostumeCategories.has(record.category)) {
    throw new Error("Unknown costume category: " + record.category);
  }
  for (const [field, subdir, pattern] of [
    ["thumbnail", "thumbs", /^costumes\/thumbs\/[^/]+\.webp$/],
    ["preview", "preview", /^costumes\/img\/[^/]+\.webp$/],
    ["original", "original", /^costumes\/png\/[^/]+\.png$/]
  ]) {
    collect(record, field, `img/costume/${record.category}/${subdir}/${path.posix.basename(record[field])}`,
      pattern);
  }
}

// Preflight everything before moving anything. Never silently replace files.
const seen = new Set();
let alreadyMoved = 0;
let byteCount = 0;
for (const entry of moves) {
  if (seen.has(entry.dest)) throw new Error("Duplicate destination: " + entry.dest);
  seen.add(entry.dest);
  const src = fs.existsSync(entry.absoluteSource);
  const dst = fs.existsSync(entry.absoluteTarget);
  if (entry.from === entry.dest) {
    if (!dst) throw new Error("Missing file: " + entry.dest);
    alreadyMoved++;
  } else if (src && dst) {
    throw new Error("Refusing to overwrite target: " + entry.dest);
  } else if (!src && dst) {
    alreadyMoved++;
  } else if (!src) {
    throw new Error("Missing source and target: " + entry.from + " / " + entry.dest);
  }
  byteCount += fs.statSync(dst ? entry.absoluteTarget : entry.absoluteSource).size;
}

console.log(`Preflight OK: ${moves.length} files, ${alreadyMoved} already in place, ${(byteCount / 2**30).toFixed(2)} GiB`);
if (process.argv.includes("--dry-run")) process.exit(0);

let moved = 0;
for (const entry of moves) {
  if (fs.existsSync(entry.absoluteTarget)) continue;
  fs.mkdirSync(path.dirname(entry.absoluteTarget), { recursive: true });
  fs.renameSync(entry.absoluteSource, entry.absoluteTarget);
  moved++;
  if (moved % 1000 === 0) console.log(`Moved ${moved} files...`);
}

for (const entry of moves) {
  if (!fs.existsSync(entry.absoluteTarget)) throw new Error("Move validation failed: " + entry.dest);
  entry.record[entry.field] = entry.dest;
}

function writeCatalog(file, key, data, comment = "") {
  const target = path.join(root, file), temp = target + ".part";
  fs.writeFileSync(temp, `"use strict";\n${comment}window.${key} = ${JSON.stringify(data)};\n`, "utf8");
  fs.renameSync(temp, target);
}
writeCatalog("catalog.js", "POSE_GALLERY_CATALOG", poses);
writeCatalog("costume-catalog.js", "COSTUME_GALLERY_CATALOG", costumes,
  "// Licensed image metadata from https://ai-costume-gallery.pages.dev/\n");

// Remove ONLY old empty asset directories, never delete files.
for (const oldDir of ["thumbs", "costumes/thumbs", "costumes/img", "costumes/png", "costumes"]) {
  const full = path.join(root, oldDir);
  if (fs.existsSync(full) && fs.readdirSync(full).length === 0) fs.rmdirSync(full);
}
console.log(`Done. ${moved} moved, ${moves.length - moved} already present. All images are now referenced under img/.`);

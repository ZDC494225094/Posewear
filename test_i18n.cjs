"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const root = __dirname;
const storage = new Map();
const sandbox = {
  window: {},
  localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value)
  }
};
vm.runInNewContext(fs.readFileSync(path.join(root, "i18n.js"), "utf8"), sandbox);
const i18n = sandbox.window.ReferenceGalleryI18n;

// The published catalog is a normal script so file:// mode works without a server.
const catalogContext = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, "catalog.js"), "utf8"), catalogContext);
const records = catalogContext.window.POSE_GALLERY_CATALOG;
vm.runInNewContext(fs.readFileSync(path.join(root, "costume-catalog.js"), "utf8"), catalogContext);
const costumes = catalogContext.window.COSTUME_GALLERY_CATALOG;

test("offline catalog loads without fetch and all local image files are present", () => {
  assert.equal(records.length, 1439);
  assert.equal(new Set(records.map((item) => item.pose_key)).size, 288);
  assert.ok(fs.readFileSync(path.join(root, "index.html"), "utf8").includes('src="catalog.js"'));
  assert.ok(!fs.readFileSync(path.join(root, "app.js"), "utf8").includes("fetch("));
  for (const record of records) {
    for (const key of ["thumbnail", "original"]) {
      assert.ok(fs.existsSync(path.join(root, record[key])), `${record.id}: ${key}`);
      assert.match(record[key], /^img\/pose\/[a-z-]+\/(thumbs|original)\/[^/]+$/);
    }
  }
});

test("all 1,407 outfits have unique IDs and complete local assets", () => {
  assert.equal(costumes.length, 1407);
  assert.equal(new Set(costumes.map((item) => item.id)).size, costumes.length);
  assert.equal(new Set([...records.map((item) => item.id), ...costumes.map((item) => item.id)]).size,
    records.length + costumes.length);
  const counts = { spring: 215, summer: 254, autumn: 244, winter: 253,
    lingerie: 199, party: 48, swimwear: 54, sexy: 140 };
  for (const [category, expected] of Object.entries(counts)) {
    assert.equal(costumes.filter((c) => c.category === category).length, expected);
  }
  for (const item of costumes) {
    for (const key of ["thumbnail", "preview", "original"]) {
      const file = path.join(root, item[key]);
      assert.ok(fs.existsSync(file), `${item.id} missing ${key}`);
      assert.ok(fs.statSync(file).size > 100, `${item.id} empty ${key}`);
      assert.match(item[key], new RegExp(`^img/costume/${item.category}/(thumbs|preview|original)/[^/]+$`));
    }
  }
});

test("all images belong under the single img folder with no legacy asset directories", () => {
  for (const old of ["thumbs", "costumes"]) {
    assert.equal(fs.existsSync(path.join(root, old)), false, `${old} is not cleaned up`);
  }
  const paths = [
    ...records.flatMap((x) => [x.thumbnail, x.original]),
    ...costumes.flatMap((x) => [x.thumbnail, x.preview, x.original])
  ];
  assert.equal(paths.length, 7099);
  assert.equal(new Set(paths).size, paths.length);
  assert.ok(paths.every((p) => p.startsWith("img/")));
});

test("both catalogs load offline and the gallery has type switching and pagination", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  assert.ok(html.includes('src="costume-catalog.js"'));
  assert.ok(html.includes('id="type-costume"'));
  assert.ok(html.includes('id="type-pose"'));
  assert.ok(html.includes('id="load-more"'));
  assert.ok(app.includes('state.visibleCount'));
  assert.ok(!app.includes("fetch("));
});

test("costume labels and keyword searches work in all three languages", () => {
  const sample = costumes.find((item) => item.id === "SPR-0001");
  assert.ok(sample);
  for (const locale of ["zh-CN", "en", "ja"]) {
    i18n.setLocale(locale);
    assert.ok(i18n.t("typeCostume"));
    assert.ok(i18n.t("costumeName", i18n.label(sample, "category"), sample.id).includes(sample.id));
    assert.ok(i18n.searchable(sample).includes(sample.keywords));
    assert.ok(i18n.searchable(sample).includes("春季"));
    assert.ok(i18n.searchable(sample).includes("Spring"));
    assert.ok(i18n.searchable(sample).includes("春"));
  }
});

test("language choice is switchable and persisted", () => {
  i18n.setLocale("en");
  assert.equal(i18n.locale, "en");
  assert.equal(storage.get("ai-reference-gallery-language"), "en");
  assert.equal(i18n.t("reset"), "Reset filters");
  i18n.setLocale("zh-CN");
  assert.equal(i18n.t("reset"), "重置筛选");
  i18n.setLocale("ja");
  assert.equal(i18n.locale, "ja");
  assert.equal(storage.get("ai-reference-gallery-language"), "ja");
  assert.equal(i18n.t("reset"), "絞り込みをリセット");

  const reloaded = { window: {}, localStorage: sandbox.localStorage };
  vm.runInNewContext(fs.readFileSync(path.join(root, "i18n.js"), "utf8"), reloaded);
  assert.equal(reloaded.window.ReferenceGalleryI18n.locale, "ja");
});

test("previous project language preference remains compatible", () => {
  const legacy = { window: {}, localStorage: {
    getItem: (key) => key === "ai-pose-gallery-language" ? "en" : null,
    setItem: () => {}
  } };
  vm.runInNewContext(fs.readFileSync(path.join(root, "i18n.js"), "utf8"), legacy);
  assert.equal(legacy.window.ReferenceGalleryI18n.locale, "en");
});

test("every interface text has a Japanese translation", () => {
  const keys = [
    "eyebrow", "tagline", "description", "searchLabel", "searchPlaceholder",
    "categoryLabel", "angleLabel", "viewLabel", "viewPose", "viewImage",
    "allCategories", "allAngles", "allSeries", "reset", "loadingCounts",
    "counts", "results", "angles", "empty", "loadError", "footer", "source",
    "download", "hint", "close", "previous", "next", "dialog",
    "typePose", "typeCostume", "costumeDescription", "costumeSearchLabel",
    "costumeSearchPlaceholder", "costumeName", "costumeResults", "costumeEmpty",
    "costumeHint", "loadMore"
  ];
  for (const locale of ["zh-CN", "en", "ja"]) {
    i18n.setLocale(locale);
    for (const key of keys) {
      const value = i18n.t(key, 2, 3, 4);
      assert.equal(typeof value, "string", `${locale}.${key}`);
      assert.ok(value.trim(), `${locale}.${key}`);
    }
  }
});

test("Japanese mode uses original Japanese labels without replacing metadata", () => {
  i18n.setLocale("ja");
  for (const item of records) {
    for (const field of ["series", "category", "angle", "pose_name"]) {
      assert.equal(i18n.label(item, field), item[`${field}_ja`] || item[field], `${item.id}.${field}`);
    }
  }
  const originalJapanese = {
    id: "LOCAL-P001", pose_number: "P001",
    series: "全身1人・標準系", category: "立ち",
    angle: "横", pose_name: "腕を上げて立つ"
  };
  for (const field of ["series", "category", "angle", "pose_name"]) {
    assert.equal(i18n.label(originalJapanese, field), originalJapanese[field]);
  }
});

test("full catalog series, category and angle have readable English labels", () => {
  i18n.setLocale("en");
  for (const field of ["series", "category", "angle"]) {
    for (const item of records) {
      const translated = i18n.label(item, field);
      assert.ok(translated, `${item.id}: ${field}`);
      assert.match(translated, /[A-Za-z]/, `${item.id}: ${field} is missing an English label`);
      assert.doesNotMatch(translated, /[\u3040-\u30ff\u3400-\u9fff]/, `${item.id}: ${field} is untranslated`);
    }
  }
});

test("English names are never silently presented as translated Japanese", () => {
  i18n.setLocale("en");
  for (const item of records) {
    const name = i18n.label(item, "pose_name");
    assert.ok(name);
    if (!item.pose_name_en) {
      assert.ok(name.includes(item.pose_number), item.id);
      assert.notEqual(name, item.pose_name, item.id);
    }
  }
});

test("search can match English and Chinese terms regardless of selected UI", () => {
  const sample = records[0];
  i18n.setLocale("en");
  const englishCategory = i18n.label(sample, "category");
  assert.ok(i18n.searchable(sample).includes(englishCategory));
  if (sample.category_zh) assert.ok(i18n.searchable(sample).includes(sample.category_zh));
  i18n.setLocale("zh-CN");
  assert.ok(i18n.searchable(sample).includes(englishCategory));
  i18n.setLocale("ja");
  assert.ok(i18n.searchable(sample).includes(englishCategory));
  if (sample.category_ja) assert.ok(i18n.searchable(sample).includes(sample.category_ja));
  i18n.setLocale("en");
  if (sample.category_ja) assert.ok(i18n.searchable(sample).includes(sample.category_ja));
});

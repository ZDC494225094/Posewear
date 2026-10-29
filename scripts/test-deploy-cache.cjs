"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");

test("deployed CSS and JS references have content-based cache versions", () => {
  const references = [...html.matchAll(/\b(?:src|href)="([^"#]+?\.(?:css|js))(?:\?v=([a-f0-9]{12}))?"/g)];
  assert.ok(references.length >= 8, "Expected all CSS and JS entrypoints");
  for (const [, file, version] of references) {
    assert.ok(version, `Missing cache version for ${file}`);
    const expected = crypto.createHash("sha256")
      .update(fs.readFileSync(path.join(root, "dist", file)))
      .digest("hex").slice(0, 12);
    assert.equal(version, expected, `Outdated cache version for ${file}`);
  }
  if (process.env.CHECK_RELEASE_SOURCE === "1") {
    const sourceHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
    assert.equal(html.replace(/\?v=[a-f0-9]{12}(?=")/g, ""), sourceHtml,
      "Release HTML differs from local source beyond asset versioning");
    for (const [, file] of references) {
      assert.deepEqual(fs.readFileSync(path.join(root, "dist", file)),
        fs.readFileSync(path.join(root, file)), `Changed locally since release build: ${file}`);
    }
  }
});

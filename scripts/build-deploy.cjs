"use strict";

// Build an incremental Cloudflare Pages release without re-copying the image library.
// Asset URLs include their content hash so browsers never mix new HTML with old CSS/JS.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
assert.ok(fs.existsSync(path.join(dist, "img", "pose")), "Missing dist/img/pose; first prepare the image assets");
assert.ok(fs.existsSync(path.join(dist, "img", "costume")), "Missing dist/img/costume; first prepare the image assets");

const original = fs.readFileSync(path.join(root, "index.html"), "utf8");
let copied = 0;
const html = original.replace(/(\b(?:src|href)=")([^"?#]+?\.(?:js|css))(")/g, (full, prefix, file, suffix) => {
  const source = path.resolve(root, file);
  assert.ok(source.startsWith(root + path.sep), `Unexpected asset path: ${file}`);
  assert.ok(fs.existsSync(source), `Missing referenced asset: ${file}`);
  const content = fs.readFileSync(source);
  const version = crypto.createHash("sha256").update(content).digest("hex").slice(0, 12);
  const target = path.resolve(dist, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  copied += 1;
  return `${prefix}${file}?v=${version}${suffix}`;
});
assert.ok(copied >= 8, `Only found ${copied} JS/CSS references in index.html`);
fs.writeFileSync(path.join(dist, "index.html"), html);
console.log(`Release prepared: index.html and ${copied} CSS/JS files; image assets preserved`);

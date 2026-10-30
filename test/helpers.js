import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

// A tiny ai-reference-gallery checkout: three poses (general, suggestive,
// explicit duo) and two outfits (general, lingerie), with real image files.
export async function makeFixtureUpstream(dir) {
  const img = (rel, w, h, color) => {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    const pipeline = sharp({ create: { width: w, height: h, channels: 3, background: color } });
    return (rel.endsWith(".png") ? pipeline.png() : rel.endsWith(".webp") ? pipeline.webp() : pipeline.jpeg()).toFile(full);
  };
  const poses = [
    { id: "std_P001_front", series: "全身1人・標準系", series_zh: "单人全身 · 常规姿势", series_en: "Solo · classic full body",
      category: "立ち", category_zh: "站姿", category_en: "Standing", pose_name: "立ち", pose_name_zh: "对立式站姿",
      pose_number: "P001", angle: "正面", angle_zh: "正面", angle_en: "Front", pose_key: "全身1人・標準系|P001", folder: "solo-standard" },
    { id: "std_P001_side", series: "全身1人・標準系", series_zh: "单人全身 · 常规姿势", series_en: "Solo · classic full body",
      category: "立ち", category_zh: "站姿", category_en: "Standing", pose_name: "立ち", pose_name_zh: "对立式站姿",
      pose_number: "P001", angle: "横", angle_zh: "侧面", angle_en: "Side", pose_key: "全身1人・標準系|P001", folder: "solo-standard" },
    { id: "sexy_P002_front", series: "全身1人・セクシー系", series_zh: "单人全身 · 性感姿势", series_en: "Solo · expressive full body",
      category: "座り", category_zh: "坐姿", category_en: "Sitting", pose_name: "座り", pose_name_zh: "侧坐",
      pose_number: "P002", angle: "正面", angle_zh: "正面", angle_en: "Front", pose_key: "全身1人・セクシー系|P002", folder: "solo-expressive" },
    { id: "pair_P003_front", series: "2人絡み", series_zh: "双人互动", series_en: "Two-person poses",
      category: "立位", category_zh: "双人站姿", category_en: "Standing together", pose_name: "立位", pose_name_zh: "双人",
      pose_number: "P003", angle: "正面", angle_zh: "正面", angle_en: "Front", pose_key: "2人絡み|P003", folder: "duo" }
  ].map((p) => ({ ...p, thumbnail: `img/pose/${p.folder}/thumbs/${p.id}.jpg`, original: `img/pose/${p.folder}/original/${p.id}.png` }));
  const outfits = [
    { id: "SPR-0001", category: "spring", category_zh: "春季", category_en: "Spring", category_ja: "春", keywords: "ivory knit denim skirt" },
    { id: "LNG-0001", category: "lingerie", category_zh: "内衣", category_en: "Lingerie", category_ja: "ランジェリー", keywords: "lace set" }
  ].map((o) => ({ ...o, thumbnail: `img/costume/${o.category}/thumbs/${o.id}.webp`,
    preview: `img/costume/${o.category}/preview/${o.id}.webp`, original: `img/costume/${o.category}/original/${o.id}.png` }));
  for (const p of poses) {
    await img(p.thumbnail, 300, 400, { r: 250, g: 250, b: 250 });
    await img(p.original, 900, 1200, { r: 255, g: 255, b: 255 });
  }
  for (const o of outfits) {
    await img(o.thumbnail, 360, 540, { r: 230, g: 200, b: 190 });
    await img(o.preview, 683, 1024, { r: 230, g: 200, b: 190 });
    await img(o.original, 683, 1024, { r: 230, g: 200, b: 190 });
  }
  const strip = (list) => list.map(({ folder, ...rest }) => rest);
  fs.writeFileSync(path.join(dir, "catalog.js"), `"use strict";\nwindow.POSE_GALLERY_CATALOG = ${JSON.stringify(strip(poses))};\n`);
  fs.writeFileSync(path.join(dir, "costume-catalog.js"), `"use strict";\nwindow.COSTUME_GALLERY_CATALOG = ${JSON.stringify(outfits)};\n`);
}

export async function startApp({ env = {} } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "posewear-test-"));
  const upstream = path.join(tmp, "upstream");
  await makeFixtureUpstream(upstream);
  const port = await freePort();
  const baseEnv = {
    ...process.env,
    ENV_FILE: ".env.test-none",
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: String(port),
    DATA_DIR: path.join(tmp, "data"),
    LIBRARY_DIR: path.join(upstream, "img"),
    APP_SECRET: "test-secret-0123456789-0123456789-abcdef",
    ADMIN_EMAIL: "admin@test.local",
    ADMIN_PASSWORD: "admin-pass-123",
    OPENAI_API_KEY: "",
    LOG_LEVEL: "warn",
    ...env
  };
  execFileSync(process.execPath, [path.join(ROOT, "scripts/import-upstream.js"), "--source", upstream, "--accept-license"],
    { env: baseEnv, stdio: "pipe" });
  const child = spawn(process.execPath, [path.join(ROOT, "server/index.js")], { env: baseEnv, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (d) => { output += d; });
  child.stderr.on("data", (d) => { output += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`${base}/healthz`);
      if (res.ok) break;
    } catch { /* not up yet */ }
    if (child.exitCode !== null) throw new Error(`Server exited early:\n${output}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    base, tmp, child,
    output: () => output,
    async stop() {
      if (child.exitCode === null) {
        const exited = new Promise((r) => child.once("exit", r));
        child.kill();
        await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
      }
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows may hold files briefly */ }
    }
  };
}

// fetch wrapper with a cookie jar and the double-submit CSRF header.
export function client(base) {
  const jar = new Map();
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  async function request(method, url, { json, form, headers = {}, raw = false } = {}) {
    const h = { ...headers, cookie: cookieHeader() };
    if (jar.has("pw_csrf") && method !== "GET") h["x-csrf-token"] = decodeURIComponent(jar.get("pw_csrf"));
    let body;
    if (json !== undefined) { h["content-type"] = "application/json"; body = JSON.stringify(json); }
    if (form) body = form;
    const res = await fetch(base + url, { method, headers: h, body, redirect: "manual" });
    for (const line of res.headers.getSetCookie?.() || []) {
      const [pair] = line.split(";");
      const i = pair.indexOf("=");
      const value = pair.slice(i + 1);
      if (/Expires=Thu, 01 Jan 1970/i.test(line) || value === "") jar.delete(pair.slice(0, i));
      else jar.set(pair.slice(0, i), value);
    }
    if (raw) return res;
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  }
  return {
    jar,
    get: (url, opts) => request("GET", url, opts),
    post: (url, json, opts = {}) => request("POST", url, { ...opts, json }),
    put: (url, json) => request("PUT", url, { json }),
    patch: (url, json) => request("PATCH", url, { json }),
    del: (url) => request("DELETE", url),
    upload: (url, form) => request("POST", url, { form }),
    raw: (url) => request("GET", url, { raw: true })
  };
}

export async function waitFor(fn, { timeout = 20_000, interval = 200 } = {}) {
  const started = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - started > timeout) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, interval));
  }
}

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import express from "express";
import compression from "compression";
import { config } from "./config.js";
import { db, migrate } from "./db.js";
import * as settings from "./services/settings.js";
import * as worker from "./services/worker.js";
import { ensureBootstrapAdmin } from "./services/auth.js";
import { seedPackages } from "./services/billing.js";
import { startMaintenance } from "./services/maintenance.js";
import { seedChannels } from "./services/seed.js";
import { securityHeaders, session, csrf, errorHandler, notFoundApi } from "./middleware.js";
import { router as publicRouter } from "./routes/public.js";
import { router as authRouter } from "./routes/auth.js";
import { router as meRouter } from "./routes/me.js";
import { router as libraryRouter } from "./routes/library.js";
import { router as studioRouter } from "./routes/studio.js";
import { router as assetsRouter } from "./routes/assets.js";
import { router as billingRouter, notifyRouter } from "./routes/billing.js";
import { router as mediaRouter } from "./routes/media.js";
import { router as adminRouter } from "./routes/admin.js";
import { router as weddingRouter } from "./routes/wedding.js";
import { log } from "./lib/logger.js";

migrate();
await ensureBootstrapAdmin(config.adminEmail, config.adminPassword);
seedPackages();
seedChannels();

const app = express();
app.disable("x-powered-by");
const trust = config.trustProxy;
app.set("trust proxy", trust === "true" ? true : trust === "false" ? false : /^\d+$/.test(trust) ? Number(trust) : trust);

app.use(securityHeaders);
// gzip for HTML, JSON, JS and CSS; images and fonts are already compressed.
app.use(compression());
app.get("/healthz", (req, res) => {
  db.prepare("SELECT 1").get();
  res.json({ ok: true, worker: worker.stats() });
});

// Static assets, served before the session lookup. The HTML shells load code
// and styles from /assets/<version>/, which changes with every deploy: in
// production browsers keep those files for a year, so a repeat visit fetches
// no code at all. Plain /assets paths (images named in code) work as before:
// fonts and images are cached, JS and CSS revalidate (cheap 304s).
const assetsDir = path.join(config.publicDir, "assets");
const assetVersion = (() => {
  const hash = crypto.createHash("sha1");
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|css)$/.test(entry.name)) hash.update(entry.name).update(String(fs.statSync(full).mtimeMs));
    }
  };
  walk(assetsDir);
  return hash.digest("hex").slice(0, 10);
})();
app.use(`/assets/${assetVersion}`, express.static(assetsDir, {
  index: false,
  setHeaders(res) { res.setHeader("Cache-Control", config.isProd ? "public, max-age=31536000, immutable" : "no-cache"); }
}));
app.use("/assets", express.static(assetsDir, {
  index: false,
  setHeaders(res, file) {
    if (/\.(woff2|png|jpe?g|webp|svg|ico)$/.test(file)) res.setHeader("Cache-Control", "public, max-age=2592000");
    else res.setHeader("Cache-Control", "no-cache");
  }
}));
app.use("/assets", (req, res) => res.status(404).end());
app.get(["/favicon.ico", "/favicon.svg"], (req, res) => res.sendFile(path.join(assetsDir, "img", "favicon.svg")));
app.get("/robots.txt", (req, res) => res.type("text/plain").send("User-agent: *\nDisallow: /admin\nDisallow: /api\nDisallow: /media/uploads\nDisallow: /media/library\n"));

// Payment callbacks need their raw bodies and carry no session or CSRF token.
app.use("/api", notifyRouter);
app.use(express.json({ limit: "1mb" }));
app.use(session);
app.use("/api", csrf);
app.use("/api", publicRouter, authRouter, meRouter, libraryRouter, studioRouter, assetsRouter, weddingRouter, billingRouter, adminRouter);
app.use("/api", notFoundApi);
app.use("/media", mediaRouter);

// HTML shells for the user site and the admin panel, with site metadata filled in.

// The modules an entry imports statically, as <link rel="modulepreload">, so the
// browser asks for all of them at once instead of one import level at a time.
function modulePreloads(entry) {
  const seen = new Set();
  const visit = (rel) => {
    if (seen.has(rel) || !fs.existsSync(path.join(assetsDir, rel))) return;
    seen.add(rel);
    const source = fs.readFileSync(path.join(assetsDir, rel), "utf8");
    for (const m of source.matchAll(/^\s*import\s+(?:[^;]*?\sfrom\s+)?["'](\.{1,2}\/[^"']+)["']/gm)) {
      visit(path.posix.join(path.posix.dirname(rel), m[1]));
    }
  };
  visit(entry);
  seen.delete(entry);
  return [...seen].map((rel) => `<link rel="modulepreload" href="/assets/${assetVersion}/${rel}">`).join("\n  ");
}
const preloads = { "index.html": modulePreloads("js/main.js"), "admin.html": modulePreloads("js/admin/main.js") };

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);
const templates = new Map();
function shell(name) {
  if (!templates.has(name) || !config.isProd) {
    templates.set(name, fs.readFileSync(path.join(config.publicDir, name), "utf8"));
  }
  const site = settings.get("site");
  return templates.get(name)
    .replaceAll("%SITE_NAME%", escapeHtml(site.name))
    .replaceAll("%SITE_DESCRIPTION%", escapeHtml(site.description))
    .replaceAll("%SITE_KEYWORDS%", escapeHtml(site.keywords))
    .replaceAll("%ASSET_VERSION%", assetVersion)
    .replace("%MODULE_PRELOADS%", preloads[name] || "");
}

app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  if (/^\/(api|media|assets)(\/|$)/.test(req.path)) return next();
  res.set("Cache-Control", "no-cache");
  res.type("html").send(shell(req.path === "/admin" || req.path.startsWith("/admin/") ? "admin.html" : "index.html"));
});

app.use(errorHandler);

if (config.workerEnabled) worker.start();
startMaintenance();

const server = app.listen(config.port, config.host);
server.once("listening", () => {
  log.info(`${settings.get("site").name} listening on http://${config.host === "0.0.0.0" ? "localhost" : config.host}:${config.port}`);
  log.info(`Data: ${config.dataDir} · Library: ${config.libraryDir}`);
});
server.once("error", (err) => {
  log.error(`Failed to listen on ${config.host}:${config.port} (${err.code || "LISTEN_ERROR"})`, err);
  process.exitCode = 1;
});
server.requestTimeout = 120_000;

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`${signal} received, shutting down…`);
  server.close();
  await Promise.race([worker.stop(), new Promise((r) => setTimeout(r, 15_000))]);
  db.close();
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

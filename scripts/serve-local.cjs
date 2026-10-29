"use strict";
// Development-only same-origin preview: node scripts/serve-local.cjs
// No dependency and not required after deployment.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", process.env.GALLERY_SERVE_DIST === "1" ? "dist" : ".");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml"
};
const port = Number(process.argv[2] || process.env.GALLERY_PORT) || 8765;
http.createServer((request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405).end();
    return;
  }
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname); }
  catch (_) { response.writeHead(400).end(); return; }
  const file = path.resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
  const ext = path.extname(file).toLowerCase();
  if (!file.startsWith(root + path.sep) || !types[ext]) {
    response.writeHead(404).end();
    return;
  }
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "Content-Type": types[ext], "Content-Length": stat.size,
      "Cache-Control": "no-cache" });
    if (request.method === "HEAD") response.end();
    else fs.createReadStream(file).pipe(response);
  });
}).listen(port, "127.0.0.1", () => {
  console.log(`Reference Gallery static preview: http://127.0.0.1:${port}/`);
});

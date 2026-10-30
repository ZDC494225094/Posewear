import multer from "multer";
import { config } from "./config.js";
import { sessionUser, SESSION_COOKIE } from "./services/auth.js";
import { HttpError, unauthorized, forbidden } from "./lib/errors.js";
import { randomToken, safeEqual } from "./lib/crypto.js";
import { log } from "./lib/logger.js";
import { MAX_UPLOAD_BYTES } from "./services/uploads.js";

export const CSRF_COOKIE = "pw_csrf";

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    if (!key || key in out) continue;
    try { out[key] = decodeURIComponent(part.slice(i + 1).trim()); } catch { out[key] = part.slice(i + 1).trim(); }
  }
  return out;
}

export function secureCookie(req) {
  if (config.cookieSecure === "true") return true;
  if (config.cookieSecure === "false") return false;
  return req.secure;
}

export function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'"
  ].join("; "));
  if (req.secure) res.setHeader("Strict-Transport-Security", "max-age=15552000");
  next();
}

// Attach req.user from the session cookie, and make sure a CSRF cookie exists.
export function session(req, res, next) {
  req.cookies = parseCookies(req.headers.cookie);
  const token = req.cookies[SESSION_COOKIE];
  const row = token ? sessionUser(token) : null;
  if (row) {
    req.sessionId = row.session_id;
    req.sessionToken = token;
    req.user = row;
  }
  if (!req.cookies[CSRF_COOKIE]) {
    const value = randomToken(18);
    req.cookies[CSRF_COOKIE] = value;
    res.cookie(CSRF_COOKIE, value, { sameSite: "lax", secure: secureCookie(req), path: "/", maxAge: 365 * 24 * 3600_000 });
  }
  next();
}

// Double-submit CSRF check for every state-changing API call. Payment
// gateways post notifications without our cookie, so those routes are exempt
// and authenticate by signature instead.
export function csrf(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.path.startsWith("/pay/notify/")) return next();
  const header = req.get("x-csrf-token") || "";
  const cookie = req.cookies?.[CSRF_COOKIE] || "";
  if (!header || !cookie || !safeEqual(header, cookie)) {
    return next(new HttpError(403, "CSRF", "页面已过期，请刷新后重试"));
  }
  next();
}

export function requireUser(req, res, next) {
  if (!req.user) return next(unauthorized());
  if (req.user.status === "banned") return next(forbidden("该账号已被停用，如有疑问请联系客服", "ACCOUNT_BANNED"));
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== "admin" || req.user.status !== "active") return next(forbidden());
  next();
}

export const uploadSingle = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 20 }
}).single("file");

export function notFoundApi(req, res) {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "接口不存在" } });
}

export function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (res.headersSent) return;
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, ...err.extra } });
  }
  if (err instanceof multer.MulterError) {
    const message = err.code === "LIMIT_FILE_SIZE" ? `图片不能超过 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB` : "上传失败，请重试";
    return res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: { code: err.code, message } });
  }
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ error: { code: "BAD_JSON", message: "请求格式不正确" } });
  }
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: { code: "TOO_LARGE", message: "请求内容过大" } });
  }
  log.error(`${req.method} ${req.originalUrl} failed`, err);
  res.status(500).json({ error: { code: "INTERNAL", message: "服务器开小差了，请稍后再试" } });
}

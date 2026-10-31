import { db } from "../db.js";
import { hit } from "../lib/rate-limit.js";
import { tooMany } from "../lib/errors.js";
import { log } from "../lib/logger.js";
import * as settings from "./settings.js";

// Limits on browsing the library, against scraping. Each kind is counted per
// viewer (user, or guest cookie) and per IP within an hour; previews and
// originals also per day. A normal visit stays far below these. Tripping one
// refuses the request and records an alert for the admins.
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const LIMITS = {
  list: [600, 1500],
  thumb: [2000, 5000],
  preview: [300, 800],
  original: [60, 150]
};
const DAILY_ORIGINALS = 200;

export const KIND_TEXT = { list: "素材列表", thumb: "缩略图", preview: "大图", original: "原图下载" };

export function check(req, kind, viewerKey) {
  const [perViewer, perIp] = LIMITS[kind];
  const who = viewerKey || `ip:${req.ip}`;
  let ok = hit(`access:${kind}:${who}`, perViewer, HOUR) && hit(`access:${kind}:ip:${req.ip}`, perIp, HOUR);
  if (ok && kind === "preview") ok = hit(`access:preview-day:${who}`, settings.get("library").dailyPreviews, DAY);
  if (ok && kind === "original") ok = hit(`access:original-day:${who}`, DAILY_ORIGINALS, DAY);
  if (ok) return;
  record(req, kind);
  throw tooMany("访问太频繁，请稍后再试");
}

// One alert row per user (or IP for guests) and kind per hour; repeated
// refusals within a minute count once.
function record(req, kind) {
  const userId = req.user?.id ?? null;
  const ip = String(req.ip || "").slice(0, 64);
  if (!hit(`access-alert:${kind}:${userId ?? ip}`, 1, 60_000)) return;
  const now = Date.now();
  const recent = db.prepare(`SELECT id FROM access_alerts WHERE user_id IS ? AND ip = ? AND kind = ? AND last_at > ?
    ORDER BY id DESC LIMIT 1`).get(userId, ip, kind, now - HOUR);
  if (recent) db.prepare("UPDATE access_alerts SET hits = hits + 1, last_at = ? WHERE id = ?").run(now, recent.id);
  else {
    db.prepare("INSERT INTO access_alerts (user_id, ip, kind, hits, first_at, last_at) VALUES (?, ?, ?, 1, ?, ?)")
      .run(userId, ip, kind, now, now);
  }
  log.warn(`Library access limit (${kind}) hit by ${userId ? `user ${userId}` : "a guest"} from ${ip}`);
}

export function listAlerts({ offset = 0, size = 30 } = {}) {
  const total = db.prepare("SELECT COUNT(*) AS n FROM access_alerts").get().n;
  const rows = db.prepare(`SELECT a.*, u.email, u.status, u.role FROM access_alerts a LEFT JOIN users u ON u.id = a.user_id
    ORDER BY a.last_at DESC LIMIT ? OFFSET ?`).all(size, offset);
  return {
    total,
    items: rows.map((r) => ({
      id: r.id, userId: r.user_id, email: r.email || null, userStatus: r.status || null, ip: r.ip,
      kind: r.kind, kindText: KIND_TEXT[r.kind] || r.kind, hits: r.hits, firstAt: r.first_at, lastAt: r.last_at
    }))
  };
}

// Alerts in the last day, for the dashboard badge.
export const recentAlertCount = () =>
  db.prepare("SELECT COUNT(*) AS n FROM access_alerts WHERE last_at > ?").get(Date.now() - DAY).n;

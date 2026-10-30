import { db } from "../db.js";
import { badRequest, notFound } from "../lib/errors.js";
import { enforce } from "../lib/rate-limit.js";

export const REPORT_REASONS = {
  sexual: "色情低俗",
  minor: "涉及未成年人",
  portrait: "侵犯肖像或隐私",
  copyright: "侵犯版权",
  illegal: "违法违规",
  other: "其他"
};

export function create(user, { generationId, reason, detail }) {
  enforce(`report:${user.id}`, 20, 60 * 60 * 1000, "举报太频繁，请稍后再试");
  if (!REPORT_REASONS[reason]) throw badRequest("INVALID_INPUT", "请选择举报原因");
  const gen = db.prepare("SELECT id FROM generations WHERE id = ? AND is_public = 1 AND deleted_at IS NULL").get(String(generationId || ""));
  if (!gen) throw notFound("作品不存在或已下线");
  const dup = db.prepare("SELECT 1 FROM reports WHERE generation_id = ? AND reporter_id = ? AND status = 'open'").get(gen.id, user.id);
  if (dup) return { duplicate: true };
  db.prepare("INSERT INTO reports (generation_id, reporter_id, reason, detail, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(gen.id, user.id, reason, String(detail || "").trim().slice(0, 500), Date.now());
  return { ok: true };
}

export function list({ status, offset, size }) {
  const where = status ? "WHERE r.status = ?" : "";
  const params = status ? [status] : [];
  const total = db.prepare(`SELECT COUNT(*) AS n FROM reports r ${where}`).get(...params).n;
  const items = db.prepare(`SELECT r.*, u.email AS reporter_email, g.user_id AS author_id, g.hidden AS gen_hidden,
      (SELECT id FROM generation_images WHERE generation_id = r.generation_id ORDER BY idx LIMIT 1) AS image_id
    FROM reports r LEFT JOIN users u ON u.id = r.reporter_id LEFT JOIN generations g ON g.id = r.generation_id
    ${where} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`).all(...params, size, offset)
    .map((r) => ({ ...r, reasonLabel: REPORT_REASONS[r.reason] || r.reason,
      thumb: r.image_id ? `/media/gen/${r.image_id}/thumb` : null }));
  return { total, items };
}

export function resolve(id, { action, note }, adminId) {
  const r = db.prepare("SELECT * FROM reports WHERE id = ?").get(Number(id));
  if (!r) throw notFound("举报不存在");
  if (!["hide", "dismiss"].includes(action)) throw badRequest("INVALID_INPUT", "处理方式不正确");
  if (action === "hide") {
    db.prepare("UPDATE generations SET hidden = 1, featured = 0 WHERE id = ?").run(r.generation_id);
  }
  // Resolve every open report on the same work at once.
  db.prepare(`UPDATE reports SET status = ?, handled_by = ?, handled_at = ?, note = ?
    WHERE generation_id = ? AND status = 'open'`)
    .run(action === "hide" ? "resolved" : "dismissed", adminId, Date.now(), String(note || "").slice(0, 300), r.generation_id);
  return { ok: true };
}

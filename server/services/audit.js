import { db } from "../db.js";

// Admin and security-relevant actions, shown in the admin audit log.
export function audit(req, action, targetType = null, targetId = null, detail = null) {
  db.prepare(`INSERT INTO audit_logs (actor_id, action, target_type, target_id, detail, ip, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    req?.user?.id ?? null, action, targetType, targetId === null ? null : String(targetId),
    detail ? JSON.stringify(detail) : null, req?.ip ?? null, Date.now());
}

export function listAudit({ offset, size, action }) {
  const where = action ? "WHERE a.action LIKE ?" : "";
  const params = action ? [`${action}%`] : [];
  const total = db.prepare(`SELECT COUNT(*) AS n FROM audit_logs a ${where}`).get(...params).n;
  const items = db.prepare(`SELECT a.*, u.email AS actor_email FROM audit_logs a
    LEFT JOIN users u ON u.id = a.actor_id ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`)
    .all(...params, size, offset)
    .map((row) => ({ ...row, detail: row.detail ? JSON.parse(row.detail) : null }));
  return { total, items };
}

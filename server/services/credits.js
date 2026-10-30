import { db } from "../db.js";
import { notFound, paymentRequired } from "../lib/errors.js";

export const LEDGER_KINDS = {
  signup: "注册赠送",
  invite: "邀请奖励",
  checkin: "每日签到",
  purchase: "充值",
  redeem: "兑换码",
  generation: "生成消耗",
  refund: "失败退回",
  admin: "后台调整"
};

const updateBalance = db.prepare(
  "UPDATE users SET credits = credits + ?, updated_at = ? WHERE id = ? AND credits + ? >= 0");
const readBalance = db.prepare("SELECT credits FROM users WHERE id = ?");
const insertLedger = db.prepare(`INSERT INTO credit_ledger
  (user_id, delta, balance_after, kind, ref_type, ref_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

// Change a user's balance and record it in the ledger, atomically. Nested
// calls inside another db.transaction become savepoints.
export const adjust = db.transaction((userId, delta, kind, { refType = null, refId = null, note = "" } = {}) => {
  const now = Date.now();
  const result = updateBalance.run(delta, now, userId, delta);
  if (result.changes === 0) {
    const row = readBalance.get(userId);
    if (!row) throw notFound("用户不存在");
    throw paymentRequired(`点数不足：需要 ${-delta} 点，当前余额 ${row.credits} 点`,
      { balance: row.credits, required: -delta });
  }
  const balance = readBalance.get(userId).credits;
  insertLedger.run(userId, delta, balance, kind, refType, refId === null ? null : String(refId), note, now);
  return balance;
});

export function listLedger(userId, { offset, size }) {
  const total = db.prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE user_id = ?").get(userId).n;
  const items = db.prepare(`SELECT id, delta, balance_after, kind, ref_type, ref_id, note, created_at
    FROM credit_ledger WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?`).all(userId, size, offset)
    .map((row) => ({ ...row, kindLabel: LEDGER_KINDS[row.kind] || row.kind }));
  return { total, items };
}

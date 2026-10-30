import { db, tx } from "../db.js";
import * as settings from "./settings.js";
import * as credits from "./credits.js";
import * as alipay from "../payments/alipay.js";
import * as wechat from "../payments/wechat.js";
import { randomId, redeemCode } from "../lib/crypto.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { enforce } from "../lib/rate-limit.js";
import { log } from "../lib/logger.js";
import { localDateTime } from "../lib/time.js";

// ---------- packages

export function packageDto(p) {
  return {
    id: p.id, name: p.name, description: p.description, credits: p.credits, bonusCredits: p.bonus_credits,
    totalCredits: p.credits + p.bonus_credits, priceCents: p.price_cents, badge: p.badge, sort: p.sort, enabled: !!p.enabled
  };
}

export function listPackages({ includeDisabled = false } = {}) {
  return db.prepare(`SELECT * FROM packages ${includeDisabled ? "" : "WHERE enabled = 1"} ORDER BY sort, price_cents`)
    .all().map(packageDto);
}

function cleanPackage(input, existing = {}) {
  const name = String(input.name ?? existing.name ?? "").trim().slice(0, 40);
  if (!name) throw badRequest("INVALID_INPUT", "请填写套餐名称");
  const creditsValue = Math.round(Number(input.credits ?? existing.credits));
  const bonus = Math.round(Number(input.bonusCredits ?? existing.bonus_credits ?? 0));
  const price = Math.round(Number(input.priceCents ?? existing.price_cents));
  if (!Number.isInteger(creditsValue) || creditsValue < 1 || creditsValue > 10_000_000) throw badRequest("INVALID_INPUT", "点数需为正整数");
  if (!Number.isInteger(bonus) || bonus < 0 || bonus > 10_000_000) throw badRequest("INVALID_INPUT", "赠送点数需为非负整数");
  if (!Number.isInteger(price) || price < 1 || price > 100_000_000) throw badRequest("INVALID_INPUT", "价格需大于 0");
  return {
    name, credits: creditsValue, bonus, price,
    description: String(input.description ?? existing.description ?? "").trim().slice(0, 200),
    badge: String(input.badge ?? existing.badge ?? "").trim().slice(0, 12),
    sort: Math.round(Number(input.sort ?? existing.sort ?? 0)) || 0,
    enabled: input.enabled === undefined ? (existing.enabled ?? 1) : (input.enabled ? 1 : 0)
  };
}

export function createPackage(input) {
  const p = cleanPackage(input);
  const now = Date.now();
  const info = db.prepare(`INSERT INTO packages (name, description, credits, bonus_credits, price_cents, badge, sort, enabled,
    created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(p.name, p.description, p.credits, p.bonus, p.price, p.badge, p.sort, p.enabled, now, now);
  return packageDto(db.prepare("SELECT * FROM packages WHERE id = ?").get(info.lastInsertRowid));
}

export function updatePackage(id, input) {
  const existing = db.prepare("SELECT * FROM packages WHERE id = ?").get(id);
  if (!existing) throw notFound("套餐不存在");
  const p = cleanPackage(input, existing);
  db.prepare(`UPDATE packages SET name = ?, description = ?, credits = ?, bonus_credits = ?, price_cents = ?, badge = ?,
    sort = ?, enabled = ?, updated_at = ? WHERE id = ?`)
    .run(p.name, p.description, p.credits, p.bonus, p.price, p.badge, p.sort, p.enabled, Date.now(), id);
  return packageDto(db.prepare("SELECT * FROM packages WHERE id = ?").get(id));
}

export function deletePackage(id) {
  const used = db.prepare("SELECT 1 FROM orders WHERE package_id = ? LIMIT 1").get(id);
  if (used) {
    db.prepare("UPDATE packages SET enabled = 0, updated_at = ? WHERE id = ?").run(Date.now(), id);
    return { disabled: true };
  }
  db.prepare("DELETE FROM packages WHERE id = ?").run(id);
  return { deleted: true };
}

export function seedPackages() {
  if (db.prepare("SELECT COUNT(*) AS n FROM packages").get().n) return;
  const defaults = [
    { name: "体验包", description: "先试试效果", credits: 100, bonusCredits: 0, priceCents: 990, sort: 1 },
    { name: "创作者", description: "适合经常创作的个人", credits: 300, bonusCredits: 30, priceCents: 2990, badge: "最多人选", sort: 2 },
    { name: "工作室", description: "适合工作室和电商团队", credits: 1100, bonusCredits: 300, priceCents: 9900, sort: 3 }
  ];
  for (const p of defaults) createPackage(p);
}

// ---------- orders

const PROVIDER_LABELS = { alipay: "支付宝", wechat: "微信支付", mock: "模拟支付", manual: "人工入账" };

export function orderDto(o) {
  let pay = null;
  try { pay = o.pay_data ? JSON.parse(o.pay_data) : null; } catch { pay = null; }
  return {
    id: o.id, title: o.title, credits: o.credits, amountCents: o.amount_cents, currency: o.currency,
    provider: o.provider, providerLabel: PROVIDER_LABELS[o.provider] || o.provider, status: o.status,
    pay: o.status === "pending" ? pay : null, paidAt: o.paid_at, expiresAt: o.expires_at, createdAt: o.created_at
  };
}

function orderNo() {
  const d = localDateTime().replace(/\D/g, "");
  return `PW${d}${randomId(6).toUpperCase()}`;
}

function providerEnabled(provider) {
  const payment = settings.get("payment");
  if (provider === "alipay") return payment.alipay.enabled;
  if (provider === "wechat") return payment.wechat.enabled;
  if (provider === "mock") return payment.mock.enabled;
  return false;
}

export async function createOrder(user, { packageId, provider }, { baseUrl }) {
  enforce(`order:${user.id}`, 10, 10 * 60 * 1000, "下单太频繁，请稍后再试");
  if (!providerEnabled(provider)) throw badRequest("PROVIDER_DISABLED", "该支付方式暂未开放");
  const pkg = db.prepare("SELECT * FROM packages WHERE id = ? AND enabled = 1").get(Number(packageId));
  if (!pkg) throw badRequest("PACKAGE_UNAVAILABLE", "套餐不存在或已下架");
  const pending = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE user_id = ? AND status = 'pending' AND expires_at > ?")
    .get(user.id, Date.now()).n;
  if (pending >= 5) throw conflict("TOO_MANY_PENDING", "你有多笔待支付订单，请先完成或等待其过期");

  const payment = settings.get("payment");
  const now = Date.now();
  const order = {
    id: orderNo(), user_id: user.id, package_id: pkg.id, title: `${settings.get("site").name} ${pkg.name}`,
    credits: pkg.credits + pkg.bonus_credits, amount_cents: pkg.price_cents, provider,
    expires_at: now + payment.orderExpireMinutes * 60_000
  };
  db.prepare(`INSERT INTO orders (id, user_id, package_id, title, credits, amount_cents, currency, provider, status,
    expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'CNY', ?, 'pending', ?, ?, ?)`)
    .run(order.id, order.user_id, order.package_id, order.title, order.credits, order.amount_cents, provider,
      order.expires_at, now, now);

  let pay;
  try {
    if (provider === "alipay") {
      pay = await alipay.create(payment.alipay, order, {
        notifyUrl: `${baseUrl}/api/pay/notify/alipay`, returnUrl: `${baseUrl}/pay/${order.id}?from=return`
      });
    } else if (provider === "wechat") {
      pay = await wechat.create(payment.wechat, order, { notifyUrl: `${baseUrl}/api/pay/notify/wechat` });
    } else {
      pay = { type: "mock" };
    }
  } catch (err) {
    db.prepare("UPDATE orders SET status = 'closed', note = ?, updated_at = ? WHERE id = ?")
      .run(String(err.message).slice(0, 300), Date.now(), order.id);
    log.error(`Payment create failed for ${order.id}`, err);
    throw badRequest("PAYMENT_CREATE_FAILED", "支付下单失败，请稍后重试或换一种支付方式");
  }
  db.prepare("UPDATE orders SET pay_data = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(pay), Date.now(), order.id);
  return orderDto(db.prepare("SELECT * FROM orders WHERE id = ?").get(order.id));
}

export function getOrder(user, id) {
  const o = db.prepare("SELECT * FROM orders WHERE id = ? AND user_id = ?").get(String(id), user.id);
  if (!o) throw notFound("订单不存在");
  return orderDto(o);
}

export function listOrders(userId, { offset, size }) {
  const total = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE user_id = ?").get(userId).n;
  const items = db.prepare("SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?")
    .all(userId, size, offset).map(orderDto);
  return { total, items };
}

// Idempotent: the first confirmation credits the account, later ones no-op.
// A payment that arrives after the order expired is still honoured.
export const markPaid = tx((orderId, { tradeNo = "", amountCents, source }) => {
  const o = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
  if (!o) throw notFound("订单不存在");
  if (o.status === "paid") return { already: true, order: orderDto(o) };
  if (o.status === "refunded") throw conflict("ORDER_REFUNDED", "订单已退款");
  if (amountCents !== undefined && amountCents !== o.amount_cents) {
    throw badRequest("AMOUNT_MISMATCH", `支付金额不一致：订单 ${o.amount_cents}，回调 ${amountCents}`);
  }
  const now = Date.now();
  db.prepare("UPDATE orders SET status = 'paid', provider_trade_no = ?, paid_at = ?, updated_at = ?, note = ? WHERE id = ?")
    .run(tradeNo, now, now, source ? `confirmed by ${source}` : o.note, o.id);
  credits.adjust(o.user_id, o.credits, "purchase", { refType: "order", refId: o.id, note: o.title });
  log.info(`Order ${o.id} paid via ${source} (${o.amount_cents} cents, +${o.credits} credits)`);
  return { already: false, order: orderDto(db.prepare("SELECT * FROM orders WHERE id = ?").get(o.id)) };
});

export async function refreshOrder(user, id) {
  const o = db.prepare("SELECT * FROM orders WHERE id = ? AND user_id = ?").get(String(id), user.id);
  if (!o) throw notFound("订单不存在");
  if (o.status !== "pending" && o.status !== "closed") return orderDto(o);
  enforce(`order-query:${o.id}`, 12, 60_000, "查询太频繁，请稍后再试");
  const payment = settings.get("payment");
  try {
    let result = null;
    if (o.provider === "alipay" && payment.alipay.enabled) result = await alipay.query(payment.alipay, o);
    if (o.provider === "wechat" && payment.wechat.enabled) result = await wechat.query(payment.wechat, o);
    if (result?.paid) markPaid(o.id, { tradeNo: result.tradeNo, amountCents: result.amountCents, source: `${o.provider}-query` });
  } catch (err) {
    log.warn(`Order query failed for ${o.id}: ${err.message}`);
  }
  return orderDto(db.prepare("SELECT * FROM orders WHERE id = ?").get(o.id));
}

export function mockPay(user, id) {
  if (!settings.get("payment").mock.enabled) throw forbidden("模拟支付未开启", "MOCK_DISABLED");
  const o = db.prepare("SELECT * FROM orders WHERE id = ? AND user_id = ?").get(String(id), user.id);
  if (!o || o.provider !== "mock") throw notFound("订单不存在");
  return markPaid(o.id, { tradeNo: `MOCK-${randomId(10)}`, amountCents: o.amount_cents, source: "mock" }).order;
}

export function handleAlipayNotify(body) {
  const cfg = settings.get("payment").alipay;
  const parsed = alipay.parseNotify(cfg, body);
  if (!parsed) { log.warn("Alipay notify rejected: bad signature or app id"); return false; }
  if (parsed.paid) markPaid(parsed.orderId, { tradeNo: parsed.tradeNo, amountCents: parsed.amountCents, source: "alipay-notify" });
  return true;
}

export function handleWechatNotify(headers, rawBody) {
  const cfg = settings.get("payment").wechat;
  const parsed = wechat.parseNotify(cfg, headers, rawBody);
  if (!parsed) { log.warn("WeChat Pay notify rejected: bad signature"); return false; }
  if (parsed.paid) markPaid(parsed.orderId, { tradeNo: parsed.tradeNo, amountCents: parsed.amountCents, source: "wechat-notify" });
  return true;
}

export function closeExpiredOrders() {
  return db.prepare("UPDATE orders SET status = 'closed', updated_at = ? WHERE status = 'pending' AND expires_at <= ?")
    .run(Date.now(), Date.now()).changes;
}

export function adminListOrders({ status, q, offset, size }) {
  const where = ["1 = 1"];
  const params = [];
  if (status) { where.push("o.status = ?"); params.push(status); }
  if (q) { where.push("(o.id = ? OR u.email LIKE ? OR o.provider_trade_no = ?)"); params.push(q, `%${q}%`, q); }
  const sql = where.join(" AND ");
  const total = db.prepare(`SELECT COUNT(*) AS n FROM orders o JOIN users u ON u.id = o.user_id WHERE ${sql}`).get(...params).n;
  const items = db.prepare(`SELECT o.*, u.email AS user_email FROM orders o JOIN users u ON u.id = o.user_id
    WHERE ${sql} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`).all(...params, size, offset)
    .map((o) => ({ ...orderDto(o), userId: o.user_id, userEmail: o.user_email, tradeNo: o.provider_trade_no, note: o.note }));
  return { total, items };
}

export function adminMarkRefunded(id, note) {
  const o = db.prepare("SELECT * FROM orders WHERE id = ?").get(String(id));
  if (!o) throw notFound("订单不存在");
  if (o.status !== "paid") throw badRequest("NOT_PAID", "只有已支付订单可以标记退款");
  db.prepare("UPDATE orders SET status = 'refunded', note = ?, updated_at = ? WHERE id = ?")
    .run(String(note || "已线下退款").slice(0, 300), Date.now(), o.id);
  return orderDto(db.prepare("SELECT * FROM orders WHERE id = ?").get(o.id));
}

// ---------- redeem codes

export function createRedeemBatch({ count, credits: amount, expiresAt, note }, adminId) {
  const n = Math.round(Number(count));
  const value = Math.round(Number(amount));
  if (!Number.isInteger(n) || n < 1 || n > 1000) throw badRequest("INVALID_INPUT", "数量需在 1–1000 之间");
  if (!Number.isInteger(value) || value < 1 || value > 1_000_000) throw badRequest("INVALID_INPUT", "点数需为正整数");
  const expires = expiresAt ? Number(expiresAt) : null;
  if (expires !== null && (!Number.isFinite(expires) || expires <= Date.now())) throw badRequest("INVALID_INPUT", "过期时间需晚于现在");
  const batch = `B${localDateTime().slice(2, 10).replace(/-/g, "")}-${randomId(4).toUpperCase()}`;
  const insert = db.prepare(`INSERT OR IGNORE INTO redeem_codes (code, credits, batch, note, expires_at, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const codes = [];
  tx(() => {
    while (codes.length < n) {
      const code = redeemCode();
      if (insert.run(code, value, batch, String(note || "").slice(0, 100), expires, adminId, Date.now()).changes) codes.push(code);
    }
  })();
  return { batch, codes, credits: value };
}

export function redeem(user, rawCode) {
  enforce(`redeem:${user.id}`, 10, 10 * 60 * 1000, "兑换尝试过于频繁，请 10 分钟后再试");
  const compact = String(rawCode || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (compact.length !== 16) throw badRequest("INVALID_CODE", "兑换码格式不正确");
  const code = compact.match(/.{4}/g).join("-");
  return tx(() => {
    const row = db.prepare("SELECT * FROM redeem_codes WHERE code = ?").get(code);
    if (!row || row.status !== "active") throw badRequest("INVALID_CODE", "兑换码无效或已被使用");
    if (row.expires_at && row.expires_at <= Date.now()) throw badRequest("CODE_EXPIRED", "兑换码已过期");
    const used = db.prepare("UPDATE redeem_codes SET status = 'used', used_by = ?, used_at = ? WHERE id = ? AND status = 'active'")
      .run(user.id, Date.now(), row.id);
    if (!used.changes) throw badRequest("INVALID_CODE", "兑换码无效或已被使用");
    const balance = credits.adjust(user.id, row.credits, "redeem", { refType: "redeem", refId: row.id, note: `兑换码 ${code.slice(0, 4)}-****` });
    return { credits: row.credits, balance };
  })();
}

export function listRedeemCodes({ batch, status, q, offset, size }) {
  const where = ["1 = 1"];
  const params = [];
  if (batch) { where.push("r.batch = ?"); params.push(batch); }
  if (status) { where.push("r.status = ?"); params.push(status); }
  if (q) { where.push("r.code LIKE ?"); params.push(`%${String(q).toUpperCase()}%`); }
  const sql = where.join(" AND ");
  const total = db.prepare(`SELECT COUNT(*) AS n FROM redeem_codes r WHERE ${sql}`).get(...params).n;
  const items = db.prepare(`SELECT r.*, u.email AS used_by_email FROM redeem_codes r LEFT JOIN users u ON u.id = r.used_by
    WHERE ${sql} ORDER BY r.id DESC LIMIT ? OFFSET ?`).all(...params, size, offset);
  const batches = db.prepare(`SELECT batch, COUNT(*) AS total, SUM(status = 'used') AS used, MAX(credits) AS credits,
    MAX(note) AS note, MIN(created_at) AS created_at FROM redeem_codes GROUP BY batch ORDER BY created_at DESC LIMIT 50`).all();
  return { total, items, batches };
}

export function setRedeemStatus(id, status) {
  if (!["active", "disabled"].includes(status)) throw badRequest("INVALID_INPUT", "状态不正确");
  const r = db.prepare("UPDATE redeem_codes SET status = ? WHERE id = ? AND status <> 'used'").run(status, Number(id));
  if (!r.changes) throw badRequest("CODE_USED", "兑换码不存在或已被使用");
}

export function exportBatch(batch) {
  return db.prepare("SELECT code, credits, status, expires_at, note FROM redeem_codes WHERE batch = ? ORDER BY id").all(batch);
}

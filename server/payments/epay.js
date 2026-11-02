import crypto from "node:crypto";

// 易支付 (彩虹易支付 and compatible gateways), the classic MD5 interface.
//   page: submit.php, the browser goes to the gateway's cashier with signed parameters
//   api:  mapi.php, the server orders and gets a pay URL or QR code back
// Notifications come to notify_url (GET, sometimes POST) and are answered "success".
// The merchant key signs every request and notification; it also authenticates
// the order query, so it is only sent to the gateway over HTTPS.

export const METHODS = { alipay: "支付宝", wxpay: "微信支付", qqpay: "QQ 钱包" };

// Accept the gateway's root, or a pasted .../submit.php or .../mapi.php URL.
export function gatewayOf(raw) {
  let base = String(raw || "").trim().replace(/\/+$/, "");
  if (base && !/^https?:\/\//i.test(base)) base = `https://${base}`;
  return base.replace(/\/(submit|mapi|api)\.php$/i, "");
}

// Content to sign: parameters except sign, sign_type and blank values, sorted
// by key, joined as k=v with & (values unencoded), the key appended directly.
export function signContent(params) {
  return Object.keys(params)
    .filter((k) => k !== "sign" && k !== "sign_type" && params[k] !== undefined && params[k] !== null && String(params[k]).trim() !== "")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
}

// "9.90", "9.9" and "9" (newer gateways send the amount as a number) in cents; NaN otherwise.
export function centsOf(money) {
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(String(money ?? ""));
  return m ? Number(m[1]) * 100 + Number((m[2] || "").padEnd(2, "0")) : NaN;
}

export const sign = (params, key) => crypto.createHash("md5").update(signContent(params) + key, "utf8").digest("hex");

export function verify(params, key) {
  if (!key || typeof params.sign !== "string") return false;
  const expected = Buffer.from(sign(params, key));
  const given = Buffer.from(params.sign.toLowerCase());
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

const yuan = (cents) => (cents / 100).toFixed(2);

function signed(cfg, params) {
  return { ...params, sign: sign(params, cfg.key), sign_type: "MD5" };
}

export async function create(cfg, order, { notifyUrl, returnUrl, method, clientIp, device }) {
  const gateway = gatewayOf(cfg.gateway);
  if (!gateway || !cfg.pid || !cfg.key) throw new Error("易支付的接口地址、商户 ID 或密钥未配置");
  const params = {
    pid: String(cfg.pid), type: method, out_trade_no: order.id, notify_url: notifyUrl, return_url: returnUrl,
    // Some gateways reject symbols in the product name.
    name: order.title.replace(/[^\p{L}\p{N} ._-]/gu, "").slice(0, 60) || "充值", money: yuan(order.amount_cents)
  };
  if (cfg.mode !== "api") return { type: "redirect", url: `${gateway}/submit.php?${new URLSearchParams(signed(cfg, params))}`, method };
  const res = await fetch(`${gateway}/mapi.php`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    // The gateway validates clientip as an IP; IPv4 clients come in IPv6-mapped ("::ffff:1.2.3.4").
    body: new URLSearchParams(signed(cfg, { ...params, clientip: String(clientIp || "127.0.0.1").replace(/^::ffff:/i, ""),
      device: device || "pc" })).toString(),
    signal: AbortSignal.timeout(15_000)
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  if (!json || Number(json.code) !== 1) throw new Error(`易支付下单失败：${json?.msg || text.slice(0, 120) || `HTTP ${res.status}`}`);
  if (json.qrcode) return { type: "qr", content: json.qrcode, method };
  if (json.payurl || json.urlscheme) return { type: "redirect", url: json.payurl || json.urlscheme, method };
  throw new Error("易支付没有返回支付地址");
}

// The fields a payment notification carries. With MD5 the same key signs our
// requests and the gateway's notifications, and the buyer holds a signed
// request (the submit.php URL), so a notification with other fields, or with
// "&" or "=" folded into a value, could be a request signature reused.
const NOTIFY_FIELDS = new Set(["pid", "trade_no", "out_trade_no", "type", "name", "money", "trade_status", "param", "sign", "sign_type"]);

// Notification parameters (query string or form). null when a field is
// unexpected or repeated, or the signature or merchant ID doesn't match.
export function parseNotify(cfg, params) {
  if (!params || typeof params !== "object") return null;
  for (const [key, value] of Object.entries(params)) {
    if (!NOTIFY_FIELDS.has(key) || typeof value !== "string") return null;
    if (key !== "name" && /[&=]/.test(value)) return null;
  }
  if (String(params.pid || "") !== String(cfg.pid || "") || !verify(params, cfg.key)) return null;
  const amountCents = centsOf(params.money);
  if (!Number.isFinite(amountCents)) return null;
  return {
    orderId: String(params.out_trade_no || ""),
    tradeNo: String(params.trade_no || ""),
    amountCents,
    paid: params.trade_status === "TRADE_SUCCESS"
  };
}

// api.php?act=order: the gateway's record of the order (status 1 = paid).
export async function query(cfg, order) {
  const gateway = gatewayOf(cfg.gateway);
  // The query carries the merchant key: never over plain HTTP, except to this machine.
  if (!/^https:\/\//i.test(gateway) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(gateway)) {
    return { paid: false, message: "易支付接口地址不是 HTTPS，不查询订单" };
  }
  const url = `${gateway}/api.php?${new URLSearchParams({ act: "order", pid: String(cfg.pid), key: cfg.key, out_trade_no: order.id })}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const json = await res.json().catch(() => null);
  if (!json || Number(json.code) !== 1) return { paid: false, message: json?.msg };
  return { paid: Number(json.status) === 1, tradeNo: String(json.trade_no || ""), amountCents: centsOf(json.money) };
}

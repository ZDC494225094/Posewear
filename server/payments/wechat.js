import crypto from "node:crypto";
import { privateKeyFrom, publicKeyFrom } from "./keys.js";
import { config } from "../config.js";

// WeChat Pay API v3, Native (QR code) payments.
// Docs: https://pay.weixin.qq.com/doc/v3/merchant/4012791874
const BASE = "https://api.mch.weixin.qq.com";

export function authorization(cfg, method, urlPath, body = "") {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString("hex");
  const message = `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${body}\n`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(message), privateKeyFrom(cfg.privateKey)).toString("base64");
  return `WECHATPAY2-SHA256-RSA2048 mchid="${cfg.mchId}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${cfg.serialNo}"`;
}

async function request(cfg, method, urlPath, payload) {
  const body = payload ? JSON.stringify(payload) : "";
  const res = await fetch(BASE + urlPath, {
    method,
    headers: {
      Authorization: authorization(cfg, method, urlPath, body),
      Accept: "application/json",
      ...(payload ? { "Content-Type": "application/json" } : {}),
      "User-Agent": "posewear-studio"
    },
    body: payload ? body : undefined,
    signal: AbortSignal.timeout(15_000)
  });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { /* keep empty */ }
  return { status: res.status, json };
}

// RFC 3339 in the operator's time zone, e.g. 2026-10-29T21:30:00+08:00
function rfc3339(ts) {
  const offset = config.tzOffsetMinutes;
  const local = new Date(ts + offset * 60_000).toISOString().slice(0, 19);
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  return `${local}${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

export async function create(cfg, order, { notifyUrl }) {
  if (!cfg.mchId || !cfg.appId || !cfg.privateKey || !cfg.serialNo) throw new Error("微信支付商户号、AppID、证书序列号或私钥未配置");
  const { status, json } = await request(cfg, "POST", "/v3/pay/transactions/native", {
    appid: cfg.appId,
    mchid: cfg.mchId,
    description: order.title.slice(0, 127),
    out_trade_no: order.id,
    time_expire: rfc3339(order.expires_at),
    notify_url: notifyUrl,
    amount: { total: order.amount_cents, currency: "CNY" }
  });
  if (status !== 200 || !json.code_url) throw new Error(`微信支付下单失败：${json.message || json.code || status}`);
  return { type: "qr", content: json.code_url };
}

export function decryptResource(apiV3Key, { ciphertext, nonce, associated_data: aad }) {
  const raw = Buffer.from(ciphertext, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(apiV3Key, "utf8"), Buffer.from(nonce, "utf8"));
  decipher.setAuthTag(raw.subarray(raw.length - 16));
  if (aad) decipher.setAAD(Buffer.from(aad, "utf8"));
  return JSON.parse(Buffer.concat([decipher.update(raw.subarray(0, raw.length - 16)), decipher.final()]).toString("utf8"));
}

// Callback: verify the platform signature over the raw body, then decrypt.
// Returns null if anything does not check out.
export function parseNotify(cfg, headers, rawBody) {
  const timestamp = headers["wechatpay-timestamp"];
  const nonce = headers["wechatpay-nonce"];
  const signature = headers["wechatpay-signature"];
  const serial = headers["wechatpay-serial"];
  if (!timestamp || !nonce || !signature) return null;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return null;
  if (cfg.platformPublicKeyId && serial && serial !== cfg.platformPublicKeyId) return null;
  const message = `${timestamp}\n${nonce}\n${rawBody}\n`;
  let ok = false;
  try {
    ok = crypto.verify("RSA-SHA256", Buffer.from(message), publicKeyFrom(cfg.platformPublicKey), Buffer.from(signature, "base64"));
  } catch { ok = false; }
  if (!ok) return null;
  const event = JSON.parse(rawBody);
  if (!event.resource) return null;
  const tx = decryptResource(cfg.apiV3Key, event.resource);
  if (tx.mchid !== cfg.mchId || (cfg.appId && tx.appid !== cfg.appId)) return null;
  return {
    orderId: tx.out_trade_no,
    tradeNo: tx.transaction_id,
    amountCents: tx.amount?.total,
    paid: tx.trade_state === "SUCCESS"
  };
}

export async function query(cfg, order) {
  const { status, json } = await request(cfg, "GET",
    `/v3/pay/transactions/out-trade-no/${encodeURIComponent(order.id)}?mchid=${encodeURIComponent(cfg.mchId)}`);
  if (status !== 200) return { paid: false, message: json.message || String(status) };
  return { paid: json.trade_state === "SUCCESS", tradeNo: json.transaction_id, amountCents: json.amount?.total };
}

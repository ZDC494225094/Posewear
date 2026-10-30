import crypto from "node:crypto";
import { privateKeyFrom, publicKeyFrom } from "./keys.js";
import { localDateTime } from "../lib/time.js";

// Alipay Open Platform, RSA2 signatures.
//   page: 电脑网站支付 alipay.trade.page.pay (redirect to the cashier)
//   qr:   当面付 alipay.trade.precreate (show a QR code)
// Docs: https://opendocs.alipay.com/open/270/105899 and /open/194/105072

const GATEWAYS = {
  prod: "https://openapi.alipay.com/gateway.do",
  sandbox: "https://openapi-sandbox.dl.alipaydev.com/gateway.do"
};

export const gateway = (cfg) => (cfg.sandbox ? GATEWAYS.sandbox : GATEWAYS.prod);

// Content to sign: non-empty params except `sign` (and `sign_type` when
// verifying), sorted by key, joined as k=v with &, values unencoded.
export function signContent(params, { excludeSignType = false } = {}) {
  return Object.keys(params)
    .filter((k) => k !== "sign" && !(excludeSignType && k === "sign_type") &&
      params[k] !== undefined && params[k] !== null && params[k] !== "")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
}

export function sign(params, privateKey) {
  return crypto.sign("RSA-SHA256", Buffer.from(signContent(params), "utf8"), privateKeyFrom(privateKey)).toString("base64");
}

export function verify(params, publicKey) {
  if (!params.sign) return false;
  try {
    return crypto.verify("RSA-SHA256", Buffer.from(signContent(params, { excludeSignType: true }), "utf8"),
      publicKeyFrom(publicKey), Buffer.from(params.sign, "base64"));
  } catch {
    return false;
  }
}

function commonParams(cfg, method, extra = {}) {
  return {
    app_id: cfg.appId, method, format: "JSON", charset: "utf-8", sign_type: "RSA2",
    timestamp: localDateTime(), version: "1.0", ...extra
  };
}

const yuan = (cents) => (cents / 100).toFixed(2);

async function call(cfg, method, biz, extra = {}) {
  const params = commonParams(cfg, method, { ...extra, biz_content: JSON.stringify(biz) });
  params.sign = sign(params, cfg.privateKey);
  const res = await fetch(gateway(cfg), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(15_000)
  });
  const json = await res.json();
  const key = `${method.replaceAll(".", "_")}_response`;
  return json[key] || {};
}

export async function create(cfg, order, { notifyUrl, returnUrl }) {
  if (!cfg.appId || !cfg.privateKey) throw new Error("支付宝 AppID 或应用私钥未配置");
  const biz = {
    out_trade_no: order.id,
    total_amount: yuan(order.amount_cents),
    subject: order.title.slice(0, 128),
    time_expire: localDateTime(order.expires_at)
  };
  if (cfg.mode === "qr") {
    const resp = await call(cfg, "alipay.trade.precreate", biz, { notify_url: notifyUrl });
    if (resp.code !== "10000" || !resp.qr_code) {
      throw new Error(`支付宝下单失败：${resp.sub_msg || resp.msg || resp.code || "未知错误"}`);
    }
    return { type: "qr", content: resp.qr_code };
  }
  const params = commonParams(cfg, "alipay.trade.page.pay", {
    notify_url: notifyUrl, return_url: returnUrl,
    biz_content: JSON.stringify({ ...biz, product_code: "FAST_INSTANT_TRADE_PAY" })
  });
  params.sign = sign(params, cfg.privateKey);
  return { type: "redirect", url: `${gateway(cfg)}?${new URLSearchParams(params).toString()}` };
}

// Async notification (POST form). Returns null when the signature is invalid.
export function parseNotify(cfg, body) {
  if (!verify(body, cfg.alipayPublicKey)) return null;
  if (cfg.appId && body.app_id && body.app_id !== cfg.appId) return null;
  return {
    orderId: body.out_trade_no,
    tradeNo: body.trade_no,
    amountCents: Math.round(Number(body.total_amount) * 100),
    paid: body.trade_status === "TRADE_SUCCESS" || body.trade_status === "TRADE_FINISHED"
  };
}

export async function query(cfg, order) {
  const resp = await call(cfg, "alipay.trade.query", { out_trade_no: order.id });
  if (resp.code !== "10000") return { paid: false, message: resp.sub_msg || resp.msg };
  return {
    paid: resp.trade_status === "TRADE_SUCCESS" || resp.trade_status === "TRADE_FINISHED",
    tradeNo: resp.trade_no,
    amountCents: Math.round(Number(resp.total_amount) * 100)
  };
}

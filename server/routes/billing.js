import express from "express";
import QRCode from "qrcode";
import * as billing from "../services/billing.js";
import * as settings from "../services/settings.js";
import { requireUser } from "../middleware.js";
import { badRequest } from "../lib/errors.js";
import { log } from "../lib/logger.js";
import * as v from "../lib/validate.js";

export const router = express.Router();

router.get("/billing/packages", (req, res) => {
  res.json({ items: billing.listPackages() });
});

router.post("/billing/orders", requireUser, async (req, res) => {
  const provider = v.oneOf(req.body?.provider, "provider", ["alipay", "wechat", "mock"]);
  const order = await billing.createOrder(req.user, { packageId: req.body?.packageId, provider },
    { baseUrl: settings.publicBaseUrl(req) });
  res.status(201).json({ order });
});

router.get("/billing/orders/:id", requireUser, (req, res) => {
  res.json({ order: billing.getOrder(req.user, req.params.id) });
});

router.post("/billing/orders/:id/refresh", requireUser, async (req, res) => {
  res.json({ order: await billing.refreshOrder(req.user, req.params.id) });
});

router.post("/billing/orders/:id/mock-pay", requireUser, (req, res) => {
  res.json({ order: billing.mockPay(req.user, req.params.id) });
});

// QR code for WeChat Native / Alipay precreate, rendered server-side as SVG.
router.get("/billing/orders/:id/qr.svg", requireUser, async (req, res) => {
  const order = billing.getOrder(req.user, req.params.id);
  if (order.status !== "pending" || order.pay?.type !== "qr") throw badRequest("NO_QR", "该订单没有可用的支付二维码");
  const svg = await QRCode.toString(order.pay.content, { type: "svg", margin: 1, width: 240, errorCorrectionLevel: "M" });
  res.set("Cache-Control", "private, no-store").type("image/svg+xml").send(svg);
});

router.post("/billing/redeem", requireUser, (req, res) => {
  res.json(billing.redeem(req.user, req.body?.code));
});

// ---------- payment gateway callbacks (no session, verified by signature)

export const notifyRouter = express.Router();

notifyRouter.post("/pay/notify/alipay", express.urlencoded({ extended: false, limit: "64kb" }), (req, res) => {
  try {
    const ok = billing.handleAlipayNotify(req.body || {});
    res.type("text/plain").send(ok ? "success" : "fail");
  } catch (err) {
    log.error("Alipay notify handling failed", err);
    res.type("text/plain").send("fail");
  }
});

notifyRouter.post("/pay/notify/wechat", express.raw({ type: "*/*", limit: "64kb" }), (req, res) => {
  try {
    const ok = billing.handleWechatNotify(req.headers, Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "");
    if (ok) return res.status(204).end();
    res.status(401).json({ code: "FAIL", message: "signature verification failed" });
  } catch (err) {
    log.error("WeChat Pay notify handling failed", err);
    res.status(500).json({ code: "FAIL", message: "internal error" });
  }
});

import express from "express";
import { db, tx } from "../db.js";
import * as settings from "../services/settings.js";
import * as channels from "../services/channels.js";
import * as library from "../services/library.js";
import * as taxonomy from "../services/taxonomy.js";
import * as assetJobs from "../services/asset-jobs.js";
import * as uploads from "../services/uploads.js";
import * as generations from "../services/generations.js";
import * as billing from "../services/billing.js";
import * as credits from "../services/credits.js";
import * as reports from "../services/reports.js";
import * as stats from "../services/stats.js";
import * as auth from "../services/auth.js";
import * as worker from "../services/worker.js";
import { providerFor, ProviderError } from "../services/providers/index.js";
import { watermarkPreview, finalizeImage } from "../services/image-post.js";
import { sizeForChannel } from "../services/sizes.js";
import { sendMail, mailEnabled } from "../services/mailer.js";
import { audit, listAudit } from "../services/audit.js";
import { requireAdmin, uploadSingle } from "../middleware.js";
import { badRequest, notFound } from "../lib/errors.js";
import { hashPassword } from "../lib/crypto.js";
import * as v from "../lib/validate.js";

export const router = express.Router();
router.use("/admin", requireAdmin);

// ---------- dashboard

router.get("/admin/overview", (req, res) => {
  res.json({ ...stats.overview({ days: Number(req.query.days) || 30 }), worker: worker.stats() });
});

// ---------- settings

const GROUPS = ["site", "auth", "generation", "prompt", "safety", "library", "assets", "payment", "mail", "legal"];

router.get("/admin/settings/:group", (req, res) => {
  const group = v.oneOf(req.params.group, "group", GROUPS);
  const defaults = group === "prompt" || group === "assets" ? settings.DEFAULTS[group] : undefined;
  res.json({ group, value: settings.getForAdmin(group), defaults });
});

router.put("/admin/settings/:group", (req, res) => {
  const group = v.oneOf(req.params.group, "group", GROUPS);
  const value = settings.update(group, req.body?.value);
  if (group === "safety" || group === "library" || group === "assets") library.invalidate();
  audit(req, "settings.update", "settings", group);
  res.json({ group, value });
});

router.post("/admin/settings/mail/test", async (req, res) => {
  if (!mailEnabled()) throw badRequest("MAIL_DISABLED", "请先启用并保存邮件设置");
  const to = v.email(req.body?.to || req.user.email, "to");
  try {
    await sendMail({ to, subject: "测试邮件", text: "这是一封测试邮件。收到说明 SMTP 配置正确。" });
  } catch (err) {
    throw badRequest("MAIL_FAILED", `发送失败：${err.message}`);
  }
  res.json({ ok: true });
});

router.get("/admin/watermark-preview.png", async (req, res) => {
  res.set("Cache-Control", "no-store").type("image/png").send(await watermarkPreview());
});

// ---------- channels

router.get("/admin/channels", (req, res) => {
  res.json({ items: channels.list(), models: channels.KNOWN_MODELS });
});

router.post("/admin/channels", (req, res) => {
  const channel = channels.create(req.body || {});
  audit(req, "channel.create", "channel", channel.id, { name: channel.name, model: channel.model });
  res.status(201).json({ channel });
});

router.put("/admin/channels/:id", (req, res) => {
  const channel = channels.update(Number(req.params.id), req.body || {});
  audit(req, "channel.update", "channel", channel.id, { name: channel.name, model: channel.model, enabled: channel.enabled });
  res.json({ channel });
});

router.delete("/admin/channels/:id", (req, res) => {
  channels.remove(Number(req.params.id));
  audit(req, "channel.delete", "channel", req.params.id);
  res.json({ ok: true });
});

// "ping" lists models (free); "generate" makes one real low-quality image.
router.post("/admin/channels/:id/test", async (req, res) => {
  const channel = channels.get(Number(req.params.id));
  const mode = req.body?.mode === "generate" ? "generate" : "ping";
  const provider = providerFor(channel);
  if (mode === "ping") return res.json(await provider.ping(channel));
  const started = Date.now();
  try {
    const size = sizeForChannel("1:1", "standard", channel.options.sizeMode);
    const result = await provider.run(channel, {
      prompt: "A small ceramic cup of green tea on a wooden table, soft daylight, simple product photo.",
      images: [], size, quality: "low", n: 1, moderation: "auto", outputFormat: "png", outputCompression: 90,
      safetyIdentifier: undefined, timeoutSec: settings.get("generation").requestTimeoutSec
    });
    const final = await finalizeImage(result.images[0], { imageId: "test", generationId: "admin-test" });
    channels.markSuccess(channel.id);
    res.json({
      ok: true, ms: Date.now() - started, size: result.size, usage: result.usage,
      message: `生成成功，耗时 ${((Date.now() - started) / 1000).toFixed(1)} 秒`,
      image: `data:image/webp;base64,${final.thumb.toString("base64")}`
    });
  } catch (err) {
    const message = err instanceof ProviderError ? `${err.code || err.kind}：${err.message}` : err.message;
    channels.markFailure(channel.id, message);
    res.json({ ok: false, ms: Date.now() - started, message });
  }
});

// ---------- users

router.get("/admin/users", (req, res) => {
  const { offset, size } = v.page(req.query, { defaultSize: 30 });
  const q = String(req.query.q || "").trim();
  const where = ["1 = 1"];
  const params = [];
  if (q) { where.push("(email LIKE ? OR nickname LIKE ? OR CAST(id AS TEXT) = ? OR invite_code = ?)"); params.push(`%${q}%`, `%${q}%`, q, q.toUpperCase()); }
  if (req.query.role) { where.push("role = ?"); params.push(String(req.query.role)); }
  if (req.query.status) { where.push("status = ?"); params.push(String(req.query.status)); }
  const sql = where.join(" AND ");
  const total = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE ${sql}`).get(...params).n;
  const items = db.prepare(`SELECT u.*,
      (SELECT COUNT(*) FROM generations g WHERE g.user_id = u.id) AS generations,
      (SELECT COALESCE(SUM(amount_cents), 0) FROM orders o WHERE o.user_id = u.id AND o.status = 'paid') AS paid_cents
    FROM users u WHERE ${sql} ORDER BY u.id DESC LIMIT ? OFFSET ?`).all(...params, size, offset)
    .map((u) => ({ ...auth.publicUser(u), lastLoginAt: u.last_login_at, lastLoginIp: u.last_login_ip,
      signupIp: u.signup_ip, note: u.note, generations: u.generations, paidCents: u.paid_cents }));
  res.json({ total, items });
});

router.get("/admin/users/:id", (req, res) => {
  const user = auth.getUser(Number(req.params.id));
  const ledger = credits.listLedger(user.id, { offset: 0, size: 30 });
  const orders = billing.listOrders(user.id, { offset: 0, size: 20 });
  const gens = generations.adminList({ userId: user.id, offset: 0, size: 12 });
  const invited = db.prepare("SELECT id, email, created_at FROM users WHERE referred_by = ? ORDER BY id DESC LIMIT 20").all(user.id);
  const referrer = user.referred_by ? db.prepare("SELECT id, email FROM users WHERE id = ?").get(user.referred_by) : null;
  res.json({
    user: { ...auth.publicUser(user), lastLoginAt: user.last_login_at, lastLoginIp: user.last_login_ip,
      signupIp: user.signup_ip, note: user.note, referrer },
    ledger, orders, generations: gens, invited
  });
});

router.patch("/admin/users/:id", (req, res) => {
  const user = auth.getUser(Number(req.params.id));
  const patch = {};
  if (req.body?.role !== undefined) {
    patch.role = v.oneOf(req.body.role, "role", ["user", "admin"]);
    if (user.id === req.user.id && patch.role !== "admin") throw badRequest("SELF_DEMOTE", "不能取消自己的管理员权限");
  }
  if (req.body?.status !== undefined) {
    patch.status = v.oneOf(req.body.status, "status", ["active", "banned"]);
    if (user.id === req.user.id && patch.status === "banned") throw badRequest("SELF_BAN", "不能停用自己的账号");
  }
  if (req.body?.nickname !== undefined) patch.nickname = v.str(req.body.nickname, "nickname", { min: 1, max: 20 });
  if (req.body?.note !== undefined) patch.note = v.str(req.body.note, "note", { optional: true, max: 500 });
  if (req.body?.emailVerified !== undefined) patch.email_verified = req.body.emailVerified ? 1 : 0;
  const keys = Object.keys(patch);
  if (keys.length) {
    db.prepare(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
      .run(...keys.map((k) => patch[k]), Date.now(), user.id);
    if (patch.status === "banned") auth.destroyUserSessions(user.id);
    if (patch.email_verified) auth.grantSignupRewards(user.id);
    // Shared assets show the owner's nickname and hide while the owner is banned.
    if (patch.status || patch.nickname) library.invalidate();
  }
  audit(req, "user.update", "user", user.id, patch);
  res.json({ user: auth.publicUser(auth.getUser(user.id)) });
});

router.post("/admin/users/:id/credits", (req, res) => {
  const user = auth.getUser(Number(req.params.id));
  const delta = v.int(req.body?.delta, "delta", { min: -10_000_000, max: 10_000_000 });
  if (delta === 0) throw badRequest("INVALID_INPUT", "调整数量不能为 0");
  const reason = v.str(req.body?.reason, "reason", { min: 1, max: 100, message: "请填写调整原因" });
  const balance = credits.adjust(user.id, delta, "admin", { refType: "admin", refId: req.user.id, note: reason });
  audit(req, "user.credits", "user", user.id, { delta, reason, balance });
  res.json({ balance });
});

router.post("/admin/users/:id/password", async (req, res) => {
  const user = auth.getUser(Number(req.params.id));
  const password = v.password(req.body?.password);
  db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(await hashPassword(password), Date.now(), user.id);
  auth.destroyUserSessions(user.id);
  audit(req, "user.password_reset", "user", user.id);
  res.json({ ok: true });
});

// ---------- generations

router.get("/admin/generations", (req, res) => {
  const { offset, size } = v.page(req.query, { defaultSize: 24, maxSize: 60 });
  res.json(generations.adminList({
    status: req.query.status ? String(req.query.status) : "", userId: req.query.userId,
    kind: ["work", "asset"].includes(req.query.kind) ? req.query.kind : "",
    q: String(req.query.q || "").trim(), isPublic: String(req.query.public || ""), offset, size
  }));
});

router.patch("/admin/generations/:id", (req, res) => {
  const patch = {};
  for (const key of ["hidden", "featured", "approved"]) if (req.body?.[key] !== undefined) patch[key] = !!req.body[key];
  generations.adminUpdate(req.params.id, patch);
  audit(req, "generation.update", "generation", req.params.id, patch);
  res.json({ ok: true });
});

router.delete("/admin/generations/:id", (req, res) => {
  generations.adminDelete(req.params.id);
  audit(req, "generation.delete", "generation", req.params.id);
  res.json({ ok: true });
});

// ---------- orders and packages

router.get("/admin/orders", (req, res) => {
  const { offset, size } = v.page(req.query, { defaultSize: 30 });
  res.json(billing.adminListOrders({ status: String(req.query.status || ""), q: String(req.query.q || "").trim(), offset, size }));
});

router.post("/admin/orders/:id/mark-paid", (req, res) => {
  const result = billing.markPaid(String(req.params.id), { tradeNo: String(req.body?.tradeNo || "").slice(0, 64), source: `admin#${req.user.id}` });
  audit(req, "order.mark_paid", "order", req.params.id, { already: result.already });
  res.json(result);
});

router.post("/admin/orders/:id/refund", (req, res) => {
  const order = billing.adminMarkRefunded(req.params.id, req.body?.note);
  audit(req, "order.refund", "order", req.params.id, { note: req.body?.note });
  res.json({ order });
});

router.get("/admin/packages", (req, res) => res.json({ items: billing.listPackages({ includeDisabled: true }) }));

router.post("/admin/packages", (req, res) => {
  const pkg = billing.createPackage(req.body || {});
  audit(req, "package.create", "package", pkg.id, pkg);
  res.status(201).json({ package: pkg });
});

router.put("/admin/packages/:id", (req, res) => {
  const pkg = billing.updatePackage(Number(req.params.id), req.body || {});
  audit(req, "package.update", "package", pkg.id, pkg);
  res.json({ package: pkg });
});

router.delete("/admin/packages/:id", (req, res) => {
  const result = billing.deletePackage(Number(req.params.id));
  audit(req, "package.delete", "package", req.params.id, result);
  res.json(result);
});

// ---------- redeem codes

router.get("/admin/redeem", (req, res) => {
  const { offset, size } = v.page(req.query, { defaultSize: 50, maxSize: 200 });
  res.json(billing.listRedeemCodes({ batch: String(req.query.batch || ""), status: String(req.query.status || ""),
    q: String(req.query.q || "").trim(), offset, size }));
});

router.post("/admin/redeem", (req, res) => {
  const result = billing.createRedeemBatch(req.body || {}, req.user.id);
  audit(req, "redeem.create", "redeem_batch", result.batch, { count: result.codes.length, credits: result.credits });
  res.status(201).json(result);
});

router.patch("/admin/redeem/:id", (req, res) => {
  billing.setRedeemStatus(req.params.id, req.body?.status);
  audit(req, "redeem.status", "redeem", req.params.id, { status: req.body?.status });
  res.json({ ok: true });
});

router.get("/admin/redeem/export.csv", (req, res) => {
  const batch = v.str(req.query.batch, "batch", { min: 1, max: 40 });
  const rows = billing.exportBatch(batch);
  if (!rows.length) throw notFound("批次不存在");
  const csv = ["code,credits,status,expires_at,note",
    ...rows.map((r) => [r.code, r.credits, r.status, r.expires_at ? new Date(r.expires_at).toISOString() : "",
      `"${String(r.note || "").replace(/"/g, "\"\"")}"`].join(","))].join("\r\n");
  audit(req, "redeem.export", "redeem_batch", batch, { count: rows.length });
  res.attachment(`redeem-${batch}.csv`).type("text/csv").send("﻿" + csv);
});

// ---------- assets

router.get("/admin/assets", (req, res) => {
  const { offset, size } = v.page(req.query, { defaultSize: 48, maxSize: 200 });
  const q = req.query;
  res.json(library.adminList({
    type: q.type, rating: q.rating, enabled: q.enabled, series: q.series, category: q.category, q: q.q,
    source: q.source, origin: q.origin, license: q.license, review: q.review, ownerId: q.ownerId
  }, { offset, size }));
});

router.get("/admin/assets/facets", (req, res) => res.json(library.adminFacets()));

router.patch("/admin/assets/:id", (req, res) => {
  const asset = library.updateAsset(req.params.id, req.body || {});
  audit(req, "asset.update", "asset", req.params.id, req.body);
  res.json({ asset });
});

router.post("/admin/assets/bulk", (req, res) => {
  const result = library.bulkUpdate({ ids: req.body?.ids, filter: req.body?.filter }, req.body?.set || {});
  audit(req, "asset.bulk", "asset", null, { filter: req.body?.filter, count: result.changed, set: req.body?.set });
  res.json(result);
});

router.post("/admin/assets/upload", uploadSingle, async (req, res) => {
  const b = req.body || {};
  const asset = await library.createCustomAsset({
    type: b.type, categoryId: b.categoryId, category: b.category, categoryZh: b.categoryZh, categoryEn: b.categoryEn,
    nameZh: b.nameZh, nameEn: b.nameEn, keywords: b.keywords, rating: b.rating || "general", license: b.license || "commercial",
    series: b.series, seriesZh: b.seriesZh, seriesEn: b.seriesEn, people: b.people
  }, req.file);
  audit(req, "asset.create", "asset", asset.id);
  res.status(201).json({ asset });
});

router.delete("/admin/assets/:id", (req, res) => {
  library.deleteCustomAsset(req.params.id);
  audit(req, "asset.delete", "asset", req.params.id);
  res.json({ ok: true });
});

// Generation details of one asset: the job that made it and what it used.
router.get("/admin/assets/:id/info", (req, res) => {
  res.json(assetJobs.assetInfo(req.params.id, { admin: true }));
});

// ---------- virtual persons

router.get("/admin/virtual-persons", (req, res) => {
  const { offset, size } = v.page(req.query, { defaultSize: 24, maxSize: 60 });
  const status = ["pending", "approved", "rejected"].includes(req.query.status) ? req.query.status : "";
  res.json(uploads.listVirtual({ status, offset, size }));
});

router.post("/admin/virtual-persons/:id", (req, res) => {
  const approve = req.body?.action === "approve";
  if (!approve && req.body?.action !== "reject") throw badRequest("INVALID_INPUT", "处理方式不正确");
  const upload = uploads.reviewVirtual(req.params.id, { approve, note: req.body?.note });
  audit(req, approve ? "virtual.approve" : "virtual.reject", "upload", req.params.id, { note: req.body?.note });
  res.json({ upload });
});

// ---------- asset generation

router.post("/admin/asset-jobs", (req, res) => {
  const items = assetJobs.createJobs(req.user, req.body || {}, { admin: true, ip: req.ip });
  worker.kick();
  audit(req, "asset.generate", "generation", items.map((j) => j.id).join(","),
    { type: items[0]?.type, category: items[0]?.category, n: items.reduce((n, j) => n + j.n, 0) });
  res.status(201).json({ items });
});

router.get("/admin/asset-jobs", (req, res) => {
  const ids = String(req.query.ids || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 50);
  if (ids.length) return res.json({ items: assetJobs.listJobs({ ids, admin: true }) });
  const { offset, size } = v.page(req.query, { defaultSize: 20, maxSize: 60 });
  res.json(assetJobs.listJobs({
    admin: true, offset, size,
    status: ["active", "succeeded", "failed"].includes(req.query.status) ? req.query.status : "",
    scope: ["platform", "user"].includes(req.query.scope) ? req.query.scope : "",
    type: library.ASSET_TYPES.includes(req.query.type) ? req.query.type : ""
  }));
});

// ---------- asset categories

function categoryTree(type) {
  const count = (node) => library.categoryUsage(taxonomy.get(node.id));
  return taxonomy.tree(type, { admin: true }).map((major) => ({
    ...major, count: count(major), children: major.children.map((c) => ({ ...c, count: count(c) }))
  }));
}

router.get("/admin/asset-categories", (req, res) => {
  res.json(Object.fromEntries(library.ASSET_TYPES.map((type) => [type, categoryTree(type)])));
});

router.post("/admin/asset-categories", (req, res) => {
  const row = taxonomy.create(req.body || {});
  library.invalidate();
  audit(req, "category.create", "category", row.id, { type: row.type, key: row.key, name: row.name_zh });
  res.status(201).json({ category: taxonomy.dto(row) });
});

router.put("/admin/asset-categories/:id", (req, res) => {
  const row = taxonomy.update(req.params.id, req.body || {});
  library.invalidate();
  audit(req, "category.update", "category", row.id, req.body);
  res.json({ category: taxonomy.dto(row) });
});

router.delete("/admin/asset-categories/:id", (req, res) => {
  taxonomy.remove(req.params.id, library.categoryUsage);
  library.invalidate();
  audit(req, "category.delete", "category", req.params.id);
  res.json({ ok: true });
});

// ---------- reports and audit

router.get("/admin/reports", (req, res) => {
  const { offset, size } = v.page(req.query, { defaultSize: 30 });
  res.json(reports.list({ status: String(req.query.status || ""), offset, size }));
});

router.post("/admin/reports/:id/resolve", (req, res) => {
  const result = reports.resolve(req.params.id, { action: req.body?.action, note: req.body?.note }, req.user.id);
  audit(req, "report.resolve", "report", req.params.id, { action: req.body?.action });
  res.json(result);
});

router.get("/admin/audit", (req, res) => {
  const { offset, size } = v.page(req.query, { defaultSize: 50, maxSize: 200 });
  res.json(listAudit({ offset, size, action: String(req.query.action || "").trim() }));
});

// Bulk credit grant, e.g. compensation after an outage.
router.post("/admin/credits/grant-all", (req, res) => {
  const amount = v.int(req.body?.amount, "amount", { min: 1, max: 100_000 });
  const reason = v.str(req.body?.reason, "reason", { min: 1, max: 100, message: "请填写原因" });
  const ids = db.prepare("SELECT id FROM users WHERE status = 'active'").all().map((r) => r.id);
  tx(() => { for (const id of ids) credits.adjust(id, amount, "admin", { refType: "admin", refId: req.user.id, note: reason }); })();
  audit(req, "credits.grant_all", "user", null, { amount, reason, users: ids.length });
  res.json({ users: ids.length });
});

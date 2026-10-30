import express from "express";
import * as uploads from "../services/uploads.js";
import * as generations from "../services/generations.js";
import * as reports from "../services/reports.js";
import * as worker from "../services/worker.js";
import { requireUser, uploadSingle } from "../middleware.js";
import { enforce } from "../lib/rate-limit.js";
import * as v from "../lib/validate.js";

export const router = express.Router();

router.post("/uploads", requireUser, uploadSingle, async (req, res) => {
  enforce(`upload:${req.user.id}`, 40, 10 * 60 * 1000, "上传太频繁，请稍后再试");
  const kind = v.oneOf(req.body?.kind, "kind", ["person", "outfit"]);
  const upload = await uploads.saveUpload(req.user, kind, req.file, { consent: v.bool(req.body?.consent) });
  res.status(201).json({ upload });
});

router.get("/uploads", requireUser, (req, res) => {
  const kind = v.oneOf(req.query.kind, "kind", ["person", "outfit"]);
  res.json({ items: uploads.listUploads(req.user, kind) });
});

router.delete("/uploads/:id", requireUser, (req, res) => {
  uploads.deleteUpload(req.user, req.params.id);
  res.json({ ok: true });
});

const body = (req) => ({
  poseId: req.body?.poseId || null,
  outfitId: req.body?.outfitId || null,
  outfitUploadId: req.body?.outfitUploadId || null,
  personUploadId: req.body?.personUploadId || null,
  prompt: req.body?.prompt,
  style: req.body?.style || "",
  scene: req.body?.scene || "",
  ratio: req.body?.ratio,
  tier: req.body?.tier,
  quality: req.body?.quality,
  n: req.body?.n
});

router.post("/generations/estimate", requireUser, (req, res) => {
  res.json(generations.estimate(req.user, body(req)));
});

router.post("/generations", requireUser, (req, res) => {
  const generation = generations.create(req.user, body(req), { ip: req.ip });
  worker.kick();
  res.status(201).json({ generation });
});

router.get("/generations", requireUser, (req, res) => {
  const { offset, size } = v.page(req.query, { defaultSize: 24, maxSize: 60 });
  res.json(generations.listOwned(req.user, { status: String(req.query.status || ""), offset, size }));
});

router.get("/generations/status", requireUser, (req, res) => {
  const ids = String(req.query.ids || "").split(",").map((s) => s.trim()).filter(Boolean);
  res.json({ items: generations.statusOf(req.user, ids) });
});

router.get("/generations/:id", requireUser, (req, res) => {
  res.json({ generation: generations.getOwned(req.user, req.params.id) });
});

router.delete("/generations/:id", requireUser, (req, res) => {
  generations.softDelete(req.user, req.params.id);
  res.json({ ok: true });
});

router.post("/generations/:id/publish", requireUser, (req, res) => {
  res.json({ generation: generations.setPublic(req.user, req.params.id, v.bool(req.body?.public)) });
});

router.post("/reports", requireUser, (req, res) => {
  res.status(201).json(reports.create(req.user, {
    generationId: req.body?.generationId, reason: req.body?.reason, detail: req.body?.detail
  }));
});

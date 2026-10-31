import express from "express";
import * as library from "../services/library.js";
import * as assetJobs from "../services/asset-jobs.js";
import * as worker from "../services/worker.js";
import { requireUser } from "../middleware.js";
import * as v from "../lib/validate.js";

// A user's own assets: generating them, sharing them and setting a price.
export const router = express.Router();
router.use("/my", requireUser);

const typeOf = (value) => (library.ASSET_TYPES.includes(value) ? value : "");

router.get("/my/assets", (req, res) => {
  const { offset, size } = v.page(req.query, { defaultSize: 48, maxSize: 96 });
  res.json({
    ...library.listOwned(req.user.id, { type: typeOf(req.query.type), offset, size }),
    summary: library.ownerSummary(req.user.id)
  });
});

// Generation details of one of the user's assets.
router.get("/my/assets/:id/info", (req, res) => {
  res.json(assetJobs.assetInfo(req.params.id, { userId: req.user.id }));
});

router.patch("/my/assets/:id", (req, res) => {
  const asset = library.updateOwned(req.user, req.params.id, {
    name: req.body?.name, visibility: req.body?.visibility, price: req.body?.price
  });
  res.json({ asset });
});

router.delete("/my/assets/:id", (req, res) => {
  library.deleteOwned(req.user, req.params.id);
  res.json({ ok: true });
});

router.post("/my/asset-jobs", (req, res) => {
  const items = assetJobs.createJobs(req.user, req.body || {}, { ip: req.ip });
  worker.kick();
  res.status(201).json({ items });
});

// ?ids=a,b for polling, otherwise the most recent jobs.
router.get("/my/asset-jobs", (req, res) => {
  const ids = String(req.query.ids || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 50);
  if (ids.length) return res.json({ items: assetJobs.listJobs({ ids, userId: req.user.id }) });
  const { offset, size } = v.page(req.query, { defaultSize: 12, maxSize: 50 });
  res.json(assetJobs.listJobs({ userId: req.user.id, offset, size, type: typeOf(req.query.type),
    status: ["active", "succeeded", "failed"].includes(req.query.status) ? req.query.status : "" }));
});

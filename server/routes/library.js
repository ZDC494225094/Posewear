import express from "express";
import * as library from "../services/library.js";
import { notFound } from "../lib/errors.js";
import * as v from "../lib/validate.js";

export const router = express.Router();

const viewerOf = (req) => ({ loggedIn: !!req.user });
const text = (value, max = 80) => (typeof value === "string" ? value.trim().slice(0, max) : "");

router.get("/library/meta", (req, res) => {
  res.json(library.meta(viewerOf(req)));
});

router.get("/library/poses", (req, res) => {
  const { offset, size } = v.page(req.query, { defaultSize: 48, maxSize: 96 });
  res.json(library.queryPoses({
    series: text(req.query.series), category: text(req.query.category), angle: text(req.query.angle),
    q: text(req.query.q, 60), view: req.query.view === "image" ? "image" : "group"
  }, viewerOf(req), { offset, limit: size }));
});

router.get("/library/outfits", (req, res) => {
  const { offset, size } = v.page(req.query, { defaultSize: 48, maxSize: 96 });
  res.json(library.queryOutfits({ category: text(req.query.category), q: text(req.query.q, 60) },
    viewerOf(req), { offset, limit: size }));
});

router.get("/library/random", (req, res) => {
  const item = library.random({
    type: req.query.type === "outfit" ? "outfit" : "pose",
    series: text(req.query.series), category: text(req.query.category),
    includeDuo: v.bool(req.query.duo), forAI: v.bool(req.query.forAI, true), withPerson: v.bool(req.query.withPerson),
    exclude: text(req.query.exclude, 120)
  }, viewerOf(req));
  res.json({ item });
});

router.get("/library/assets/:id", (req, res) => {
  const asset = library.getAsset(req.params.id);
  if (!asset || !library.visible(asset, viewerOf(req))) throw notFound("素材不存在");
  res.json({ asset: library.dto(asset), angles: library.angles(asset, viewerOf(req)) });
});

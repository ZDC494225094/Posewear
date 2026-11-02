import express from "express";
import * as library from "../services/library.js";
import * as taxonomy from "../services/taxonomy.js";
import * as guard from "../services/access-guard.js";
import { CSRF_COOKIE } from "../middleware.js";
import { notFound } from "../lib/errors.js";
import * as v from "../lib/validate.js";

export const router = express.Router();

// The viewer of this request, worked out once (unlocking reads the user's orders).
export function viewerOf(req) {
  if (!req.viewer) req.viewer = library.viewerFor(req.user, req.cookies?.[CSRF_COOKIE]);
  return req.viewer;
}

// Listing is rate limited too, so a script can't page through the library.
router.use("/library", (req, res, next) => {
  guard.check(req, "list", viewerOf(req).key);
  next();
});
const text = (value, max = 80) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const origin = (value) => (["platform", "user", "mine"].includes(value) ? value : "");
const license = (value) => (["commercial", "noncommercial"].includes(value) ? value : "");

router.get("/library/meta", (req, res) => {
  res.json(library.meta(viewerOf(req)));
});

// The category tree for filters and the asset generator.
router.get("/library/taxonomy", (req, res) => {
  const admin = req.user?.role === "admin";
  res.json({
    ...Object.fromEntries(library.ASSET_TYPES.map((type) => [type, taxonomy.tree(type, { admin, forUser: !admin })])),
    angles: library.ANGLES
  });
});

router.get("/library/poses", (req, res) => {
  const { offset, size } = v.page(req.query, { defaultSize: 48, maxSize: 96 });
  res.json(library.queryPoses({
    series: text(req.query.series), category: text(req.query.category), angle: text(req.query.angle),
    q: text(req.query.q, 60), view: req.query.view === "image" ? "image" : "group",
    origin: origin(req.query.origin), license: license(req.query.license)
  }, viewerOf(req), { offset, limit: size }));
});

// Outfits, scenes, items, portraits and hair share one listing.
for (const [path, type] of [["outfits", "outfit"], ["scenes", "scene"], ["items", "item"], ["faces", "face"], ["hairs", "hair"]]) {
  router.get(`/library/${path}`, (req, res) => {
    const { offset, size } = v.page(req.query, { defaultSize: 48, maxSize: 96 });
    res.json(library.queryFlat(type, {
      series: text(req.query.series), category: text(req.query.category), q: text(req.query.q, 60),
      origin: origin(req.query.origin), license: license(req.query.license)
    }, viewerOf(req), { offset, limit: size }));
  });
}

router.get("/library/random", (req, res) => {
  const item = library.random({
    type: library.ASSET_TYPES.includes(req.query.type) ? req.query.type : "pose",
    series: text(req.query.series), category: text(req.query.category),
    includeDuo: v.bool(req.query.duo), forAI: v.bool(req.query.forAI, true), withPerson: v.bool(req.query.withPerson),
    exclude: text(req.query.exclude, 120)
  }, viewerOf(req));
  res.json({ item });
});

router.get("/library/assets/:id", (req, res) => {
  const asset = library.getAsset(req.params.id);
  const viewer = viewerOf(req);
  if (!asset || !library.visible(asset, viewer)) throw notFound("素材不存在");
  res.json({ asset: library.dto(asset, viewer), angles: library.angles(asset, viewer) });
});

// Several assets by id, e.g. to renew the image links of what is on the studio.
// Missing or hidden ones come back as null, in the same order.
router.get("/library/assets", (req, res) => {
  const viewer = viewerOf(req);
  const ids = String(req.query.ids || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 12);
  res.json({ items: ids.map((id) => {
    const asset = library.getAsset(id);
    return asset && library.visible(asset, viewer) ? library.dto(asset, viewer) : null;
  }) });
});

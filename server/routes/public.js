import express from "express";
import * as settings from "../services/settings.js";
import * as library from "../services/library.js";
import * as generations from "../services/generations.js";
import * as billing from "../services/billing.js";
import { notFound } from "../lib/errors.js";
import * as v from "../lib/validate.js";

export const router = express.Router();

const viewerOf = (req) => ({ loggedIn: !!req.user, userId: req.user?.id ?? null });

router.get("/public/config", (req, res) => {
  const cfg = settings.publicConfig();
  const meta = library.meta(viewerOf(req));
  res.json({ ...cfg, library: { ...cfg.library, poses: meta.pose.total, poseGroups: meta.pose.groups, outfits: meta.outfit.total,
    scenes: meta.scene.total, items: meta.item.total } });
});

const LEGAL = {
  terms: { key: "terms", title: "用户服务协议" },
  privacy: { key: "privacy", title: "隐私政策" },
  "content-policy": { key: "contentPolicy", title: "内容规范" }
};

router.get("/public/legal/:slug", (req, res) => {
  const page = LEGAL[req.params.slug];
  if (!page) throw notFound("页面不存在");
  res.set("Cache-Control", "public, max-age=300");
  res.json({ title: page.title, content: settings.get("legal")[page.key] });
});

router.get("/public/showcase", (req, res) => {
  const { offset, size } = v.page(req.query, { defaultSize: 24, maxSize: 60 });
  res.json(generations.showcase({ offset, size }));
});

// Home page data: real pose + outfit = result examples for the hero, featured
// and recent works, and packages.
router.get("/public/home", (req, res) => {
  res.json({
    combos: generations.homeCombos(viewerOf(req), 6),
    featured: generations.featuredForHome(8),
    recent: generations.showcase({ offset: 0, size: 8 }).items,
    packages: billing.listPackages().slice(0, 3)
  });
});

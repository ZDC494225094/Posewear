import express from "express";
import * as settings from "../services/settings.js";
import * as library from "../services/library.js";
import * as generations from "../services/generations.js";
import * as billing from "../services/billing.js";
import { notFound } from "../lib/errors.js";
import * as v from "../lib/validate.js";

export const router = express.Router();

router.get("/public/config", (req, res) => {
  const cfg = settings.publicConfig();
  const meta = library.meta({ loggedIn: !!req.user });
  res.json({ ...cfg, library: { ...cfg.library, poses: meta.pose.total, poseGroups: meta.pose.groups, outfits: meta.outfit.total } });
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

// Home page data: featured works, plus random pose/outfit pairs for the hero.
router.get("/public/home", (req, res) => {
  const viewer = { loggedIn: !!req.user };
  const pairs = [];
  for (let i = 0; i < 4; i++) {
    const pose = library.random({ type: "pose", forAI: true, withPerson: true }, viewer);
    const outfit = library.random({ type: "outfit", forAI: true, withPerson: true }, viewer);
    if (pose && outfit) pairs.push({ pose, outfit });
  }
  res.json({
    featured: generations.featuredForHome(8),
    recent: generations.showcase({ offset: 0, size: 8 }).items,
    pairs,
    packages: billing.listPackages().slice(0, 3)
  });
});

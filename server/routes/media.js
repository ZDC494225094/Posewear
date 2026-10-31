import express from "express";
import fs from "node:fs";
import sharp from "sharp";
import { db } from "../db.js";
import * as library from "../services/library.js";
import * as settings from "../services/settings.js";
import { uploadFile } from "../services/uploads.js";
import { imageFile } from "../services/generations.js";
import * as wedding from "../services/wedding.js";
import { notFound, unauthorized, forbidden } from "../lib/errors.js";

export const router = express.Router();

function send(res, file, { cacheControl, downloadName } = {}) {
  if (!file || !fs.existsSync(file)) throw notFound("图片不存在");
  if (cacheControl) res.set("Cache-Control", cacheControl);
  if (downloadName) res.attachment(downloadName);
  res.sendFile(file, { dotfiles: "deny", lastModified: true, cacheControl: !cacheControl });
}

router.get("/library/:id/:variant", (req, res) => {
  const { id, variant } = req.params;
  if (!["thumb", "preview", "original"].includes(variant)) throw notFound();
  const asset = library.getAsset(id);
  const isAdmin = req.user?.role === "admin";
  if (!asset || (!isAdmin && !library.visible(asset, { loggedIn: !!req.user, userId: req.user?.id }))) {
    throw notFound("素材不存在");
  }
  if (variant === "original" && !isAdmin) {
    const policy = settings.get("library").originalDownload;
    if (policy === "disabled") throw forbidden("原图下载未开放", "DOWNLOAD_DISABLED");
    if (policy === "login" && !req.user) throw unauthorized("登录后可下载原图");
  }
  const file = library.assetFile(asset, variant);
  const ext = (file || "").split(".").pop();
  // Users' assets can turn private at any time, so shared caches never keep them.
  send(res, file, {
    cacheControl: variant === "original" || asset.owner_id ? "private, max-age=3600" : "public, max-age=604800",
    downloadName: variant === "original" && req.query.download ? `${asset.id}.${ext}` : undefined
  });
});

function ownUpload(req) {
  if (!req.user) throw unauthorized();
  const row = db.prepare("SELECT * FROM uploads WHERE id = ?").get(String(req.params.id));
  if (!row || row.deleted_at || (row.user_id !== req.user.id && req.user.role !== "admin")) throw notFound("图片不存在");
  return row;
}

router.get("/uploads/:id", (req, res) => {
  send(res, uploadFile(ownUpload(req)), { cacheControl: "private, max-age=3600" });
});

// Small version for pickers and history lists, made on request.
router.get("/uploads/:id/thumb", async (req, res) => {
  const file = uploadFile(ownUpload(req));
  if (!fs.existsSync(file)) throw notFound("图片不存在");
  const buffer = await sharp(file).resize({ width: 360, height: 480, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 }).toBuffer();
  res.set("Cache-Control", "private, max-age=3600").type("image/webp").send(buffer);
});

// Sample photos of the wedding scenes: public while the scene is online.
router.get("/wedding/sample/:imageId/:variant", (req, res) => {
  if (!["full", "thumb"].includes(req.params.variant)) throw notFound();
  send(res, wedding.sampleFile(req.params.imageId, req.params.variant), { cacheControl: "public, max-age=86400" });
});

// Generated images: owner and admins always; others only for public works.
router.get("/gen/:imageId/:variant", (req, res) => {
  const { imageId, variant } = req.params;
  if (!["full", "thumb"].includes(variant)) throw notFound();
  const row = db.prepare(`SELECT i.*, g.user_id AS owner, g.is_public, g.hidden, g.deleted_at, g.approved
    FROM generation_images i JOIN generations g ON g.id = i.generation_id WHERE i.id = ?`).get(String(imageId));
  if (!row || row.deleted_at) throw notFound("图片不存在");
  const isOwner = req.user && req.user.id === row.owner;
  const isAdmin = req.user?.role === "admin";
  const review = settings.get("safety").showcaseReview;
  const isPublic = row.is_public && !row.hidden && (!review || row.approved);
  if (!isOwner && !isAdmin && !isPublic) throw notFound("图片不存在");
  const file = imageFile(variant === "thumb" ? row.thumb_path : row.path);
  const site = settings.get("site").name.replace(/[^\p{L}\p{N}_-]+/gu, "") || "posewear";
  send(res, file, {
    cacheControl: isPublic ? "public, max-age=86400" : "private, max-age=86400",
    downloadName: req.query.download ? `${site}-${row.generation_id}-${row.idx + 1}.${row.format}` : undefined
  });
});

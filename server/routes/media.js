import express from "express";
import fs from "node:fs";
import sharp from "sharp";
import { db } from "../db.js";
import * as library from "../services/library.js";
import * as settings from "../services/settings.js";
import { uploadFile } from "../services/uploads.js";
import { imageFile, viewRel } from "../services/generations.js";
import * as wedding from "../services/wedding.js";
import * as guard from "../services/access-guard.js";
import { markPreview } from "../services/image-post.js";
import { CSRF_COOKIE } from "../middleware.js";
import { notFound, unauthorized, forbidden } from "../lib/errors.js";

export const router = express.Router();

function send(res, file, { cacheControl, downloadName } = {}) {
  if (!file || !fs.existsSync(file)) throw notFound("图片不存在");
  if (cacheControl) res.set("Cache-Control", cacheControl);
  if (downloadName) res.attachment(downloadName);
  res.sendFile(file, { dotfiles: "deny", lastModified: true, cacheControl: !cacheControl });
}

// Tiny blurred stand-ins for locked assets, kept in memory (a few hundred bytes each).
const blurs = new Map();
async function blurOf(asset) {
  let buffer = blurs.get(asset.id);
  if (!buffer) {
    const file = library.assetFile(asset, "thumb");
    if (!file || !fs.existsSync(file)) throw notFound("图片不存在");
    buffer = await sharp(file).resize({ width: 24, height: 24, fit: "inside" }).blur(1).webp({ quality: 40 }).toBuffer();
    if (blurs.size >= 6000) blurs.delete(blurs.keys().next().value);
    blurs.set(asset.id, buffer);
  }
  return buffer;
}

// Library images. Admins and an asset's owner use plain links; everyone else
// needs a signed link from the API (see library.mediaLink), which stops
// guessing ids, hotlinking and passing links around, and is rate limited.
router.get("/library/:id/:variant", async (req, res) => {
  const { id, variant } = req.params;
  if (!["thumb", "preview", "original", "blur"].includes(variant)) throw notFound();
  const asset = library.getAsset(id);
  const isAdmin = req.user?.role === "admin";
  if (!asset || (!isAdmin && !library.visible(asset, { loggedIn: !!req.user, userId: req.user?.id }))) {
    throw notFound("素材不存在");
  }
  res.set("X-Robots-Tag", "noindex");
  if (variant === "blur") {
    const buffer = await blurOf(asset);
    res.set("Cache-Control", "public, max-age=86400").type("image/webp").send(buffer);
    return;
  }
  const own = !!asset.owner_id && asset.owner_id === req.user?.id;
  const signed = !isAdmin && !own;
  let link = null;
  if (signed) {
    const key = library.viewerKey(req.user, req.cookies?.[CSRF_COOKIE]);
    link = library.checkLink(asset.id, variant, req.query.t, key);
    if (!link) throw forbidden("图片链接已失效，请刷新页面", "LINK_EXPIRED");
    guard.check(req, variant, key);
  }
  if (variant === "original" && !isAdmin) {
    const policy = settings.get("library").originalDownload;
    if (policy === "disabled") throw forbidden("原图下载未开放", "DOWNLOAD_DISABLED");
    if (policy === "login" && !req.user) throw unauthorized("登录后可下载原图");
  }
  const file = library.assetFile(asset, variant);
  if (variant === "preview" && link?.bound && settings.get("library").previewWatermark) {
    if (!file || !fs.existsSync(file)) throw notFound("图片不存在");
    const site = settings.get("site").name;
    const buffer = await markPreview(file, req.user ? `${site} · ${req.user.id}` : site);
    res.set("Cache-Control", "private, max-age=3600").type("image/webp").send(buffer);
    return;
  }
  const ext = (file || "").split(".").pop();
  // Signed links change every hour and users' assets can turn private at any
  // time, so shared caches never keep either.
  send(res, file, {
    cacheControl: signed || variant === "original" || asset.owner_id ? "private, max-age=3600" : "public, max-age=604800",
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

// The display-size copy of a generated image. Images made before it existed
// get one on first view.
const viewing = new Map();
async function viewFile(row) {
  const file = imageFile(viewRel(row.path));
  if (fs.existsSync(file)) return file;
  const full = imageFile(row.path);
  if (!fs.existsSync(full)) return null;
  if (!viewing.has(file)) {
    viewing.set(file, sharp(full, { limitInputPixels: 80_000_000 })
      .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toFile(file)
      .finally(() => viewing.delete(file)));
  }
  await viewing.get(file);
  return file;
}

// Generated images: owner and admins always; others only for public works.
router.get("/gen/:imageId/:variant", async (req, res) => {
  const { imageId, variant } = req.params;
  if (!["full", "thumb", "view"].includes(variant)) throw notFound();
  const row = db.prepare(`SELECT i.*, g.user_id AS owner, g.is_public, g.hidden, g.deleted_at, g.approved
    FROM generation_images i JOIN generations g ON g.id = i.generation_id WHERE i.id = ?`).get(String(imageId));
  if (!row || row.deleted_at) throw notFound("图片不存在");
  const isOwner = req.user && req.user.id === row.owner;
  const isAdmin = req.user?.role === "admin";
  const review = settings.get("safety").showcaseReview;
  const isPublic = row.is_public && !row.hidden && (!review || row.approved);
  if (!isOwner && !isAdmin && !isPublic) throw notFound("图片不存在");
  const file = variant === "view" ? await viewFile(row) : imageFile(variant === "thumb" ? row.thumb_path : row.path);
  const site = settings.get("site").name.replace(/[^\p{L}\p{N}_-]+/gu, "") || "posewear";
  send(res, file, {
    cacheControl: isPublic ? "public, max-age=86400" : "private, max-age=86400",
    downloadName: req.query.download ? `${site}-${row.generation_id}-${row.idx + 1}.${row.format}` : undefined
  });
});

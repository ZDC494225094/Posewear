import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { db } from "../db.js";
import { config } from "../config.js";
import * as settings from "./settings.js";
import { randomId } from "../lib/crypto.js";
import { badRequest, forbidden, notFound } from "../lib/errors.js";
import { DAY } from "../lib/time.js";

const root = path.join(config.dataDir, "uploads");
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export function uploadFile(row) {
  const full = path.resolve(root, row.path);
  if (!full.startsWith(path.resolve(root) + path.sep)) throw new Error("Invalid upload path");
  return full;
}

// Normalize every upload: decode with sharp (rejects non-images and
// decompression bombs), apply EXIF orientation, drop all metadata (GPS etc.),
// cap the size, and re-encode. The original bytes are never stored.
// Kinds: person (identity reference), outfit (one-off clothing reference) and
// reference (input for generating a library asset). People may appear in
// person and reference images, so both need consent and are kept briefly.
export async function saveUpload(user, kind, file, { consent = false } = {}) {
  const gen = settings.get("generation");
  if (!["person", "outfit", "reference"].includes(kind)) throw badRequest("INVALID_INPUT", "上传类型不正确");
  if (kind === "person" && !gen.allowPersonPhoto) throw forbidden("当前未开放人物照片功能", "PERSON_DISABLED");
  if (kind === "outfit" && !gen.allowOutfitUpload) throw forbidden("当前未开放自定义服装图片", "OUTFIT_UPLOAD_DISABLED");
  if (kind === "reference" && !settings.get("assets").userGeneration && user.role !== "admin") {
    throw forbidden("素材生成暂未开放", "ASSET_GEN_DISABLED");
  }
  if (kind === "person" && !consent) {
    throw badRequest("CONSENT_REQUIRED", "请先确认照片是你本人，或已获得照片中成年人的授权");
  }
  if (kind === "reference" && !consent) {
    throw badRequest("CONSENT_REQUIRED", "请先确认你拥有这张图片的使用权；图中如有他人，需已获得其授权");
  }
  if (!file?.buffer?.length) throw badRequest("FILE_REQUIRED", "请选择要上传的图片");

  const input = sharp(file.buffer, { limitInputPixels: 60_000_000, failOn: "error" });
  const meta = await input.metadata().catch(() => null);
  if (!meta || !["jpeg", "png", "webp", "heif", "avif"].includes(meta.format)) {
    throw badRequest("INVALID_IMAGE", "仅支持 JPG、PNG、WebP 图片");
  }
  if ((meta.width || 0) < 256 || (meta.height || 0) < 256) {
    throw badRequest("IMAGE_TOO_SMALL", "图片太小，请上传边长不少于 256 像素的图片");
  }

  const pipeline = input.rotate().resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true });
  const photo = kind !== "outfit";
  let encoded;
  try {
    encoded = photo
      ? await pipeline.flatten({ background: "#ffffff" }).jpeg({ quality: 90, mozjpeg: true }).toBuffer({ resolveWithObject: true })
      : await pipeline.webp({ quality: 92 }).toBuffer({ resolveWithObject: true });
  } catch {
    // e.g. HEIC from phones: the bundled libvips decodes AVIF but not HEVC.
    throw badRequest("INVALID_IMAGE", "无法读取这张图片，请转换为 JPG 或 PNG 后再上传");
  }
  const ext = photo ? "jpg" : "webp";
  const mime = photo ? "image/jpeg" : "image/webp";

  const id = randomId(16);
  const rel = path.join(String(user.id), `${id}.${ext}`);
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, encoded.data);

  const safety = settings.get("safety");
  const days = photo ? safety.personRetentionDays : safety.outfitRetentionDays;
  const now = Date.now();
  db.prepare(`INSERT INTO uploads (id, user_id, kind, path, mime, width, height, bytes, consent_at, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, user.id, kind, rel.replaceAll("\\", "/"), mime,
    encoded.info.width, encoded.info.height, encoded.data.length, photo ? now : null, now, now + days * DAY);
  return dto(db.prepare("SELECT * FROM uploads WHERE id = ?").get(id));
}

export function dto(row) {
  return {
    id: row.id, kind: row.kind, width: row.width, height: row.height, bytes: row.bytes,
    url: `/media/uploads/${row.id}`, createdAt: row.created_at, expiresAt: row.expires_at
  };
}

// An upload the user may still use: theirs, not deleted, not past retention.
export function getOwnedUpload(user, id, kind) {
  const row = db.prepare("SELECT * FROM uploads WHERE id = ? AND user_id = ?").get(String(id || ""), user.id);
  if (!row || row.deleted_at || (row.expires_at && row.expires_at <= Date.now())) {
    throw badRequest("UPLOAD_GONE", "上传的图片已过期或被删除，请重新上传");
  }
  if (kind && row.kind !== kind) throw badRequest("INVALID_INPUT", "图片类型不匹配");
  return row;
}

export function listUploads(user, kind) {
  return db.prepare(`SELECT * FROM uploads WHERE user_id = ? AND kind = ? AND deleted_at IS NULL
    AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC LIMIT 30`)
    .all(user.id, kind, Date.now()).map(dto);
}

export function deleteUpload(user, id) {
  const row = db.prepare("SELECT * FROM uploads WHERE id = ? AND user_id = ?").get(String(id || ""), user.id);
  if (!row || row.deleted_at) throw notFound("图片不存在");
  removeUploadFile(row);
}

export function removeUploadFile(row) {
  try { fs.rmSync(uploadFile(row), { force: true }); } catch { /* already gone */ }
  db.prepare("UPDATE uploads SET deleted_at = ? WHERE id = ?").run(Date.now(), row.id);
}

export function purgeExpired() {
  const rows = db.prepare("SELECT * FROM uploads WHERE deleted_at IS NULL AND expires_at <= ?").all(Date.now());
  for (const row of rows) removeUploadFile(row);
  return rows.length;
}

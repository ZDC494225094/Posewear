import express from "express";
import fs from "node:fs";
import { crc32 } from "node:zlib";
import * as wedding from "../services/wedding.js";
import * as uploads from "../services/uploads.js";
import * as worker from "../services/worker.js";
import { requireUser, uploadSingle } from "../middleware.js";
import { enforce } from "../lib/rate-limit.js";
import * as v from "../lib/validate.js";

// 婚纱影楼 for users: the catalog for the wizard, the couple's photos, buying a
// package (a shoot) and managing its album.
export const router = express.Router();

const viewerOf = (req) => ({ loggedIn: !!req.user, userId: req.user?.id ?? null });

router.get("/wedding/catalog", (req, res) => res.json(wedding.catalog(viewerOf(req))));

router.get("/wedding/quote", (req, res) => {
  const q = wedding.quote({ packageKey: req.query.package, extraPerLook: req.query.extra || 0 });
  res.json({ photos: q.photos, perLook: q.perLook, price: q.price });
});

router.post("/wedding/photos", requireUser, uploadSingle, async (req, res) => {
  enforce(`upload:${req.user.id}`, 40, 10 * 60 * 1000, "上传太频繁，请稍后再试");
  res.status(201).json(await wedding.uploadPhoto(req.user, req.file, { consent: v.bool(req.body?.consent) }));
});

// Earlier person photos the user may reuse (consented or approved virtual).
router.get("/wedding/photos", requireUser, (req, res) => {
  res.json({ items: uploads.listUploads(req.user, "person").filter((u) => u.consent || u.virtual === "approved") });
});

router.post("/wedding/shoots", requireUser, (req, res) => {
  enforce(`wedding:${req.user.id}`, 6, 60_000, "提交太频繁，请稍后再试");
  const b = req.body || {};
  const shoot = wedding.createShoot(req.user, {
    packageKey: b.packageKey, extraPerLook: b.extraPerLook, title: b.title, consent: b.consent,
    brideUploadIds: b.brideUploadIds, groomUploadIds: b.groomUploadIds, looks: b.looks
  }, { ip: req.ip });
  worker.kick();
  res.status(201).json({ shoot });
});

router.get("/wedding/shoots", requireUser, (req, res) => {
  const { offset, size } = v.page(req.query, { defaultSize: 24, maxSize: 60 });
  res.json(wedding.listShoots(req.user, { offset, size }));
});

router.get("/wedding/shoots/:id", requireUser, (req, res) => res.json({ shoot: wedding.album(req.user, req.params.id) }));

router.patch("/wedding/shoots/:id", requireUser, (req, res) => {
  wedding.rename(req.user, req.params.id, req.body?.title);
  res.json({ shoot: wedding.album(req.user, req.params.id) });
});

router.delete("/wedding/shoots/:id", requireUser, (req, res) => {
  wedding.removeShoot(req.user, req.params.id);
  res.json({ ok: true });
});

router.post("/wedding/shoots/:id/photos/:photoId/retake", requireUser, (req, res) => {
  enforce(`wedding-retake:${req.user.id}`, 30, 60_000, "操作太频繁，请稍后再试");
  const result = wedding.retake(req.user, req.params.id, req.params.photoId, { ip: req.ip });
  worker.kick();
  res.json({ ...result, shoot: wedding.album(req.user, req.params.id) });
});

router.post("/wedding/shoots/:id/photos/:photoId/choose", requireUser, (req, res) => {
  wedding.choose(req.user, req.params.id, req.params.photoId, req.body?.imageId);
  res.json({ shoot: wedding.album(req.user, req.params.id) });
});

router.post("/wedding/shoots/:id/photos/:photoId/favorite", requireUser, (req, res) => {
  wedding.setFavorite(req.user, req.params.id, req.params.photoId, v.bool(req.body?.favorite));
  res.json({ shoot: wedding.album(req.user, req.params.id) });
});

router.post("/wedding/shoots/:id/photos/:photoId/cancel", requireUser, (req, res) => {
  const result = wedding.cancelPhoto(req.user, req.params.id, req.params.photoId);
  res.json({ ...result, shoot: wedding.album(req.user, req.params.id) });
});

// The whole album as one ZIP. Photos are already compressed, so entries are
// stored as they are; names are UTF-8.
router.get("/wedding/shoots/:id/download", requireUser, (req, res) => {
  const { name, files } = wedding.downloadList(req.user, req.params.id);
  res.attachment(`${name}.zip`).type("application/zip");
  res.set("Cache-Control", "private, no-store");
  const central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const entry of files) {
    const data = fs.readFileSync(entry.file);
    const nameBuf = Buffer.from(entry.name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8); local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    res.write(local); res.write(nameBuf); res.write(data);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(20, 6); head.writeUInt16LE(0x0800, 8);
    head.writeUInt16LE(0, 10); head.writeUInt16LE(dosTime, 12); head.writeUInt16LE(dosDate, 14);
    head.writeUInt32LE(crc, 16); head.writeUInt32LE(data.length, 20); head.writeUInt32LE(data.length, 24);
    head.writeUInt16LE(nameBuf.length, 28); head.writeUInt32LE(offset, 42);
    central.push(head, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  res.end(Buffer.concat([dir, end]));
});

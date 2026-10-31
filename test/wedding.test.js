// 婚纱影楼: catalog, the couple's photos, buying a package, the album with
// retakes, versions, refunds and the ZIP download, and the admin's scenes.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { startApp, client, waitFor } from "./helpers.js";
import { createFakeOpenAI } from "../scripts/fake-openai.js";

let app, fake, admin, user, other, catalog;

before(async () => {
  fake = createFakeOpenAI();
  await new Promise((r) => fake.server.listen(0, "127.0.0.1", r));
  const fakeBase = `http://127.0.0.1:${fake.server.address().port}/v1`;
  app = await startApp();
  admin = client(app.base);
  user = client(app.base);
  other = client(app.base);
  for (const c of [admin, user, other]) await c.get("/api/public/config");
  assert.equal((await admin.post("/api/auth/login", { email: "admin@test.local", password: "admin-pass-123" })).status, 200);
  const { data } = await admin.get("/api/admin/channels");
  for (const channel of data.items) {
    await admin.put(`/api/admin/channels/${channel.id}`, channel.kind === "openai" ? { baseUrl: fakeBase, apiKey: "sk-test", enabled: true } : { enabled: false });
  }
  for (const [c, email] of [[user, "bride@example.com"], [other, "other@example.com"]]) {
    assert.equal((await c.post("/api/auth/register", { email, password: "secret-pass-1", agree: true })).status, 201);
  }
  const me = (await user.get("/api/me")).data.user;
  await admin.post(`/api/admin/users/${me.id}/credits`, { delta: 5000, reason: "test" });
});

after(async () => {
  await app?.stop();
  fake?.server.close();
});

const balance = async (c) => (await c.get("/api/me")).data.user.credits;
const photo = async (shade) => {
  const png = await sharp({ create: { width: 700, height: 900, channels: 3, background: { r: shade, g: shade - 20, b: shade - 40 } } }).png().toBuffer();
  const form = new FormData();
  form.append("consent", "true");
  form.append("file", new Blob([png], { type: "image/png" }), "me.png");
  return form;
};
const upload = async (c, shade = 160) => {
  const res = await c.upload("/api/wedding/photos", await photo(shade));
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return res.data;
};
const lookFor = (scene) => {
  const bride = catalog.outfits.bride.find((o) => o.key === scene.recommend.bride) || catalog.outfits.bride[0];
  const groom = catalog.outfits.groom.find((o) => o.key === scene.recommend.groom) || catalog.outfits.groom[0];
  return { sceneId: scene.id, bride: { categoryId: bride.categoryId }, groom: { categoryId: groom.categoryId },
    hair: scene.recommend.hair, headpiece: scene.recommend.headpiece, makeup: scene.recommend.makeup };
};
const waitAlbum = (c, id) => waitFor(async () => {
  const { data } = await c.get(`/api/wedding/shoots/${id}`);
  return data.shoot.progress.active ? null : data.shoot;
}, { timeout: 60_000 });

test("the catalog lists packages, scenes, bridal and groom's wear and styling", async () => {
  const res = await user.get("/api/wedding/catalog");
  assert.equal(res.status, 200);
  catalog = res.data;
  assert.equal(catalog.enabled, true);
  assert.deepEqual(catalog.packages.map((p) => [p.key, p.photos, p.price]), [["light", 6, 299], ["classic", 18, 799], ["premium", 40, 1599]]);
  assert.equal(catalog.scenes.length, 12);
  assert.ok(catalog.scenes.some((s) => s.key === "beach-sunset" && s.categoryText === "外景"));
  assert.ok(catalog.outfits.bride.some((o) => o.name === "秀禾服"));
  assert.ok(catalog.outfits.groom.some((o) => o.name === "燕尾服"));
  assert.ok(catalog.styling.headpiece.some((x) => x.key === "phoenix"));
  const cfg = (await user.get("/api/public/config")).data;
  assert.equal(cfg.wedding.enabled, true);
});

test("the couple's photos need consent and are kept for the wedding retention period", async () => {
  const form = await photo(150);
  form.delete("consent");
  const refused = await user.upload("/api/wedding/photos", form);
  assert.equal(refused.data.error.code, "CONSENT_REQUIRED");
  const dark = await upload(user, 40);
  assert.ok(dark.warnings.includes("照片偏暗"));
  const days = (dark.upload.expiresAt - Date.now()) / 86_400_000;
  assert.ok(days > 29 && days <= 30, `kept ${days} days`);
});

let shoot;

test("buying a package charges its price and queues one job per photo with both people's photos", async () => {
  const bride = [await upload(user, 170), await upload(user, 172), await upload(user, 174), await upload(user, 176)];
  const groom = [await upload(user, 150), await upload(user, 152)];
  const scenes = ["white-studio", "beach-sunset", "chinese-garden"].map((k) => catalog.scenes.find((s) => s.key === k));
  const body = { packageKey: "classic", extraPerLook: 1, title: "阿杰 & 小雨", consent: true,
    brideUploadIds: bride.map((x) => x.upload.id), groomUploadIds: groom.map((x) => x.upload.id), looks: scenes.map(lookFor) };
  const quote = await user.get("/api/wedding/quote?package=classic&extra=1");
  assert.deepEqual(quote.data, { photos: 21, perLook: 7, price: 799 + 3 * 50 });
  const wrong = await user.post("/api/wedding/shoots", { ...body, looks: body.looks.slice(0, 2) });
  assert.equal(wrong.data.error.code, "INVALID_LOOKS");
  const before = await balance(user);
  const res = await user.post("/api/wedding/shoots", body);
  assert.equal(res.status, 201, JSON.stringify(res.data));
  shoot = res.data.shoot;
  assert.equal(shoot.photos, 21);
  assert.equal(await balance(user), before - 949);
  assert.equal(shoot.retakesLeft, 5);
  assert.equal(shoot.items.length, 21);

  const done = await waitAlbum(user, shoot.id);
  assert.equal(done.progress.done, 21);
  assert.equal(done.status, "done");
  const calls = fake.requests.slice(-21);
  const couple = calls.find((r) => r.fields.prompt.includes("Shot: full-length portrait of the couple"));
  assert.equal(couple.endpoint, "edits");
  assert.equal(couple.files.length, 5, "3 of the bride's 4 photos and both of the groom's");
  assert.match(couple.fields.prompt, /Images 1–3 show the BRIDE/);
  assert.match(couple.fields.prompt, /Images 4–5 show the GROOM/);
  assert.match(couple.fields.prompt, /The bride wears floor-length A-line white wedding gown/);
  assert.match(couple.fields.prompt, /Location: a bright white European-style studio set/);
  assert.match(couple.fields.prompt, /natural skin texture with visible pores/);
  assert.equal(couple.fields.size, "1536x2304", "2K by default");
  const solo = calls.find((r) => r.fields.prompt.includes("the bride alone"));
  assert.equal(solo.files.length, 3);
  assert.doesNotMatch(solo.fields.prompt, /GROOM/);

  const works = await user.get("/api/generations");
  assert.equal(works.data.total, 0, "wedding photos stay in the album");
  const theirs = await other.get(`/api/wedding/shoots/${shoot.id}`);
  assert.equal(theirs.status, 404);
  const img = done.items[0].image;
  assert.equal((await other.raw(img.thumb)).status, 404);
  assert.equal((await user.raw(img.thumb)).status, 200);
});

test("retakes use the free ones first, keep every version and let the couple choose", async () => {
  const target = shoot.items[0];
  const first = (await user.get(`/api/wedding/shoots/${shoot.id}`)).data.shoot.items[0].image.id;
  const res = await user.post(`/api/wedding/shoots/${shoot.id}/photos/${target.id}/retake`);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.usedRetake, true);
  assert.equal(res.data.charged, 0);
  assert.equal(res.data.shoot.retakesLeft, 4);
  const done = await waitAlbum(user, shoot.id);
  const item = done.items[0];
  assert.equal(item.versions.length, 2);
  assert.notEqual(item.image.id, first, "the new take shows by default");
  const chose = await user.post(`/api/wedding/shoots/${shoot.id}/photos/${target.id}/choose`, { imageId: first });
  assert.equal(chose.data.shoot.items[0].image.id, first);
  const fav = await user.post(`/api/wedding/shoots/${shoot.id}/photos/${target.id}/favorite`, { favorite: true });
  assert.equal(fav.data.shoot.items[0].favorite, true);
});

test("the whole album downloads as one ZIP", async () => {
  const res = await user.raw(`/api/wedding/shoots/${shoot.id}/download`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition"), /zip/);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.readUInt32LE(0), 0x04034b50);
  const end = buf.length - 22;
  assert.equal(buf.readUInt32LE(end), 0x06054b50);
  assert.equal(buf.readUInt16LE(end + 10), 21);
});

test("a photo that keeps failing is retried free, then can be given up for its share", async () => {
  const { data: settingsData } = await admin.get("/api/admin/settings/wedding");
  const value = settingsData.value;
  const shots = value.shots.map((s, i) => (i === 0 ? { ...s, prompt: `${s.prompt} [fake:moderation]` } : s));
  assert.equal((await admin.put("/api/admin/settings/wedding", { value: { ...value, shots } })).status, 200);
  const bride = await upload(user, 180);
  const groom = await upload(user, 140);
  const scene = catalog.scenes.find((s) => s.key === "castle");
  const res = await user.post("/api/wedding/shoots", { packageKey: "light", consent: true, brideUploadIds: [bride.upload.id],
    groomUploadIds: [groom.upload.id], looks: [lookFor(scene)] });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const done = await waitAlbum(user, res.data.shoot.id);
  const failed = done.items.find((it) => it.status === "failed");
  assert.ok(failed && failed.freeRetry);
  assert.equal(done.status, "attention");
  const retry = await user.post(`/api/wedding/shoots/${done.id}/photos/${failed.id}/retake`);
  assert.equal(retry.data.free, true);
  await waitAlbum(user, done.id);
  const before = await balance(user);
  const cancel = await user.post(`/api/wedding/shoots/${done.id}/photos/${failed.id}/cancel`);
  assert.equal(cancel.status, 200, JSON.stringify(cancel.data));
  assert.equal(cancel.data.refunded, Math.floor(299 / 6));
  assert.equal(await balance(user), before + Math.floor(299 / 6));
  assert.equal(cancel.data.shoot.items.find((it) => it.id === failed.id).status, "cancelled");
  await admin.put("/api/admin/settings/wedding", { value });
});

test("admins manage scenes: sample photos with a virtual couple are public while the scene is online", async () => {
  const scenes = (await admin.get("/api/admin/wedding/scenes")).data.items;
  const beach = scenes.find((s) => s.key === "beach-sunset");
  const res = await admin.post(`/api/admin/wedding/scenes/${beach.id}/samples`, { count: 2 });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const sample = await waitFor(async () => {
    const list = (await user.get("/api/wedding/catalog")).data.scenes.find((s) => s.id === beach.id).samples;
    return list.length === 2 ? list : null;
  }, { timeout: 30_000 });
  const call = fake.requests.at(-1);
  assert.match(call.fields.prompt, /do not resemble any real or famous person/);
  assert.equal(call.endpoint, "generations", "no person photos, no outfit or plate images yet");
  const anonymous = client(app.base);
  assert.equal((await anonymous.raw(sample[0].thumb)).status, 200);
  await admin.put(`/api/admin/wedding/scenes/${beach.id}`, { enabled: false });
  assert.equal((await anonymous.raw(sample[0].thumb)).status, 404);
  await admin.put(`/api/admin/wedding/scenes/${beach.id}`, { enabled: true });

  const created = await admin.post("/api/admin/wedding/scenes", { name: "游艇", category: "outdoor", prompt: "the deck of a white yacht at sea" });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const seed = await admin.get("/api/admin/wedding/seed");
  assert.ok(seed.data.plates >= 13 && seed.data.outfits === 16, JSON.stringify(seed.data));
  assert.ok(seed.data.estimatedUsd > 0);
  const used = await admin.del(`/api/admin/wedding/scenes/${catalog.scenes.find((s) => s.key === "castle").id}`);
  assert.equal(used.data.error.code, "SCENE_IN_USE");
  assert.equal((await admin.del(`/api/admin/wedding/scenes/${created.data.scene.id}`)).status, 200);
  const shoots = await admin.get("/api/admin/wedding/shoots");
  assert.equal(shoots.data.total, 2);
  // A real seed queues dozens of jobs in one admin action, past the per-minute submit limit.
  const run = await admin.post("/api/admin/wedding/seed");
  assert.equal(run.status, 201, JSON.stringify(run.data));
  assert.ok(run.data.plates >= 12 && run.data.outfits === 16, JSON.stringify(run.data));
  const again = (await admin.get("/api/admin/wedding/seed")).data;
  assert.deepEqual([again.plates, again.samples, again.outfits], [0, 0, 0], "queued work is not planned twice");
});

test("deleting an album removes its photos and the couple's uploads", async () => {
  const before = (await user.get("/api/wedding/shoots")).data.total;
  const res = await user.del(`/api/wedding/shoots/${shoot.id}`);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal((await user.get("/api/wedding/shoots")).data.total, before - 1);
  assert.equal((await user.get(`/api/wedding/shoots/${shoot.id}`)).status, 404);
});

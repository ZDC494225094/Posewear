// The free share of the library, unlocking by recharge, and the signed image
// links and limits that keep the library from being scraped.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startApp, client, listenLocal } from "./helpers.js";
import { createFakeOpenAI } from "../scripts/fake-openai.js";

let app, fake, admin, viewer, payer, guest;
const ids = {};

const librarySettings = async (patch) => {
  const value = (await admin.get("/api/admin/settings/library")).data.value;
  const res = await admin.put("/api/admin/settings/library", { value: { ...value, ...patch } });
  assert.equal(res.status, 200, JSON.stringify(res.data));
};
const unlocked = async (c) => (await c.get("/api/me")).data.user.libraryUnlocked;

before(async () => {
  fake = createFakeOpenAI();
  await listenLocal(fake.server);
  const fakeBase = `http://127.0.0.1:${fake.server.address().port}/v1`;
  app = await startApp();
  admin = client(app.base);
  viewer = client(app.base);
  payer = client(app.base);
  guest = client(app.base);
  for (const c of [admin, viewer, payer, guest]) await c.get("/api/public/config");
  assert.equal((await admin.post("/api/auth/login", { email: "admin@test.local", password: "admin-pass-123" })).status, 200);
  for (const channel of (await admin.get("/api/admin/channels")).data.items) {
    await admin.put(`/api/admin/channels/${channel.id}`, channel.kind === "openai" ? { baseUrl: fakeBase, apiKey: "sk-test", enabled: true } : { enabled: false });
  }
  for (const [c, email] of [[viewer, "viewer@example.com"], [payer, "payer@example.com"]]) {
    assert.equal((await c.post("/api/auth/register", { email, password: "secret-pass-1", agree: true })).status, 201);
    ids[email] = (await c.get("/api/me")).data.user.id;
    await admin.post(`/api/admin/users/${ids[email]}/credits`, { delta: 500, reason: "test" });
  }
  // The fixture library is tiny: make only the first asset of each type free.
  await librarySettings({ freeLimit: 1 });
});

after(async () => {
  await app?.stop();
  fake?.server.close();
});

test("without a recharge only the first assets of each type show; the rest come back locked", async () => {
  assert.equal(await unlocked(viewer), false);
  const outfits = (await viewer.get("/api/library/outfits")).data;
  assert.ok(outfits.total >= 2);
  assert.equal(outfits.locked, outfits.total - 1);
  const [free, locked] = outfits.items;
  assert.ok(!free.locked && free.thumb.includes("?t=") && free.preview.includes("?t="));
  assert.equal(locked.locked, true);
  assert.deepEqual([locked.thumb, locked.preview, locked.original, locked.keywords], [null, null, null, undefined]);
  assert.match(locked.blur, /\/blur$/);

  const poses = (await viewer.get("/api/library/poses")).data;
  assert.equal(poses.items[0].locked, false);
  assert.equal(poses.items[0].images.length, 2, "a free pose comes with all its angles");
  assert.ok(poses.items.slice(1).every((g) => g.locked && g.cover.locked));
  assert.deepEqual((await viewer.get("/api/library/meta")).data.access, { unlocked: false, lockEnabled: true, freeLimit: 1 });
});

test("image links only work for whoever they were issued to", async () => {
  const [free, locked] = (await viewer.get("/api/library/outfits")).data.items;
  assert.equal((await viewer.raw(free.thumb)).status, 200);
  const preview = await viewer.raw(free.preview);
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get("content-type"), "image/webp", "previews carry the watermark");
  assert.equal(preview.headers.get("x-robots-tag"), "noindex");

  assert.equal((await guest.raw(free.thumb)).status, 403, "someone else's link");
  assert.equal((await viewer.raw(free.thumb.split("?")[0])).status, 403, "no token");
  const [path, token] = free.thumb.split("?t=");
  assert.equal((await viewer.raw(`${path}?t=${token.slice(0, -2)}xx`)).status, 403, "tampered");
  assert.equal((await viewer.raw(`${path.replace(/thumb$/, "original")}?t=${token}`)).status, 403, "other variant");
  assert.equal((await viewer.raw(`/media/library/${encodeURIComponent(locked.id)}/thumb`)).status, 403);
  const blur = await viewer.raw(locked.blur);
  assert.equal(blur.status, 200);
  assert.ok((await blur.arrayBuffer()).byteLength < 2000, "the placeholder is a few hundred bytes");

  // Guests: thumbnails of the free share bound to their cookie, no large previews.
  const mine = (await guest.get("/api/library/outfits")).data.items[0];
  assert.equal(mine.preview, null);
  assert.equal((await guest.raw(mine.thumb)).status, 200);
  assert.equal((await client(app.base).raw(mine.thumb)).status, 403);
  // Admins and owners use plain links.
  assert.equal((await admin.raw(`/media/library/${encodeURIComponent(locked.id)}/preview`)).status, 200);
});

test("a locked asset can't be used; a recharge or an admin unlocks the whole library", async () => {
  await librarySettings({ freeLimit: 0 });
  const blocked = await viewer.post("/api/generations", { poseId: "std_P001_front", quality: "low", n: 1 });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.error.code, "LIBRARY_LOCKED");
  const renewed = (await viewer.get("/api/library/assets?ids=std_P001_front,missing-id")).data.items;
  assert.equal(renewed[0].locked, true);
  assert.equal(renewed[1], null);

  const payment = (await admin.get("/api/admin/settings/payment")).data.value;
  await admin.put("/api/admin/settings/payment", { value: { ...payment, mock: { enabled: true } } });
  const pkg = (await payer.get("/api/billing/packages")).data.items[0];
  const order = await payer.post("/api/billing/orders", { packageId: pkg.id, provider: "mock" });
  assert.equal((await payer.post(`/api/billing/orders/${order.data.order.id}/mock-pay`, {})).data.order.status, "paid");
  assert.equal(await unlocked(payer), true);
  const all = (await payer.get("/api/library/outfits")).data;
  assert.equal(all.locked, 0);
  assert.ok(all.items.every((a) => a.thumb && !a.locked));
  const created = await payer.post("/api/generations", { poseId: "std_P001_front", quality: "low", n: 1 });
  assert.equal(created.status, 201, JSON.stringify(created.data));

  // What a work was made from stays visible to anyone, as thumbnails only.
  const work = (await payer.get("/api/generations")).data.items.find((g) => g.id === created.data.generation.id);
  assert.equal((await guest.raw(work.refs.pose.thumb)).status, 200);
  assert.equal((await guest.raw(work.refs.pose.thumb.replace("/thumb?", "/original?"))).status, 403);

  // An admin's choice overrides the recharge rule both ways.
  await admin.patch(`/api/admin/users/${ids["payer@example.com"]}`, { libraryUnlock: "locked" });
  assert.equal(await unlocked(payer), false);
  await admin.patch(`/api/admin/users/${ids["viewer@example.com"]}`, { libraryUnlock: "unlocked" });
  assert.equal(await unlocked(viewer), true);
  const users = (await admin.get("/api/admin/users?q=viewer%40example.com")).data.items;
  assert.equal(users[0].libraryUnlock, "unlocked");
  await librarySettings({ freeLimit: 1 });
});

test("scraping limits refuse requests and leave an alert for the admins", async () => {
  const asset = (await viewer.get("/api/library/outfits")).data.items[0];
  assert.ok(asset.original, "originals download after login by default");
  let last;
  for (let i = 0; i < 61; i++) last = await viewer.raw(asset.original);
  assert.equal(last.status, 429);
  const alerts = (await admin.get("/api/admin/access-alerts")).data;
  const alert = alerts.items.find((a) => a.kind === "original");
  assert.equal(alert?.email, "viewer@example.com");
  assert.equal(alert.kindText, "原图下载");
});

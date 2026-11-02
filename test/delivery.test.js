// How the app is delivered: versioned static files, display-size images, the
// admin badges, and a worker that keeps one large order from holding up others.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startApp, client, waitFor, listenLocal } from "./helpers.js";
import { createFakeOpenAI } from "../scripts/fake-openai.js";

let app, fake, admin, alice, bob;

before(async () => {
  fake = createFakeOpenAI();
  await listenLocal(fake.server);
  const fakeBase = `http://127.0.0.1:${fake.server.address().port}/v1`;
  app = await startApp();
  admin = client(app.base);
  alice = client(app.base);
  bob = client(app.base);
  for (const c of [admin, alice, bob]) await c.get("/api/public/config");
  assert.equal((await admin.post("/api/auth/login", { email: "admin@test.local", password: "admin-pass-123" })).status, 200);
  for (const channel of (await admin.get("/api/admin/channels")).data.items) {
    await admin.put(`/api/admin/channels/${channel.id}`, channel.kind === "openai" ? { baseUrl: fakeBase, apiKey: "sk-test", enabled: true } : { enabled: false });
  }
  for (const [c, email] of [[alice, "alice@example.com"], [bob, "bob@example.com"]]) {
    assert.equal((await c.post("/api/auth/register", { email, password: "secret-pass-1", agree: true })).status, 201);
    const me = (await c.get("/api/me")).data.user;
    await admin.post(`/api/admin/users/${me.id}/credits`, { delta: 1000, reason: "test" });
  }
});

after(async () => {
  await app?.stop();
  fake?.server.close();
});

test("pages load code from a versioned path and preload the modules main.js imports", async () => {
  const html = await (await alice.raw("/")).text();
  const main = /<script type="module" src="(\/assets\/[0-9a-f]{10}\/js\/main\.js)"><\/script>/.exec(html)?.[1];
  assert.ok(main, html.slice(0, 600));
  const preloads = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((m) => m[1]);
  assert.ok(preloads.some((p) => p.endsWith("/js/core/dom.js")) && preloads.some((p) => p.endsWith("/js/core/store.js")), preloads.join(" "));
  assert.ok(preloads.every((p) => p.startsWith(main.slice(0, 18))), "same version prefix");
  assert.equal((await alice.raw(main)).status, 200);
  assert.equal((await alice.raw(preloads[0])).status, 200);
  const adminHtml = await (await alice.raw("/admin")).text();
  assert.match(adminHtml, /\/js\/admin\/main\.js/);
});

test("a finished image has a display-size copy for viewing; the original stays for download", async () => {
  const res = await alice.post("/api/generations", { poseId: "std_P001_front", quality: "low", n: 1 });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const gen = await waitFor(async () => {
    const g = (await alice.get(`/api/generations/${res.data.generation.id}`)).data.generation;
    return g.status === "succeeded" ? g : null;
  });
  const image = gen.images[0];
  assert.match(image.view, /\/view$/);
  const view = await alice.raw(image.view);
  assert.equal(view.status, 200);
  assert.equal(view.headers.get("content-type"), "image/webp");
  const full = await alice.raw(image.url);
  assert.ok((await view.arrayBuffer()).byteLength < (await full.arrayBuffer()).byteLength);
  assert.equal((await bob.raw(image.view)).status, 404, "private works stay private");
});

test("admin badges come from a light endpoint", async () => {
  const badges = (await admin.get("/api/admin/badges")).data;
  for (const key of ["pendingReports", "pendingReview", "pendingAssets", "pendingVirtual", "accessAlerts"]) {
    assert.equal(typeof badges[key], "number", key);
  }
});

test("a batch in progress doesn't block the studio, and another user's job goes ahead of the rest of the batch", async () => {
  const taxonomy = (await alice.get("/api/library/taxonomy")).data;
  const scenes = taxonomy.scene.flatMap((m) => m.children).slice(0, 4);
  const batch = await alice.post("/api/my/asset-jobs/batch", { type: "scene",
    items: scenes.map((c, i) => ({ categoryId: c.id, description: `[fake:slow] test scene ${i}` })) });
  assert.equal(batch.status, 201, JSON.stringify(batch.data));
  // Four asset jobs active, yet the studio cap (3) only counts studio work.
  const own = await alice.post("/api/generations", { poseId: "std_P001_front", quality: "low", n: 1 });
  assert.equal(own.status, 201, JSON.stringify(own.data));
  const other = await bob.post("/api/generations", { poseId: "std_P001_front", quality: "low", n: 1 });
  assert.equal(other.status, 201, JSON.stringify(other.data));

  const ids = batch.data.items.map((j) => j.id);
  const jobs = await waitFor(async () => {
    const list = (await alice.get(`/api/my/asset-jobs?ids=${ids.join(",")}`)).data.items;
    return list.every((j) => j.status === "succeeded") ? list : null;
  }, { timeout: 30_000 });
  const bobs = (await bob.get(`/api/generations/${other.data.generation.id}`)).data.generation;
  const started = jobs.map((j) => j.startedAt).sort((a, b) => a - b);
  // First-in-first-out would start Bob's job after all four; the worker gives
  // it the first slot that frees up while Alice still has a job running.
  assert.ok(bobs.startedAt < started[3], `bob ${bobs.startedAt}, batch ${started.join(",")}`);
});

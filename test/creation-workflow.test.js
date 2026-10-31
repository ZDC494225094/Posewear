import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { startApp, client, waitFor } from "./helpers.js";
import { createFakeOpenAI } from "../scripts/fake-openai.js";

let app, fake, admin, owner, other, tree, image, virtual, scene, item;
const ok = (response, status = 200) => {
  assert.equal(response.status, status, JSON.stringify(response.data));
  return response.data;
};

before(async () => {
  fake = createFakeOpenAI();
  await new Promise((resolve) => fake.server.listen(0, "127.0.0.1", resolve));
  app = await startApp();
  admin = client(app.base); owner = client(app.base); other = client(app.base);
  for (const c of [admin, owner, other]) await c.get("/api/public/config");
  ok(await admin.post("/api/auth/login", { email: "admin@test.local", password: "admin-pass-123" }));
  const user = ok(await owner.post("/api/auth/register", { email: "workflow@example.com", password: "secret-pass-123", agree: true }), 201).user;
  ok(await other.post("/api/auth/register", { email: "other@example.com", password: "secret-pass-123", agree: true }), 201);
  ok(await admin.post(`/api/admin/users/${user.id}/credits`, { delta: 500, reason: "isolated workflow tests" }));
  for (const channel of ok(await admin.get("/api/admin/channels")).items) {
    ok(await admin.put(`/api/admin/channels/${channel.id}`, channel.kind === "openai"
      ? { enabled: true, apiKey: "sk-test", baseUrl: `http://127.0.0.1:${fake.server.address().port}/v1` }
      : { enabled: false }));
  }
  tree = ok(await owner.get("/api/library/taxonomy"));
  image = await sharp({ create: { width: 600, height: 800, channels: 3, background: "#aabbcc" } }).png().toBuffer();
});

after(async () => { await app?.stop(); if (fake) await new Promise((resolve) => fake.server.close(resolve)); });

async function upload(kind, extra = {}) {
  const form = new FormData();
  form.append("kind", kind);
  for (const [key, value] of Object.entries(extra)) form.append(key, String(value));
  form.append("file", new Blob([image], { type: "image/png" }), "fixture.png");
  return ok(await owner.upload("/api/uploads", form), 201).upload;
}

async function work(input) {
  const created = ok(await owner.post("/api/generations", { quality: "low", ratio: "2:3", ...input }), 201).generation;
  const done = await waitFor(async () => {
    const g = ok(await owner.get(`/api/generations/${created.id}`)).generation;
    return ["succeeded", "failed"].includes(g.status) ? g : null;
  });
  assert.equal(done.status, "succeeded", JSON.stringify(done));
  return done;
}

async function assetJob(type, extra = {}) {
  const created = ok(await owner.post("/api/my/asset-jobs", { type, categoryId: tree[type][0].children[0].id, ...extra }), 201).items[0];
  const job = await waitFor(async () => {
    const j = ok(await owner.get(`/api/my/asset-jobs?ids=${created.id}`)).items[0];
    return ["succeeded", "failed"].includes(j.status) ? j : null;
  });
  assert.equal(job.status, "succeeded", JSON.stringify(job));
  return job;
}

test("ordinary users can submit, reapply and use an admin-approved virtual person", async () => {
  virtual = await upload("person", { virtual: true, declare: true });
  assert.equal(virtual.virtual, "pending");
  assert.equal((await owner.post("/api/generations/estimate", { personUploadId: virtual.id })).data.error.code, "VIRTUAL_PENDING");
  assert.equal((await owner.post(`/api/admin/virtual-persons/${virtual.id}`, { action: "approve" })).status, 403);
  assert.ok(ok(await admin.get("/api/admin/virtual-persons?status=pending")).items.some((p) => p.id === virtual.id));
  assert.equal(ok(await admin.get("/api/admin/overview")).pendingVirtual, 1);
  ok(await admin.post(`/api/admin/virtual-persons/${virtual.id}`, { action: "reject", note: "Please verify the original character" }));
  const rejected = ok(await owner.get("/api/uploads?kind=person")).items.find((p) => p.id === virtual.id);
  assert.equal(rejected.virtual, "rejected");
  assert.match(rejected.virtualNote, /original character/);
  assert.equal((await owner.post(`/api/uploads/${virtual.id}/virtual`, { virtual: true })).data.error.code, "DECLARATION_REQUIRED");
  ok(await owner.post(`/api/uploads/${virtual.id}/virtual`, { virtual: true, declare: true }));
  virtual = ok(await admin.post(`/api/admin/virtual-persons/${virtual.id}`, { action: "approve" })).upload;
  assert.equal(virtual.virtual, "approved");
  assert.equal(virtual.expiresAt, null);
  assert.equal(ok(await admin.get("/api/admin/overview")).pendingVirtual, 0);
  ok(await owner.post("/api/generations/estimate", { poseId: "sexy_P002_front", outfitId: "LNG-0001", personUploadId: virtual.id }));
  const g = await work({ poseId: "sexy_P002_front", personUploadId: virtual.id });
  assert.equal(g.personKind, "virtual");
  ok(await owner.post(`/api/generations/${g.id}/publish`, { public: true }));
  const shared = ok(await other.get("/api/public/showcase")).items.find((p) => p.id === g.id);
  assert.deepEqual(shared.refs.person, { kind: "virtual" });
  const history = await work({ poseId: "std_P001_front", personImageId: g.images[0].id });
  assert.equal(history.personKind, "virtual");
  assert.equal(history.refs.person.source, "image");
});

test("uploaded outfits have reusable private references without leaking uploads publicly", async () => {
  const outfit = await upload("outfit");
  const g = await work({ poseId: "std_P001_front", outfitUploadId: outfit.id });
  assert.equal(g.refs.outfit.id, outfit.id);
  assert.equal(g.refs.outfit.upload, true);
  assert.equal((await owner.raw(g.refs.outfit.thumb)).status, 200);
  assert.equal((await other.raw(g.refs.outfit.thumb)).status, 404);
  ok(await owner.post(`/api/generations/${g.id}/publish`, { public: true }));
  const shared = ok(await other.get("/api/public/showcase")).items.find((p) => p.id === g.id);
  assert.deepEqual(shared.refs.outfit, { upload: true });
  const again = await work({ poseId: g.refs.pose.id, outfitUploadId: g.refs.outfit.id });
  assert.equal(again.refs.outfit.id, outfit.id);
  assert.equal((await other.post("/api/generations/estimate", { outfitUploadId: outfit.id })).data.error.code, "UPLOAD_GONE");
  ok(await owner.del(`/api/uploads/${outfit.id}`));
  assert.equal(ok(await owner.get(`/api/generations/${g.id}`)).generation.refs.outfit.thumb, null);
  assert.equal((await owner.post("/api/generations/estimate", { outfitUploadId: outfit.id })).data.error.code, "UPLOAD_GONE");
});

test("scene and item prices, templates, sharing and admin review form a complete workflow", async () => {
  const settings = ok(await admin.get("/api/admin/settings/assets")).value;
  ok(await admin.put("/api/admin/settings/assets", { value: { ...settings, sceneCredits: 7, itemCredits: 3,
    scenePrompt: `${settings.scenePrompt}\nScene test marker.`, itemPrompt: `${settings.itemPrompt}\nItem test marker.` } }));
  const before = ok(await owner.get("/api/me")).user.credits;
  const sceneJob = await assetJob("scene", { description: "an empty garden" });
  const itemJob = await assetJob("item", { description: "a necklace" });
  scene = sceneJob.assets[0]; item = itemJob.assets[0];
  assert.equal(sceneJob.cost, 7); assert.equal(itemJob.cost, 3);
  assert.equal(ok(await owner.get("/api/me")).user.credits, before - 10);
  assert.match(fake.requests.at(-2).fields.prompt, /Scene test marker/);
  assert.match(fake.requests.at(-1).fields.prompt, /Item test marker/);
  for (const a of [scene, item]) {
    const listPath = a.type === "scene" ? "scenes" : "items";
    assert.equal((await other.get(`/api/library/${listPath}`)).data.total, 0);
    ok(await owner.patch(`/api/my/assets/${a.id}`, { visibility: "public", price: 2 }));
    assert.ok(ok(await admin.get(`/api/admin/assets?type=${a.type}&review=pending`)).items.some((r) => r.id === a.id));
    ok(await admin.patch(`/api/admin/assets/${a.id}`, { review: "approved" }));
    assert.ok(ok(await other.get(`/api/library/${listPath}`)).items.some((r) => r.id === a.id));
  }
  const jobs = ok(await admin.get("/api/admin/asset-jobs?type=scene&scope=user&status=succeeded"));
  assert.ok(jobs.items.some((j) => j.id === sceneJob.id));
  assert.ok(jobs.items.every((j) => j.type === "scene" && !j.platform && j.status === "succeeded"));
  assert.equal(ok(await other.post("/api/generations/estimate", { sceneAssetId: scene.id, itemIds: [item.id], quality: "low" })).assetFee, 4);
  assert.equal(ok(await owner.post("/api/generations/estimate", { sceneAssetId: scene.id, itemIds: [item.id], quality: "low" })).assetFee, 0);
});

test("five reference images reach the worker in order and all references remain available for recreation", async () => {
  const g = await work({ poseId: "std_P001_front", outfitId: "SPR-0001", personUploadId: virtual.id, sceneAssetId: scene.id, itemIds: [item.id] });
  const call = fake.requests.at(-1);
  assert.deepEqual(call.files.map((f) => f.filename), ["pose.png", "outfit.jpg", "person.jpg", "scene.jpg", "item-1.jpg"]);
  assert.match(call.fields.prompt, /Image 4 is the SCENE reference/);
  assert.match(call.fields.prompt, /Image 5 is an ITEM reference/);
  assert.deepEqual([g.refs.pose.id, g.refs.outfit.id, g.refs.person.id, g.refs.scene.id, g.refs.items[0].id],
    ["std_P001_front", "SPR-0001", virtual.id, scene.id, item.id]);
  assert.equal((await owner.post("/api/generations/estimate", { itemIds: [item.id, "2", "3", "4"] })).data.error.code, "TOO_MANY_ITEMS");
});

test("scene and item categories support admin upload, editing and safe deletion", async () => {
  for (const type of ["scene", "item"]) {
    const major = ok(await admin.post("/api/admin/asset-categories", { type, key: `test-${type}`, nameZh: `Test ${type}` }), 201).category;
    const minor = ok(await admin.post("/api/admin/asset-categories", { type, parentId: major.id, key: "test-child", nameZh: "Test child" }), 201).category;
    const form = new FormData();
    for (const [key, value] of Object.entries({ type, categoryId: minor.id, rating: "general", license: "commercial", nameZh: `Uploaded ${type}`, keywords: `test ${type}` })) form.append(key, String(value));
    form.append("file", new Blob([image], { type: "image/png" }), "fixture.png");
    const a = ok(await admin.upload("/api/admin/assets/upload", form), 201).asset;
    assert.equal(a.type, type); assert.equal(a.category.key, "test-child");
    assert.ok(ok(await admin.get(`/api/admin/assets?type=${type}&source=custom`)).items.some((r) => r.id === a.id));
    assert.equal((await admin.del(`/api/admin/asset-categories/${minor.id}`)).status, 400);
    ok(await admin.patch(`/api/admin/assets/${a.id}`, { name_zh: "Updated", enabled: false }));
    assert.equal(ok(await admin.get(`/api/admin/assets?type=${type}&enabled=0`)).items.find((r) => r.id === a.id).name.zh, "Updated");
    ok(await admin.del(`/api/admin/assets/${a.id}`));
    ok(await admin.del(`/api/admin/asset-categories/${minor.id}`));
    ok(await admin.del(`/api/admin/asset-categories/${major.id}`));
  }
});

test("asset generation details and original references are restricted to owner and admins", async () => {
  const reference = await upload("reference", { consent: true });
  const job = await assetJob("scene", { referenceUploadId: reference.id, description: "empty room" });
  const a = job.assets[0];
  const info = ok(await owner.get(`/api/my/assets/${a.id}/info`));
  assert.equal(info.job.reference.url, reference.url);
  assert.equal((await owner.raw(info.job.reference.url)).status, 200);
  assert.equal((await other.get(`/api/my/assets/${a.id}/info`)).status, 404);
  assert.equal((await other.raw(info.job.reference.url)).status, 404);
  assert.equal(ok(await admin.get(`/api/admin/assets/${a.id}/info`)).job.reference.url, reference.url);
});

test("hidden and favorite records are reversible, and homepage examples use the actual generation", async () => {
  const g = await work({ poseId: "std_P001_front", outfitId: "SPR-0001" });
  ok(await owner.post(`/api/generations/${g.id}/publish`, { public: true }));
  ok(await owner.post(`/api/generations/${g.id}/flags`, { hidden: true, favorite: true }));
  assert.ok(!ok(await owner.get("/api/generations")).items.some((r) => r.id === g.id));
  assert.ok(ok(await owner.get("/api/generations?status=hidden")).items.some((r) => r.id === g.id));
  ok(await owner.post(`/api/generations/${g.id}/flags`, { hidden: false }));
  assert.ok(ok(await owner.get("/api/generations?status=favorite")).items.some((r) => r.id === g.id));
  const combo = ok(await other.get("/api/public/home")).combos.find((r) => r.id === g.id);
  assert.equal(combo.pose.id, g.refs.pose.id);
  assert.equal(combo.outfit.id, g.refs.outfit.id);
  assert.equal(combo.result.id, g.images[0].id);
});

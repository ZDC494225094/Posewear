// Batch asset creation (素材创作) and the studio's camera presets and realism switch.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startApp, client, waitFor } from "./helpers.js";
import { createFakeOpenAI } from "../scripts/fake-openai.js";

let app, fake, admin, user, taxonomy;

before(async () => {
  fake = createFakeOpenAI();
  await new Promise((r) => fake.server.listen(0, "127.0.0.1", r));
  const fakeBase = `http://127.0.0.1:${fake.server.address().port}/v1`;
  app = await startApp();
  admin = client(app.base);
  user = client(app.base);
  for (const c of [admin, user]) await c.get("/api/public/config");
  const login = await admin.post("/api/auth/login", { email: "admin@test.local", password: "admin-pass-123" });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  const { data } = await admin.get("/api/admin/channels");
  for (const channel of data.items) {
    const patch = channel.kind === "openai" ? { baseUrl: fakeBase, apiKey: "sk-test", enabled: true } : { enabled: false };
    await admin.put(`/api/admin/channels/${channel.id}`, patch);
  }
  const reg = await user.post("/api/auth/register", { email: "carol@example.com", password: "secret-pass-1", agree: true });
  assert.equal(reg.status, 201, JSON.stringify(reg.data));
  const me = (await user.get("/api/me")).data.user;
  await admin.post(`/api/admin/users/${me.id}/credits`, { delta: 200, reason: "test" });
  taxonomy = (await user.get("/api/library/taxonomy")).data;
});

after(async () => {
  await app?.stop();
  fake?.server.close();
});

const balance = async (c) => (await c.get("/api/me")).data.user.credits;
const minorOf = (type, majorKey, key) => taxonomy[type].find((m) => m.key === majorKey).children.find((c) => c.key === key);
const waitJobs = (c, prefix, ids) => waitFor(async () => {
  const { data } = await c.get(`${prefix}/asset-jobs?ids=${ids.join(",")}`);
  return data.items.every((j) => ["succeeded", "failed"].includes(j.status)) ? data.items : null;
});

test("migration 4 adds more professions under 职业服装", () => {
  for (const key of ["security", "worker", "courier", "delivery-rider", "mechanic", "lawyer"]) {
    assert.ok(minorOf("outfit", "professional", key), key);
  }
  assert.equal(minorOf("outfit", "professional", "security").zh, "保安");
});

test("a batch makes one different asset per row, with gender and season in the prompt", async () => {
  const police = minorOf("outfit", "professional", "police");
  const nurse = minorOf("outfit", "professional", "nurse");
  const worker = minorOf("outfit", "professional", "worker");
  const before = await balance(user);
  const res = await user.post("/api/my/asset-jobs/batch", { type: "outfit", items: [
    { categoryId: police.id, gender: "female", season: "autumn-winter" },
    { categoryId: police.id, gender: "male", season: "autumn-winter" },
    { categoryId: nurse.id, gender: "female" },
    { categoryId: worker.id, gender: "male", description: "反光背心" }
  ] });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  assert.equal(res.data.items.length, 4);
  assert.equal(await balance(user), before - 4 * 6);
  const jobs = await waitJobs(user, "/api/my", res.data.items.map((j) => j.id));
  assert.ok(jobs.every((j) => j.status === "succeeded"), JSON.stringify(jobs.map((j) => j.errorMessage)));
  const names = jobs.map((j) => j.assets[0].name.zh).sort();
  assert.deepEqual(names, ["工人 · 男款 · 反光背心", "护士 · 女款", "警察 · 女款 · 秋冬", "警察 · 男款 · 秋冬"]);
  const prompts = fake.requests.slice(-4).map((r) => r.fields.prompt);
  const malePolice = prompts.find((p) => p.includes("Police") && p.includes("men's outfit"));
  assert.ok(malePolice, "male rows ask for a men's outfit");
  assert.match(malePolice, /an autumn\/winter version with warm layers/);
  assert.ok(prompts.some((p) => p.includes("Nurse") && p.includes("women's outfit")));
  assert.ok(prompts.some((p) => p.includes("Outfit details: 反光背心.")));
  assert.equal(jobs.find((j) => j.assets[0].name.zh === "护士 · 女款").variant, "女款");
});

test("a batch with identical rows, too many rows or a closed category charges nothing", async () => {
  const police = minorOf("outfit", "professional", "police");
  const lingerie = minorOf("outfit", "intimate", "lingerie");
  const before = await balance(user);
  const dup = await user.post("/api/my/asset-jobs/batch", { type: "outfit", items: [
    { categoryId: police.id, gender: "male" }, { categoryId: police.id, gender: "male" }] });
  assert.equal(dup.data.error.code, "DUPLICATE_ITEM");
  const many = await user.post("/api/my/asset-jobs/batch", { type: "outfit",
    items: Array.from({ length: 21 }, (_, i) => ({ categoryId: police.id, description: `款式 ${i}` })) });
  assert.equal(many.data.error.code, "BATCH_TOO_LARGE");
  const closed = await user.post("/api/my/asset-jobs/batch", { type: "outfit", items: [
    { categoryId: police.id, gender: "female", description: "夏季短袖" }, { categoryId: lingerie.id }] });
  assert.equal(closed.data.error.code, "CATEGORY_CLOSED");
  const bad = await user.post("/api/my/asset-jobs/batch", { type: "outfit", items: [{ categoryId: police.id, season: "monsoon" }] });
  assert.equal(bad.data.error.code, "INVALID_INPUT");
  assert.equal(await balance(user), before);
});

test("admin batches make free platform poses, and male poses ask for a male mannequin", async () => {
  const standing = minorOf("pose", "全身1人・標準系", "立ち");
  const sitting = minorOf("pose", "全身1人・標準系", "座り");
  const res = await admin.post("/api/admin/asset-jobs/batch", { type: "pose", publish: false, items: [
    { categoryId: standing.id, gender: "male", angle: "斜め" }, { categoryId: sitting.id, gender: "female", angle: "斜め" }] });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  assert.ok(res.data.items.every((j) => j.cost === 0 && j.platform));
  const jobs = await waitJobs(admin, "/api/admin", res.data.items.map((j) => j.id));
  assert.ok(jobs.every((j) => j.status === "succeeded"));
  const prompts = fake.requests.slice(-2).map((r) => r.fields.prompt);
  assert.ok(prompts.some((p) => p.includes("one male artist's mannequin") && p.includes("three-quarter view")));
  assert.ok(prompts.some((p) => p.includes("one female artist's mannequin")));
  assert.ok(jobs.every((j) => j.assets[0].origin === "platform" && !j.assets[0].enabled));
});

test("a scene batch splits by time of day and season", async () => {
  const street = minorOf("scene", "urban", "street");
  const res = await admin.post("/api/admin/asset-jobs/batch", { type: "scene", items: [
    { categoryId: street.id, time: "night" }, { categoryId: street.id, time: "dusk", season: "winter" }] });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  await waitJobs(admin, "/api/admin", res.data.items.map((j) => j.id));
  const prompts = fake.requests.slice(-2).map((r) => r.fields.prompt);
  assert.ok(prompts.some((p) => p.includes("Scene details: at night, lit by street and window lights.")));
  assert.ok(prompts.some((p) => p.includes("Scene details: in winter, with snow; at golden hour.")));
  assert.ok(fake.requests.slice(-2).every((r) => r.fields.size === "1536x1024"));
});

test("the camera preset and the realism switch add their prompt lines, and are kept on the work", async () => {
  const cfg = (await user.get("/api/public/config")).data;
  assert.ok(cfg.generation.cameras.some((c) => c.id === "85mm"));
  const plain = await user.post("/api/generations", { prompt: "a woman in a red coat", quality: "low" });
  assert.equal(plain.status, 201, JSON.stringify(plain.data));
  const res = await user.post("/api/generations", { prompt: "a woman in a blue coat", quality: "low", camera: "85mm", realism: true });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  assert.equal(res.data.generation.camera, "85mm");
  assert.equal(res.data.generation.realism, true);
  await waitFor(async () => (await user.get(`/api/generations/${res.data.generation.id}`)).data.generation.status === "succeeded");
  const withCamera = fake.requests.findLast((r) => String(r.fields.prompt).includes("blue coat")).fields.prompt;
  const without = fake.requests.findLast((r) => String(r.fields.prompt).includes("red coat")).fields.prompt;
  assert.match(withCamera, /Camera and lens: 85mm f\/1\.4 portrait lens/);
  assert.match(withCamera, /Make it look like a real, unretouched photograph/);
  assert.doesNotMatch(without, /Camera and lens|unretouched/);
  const badCamera = await user.post("/api/generations", { prompt: "x", quality: "low", camera: "fisheye-9000" });
  assert.equal(badCamera.data.error.code, "INVALID_CAMERA");
});

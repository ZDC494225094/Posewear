// 清晰度: output sizes per ratio and tier, which channels may draw 2K and 4K,
// and the model-cost estimate when a relay returns no token usage.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startApp, client, waitFor, listenLocal } from "./helpers.js";
import { createFakeOpenAI } from "../scripts/fake-openai.js";

let app, fake, admin, user, flexibleId, fixedId;

before(async () => {
  fake = createFakeOpenAI();
  await listenLocal(fake.server);
  const fakeBase = `http://127.0.0.1:${fake.server.address().port}/v1`;
  app = await startApp();
  admin = client(app.base);
  user = client(app.base);
  for (const c of [admin, user]) await c.get("/api/public/config");
  const login = await admin.post("/api/auth/login", { email: "admin@test.local", password: "admin-pass-123" });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  const { data } = await admin.get("/api/admin/channels");
  for (const channel of data.items) {
    const patch = channel.kind === "openai"
      ? { baseUrl: fakeBase, apiKey: "sk-test", enabled: true, model: "gpt-image-2", priority: 0, options: { sizeMode: "flexible" } }
      : { enabled: false };
    await admin.put(`/api/admin/channels/${channel.id}`, patch);
    if (channel.kind === "openai") flexibleId = channel.id;
  }
  // A fixed-size gpt-image-1.5 channel ahead of it in priority.
  const fixed = await admin.post("/api/admin/channels", { name: "gpt-image-1.5 备用", kind: "openai", baseUrl: fakeBase,
    apiKey: "sk-test", model: "gpt-image-1.5", priority: 10, enabled: true, options: { sizeMode: "fixed", inputFidelity: "high" } });
  assert.equal(fixed.status, 201, JSON.stringify(fixed.data));
  fixedId = fixed.data.channel.id;
  const reg = await user.post("/api/auth/register", { email: "fay@example.com", password: "secret-pass-1", agree: true });
  assert.equal(reg.status, 201, JSON.stringify(reg.data));
  const me = (await user.get("/api/me")).data.user;
  await admin.post(`/api/admin/users/${me.id}/credits`, { delta: 300, reason: "test" });
});

after(async () => {
  await app?.stop();
  fake?.server.close();
});

const balance = async (c) => (await c.get("/api/me")).data.user.credits;
const finished = (id) => waitFor(async () => {
  const { data } = await user.get(`/api/generations/${id}`);
  return ["succeeded", "failed"].includes(data.generation.status) ? data.generation : null;
});

test("the size overview lists every ratio's sizes, the experimental ones and their output cost", async () => {
  const { status, data } = await admin.get("/api/admin/generation/sizes");
  assert.equal(status, 200);
  assert.equal(data.bestTier, "uhd");
  assert.deepEqual(data.rows.map((r) => r.ratio), ["2:3", "3:4", "1:1", "4:3", "3:2", "9:16", "16:9"]);
  const row = (ratio) => data.rows.find((r) => r.ratio === ratio).tiers;
  assert.deepEqual(["standard", "hd", "uhd"].map((t) => row("2:3")[t].size), ["1024x1536", "1536x2304", "2336x3504"]);
  assert.deepEqual(["standard", "hd", "uhd"].map((t) => row("2:3")[t].experimental), [false, false, true]);
  // 2560×1440 is the experimental line itself, so 2K stays official.
  assert.equal(row("16:9").hd.size, "2560x1440");
  assert.equal(row("16:9").hd.experimental, false);
  // OpenAI's prices: 1024×1024 medium $0.053 (1,756 tokens), 1024×1536 medium $0.041, 3840×2160 high $0.40.
  assert.equal(row("1:1").standard.usd.medium.toFixed(5), "0.05268");
  assert.equal(row("2:3").standard.usd.medium.toFixed(5), "0.04116");
  assert.equal(row("16:9").uhd.usd.high.toFixed(5), "0.40026");
  assert.ok(Math.abs(data.yuanPerPoint.min - 99 / 1400) < 1e-9 && Math.abs(data.yuanPerPoint.max - 0.099) < 1e-9);
  const userView = await user.get("/api/admin/generation/sizes");
  assert.equal(userView.status, 403);
});

test("the studio is told each ratio's output size", async () => {
  const cfg = (await user.get("/api/public/config")).data.generation;
  assert.deepEqual(cfg.tiers.map((t) => t.id), ["standard", "hd"]);
  assert.equal(cfg.sizes["2:3"].hd, "1536x2304");
  assert.equal(cfg.sizes["9:16"].standard, "864x1536");
  assert.equal(cfg.sizes["2:3"].uhd, undefined, "4K is off by default");
});

test("2K works skip a fixed-size channel; standard ones keep the priority order", async () => {
  const standard = await user.post("/api/generations", { prompt: "a red coat", quality: "low", ratio: "2:3", tier: "standard" });
  assert.equal(standard.status, 201, JSON.stringify(standard.data));
  assert.equal((await finished(standard.data.generation.id)).status, "succeeded");
  assert.equal(fake.requests.at(-1).fields.model, "gpt-image-1.5");
  assert.equal(fake.requests.at(-1).fields.size, "1024x1536");

  const hd = await user.post("/api/generations", { prompt: "a red coat", quality: "low", ratio: "2:3", tier: "hd" });
  assert.equal(hd.status, 201, JSON.stringify(hd.data));
  const done = await finished(hd.data.generation.id);
  assert.equal(done.status, "succeeded");
  assert.equal(fake.requests.at(-1).fields.model, "gpt-image-2");
  assert.equal(fake.requests.at(-1).fields.size, "1536x2304");
  assert.equal(`${done.images[0].width}x${done.images[0].height}`, "1536x2304");
});

test("without a custom-size channel only the standard tier is offered", async () => {
  await admin.put(`/api/admin/channels/${flexibleId}`, { enabled: false });
  try {
    const cfg = (await user.get("/api/public/config")).data.generation;
    assert.deepEqual(cfg.tiers.map((t) => t.id), ["standard"]);
    assert.equal(cfg.defaultTier, "standard");
    assert.equal(cfg.upscale.enabled, false);
    assert.equal((await admin.get("/api/admin/generation/sizes")).data.bestTier, "standard");
    const before = await balance(user);
    const res = await user.post("/api/generations", { prompt: "a red coat", quality: "low", ratio: "2:3", tier: "hd" });
    assert.equal(res.status, 503);
    assert.equal(res.data.error.code, "TIER_UNSUPPORTED");
    assert.equal(await balance(user), before);
  } finally {
    await admin.put(`/api/admin/channels/${flexibleId}`, { enabled: true });
  }
});

test("a relay that answers 2K with a small image: the work is charged as standard and the channel held to it", async () => {
  const before = await balance(user);
  const res = await user.post("/api/generations", { prompt: "a red coat [fake:1k]", quality: "medium", ratio: "1:1", tier: "hd" });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  assert.equal(res.data.generation.cost, 10);
  const done = await finished(res.data.generation.id);
  assert.equal(done.status, "succeeded");
  assert.equal(fake.requests.at(-1).fields.size, "1920x1920");
  assert.equal(`${done.images[0].width}x${done.images[0].height}`, "1024x1024");
  // Kept, but charged as a standard image (6 points) and labelled so.
  assert.equal(done.tier, "standard");
  assert.equal(done.refunded, 4);
  assert.equal(done.errorCode, "SIZE_DOWNGRADED");
  assert.match(done.errorMessage, /只返回了 1024×1024 的图，按「标准」清晰度收费，已退回 4 点/);
  assert.equal(await balance(user), before - 6);

  const channel = (await admin.get("/api/admin/channels")).data.items.find((c) => c.id === flexibleId);
  assert.equal(channel.maxTier, "standard");
  assert.equal(channel.sizeLimit.requested, "1920x1920");
  assert.equal(channel.sizeLimit.delivered, "1024x1024");
  const cfg = (await user.get("/api/public/config")).data.generation;
  assert.deepEqual(cfg.tiers.map((t) => t.id), ["standard"]);
  assert.equal(cfg.upscale.enabled, false);
  const wedding = (await user.get("/api/wedding/catalog")).data;
  assert.equal(wedding.packages[0].photoText, "高清原图", "wedding photos fall back to standard and say so");
  const again = await user.post("/api/generations", { prompt: "a red coat", quality: "medium", ratio: "1:1", tier: "hd" });
  assert.equal(again.status, 503);
  assert.equal(again.data.error.code, "TIER_UNSUPPORTED");

  // Renaming or pausing keeps what was learned; pointing it elsewhere (model, URL, key) checks it again.
  const limitOf = async () => (await admin.get("/api/admin/channels")).data.items.find((c) => c.id === flexibleId).sizeLimit;
  await admin.put(`/api/admin/channels/${flexibleId}`, { name: "改个名字" });
  assert.equal((await limitOf())?.maxTier, "standard");
  await admin.put(`/api/admin/channels/${flexibleId}`, { model: "gpt-image-2.5-sunburst" });
  assert.equal(await limitOf(), null);
  await admin.put(`/api/admin/channels/${flexibleId}`, { name: "OpenAI 官方 · gpt-image-2", model: "gpt-image-2" });
  assert.deepEqual((await user.get("/api/public/config")).data.generation.tiers.map((t) => t.id), ["standard", "hd"]);
  assert.equal((await user.get("/api/wedding/catalog")).data.packages[0].photoText, "2K 高清原图");
});

test("a relay that caps the long edge at 2048 is held below 2K, judged by the job's ratio", async () => {
  const res = await user.post("/api/generations", { prompt: "a red coat [fake:cap2048]", quality: "medium", ratio: "2:3", tier: "hd" });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const done = await finished(res.data.generation.id);
  // 1536×2304 asked, 1365×2048 delivered: 2.80 M pixels, under 80% of 2:3's 2K.
  assert.equal(`${done.images[0].width}x${done.images[0].height}`, "1365x2048");
  assert.equal(done.tier, "standard");
  assert.equal(done.refunded, 4);
  const channel = (await admin.get("/api/admin/channels")).data.items.find((c) => c.id === flexibleId);
  assert.equal(channel.maxTier, "standard", "2.80 M pixels would pass for 3:4's 2K, but this ratio didn't get it");
  await admin.put(`/api/admin/channels/${flexibleId}`, { model: "gpt-image-2.5-flare" });
  await admin.put(`/api/admin/channels/${flexibleId}`, { model: "gpt-image-2" });
});

test("2K works queued behind one that showed the channel can't do 2K fail with a clear refund", async () => {
  await admin.put("/api/admin/settings/generation", { value: { workerConcurrency: 1 } });
  try {
    const before = await balance(user);
    const first = await user.post("/api/generations", { prompt: "a red coat [fake:1k] [fake:slow]", quality: "medium", ratio: "1:1", tier: "hd" });
    const second = await user.post("/api/generations", { prompt: "a blue coat", quality: "medium", ratio: "1:1", tier: "hd" });
    assert.equal(second.status, 201, JSON.stringify(second.data));
    assert.equal((await finished(first.data.generation.id)).tier, "standard");
    const failed = await finished(second.data.generation.id);
    assert.equal(failed.status, "failed");
    assert.equal(failed.errorCode, "TIER_UNSUPPORTED");
    assert.match(failed.errorMessage, /出不了 2K 的尺寸，本次点数已退回/);
    assert.equal(failed.refunded, 10);
    assert.equal(await balance(user), before - 6, "the first is charged as standard, the second not at all");
  } finally {
    await admin.put("/api/admin/settings/generation", { value: { workerConcurrency: 2 } });
    await admin.put(`/api/admin/channels/${flexibleId}`, { model: "gpt-image-2.5-flare" });
    await admin.put(`/api/admin/channels/${flexibleId}`, { model: "gpt-image-2" });
  }
});

test("the admin size check asks for 4K and records what the channel returns", async () => {
  const prompt = "A small ceramic cup of green tea";
  const ok = await admin.post(`/api/admin/channels/${flexibleId}/test`, { mode: "size" });
  assert.equal(ok.data.ok, true, JSON.stringify(ok.data));
  assert.equal(ok.data.tier, "uhd");
  assert.equal(fake.requests.at(-1).fields.size, "2336x3504");
  assert.equal(fake.requests.at(-1).fields.quality, "low");
  assert.ok(fake.requests.at(-1).fields.prompt.startsWith(prompt));
  const fixed = await admin.post(`/api/admin/channels/${fixedId}/test`, { mode: "size" });
  assert.equal(fixed.data.ok, false);
  assert.match(fixed.data.message, /尺寸模式不是「自定义尺寸」/);
  assert.equal(fake.requests.at(-1).fields.size, "2336x3504", "a fixed-size channel is not called");
});

test("with no usage from the relay, the cost is estimated from the size and model", async () => {
  const cost = async (body) => {
    const res = await user.post("/api/generations", { prompt: "a red coat [fake:nousage]", ratio: "2:3", ...body });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.equal((await finished(res.data.generation.id)).status, "succeeded");
    const { data } = await admin.get(`/api/admin/generations?q=${res.data.generation.id}`);
    return data.items[0].apiCostUsd;
  };
  // gpt-image-2 at 1536×2304 medium: 2,127 output tokens × $30 / 1M.
  assert.equal((await cost({ quality: "medium", tier: "hd" })).toFixed(5), "0.06381");
  // gpt-image-1.5 (the fixed channel): its 1024×1024 low price, scaled by area.
  assert.equal((await cost({ quality: "low", tier: "standard" })).toFixed(4), "0.0135");
  await admin.put(`/api/admin/channels/${fixedId}`, { enabled: false });
});

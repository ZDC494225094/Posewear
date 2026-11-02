// 渠道的模型: the endpoint's model list in the channel editor, Google Gemini
// (Nano Banana) channels, the 画质 each channel takes and its own 成本单价.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startApp, client, waitFor, listenLocal } from "./helpers.js";
import { createFakeOpenAI } from "../scripts/fake-openai.js";

let app, fake, admin, user, root, openaiId, geminiId;

before(async () => {
  fake = createFakeOpenAI();
  await listenLocal(fake.server);
  root = `http://127.0.0.1:${fake.server.address().port}`;
  app = await startApp();
  admin = client(app.base);
  user = client(app.base);
  for (const c of [admin, user]) await c.get("/api/public/config");
  const login = await admin.post("/api/auth/login", { email: "admin@test.local", password: "admin-pass-123" });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  const { data } = await admin.get("/api/admin/channels");
  for (const channel of data.items) {
    const patch = channel.kind === "openai"
      ? { baseUrl: `${root}/v1`, apiKey: "sk-test", enabled: true, model: "gpt-image-2", priority: 0, options: { sizeMode: "flexible" } }
      : { enabled: false };
    await admin.put(`/api/admin/channels/${channel.id}`, patch);
    if (channel.kind === "openai") openaiId = channel.id;
  }
  const reg = await user.post("/api/auth/register", { email: "gina@example.com", password: "secret-pass-1", agree: true });
  assert.equal(reg.status, 201, JSON.stringify(reg.data));
  const me = (await user.get("/api/me")).data.user;
  await admin.post(`/api/admin/users/${me.id}/credits`, { delta: 1000, reason: "test" });
});

after(async () => {
  await app?.stop();
  fake?.server.close();
});

const balance = async () => (await user.get("/api/me")).data.user.credits;
const finished = (id) => waitFor(async () => {
  const { data } = await user.get(`/api/generations/${id}`);
  return ["succeeded", "failed"].includes(data.generation.status) ? data.generation : null;
});
const make = async (body) => {
  const res = await user.post("/api/generations", { prompt: "a red coat", quality: "low", ratio: "2:3", tier: "standard", ...body });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return finished(res.data.generation.id);
};
const costOf = async (id) => (await admin.get(`/api/admin/generations?q=${id}`)).data.items[0].apiCostUsd;
const channelOf = async (id) => (await admin.get("/api/admin/channels")).data.items.find((c) => c.id === id);

test("the model list of an unsaved channel puts the models PoseWear knows first", async () => {
  const res = await admin.post("/api/admin/channels/models", { kind: "openai", baseUrl: `${root}/v1`, apiKey: "sk-test" });
  assert.equal(res.status, 200);
  assert.equal(res.data.ok, true, res.data.message);
  assert.deepEqual(res.data.models.map((m) => [m.id, m.profile]), [
    ["gpt-image-2", "gpt-image-2"], ["gpt-image-2.5-sunburst", "gpt-image-2.5-sunburst"], ["nano-banana-pro", "gemini-3-pro-image"],
    ["flux-kontext-pro", null], ["gpt-5.5", null]]);
  assert.deepEqual(res.data.models.map((m) => m.image), [true, true, true, true, false]);

  // A saved channel's key is used while the form shows it masked.
  const saved = await channelOf(openaiId);
  const masked = await admin.post("/api/admin/channels/models", { id: openaiId, kind: "openai", baseUrl: saved.baseUrl, apiKey: saved.apiKey });
  assert.equal(masked.data.ok, true, masked.data.message);
  const wrong = await admin.post("/api/admin/channels/models", { kind: "openai", baseUrl: `${root}/v1`, apiKey: "wrong-key" });
  assert.equal(wrong.status, 200);
  assert.equal(wrong.data.ok, false);
  assert.match(wrong.data.message, /^获取模型列表失败：HTTP 401 Incorrect API key/);
  const keyless = await admin.post("/api/admin/channels/models", { kind: "gemini", baseUrl: root });
  assert.deepEqual([keyless.data.ok, keyless.data.message], [false, "先填写 API Key"]);
  assert.equal((await user.post("/api/admin/channels/models", { kind: "openai", apiKey: "sk-test" })).status, 403);
});

test("a Gemini endpoint lists its generateContent models from every page", async () => {
  const before = fake.requests.length;
  const res = await admin.post("/api/admin/channels/models", { kind: "gemini", baseUrl: root, apiKey: "AIza-test" });
  assert.equal(res.data.ok, true, res.data.message);
  // The embedding model can't generate, so it is left out.
  assert.deepEqual(res.data.models.map((m) => [m.id, m.profile]), [
    ["gemini-3-pro-image", "gemini-3-pro-image"], ["gemini-3.1-flash-image", "gemini-3.1-flash-image"], ["gemini-3-flash", null]]);
  const calls = fake.requests.slice(before);
  assert.deepEqual(calls.map((r) => r.endpoint), ["gemini-models", "gemini-models"]);
  assert.ok(calls.every((r) => r.auth === "x-goog-api-key"));
  assert.match(calls[1].query, /pageToken=p2/);
});

test("a Nano Banana channel draws a 2K work from the references and the prompt", async () => {
  const created = await admin.post("/api/admin/channels", { name: "Google · Nano Banana Pro", kind: "gemini", baseUrl: root,
    apiKey: "AIza-test", model: "gemini-3-pro-image", priority: 20, enabled: true });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const channel = created.data.channel;
  geminiId = channel.id;
  assert.equal(channel.resolvedBaseUrl, `${root}/v1beta`);
  assert.deepEqual(channel.profile, { id: "gemini-3-pro-image", label: "Nano Banana Pro", kind: "gemini" });
  assert.equal(channel.maxTier, "uhd");

  const done = await make({ poseId: "std_P001_front", outfitId: "SPR-0001", prompt: "黄昏的天台", quality: "medium", tier: "hd" });
  assert.equal(done.status, "succeeded", done.errorMessage);
  const sent = fake.requests.at(-1);
  assert.deepEqual([sent.endpoint, sent.model, sent.auth], ["gemini", "gemini-3-pro-image", "x-goog-api-key"]);
  // Pose (line art, PNG) and outfit (JPEG) first, in the order the prompt numbers them, then the prompt.
  assert.deepEqual(sent.parts, ["image/png", "image/jpeg", "text"]);
  assert.match(sent.prompt, /黄昏的天台/);
  assert.deepEqual(sent.generationConfig, { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "2:3", imageSize: "2K" } });
  // The final image, not the draft "thought" image before it; 2K kept and charged as 2K.
  assert.equal(`${done.images[0].width}x${done.images[0].height}`, "1696x2528");
  assert.equal(done.tier, "hd");
  assert.equal(done.errorCode, null);
  // 按官方价: Nano Banana Pro is $0.134 per 1K or 2K image.
  assert.equal((await costOf(done.id)).toFixed(4), "0.1340");
});

test("a standard work sends no imageSize, and two images are two calls", async () => {
  const before = fake.requests.length;
  const done = await make({ ratio: "1:1", n: 2 });
  assert.equal(done.status, "succeeded", done.errorMessage);
  assert.deepEqual(done.images.map((i) => `${i.width}x${i.height}`), ["1024x1024", "1024x1024"]);
  const calls = fake.requests.slice(before).filter((r) => r.endpoint === "gemini");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].generationConfig, { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "1:1" } });
  assert.equal((await costOf(done.id)).toFixed(3), "0.268");
});

test("Nano Banana refusals fail the work at once and refund it", async () => {
  for (const [marker, code, message] of [
    ["[fake:moderation]", "moderation_blocked", /裸露或色情/],
    ["[fake:blocked]", "moderation_blocked", /内容未通过模型的安全审核/],
    ["[fake:noimage]", "NO_IMAGE", /模型无法处理这次请求/]
  ]) {
    const start = await balance();
    const before = fake.requests.length;
    const done = await make({ prompt: `a red coat ${marker}` });
    assert.equal(done.status, "failed", marker);
    assert.equal(done.errorCode, code, marker);
    assert.match(done.errorMessage, message);
    assert.equal(await balance(), start, `${marker} is refunded`);
    // Refused by the model: not retried and not sent to the OpenAI channel.
    assert.deepEqual(fake.requests.slice(before).map((r) => r.endpoint), ["gemini"], marker);
  }
});

test("a region Google doesn't serve hands the work to the next channel", async () => {
  const done = await make({ prompt: "a red coat [fake:location]" });
  assert.equal(done.status, "succeeded", done.errorMessage);
  assert.equal(fake.requests.at(-1).endpoint, "generations");
  const gemini = await channelOf(geminiId);
  assert.match(gemini.lastError, /User location is not supported/);
});

test("the admin checks Nano Banana's sizes and connection", async () => {
  const size = await admin.post(`/api/admin/channels/${geminiId}/test`, { mode: "size" });
  assert.equal(size.data.ok, true, size.data.message);
  assert.equal(size.data.tier, "uhd");
  assert.match(size.data.message, /^能出 4K/);
  assert.deepEqual(fake.requests.at(-1).generationConfig.imageConfig, { aspectRatio: "2:3", imageSize: "4K" });
  const ping = await admin.post(`/api/admin/channels/${geminiId}/test`, { mode: "ping" });
  assert.deepEqual([ping.data.ok, ping.data.modelListed], [true, true]);

  // Set to 标准 only (as for Nano Banana 2 Lite): nothing to check, and nothing is called.
  await admin.put(`/api/admin/channels/${geminiId}`, { options: { maxTier: "standard" } });
  try {
    assert.equal((await channelOf(geminiId)).maxTier, "standard");
    const before = fake.requests.length;
    const capped = await admin.post(`/api/admin/channels/${geminiId}/test`, { mode: "size" });
    assert.equal(capped.data.ok, false);
    assert.match(capped.data.message, /最高清晰度设成了「标准」/);
    assert.equal(fake.requests.length, before);
  } finally {
    await admin.put(`/api/admin/channels/${geminiId}`, { options: { maxTier: "uhd" } });
  }
});

test("each 画质 goes to the channels that take it", async () => {
  assert.equal((await admin.put(`/api/admin/channels/${geminiId}`, { options: { qualities: [] } })).status, 400);
  await admin.put(`/api/admin/channels/${geminiId}`, { options: { qualities: ["high"] } });
  await admin.put(`/api/admin/channels/${openaiId}`, { options: { qualities: ["low", "medium"], maxTier: "standard" } });
  try {
    const low = await make({ quality: "low" });
    assert.equal(low.status, "succeeded", low.errorMessage);
    assert.equal(fake.requests.at(-1).endpoint, "generations");
    const high = await make({ quality: "high" });
    assert.equal(high.status, "succeeded", high.errorMessage);
    assert.equal(fake.requests.at(-1).endpoint, "gemini");

    // The studio learns which tiers come with which 画质.
    const cfg = (await user.get("/api/public/config")).data.generation;
    assert.deepEqual(cfg.qualities.map((q) => q.id), ["low", "medium", "high"]);
    assert.deepEqual(cfg.qualityTiers, { low: "standard", medium: "standard", high: "hd" });
    const lowHd = await user.post("/api/generations", { prompt: "a red coat", quality: "low", ratio: "2:3", tier: "hd" });
    assert.equal(lowHd.status, 503);
    assert.equal(lowHd.data.error.code, "TIER_UNSUPPORTED");
    assert.match(lowHd.data.error.message, /接「草稿」画质的生成渠道出不了「2K 高清」的尺寸/);

    // Without the channel that takes 精细, the studio doesn't offer it.
    await admin.put(`/api/admin/channels/${geminiId}`, { enabled: false });
    const narrowed = (await user.get("/api/public/config")).data.generation;
    assert.deepEqual(narrowed.qualities.map((q) => q.id), ["low", "medium"]);
    const start = await balance();
    const refused = await user.post("/api/generations", { prompt: "a red coat", quality: "high", ratio: "2:3", tier: "standard" });
    assert.equal(refused.status, 503);
    assert.equal(refused.data.error.code, "QUALITY_UNSUPPORTED");
    assert.equal(await balance(), start);
  } finally {
    await admin.put(`/api/admin/channels/${geminiId}`, { enabled: true, options: { qualities: ["low", "medium", "high"] } });
    await admin.put(`/api/admin/channels/${openaiId}`, { options: { qualities: ["low", "medium", "high"], maxTier: "uhd" } });
  }
});

test("a queued work whose 画质 no channel takes any more fails with a refund", async () => {
  await admin.put("/api/admin/settings/generation", { value: { workerConcurrency: 1 } });
  await admin.put(`/api/admin/channels/${geminiId}`, { options: { qualities: ["high"] } });
  try {
    const start = await balance();
    const slow = await user.post("/api/generations", { prompt: "a red coat [fake:slow]", quality: "low", ratio: "2:3" });
    const queued = await user.post("/api/generations", { prompt: "a blue coat", quality: "high", ratio: "2:3" });
    assert.equal(queued.status, 201, JSON.stringify(queued.data));
    await admin.put(`/api/admin/channels/${geminiId}`, { enabled: false });
    await admin.put(`/api/admin/channels/${openaiId}`, { options: { qualities: ["low", "medium"] } });
    assert.equal((await finished(slow.data.generation.id)).status, "succeeded");
    const failed = await finished(queued.data.generation.id);
    assert.equal(failed.status, "failed");
    assert.equal(failed.errorCode, "QUALITY_UNSUPPORTED");
    assert.match(failed.errorMessage, /不接「精细」画质，本次点数已退回/);
    assert.equal(await balance(), start - slow.data.generation.cost);
  } finally {
    await admin.put("/api/admin/settings/generation", { value: { workerConcurrency: 2 } });
    await admin.put(`/api/admin/channels/${geminiId}`, { enabled: true, options: { qualities: ["low", "medium", "high"] } });
    await admin.put(`/api/admin/channels/${openaiId}`, { options: { qualities: ["low", "medium", "high"] } });
  }
});

test("a channel's own 成本单价: per image in yuan, or per token in dollars", async () => {
  await admin.put("/api/admin/settings/generation", { value: { usdToCny: 7 } });
  try {
    const saved = await admin.put(`/api/admin/channels/${geminiId}`, { options: { pricing: { mode: "image", currency: "cny", standard: 0.7, hd: 1.4, uhd: 2.1 } } });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    // Changing one price keeps the others.
    await admin.put(`/api/admin/channels/${geminiId}`, { options: { pricing: { uhd: 2.8 } } });
    assert.deepEqual((await channelOf(geminiId)).options.pricing,
      { mode: "image", currency: "cny", textInput: 0, imageInput: 0, imageOutput: 0, textOutput: 0, standard: 0.7, hd: 1.4, uhd: 2.8 });
    // ¥0.70 at 7 yuan to the dollar.
    assert.equal((await costOf((await make({ quality: "low" })).id)).toFixed(4), "0.1000");
    assert.equal((await costOf((await make({ quality: "low", tier: "hd" })).id)).toFixed(4), "0.2000");
    // The 清晰度一览 prices the same images at each channel's own prices.
    const sizes = (await admin.get("/api/admin/generation/sizes")).data;
    const row = sizes.channels.find((c) => c.id === geminiId);
    assert.equal(row.pricing, "image");
    assert.equal(row.usd["2:3"].uhd.high.toFixed(2), "0.40");

    // Per token: the usage the relay returns (300 text + 1,200 image tokens in, 6,000 out).
    await admin.put(`/api/admin/channels/${geminiId}`, { enabled: false });
    await admin.put(`/api/admin/channels/${openaiId}`, { options: { pricing: { mode: "token", currency: "usd", textInput: 1, imageInput: 2, imageOutput: 10 } } });
    assert.equal((await costOf((await make({ quality: "low" })).id)).toFixed(4), "0.0627");
  } finally {
    await admin.put("/api/admin/settings/generation", { value: { usdToCny: 7.2 } });
    await admin.put(`/api/admin/channels/${geminiId}`, { enabled: true, options: { pricing: { mode: "auto" } } });
    await admin.put(`/api/admin/channels/${openaiId}`, { options: { pricing: { mode: "auto" } } });
  }
});

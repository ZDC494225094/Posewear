// A channel with several models: adding them, each one's size check, and
// 清晰度分配 sending each tier to the models assigned to it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startApp, client, waitFor, listenLocal } from "./helpers.js";
import { createFakeOpenAI } from "../scripts/fake-openai.js";

let app, fake, admin, user, fakeBase, seededId;

before(async () => {
  fake = createFakeOpenAI();
  await listenLocal(fake.server);
  fakeBase = `http://127.0.0.1:${fake.server.address().port}/v1`;
  app = await startApp();
  admin = client(app.base);
  user = client(app.base);
  for (const c of [admin, user]) await c.get("/api/public/config");
  const login = await admin.post("/api/auth/login", { email: "admin@test.local", password: "admin-pass-123" });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  // Start from no usable channel: the seeded ones are switched off.
  for (const channel of (await admin.get("/api/admin/channels")).data.items) {
    await admin.put(`/api/admin/channels/${channel.id}`, { enabled: false });
    if (channel.kind === "openai") seededId = channel.id;
  }
  const reg = await user.post("/api/auth/register", { email: "hana@example.com", password: "secret-pass-1", agree: true });
  assert.equal(reg.status, 201, JSON.stringify(reg.data));
  const me = (await user.get("/api/me")).data.user;
  await admin.post(`/api/admin/users/${me.id}/credits`, { delta: 500, reason: "test" });
});

after(async () => {
  await app?.stop();
  fake?.server.close();
});

const finished = (id) => waitFor(async () => {
  const { data } = await user.get(`/api/generations/${id}`);
  return ["succeeded", "failed"].includes(data.generation.status) ? data.generation : null;
});
const make = async (body) => {
  const res = await user.post("/api/generations", { prompt: "a red coat", quality: "low", ratio: "2:3", tier: "standard", ...body });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return finished(res.data.generation.id);
};
const channel = async (id) => (await admin.get("/api/admin/channels")).data.items.find((c) => c.id === id);
const newChannel = async (name, priority) => {
  const res = await admin.post("/api/admin/channels", { name, kind: "openai", baseUrl: fakeBase, apiKey: "sk-test", priority, enabled: true });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  assert.deepEqual(res.data.channel.models, [], "the connection comes first; models are added after");
  return res.data.channel.id;
};
const addModels = async (id, models) => {
  const res = await admin.post(`/api/admin/channels/${id}/models`, { models });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return res.data.channel.models;
};

test("a channel offers several models, each set up from what PoseWear knows about it", async () => {
  const id = await newChannel("中转 A", 10);
  const models = await addModels(id, ["gpt-image-2", "gpt-image-1.5", "gpt-image-2"]);
  assert.deepEqual(models.map((m) => m.model), ["gpt-image-2", "gpt-image-1.5"], "a model already there is skipped");
  const [two, old] = models;
  assert.deepEqual([two.options.sizeMode, two.options.inputFidelity, two.maxTier], ["flexible", "omit", "uhd"]);
  assert.deepEqual([old.options.sizeMode, old.options.inputFidelity, old.maxTier], ["fixed", "high", "standard"]);
  assert.equal((await admin.post(`/api/admin/channels/${id}/models`, { models: ["bad model id"] })).status, 400);

  // Each model has its own 画质 and cost; the channel keeps how to reach the API.
  const saved = await admin.put(`/api/admin/channel-models/${old.id}`, { options: { qualities: ["low"], pricing: { mode: "image", standard: 0.02 } } });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const updated = saved.data.channel.models.find((m) => m.id === old.id);
  assert.deepEqual(updated.options.qualities, ["low"]);
  assert.equal(updated.options.pricing.standard, 0.02);
  assert.deepEqual(saved.data.channel.models.find((m) => m.id === two.id).options.qualities, ["low", "medium", "high"]);
  assert.equal((await admin.put(`/api/admin/channel-models/${old.id}`, { model: "gpt-image-2" })).data.error.code, "MODEL_EXISTS");

  // 低 画质 standard works go to gpt-image-2 first (model order), unless it's switched off.
  assert.equal(fake.requests.length, 0);
  await make({});
  assert.equal(fake.requests.at(-1).fields.model, "gpt-image-2");
  await admin.put(`/api/admin/channel-models/${two.id}`, { enabled: false });
  await make({});
  assert.equal(fake.requests.at(-1).fields.model, "gpt-image-1.5");
  await admin.put(`/api/admin/channel-models/${two.id}`, { enabled: true });
  const removed = await admin.del(`/api/admin/channel-models/${old.id}`);
  assert.deepEqual(removed.data.channel.models.map((m) => m.model), ["gpt-image-2"]);
});

test("a model's size check asks for 4K, and for 2K only when 4K comes back below 2K", async () => {
  const id = await newChannel("中转 B", 0);
  const [capped, small] = await addModels(id, ["gpt-image-2-cap2560", "gpt-image-2-1k"]);
  // Long edge capped at 2560: 4K answered with 1707×2560, which passes for 2K, so 2K needs no second call.
  let before = fake.requests.length;
  const one = await admin.post(`/api/admin/channel-models/${capped.id}/test`, { mode: "size" });
  assert.equal(one.data.ok, true, one.data.message);
  assert.equal(one.data.tier, "hd");
  assert.equal(fake.requests.length - before, 1);
  assert.equal(fake.requests.at(-1).fields.size, "2336x3504");
  assert.deepEqual([one.data.sizes.uhd.ok, one.data.sizes.uhd.delivered, one.data.sizes.hd.ok, one.data.sizes.hd.inferred], [false, "1707x2560", true, true]);
  assert.match(one.data.message, /最高只能出2K/);
  let m = (await channel(id)).models.find((x) => x.id === capped.id);
  assert.equal(m.maxTier, "hd");
  assert.equal(m.sizes.uhd.delivered, "1707x2560");

  // A relay that always answers 1024×1024: 4K, then 2K, both come back small.
  before = fake.requests.length;
  const two = await admin.post(`/api/admin/channel-models/${small.id}/test`, { mode: "size" });
  assert.equal(two.data.ok, false);
  assert.equal(two.data.tier, "standard");
  assert.deepEqual(fake.requests.slice(before).map((r) => r.fields.size), ["2336x3504", "1536x2304"]);
  m = (await channel(id)).models.find((x) => x.id === small.id);
  assert.equal(m.maxTier, "standard");

  // Pointing the channel at another relay forgets what its models' checks learned.
  await admin.put(`/api/admin/channels/${id}`, { baseUrl: `${fakeBase}/` });
  assert.deepEqual((await channel(id)).models.map((x) => [x.maxTier, x.sizes]), [["uhd", null], ["uhd", null]]);
  await admin.put(`/api/admin/channels/${id}`, { enabled: false });
});

test("清晰度分配 sends each tier to its models in order, and falls back when they can't be used", async () => {
  const a = await newChannel("渠道甲", 10);
  const b = await newChannel("渠道乙", 0);
  const [twoA] = await addModels(a, ["gpt-image-2"]);
  const [sunburst, flare] = await addModels(b, ["gpt-image-2.5-sunburst", "gpt-image-2.5-flare"]);
  const others = (await admin.get("/api/admin/channels")).data.items.filter((c) => ![a, b].includes(c.id));
  for (const c of others) await admin.put(`/api/admin/channels/${c.id}`, { enabled: false });

  // Nothing assigned: by channel priority.
  await make({ tier: "hd" });
  assert.equal(fake.requests.at(-1).fields.model, "gpt-image-2");
  // 2K assigned to channel 乙's flare, then sunburst; standard left automatic.
  const saved = await admin.put("/api/admin/channel-routes", { hd: [flare.id, sunburst.id, 999999], uhd: [] });
  assert.deepEqual(saved.data.routes, { standard: [], hd: [flare.id, sunburst.id], uhd: [] }, "unknown models are dropped");
  assert.deepEqual((await admin.get("/api/admin/channels")).data.routes.hd, [flare.id, sunburst.id]);
  await make({ tier: "hd" });
  assert.equal(fake.requests.at(-1).fields.model, "gpt-image-2.5-flare");
  assert.equal(fake.requests.at(-1).fields.size, "1536x2304");
  await make({ tier: "standard" });
  assert.equal(fake.requests.at(-1).fields.model, "gpt-image-2");
  // The first assigned model fails over to the next assigned one, not to another channel.
  const failed = await make({ tier: "hd", prompt: "a red coat [fake:503]" });
  assert.equal(failed.status, "failed");
  const tried = JSON.parse((await admin.get(`/api/admin/generations?q=${failed.id}`)).data.items[0].errorDetail).map((e) => e.channel);
  assert.ok(tried.every((c) => c === b), "only channel 乙's assigned models were tried");
  // None of the assigned models usable: back to every model that draws 2K.
  await admin.put(`/api/admin/channels/${b}`, { enabled: false });
  await make({ tier: "hd" });
  assert.equal(fake.requests.at(-1).fields.model, "gpt-image-2");
  await admin.put(`/api/admin/channels/${b}`, { enabled: true });
  // Removing a model takes it out of 清晰度分配.
  await admin.del(`/api/admin/channel-models/${flare.id}`);
  assert.deepEqual((await admin.get("/api/admin/channels")).data.routes.hd, [sunburst.id]);
  await admin.put("/api/admin/channel-routes", {});
  assert.equal((await user.get("/api/admin/channels")).status, 403);
  assert.equal((await user.put("/api/admin/channel-routes", { hd: [twoA.id] })).status, 403);
});

test("a channel's old single-model fields still work for API clients", async () => {
  // PUT with model and model settings changes the channel's first model.
  const res = await admin.put(`/api/admin/channels/${seededId}`, { model: "gpt-image-1-mini", options: { sizeMode: "fixed", connectTimeoutSec: 9 } });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const c = res.data.channel;
  assert.equal(c.model, "gpt-image-1-mini");
  assert.equal(c.models[0].options.sizeMode, "fixed");
  assert.equal(c.options.connectTimeoutSec, 9);
  assert.equal(c.maxTier, "standard");
});

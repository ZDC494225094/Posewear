// 作品超分: redrawing one image of a finished work at 2K or 4K as a new work.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { startApp, client, waitFor, listenLocal } from "./helpers.js";
import { createFakeOpenAI } from "../scripts/fake-openai.js";

let app, fake, admin, user, other;
const openaiChannels = [];

before(async () => {
  fake = createFakeOpenAI({ keepBodies: true });
  await listenLocal(fake.server);
  const fakeBase = `http://127.0.0.1:${fake.server.address().port}/v1`;
  app = await startApp();
  admin = client(app.base);
  user = client(app.base);
  other = client(app.base);
  for (const c of [admin, user, other]) await c.get("/api/public/config");
  const login = await admin.post("/api/auth/login", { email: "admin@test.local", password: "admin-pass-123" });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  const { data } = await admin.get("/api/admin/channels");
  for (const channel of data.items) {
    const patch = channel.kind === "openai" ? { baseUrl: fakeBase, apiKey: "sk-test", enabled: true } : { enabled: false };
    await admin.put(`/api/admin/channels/${channel.id}`, patch);
    if (channel.kind === "openai") openaiChannels.push(channel.id);
  }
  for (const [c, email] of [[user, "dana@example.com"], [other, "erin@example.com"]]) {
    const reg = await c.post("/api/auth/register", { email, password: "secret-pass-1", agree: true });
    assert.equal(reg.status, 201, JSON.stringify(reg.data));
    const me = (await c.get("/api/me")).data.user;
    await admin.post(`/api/admin/users/${me.id}/credits`, { delta: 500, reason: "test" });
  }
});

after(async () => {
  await app?.stop();
  fake?.server.close();
});

const balance = async (c) => (await c.get("/api/me")).data.user.credits;
const finished = (c, id) => waitFor(async () => {
  const { data } = await c.get(`/api/generations/${id}`);
  return ["succeeded", "failed"].includes(data.generation.status) ? data.generation : null;
});

async function makeWork(c, body = {}) {
  const res = await c.post("/api/generations", { prompt: "a woman in a red coat", quality: "low", ratio: "2:3", ...body });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const gen = await finished(c, res.data.generation.id);
  assert.equal(gen.status, "succeeded", gen.errorMessage);
  return gen;
}

test("an image is redrawn at 4K as a new work that keeps the source's references", async () => {
  const source = await makeWork(user, { poseId: "std_P001_front", outfitId: "SPR-0001", prompt: "黄昏的天台" });
  const [image] = source.images;
  assert.equal(`${image.width}x${image.height}`, "1024x1536");
  assert.deepEqual(image.upscale, { hd: "1536x2304", uhd: "2336x3504" });
  const cfg = (await user.get("/api/public/config")).data.generation.upscale;
  assert.deepEqual(cfg, { enabled: true, targets: ["hd", "uhd"], hdCredits: 10, uhdCredits: 17 });

  const before = await balance(user);
  const res = await user.post(`/api/generations/${source.id}/upscale`, { imageId: image.id, target: "uhd" });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const job = res.data.generation;
  assert.equal(job.cost, 17);
  assert.equal(job.assetFee, 0);
  assert.equal(job.upscaleOf, image.id);
  assert.equal(job.tier, "uhd");
  assert.equal(job.size, "2336x3504");
  assert.equal(await balance(user), before - 17);

  const done = await finished(user, job.id);
  assert.equal(done.status, "succeeded", done.errorMessage);
  assert.equal(`${done.images[0].width}x${done.images[0].height}`, "2336x3504");
  assert.deepEqual(done.images[0].upscale, { hd: null, uhd: null });
  // Only the image goes to the model, with the 超分 prompt and size.
  const sent = fake.requests.at(-1);
  assert.equal(sent.endpoint, "edits");
  assert.equal(sent.files.length, 1);
  assert.equal(sent.fields.size, "2336x3504");
  assert.equal(sent.fields.quality, "medium");
  assert.match(sent.fields.prompt, /^Image 1 is a finished image\. Recreate it at a higher resolution/);
  // The new work still shows what the source was made from.
  assert.equal(done.refs.pose.id, "std_P001_front");
  assert.equal(done.refs.outfit.id, "SPR-0001");
  assert.equal(done.prompt, "黄昏的天台");
  assert.equal(done.ratio, "2:3");

  const again = await user.post(`/api/generations/${done.id}/upscale`, { imageId: done.images[0].id, target: "hd" });
  assert.equal(again.status, 400);
  assert.equal(again.data.error.code, "ALREADY_LARGE");
  assert.equal(await balance(user), before - 17);
});

test("the image goes to the model without its AI生成 label", async () => {
  const source = await makeWork(user);
  const [image] = source.images;
  const res = await user.post(`/api/generations/${source.id}/upscale`, { imageId: image.id, target: "hd" });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  assert.equal((await finished(user, res.data.generation.id)).status, "succeeded");
  // The fake API draws a flat (200, 120, 90) picture; the label is a dark pill
  // in the bottom-right corner (872–998 × 1461–1510 on a 1024×1536 image).
  // (stats() reads the whole input, so cut the corner out first.)
  const red = async (input) => (await sharp(await sharp(input).extract({ left: 872, top: 1461, width: 126, height: 49 }).toBuffer()).stats()).channels[0].mean;
  const saved = Buffer.from(await (await user.raw(image.url)).arrayBuffer());
  assert.ok(await red(saved) < 185, "the saved work carries the label");
  const sent = fake.requests.at(-1).files[0].body;
  assert.ok(Math.abs((await red(sent)) - 200) < 6, "what the model gets doesn't");
});

test("only the owner can upscale, and only images of that work", async () => {
  const source = await makeWork(user);
  const [image] = source.images;
  const stranger = await other.post(`/api/generations/${source.id}/upscale`, { imageId: image.id, target: "hd" });
  assert.equal(stranger.status, 404);
  const mine = await makeWork(other);
  const mixed = await other.post(`/api/generations/${mine.id}/upscale`, { imageId: image.id, target: "hd" });
  assert.equal(mixed.status, 404);
  const bad = await user.post(`/api/generations/${source.id}/upscale`, { imageId: image.id, target: "8k" });
  assert.equal(bad.status, 400);
});

test("an upscale of a work the admin hid stays hidden and can't be published", async () => {
  const source = await makeWork(user);
  assert.equal((await admin.patch(`/api/admin/generations/${source.id}`, { hidden: true })).status, 200);
  const res = await user.post(`/api/generations/${source.id}/upscale`, { imageId: source.images[0].id, target: "hd" });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  assert.equal(res.data.generation.hidden, true);
  const done = await finished(user, res.data.generation.id);
  assert.equal(done.status, "succeeded");
  const publish = await user.post(`/api/generations/${done.id}/publish`, { public: true });
  assert.equal(publish.status, 403);
  assert.equal(publish.data.error.code, "HIDDEN_BY_ADMIN");
});

test("a channel that ignores the size gets the upscale refunded", async () => {
  const prompt = (await admin.get("/api/admin/settings/prompt")).data.value.upscale;
  await admin.put("/api/admin/settings/prompt", { value: { upscale: `${prompt} [fake:1k]` } });
  try {
    const source = await makeWork(user);
    const before = await balance(user);
    const res = await user.post(`/api/generations/${source.id}/upscale`, { imageId: source.images[0].id, target: "hd" });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.equal(await balance(user), before - 10);
    const done = await finished(user, res.data.generation.id);
    assert.equal(done.status, "failed");
    assert.equal(done.errorCode, "UPSCALE_TOO_SMALL");
    assert.equal(done.refunded, 10);
    assert.equal(done.images.length, 0);
    assert.equal(await balance(user), before);
  } finally {
    await admin.put("/api/admin/settings/prompt", { value: { upscale: prompt } });
  }
});

test("upscaling needs a channel with custom sizes, and can be switched off", async () => {
  const source = await makeWork(user);
  const body = { imageId: source.images[0].id, target: "hd" };
  for (const id of openaiChannels) await admin.put(`/api/admin/channels/${id}`, { options: { sizeMode: "fixed" } });
  try {
    const fixed = await user.post(`/api/generations/${source.id}/upscale`, body);
    assert.equal(fixed.status, 503);
    assert.equal(fixed.data.error.code, "UPSCALE_UNSUPPORTED");
  } finally {
    for (const id of openaiChannels) await admin.put(`/api/admin/channels/${id}`, { options: { sizeMode: "flexible" } });
  }
  await admin.put("/api/admin/settings/generation", { value: { upscale: { enabled: false } } });
  try {
    assert.equal((await user.get("/api/public/config")).data.generation.upscale.enabled, false);
    const off = await user.post(`/api/generations/${source.id}/upscale`, body);
    assert.equal(off.status, 403);
    assert.equal(off.data.error.code, "UPSCALE_DISABLED");
  } finally {
    await admin.put("/api/admin/settings/generation", { value: { upscale: { enabled: true } } });
  }
});

test("deleting a work also deletes its WebP display copies", async () => {
  const gen = await makeWork(user);
  const view = await user.raw(gen.images[0].view);
  assert.equal(view.status, 200);
  const dir = path.join(app.tmp, "data", "generations");
  const files = () => fs.readdirSync(dir, { recursive: true }).filter((f) => String(f).includes(gen.id));
  assert.ok(files().some((f) => String(f).endsWith(".view.webp")), "the display copy is saved next to the image");
  assert.equal((await user.del(`/api/generations/${gen.id}`)).status, 200);
  assert.deepEqual(files(), []);
});

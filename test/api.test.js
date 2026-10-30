// End-to-end tests: a real server process, a fixture asset library, and a
// fake OpenAI Image API, exercising the paths that cost or move money.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startApp, client, waitFor } from "./helpers.js";
import { createFakeOpenAI } from "../scripts/fake-openai.js";
import sharp from "sharp";

let app, fake, fakeBase, admin, user;

before(async () => {
  fake = createFakeOpenAI();
  await new Promise((r) => fake.server.listen(0, "127.0.0.1", r));
  fakeBase = `http://127.0.0.1:${fake.server.address().port}/v1`;
  app = await startApp();
  admin = client(app.base);
  user = client(app.base);
  await admin.get("/api/public/config");
  await user.get("/api/public/config");
  const login = await admin.post("/api/auth/login", { email: "admin@test.local", password: "admin-pass-123" });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  // Point the seeded OpenAI channel at the fake API and turn the mock channel off.
  const { data } = await admin.get("/api/admin/channels");
  for (const channel of data.items) {
    if (channel.kind === "openai") {
      const r = await admin.put(`/api/admin/channels/${channel.id}`, { baseUrl: fakeBase, apiKey: "sk-test", enabled: true });
      assert.equal(r.status, 200, JSON.stringify(r.data));
    } else {
      await admin.put(`/api/admin/channels/${channel.id}`, { enabled: false });
    }
  }
});

after(async () => {
  await app?.stop();
  fake?.server.close();
});

const poll = (c, id) => waitFor(async () => {
  const { data } = await c.get(`/api/generations/${id}`);
  return ["succeeded", "failed"].includes(data.generation.status) ? data.generation : null;
});

const balance = async (c) => (await c.get("/api/me")).data.user.credits;

test("rejects state-changing requests without the CSRF header", async () => {
  const res = await fetch(`${app.base}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "a@b.cc", password: "x" })
  });
  assert.equal(res.status, 403);
});

test("registration grants the signup bonus", async () => {
  const res = await user.post("/api/auth/register", { email: "alice@example.com", password: "secret-pass-1", agree: true });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  assert.equal(res.data.user.credits, 20);
  const again = await client(app.base);
  await again.get("/api/public/config");
  const dup = await again.post("/api/auth/register", { email: "ALICE@example.com", password: "secret-pass-1", agree: true });
  assert.equal(dup.status, 409, "emails are unique regardless of case");
});

test("normal users cannot reach admin endpoints", async () => {
  const res = await user.get("/api/admin/overview");
  assert.equal(res.status, 403);
});

test("channel test ping succeeds against the API", async () => {
  const { data } = await admin.get("/api/admin/channels");
  const openai = data.items.find((c) => c.kind === "openai");
  assert.equal(openai.apiKey.set, true);
  assert.ok(!JSON.stringify(data).includes("sk-test"), "API key must never be returned in full");
  const ping = await admin.post(`/api/admin/channels/${openai.id}/test`, { mode: "ping" });
  assert.equal(ping.data.ok, true, JSON.stringify(ping.data));
});

test("library hides explicit assets and marks AI usability", async () => {
  const meta = await user.get("/api/library/meta");
  assert.ok(!meta.data.pose.series.some((s) => s.key === "2人絡み"), "explicit duo series must be hidden");
  const explicitThumb = await user.raw("/media/library/pair_P003_front/thumb");
  assert.equal(explicitThumb.status, 404);
  const poses = await user.get("/api/library/poses?view=image");
  const sexy = poses.data.items.find((p) => p.id === "sexy_P002_front");
  assert.equal(sexy.ai, true);
  assert.equal(sexy.aiWithPerson, false);
});

test("generation with pose + outfit calls /images/edits and stores a labelled PNG", async () => {
  const before = await balance(user);
  const res = await user.post("/api/generations", { poseId: "std_P001_front", outfitId: "SPR-0001", quality: "low", tier: "standard", ratio: "2:3", n: 1, style: "photo" });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  assert.equal(await balance(user), before - 2);
  const gen = await poll(user, res.data.generation.id);
  assert.equal(gen.status, "succeeded", JSON.stringify(gen));
  assert.equal(gen.images.length, 1);

  const call = fake.requests.at(-1);
  assert.equal(call.endpoint, "edits");
  assert.equal(call.fields.model, "gpt-image-2");
  assert.equal(call.fields.size, "1024x1536");
  assert.equal(call.fields.quality, "low");
  assert.equal(call.fields.input_fidelity, undefined, "gpt-image-2 must not receive input_fidelity");
  assert.equal(call.files.filter((f) => f.field === "image[]").length, 2);
  assert.match(call.fields.prompt, /Image 1 is the POSE reference/);
  assert.match(call.fields.prompt, /Image 2 is the OUTFIT reference/);
  assert.match(call.fields.prompt, /ivory knit denim skirt/);

  const img = await user.raw(gen.images[0].url);
  assert.equal(img.status, 200);
  const buf = Buffer.from(await img.arrayBuffer());
  assert.equal(buf.subarray(1, 4).toString(), "PNG");
  assert.ok(buf.includes(Buffer.from("AIGC")), "implicit AIGC metadata chunk present");
  const meta = await sharp(buf).metadata();
  assert.equal(`${meta.width}x${meta.height}`, "1024x1536");

  const stranger = client(app.base);
  const denied = await stranger.raw(gen.images[0].url);
  assert.equal(denied.status, 404, "private work must not be visible to others");
});

test("text-only generation uses /images/generations", async () => {
  const res = await user.post("/api/generations", { prompt: "a red umbrella on a rainy street", quality: "low", ratio: "1:1", n: 1 });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const gen = await poll(user, res.data.generation.id);
  assert.equal(gen.status, "succeeded");
  assert.equal(fake.requests.at(-1).endpoint, "generations");
  assert.equal(fake.requests.at(-1).fields.size, "1024x1024");
});

test("moderation rejection fails the job and refunds credits", async () => {
  const before = await balance(user);
  const res = await user.post("/api/generations", { poseId: "std_P001_front", prompt: "[fake:moderation]", quality: "low", n: 1 });
  assert.equal(res.status, 201);
  const gen = await poll(user, res.data.generation.id);
  assert.equal(gen.status, "failed");
  assert.equal(gen.errorCode, "moderation_blocked");
  assert.equal(gen.refunded, gen.cost);
  assert.equal(await balance(user), before);
});

test("banned words are rejected before charging", async () => {
  const before = await balance(user);
  const res = await user.post("/api/generations", { poseId: "std_P001_front", prompt: "make her nude", quality: "low" });
  assert.equal(res.status, 400);
  assert.equal(res.data.error.code, "PROMPT_BLOCKED");
  assert.equal(await balance(user), before);
});

test("person photos need consent and only combine with general-rated references", async () => {
  const png = await sharp({ create: { width: 600, height: 800, channels: 3, background: { r: 180, g: 150, b: 140 } } }).png().toBuffer();
  const form = () => {
    const f = new FormData();
    f.append("kind", "person");
    f.append("file", new Blob([png], { type: "image/png" }), "me.png");
    return f;
  };
  const noConsent = await user.upload("/api/uploads", form());
  assert.equal(noConsent.status, 400);
  assert.equal(noConsent.data.error.code, "CONSENT_REQUIRED");
  const f = form();
  f.append("consent", "true");
  const ok = await user.upload("/api/uploads", f);
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  const personUploadId = ok.data.upload.id;

  const suggestive = await user.post("/api/generations", { poseId: "sexy_P002_front", personUploadId, quality: "low" });
  assert.equal(suggestive.status, 400);
  assert.equal(suggestive.data.error.code, "POSE_NOT_ALLOWED_WITH_PERSON");
  const lingerie = await user.post("/api/generations", { poseId: "std_P001_front", outfitId: "LNG-0001", personUploadId, quality: "low" });
  assert.equal(lingerie.data.error.code, "OUTFIT_NOT_ALLOWED_WITH_PERSON");
  const explicit = await user.post("/api/generations", { poseId: "pair_P003_front", quality: "low" });
  assert.equal(explicit.data.error.code, "POSE_UNAVAILABLE");

  const good = await user.post("/api/generations", { poseId: "std_P001_front", outfitId: "SPR-0001", personUploadId, quality: "low" });
  assert.equal(good.status, 201, JSON.stringify(good.data));
  const gen = await poll(user, good.data.generation.id);
  assert.equal(gen.status, "succeeded");
  assert.equal(fake.requests.at(-1).files.filter((x) => x.field === "image[]").length, 3);
  assert.match(fake.requests.at(-1).fields.prompt, /Image 3 is the PERSON reference/);

  const publish = await user.post(`/api/generations/${gen.id}/publish`, { public: true });
  assert.equal(publish.status, 400);
  assert.equal(publish.data.error.code, "PERSON_NOT_PUBLISHABLE");
});

test("publishing a work makes it visible in the showcase", async () => {
  const list = await user.get("/api/generations?status=succeeded");
  const gen = list.data.items.find((g) => !g.refs.person);
  const res = await user.post(`/api/generations/${gen.id}/publish`, { public: true });
  assert.equal(res.status, 200);
  const showcase = await client(app.base).get("/api/public/showcase");
  assert.ok(showcase.data.items.some((g) => g.id === gen.id));
  const img = await client(app.base).raw(gen.images[0].thumb);
  assert.equal(img.status, 200);
});

test("insufficient credits returns 402 without creating a job", async () => {
  const res = await user.post("/api/generations", { poseId: "std_P001_front", quality: "high", tier: "hd", n: 4 });
  assert.equal(res.status, 402);
  assert.equal(res.data.error.code, "INSUFFICIENT_CREDITS");
});

test("redeem codes add credits exactly once", async () => {
  const batch = await admin.post("/api/admin/redeem", { count: 2, credits: 50, note: "test" });
  assert.equal(batch.status, 201, JSON.stringify(batch.data));
  const before = await balance(user);
  const code = batch.data.codes[0].toLowerCase().replaceAll("-", " ");
  const ok = await user.post("/api/billing/redeem", { code });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(await balance(user), before + 50);
  const again = await user.post("/api/billing/redeem", { code: batch.data.codes[0] });
  assert.equal(again.status, 400);
});

test("mock payment credits the package once and is disabled by default", async () => {
  const pkgs = await user.get("/api/billing/packages");
  const pkg = pkgs.data.items[0];
  const blocked = await user.post("/api/billing/orders", { packageId: pkg.id, provider: "mock" });
  assert.equal(blocked.status, 400);

  const cfg = await admin.get("/api/admin/settings/payment");
  const value = { ...cfg.data.value, mock: { enabled: true } };
  const saved = await admin.put("/api/admin/settings/payment", { value });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));

  const before = await balance(user);
  const order = await user.post("/api/billing/orders", { packageId: pkg.id, provider: "mock" });
  assert.equal(order.status, 201, JSON.stringify(order.data));
  const paid = await user.post(`/api/billing/orders/${order.data.order.id}/mock-pay`, {});
  assert.equal(paid.data.order.status, "paid");
  assert.equal(await balance(user), before + pkg.totalCredits);
  const twice = await admin.post(`/api/admin/orders/${order.data.order.id}/mark-paid`, {});
  assert.equal(twice.data.already, true);
  assert.equal(await balance(user), before + pkg.totalCredits);
});

test("transient upstream errors retry, then fail with a refund", async () => {
  const gcfg = await admin.get("/api/admin/settings/generation");
  await admin.put("/api/admin/settings/generation", { value: { ...gcfg.data.value, maxAttempts: 1 } });
  const before = await balance(user);
  const res = await user.post("/api/generations", { poseId: "std_P001_front", prompt: "[fake:503]", quality: "low" });
  assert.equal(res.status, 201);
  const gen = await poll(user, res.data.generation.id);
  assert.equal(gen.status, "failed");
  assert.equal(await balance(user), before);
});

test("admin overview reports usage and margins", async () => {
  const res = await admin.get("/api/admin/overview");
  assert.equal(res.status, 200);
  assert.ok(res.data.generations.total >= 4);
  assert.ok(res.data.revenue.totalCents > 0);
  assert.equal(res.data.daily.length, 30);
});

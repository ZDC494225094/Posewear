// Asset system: category tree, licensing, generated assets (platform and
// user), sharing with review, and usage fees paid to asset owners.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { startApp, client, waitFor } from "./helpers.js";
import { createFakeOpenAI } from "../scripts/fake-openai.js";

let app, fake, admin, alice, bob, stranger;

before(async () => {
  fake = createFakeOpenAI();
  await new Promise((r) => fake.server.listen(0, "127.0.0.1", r));
  const fakeBase = `http://127.0.0.1:${fake.server.address().port}/v1`;
  app = await startApp();
  admin = client(app.base);
  alice = client(app.base);
  bob = client(app.base);
  stranger = client(app.base);
  for (const c of [admin, alice, bob, stranger]) await c.get("/api/public/config");
  const login = await admin.post("/api/auth/login", { email: "admin@test.local", password: "admin-pass-123" });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  const { data } = await admin.get("/api/admin/channels");
  for (const channel of data.items) {
    const patch = channel.kind === "openai" ? { baseUrl: fakeBase, apiKey: "sk-test", enabled: true } : { enabled: false };
    await admin.put(`/api/admin/channels/${channel.id}`, patch);
  }
  for (const [c, email] of [[alice, "alice@example.com"], [bob, "bob@example.com"]]) {
    const res = await c.post("/api/auth/register", { email, password: "secret-pass-1", agree: true });
    assert.equal(res.status, 201, JSON.stringify(res.data));
  }
});

after(async () => {
  await app?.stop();
  fake?.server.close();
});

const balance = async (c) => (await c.get("/api/me")).data.user.credits;
const pollJob = (c, prefix, id) => waitFor(async () => {
  const { data } = await c.get(`${prefix}/asset-jobs?ids=${id}`);
  const job = data.items[0];
  return ["succeeded", "failed"].includes(job.status) ? job : null;
});
const pollWork = (c, id) => waitFor(async () => {
  const { data } = await c.get(`/api/generations/${id}`);
  return ["succeeded", "failed"].includes(data.generation.status) ? data.generation : null;
});

let taxonomy;
const minorOf = (type, majorKey, key) => taxonomy[type].find((m) => m.key === majorKey).children.find((c) => c.key === key);

test("the category tree has dynasties, professions and closed suggestive categories", async () => {
  const res = await alice.get("/api/library/taxonomy");
  assert.equal(res.status, 200);
  taxonomy = res.data;
  const historical = taxonomy.outfit.find((m) => m.key === "historical");
  assert.deepEqual(["qin", "tang", "ming"].map((k) => historical.children.some((c) => c.key === k)), [true, true, true]);
  assert.equal(minorOf("outfit", "historical", "tang").zh, "唐朝服饰");
  assert.ok(minorOf("outfit", "professional", "doctor"));
  assert.equal(minorOf("outfit", "intimate", "lingerie").canGenerate, false);
  assert.equal(minorOf("outfit", "historical", "tang").canGenerate, true);
  assert.equal(minorOf("outfit", "historical", "tang").hint, undefined, "users don't see prompt hints");
  assert.equal(taxonomy.angles.length, 5);
});

test("imported assets are non-commercial platform assets sorted into major categories", async () => {
  const outfits = await alice.get("/api/library/outfits");
  const spring = outfits.data.items.find((o) => o.id === "SPR-0001");
  assert.equal(spring.license, "noncommercial");
  assert.equal(spring.origin, "platform");
  assert.equal(spring.series.key, "daily");
  assert.equal(spring.series.zh, "日常与四季");
  const commercial = await alice.get("/api/library/outfits?license=commercial");
  assert.equal(commercial.data.total, 0);
  const meta = await alice.get("/api/library/meta");
  assert.ok(meta.data.outfit.series.some((s) => s.key === "intimate"));
});

let platformPose;

test("admin generates a commercial platform outfit in the requested spec, for free", async () => {
  const tang = minorOf("outfit", "historical", "tang");
  const res = await admin.post("/api/admin/asset-jobs", { type: "outfit", categoryId: tang.id, description: "red ruqun with gold pibo", n: 2 });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  assert.equal(res.data.items[0].cost, 0);
  const job = await pollJob(admin, "/api/admin", res.data.items[0].id);
  assert.equal(job.status, "succeeded", JSON.stringify(job));
  assert.equal(job.assets.length, 2);

  const call = fake.requests.at(-1);
  assert.equal(call.endpoint, "generations");
  assert.equal(call.fields.size, "1024x1536");
  assert.match(call.fields.prompt, /ghost mannequin/);
  assert.match(call.fields.prompt, /Tang dynasty \(唐朝服饰\)/);
  assert.match(call.fields.prompt, /qixiong ruqun/);
  assert.match(call.fields.prompt, /Outfit details: red ruqun with gold pibo\./);

  const asset = job.assets[0];
  assert.equal(asset.origin, "platform");
  assert.equal(asset.license, "commercial");
  assert.equal(asset.generated, true);
  assert.equal(asset.series.key, "historical");
  assert.equal(asset.category.key, "tang");
  const img = await admin.raw(`/media/library/${asset.id}/original`);
  const buf = Buffer.from(await img.arrayBuffer());
  const meta = await sharp(buf).metadata();
  assert.equal(`${meta.width}x${meta.height}`, "1366x2048");
  assert.ok(buf.includes(Buffer.from("AIGC")), "AIGC metadata chunk present");
  const listed = await alice.get("/api/library/outfits?series=historical&category=tang");
  assert.equal(listed.data.total, 2);
});

test("admin pose assets are 900x1200 line art and can be extended with more angles", async () => {
  const standing = minorOf("pose", "全身1人・標準系", "立ち");
  const res = await admin.post("/api/admin/asset-jobs", { type: "pose", categoryId: standing.id, description: "hands on hips", angle: "正面" });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const job = await pollJob(admin, "/api/admin", res.data.items[0].id);
  assert.equal(job.status, "succeeded", JSON.stringify(job));
  platformPose = job.assets[0];
  assert.match(fake.requests.at(-1).fields.prompt, /Camera: front view/);
  assert.equal(fake.requests.at(-1).fields.size, "1152x1536");
  const img = await admin.raw(`/media/library/${platformPose.id}/original`);
  const meta = await sharp(Buffer.from(await img.arrayBuffer())).metadata();
  assert.equal(`${meta.width}x${meta.height}`, "900x1200");

  const more = await admin.post("/api/admin/asset-jobs", { sourceAssetId: platformPose.id, angles: ["正面", "横"] });
  assert.equal(more.status, 201, JSON.stringify(more.data));
  assert.equal(more.data.items.length, 1, "existing angles are skipped");
  const side = await pollJob(admin, "/api/admin", more.data.items[0].id);
  assert.equal(side.status, "succeeded", JSON.stringify(side));
  const call = fake.requests.at(-1);
  assert.equal(call.endpoint, "edits");
  assert.equal(call.files.length, 1);
  assert.match(call.fields.prompt, /same pose, seen from a different camera angle: side view/);
  assert.equal(side.assets[0].groupKey, platformPose.groupKey);
  assert.equal(side.assets[0].angle.key, "横");
});

test("an unlisted admin draft can be extended, and its new angles stay unlisted", async () => {
  const standing = minorOf("pose", "全身1人・標準系", "立ち");
  const res = await admin.post("/api/admin/asset-jobs", { type: "pose", categoryId: standing.id, angle: "正面", publish: false });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const draft = (await pollJob(admin, "/api/admin", res.data.items[0].id)).assets[0];
  assert.equal(draft.enabled, false);
  const more = await admin.post("/api/admin/asset-jobs", { sourceAssetId: draft.id, angles: ["上から"] });
  assert.equal(more.status, 201, JSON.stringify(more.data));
  const job = await pollJob(admin, "/api/admin", more.data.items[0].id);
  assert.equal(job.status, "succeeded", JSON.stringify(job));
  assert.equal(job.assets[0].enabled, false);
  assert.equal(job.assets[0].groupKey, draft.groupKey);
});

let alicePose;

test("users pay to generate private assets that only they can see", async () => {
  const before = await balance(alice);
  const standing = minorOf("pose", "全身1人・標準系", "立ち");
  const res = await alice.post("/api/my/asset-jobs", { type: "pose", categoryId: standing.id, description: "waving" });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  assert.equal(await balance(alice), before - 6);
  const job = await pollJob(alice, "/api/my", res.data.items[0].id);
  assert.equal(job.status, "succeeded", JSON.stringify(job));
  alicePose = job.assets[0];
  assert.equal(alicePose.visibility, "private");
  assert.equal(alicePose.origin, "user");

  const mine = await alice.get("/api/library/poses?origin=mine");
  assert.equal(mine.data.total, 1);
  assert.equal((await alice.raw(`/media/library/${alicePose.id}/thumb`)).status, 200);
  assert.equal((await stranger.raw(`/media/library/${alicePose.id}/thumb`)).status, 404);
  const theirs = await bob.get("/api/library/poses?origin=user");
  assert.equal(theirs.data.total, 0);
  const works = await alice.get("/api/generations");
  assert.ok(!works.data.items.some((g) => g.id === job.id), "asset jobs are not studio works");
});

test("users cannot generate in closed categories or with banned words", async () => {
  const lingerie = minorOf("outfit", "intimate", "lingerie");
  const closed = await alice.post("/api/my/asset-jobs", { type: "outfit", categoryId: lingerie.id });
  assert.equal(closed.data.error.code, "CATEGORY_CLOSED");
  const tang = minorOf("outfit", "historical", "tang");
  const banned = await alice.post("/api/my/asset-jobs", { type: "outfit", categoryId: tang.id, description: "nude" });
  assert.equal(banned.data.error.code, "PROMPT_BLOCKED");
  const major = await alice.post("/api/my/asset-jobs", { type: "outfit", categoryId: taxonomy.outfit[0].id });
  assert.equal(major.data.error.code, "INVALID_CATEGORY");
});

test("shared assets need review, then other users pay the owner's price and the owner earns a share", async () => {
  const shared = await alice.patch(`/api/my/assets/${alicePose.id}`, { visibility: "public", price: 10 });
  assert.equal(shared.status, 200, JSON.stringify(shared.data));
  assert.equal(shared.data.asset.review, "pending");
  assert.equal((await bob.get("/api/library/poses?origin=user")).data.total, 0, "hidden until approved");

  const queue = await admin.get("/api/admin/assets?review=pending");
  assert.ok(queue.data.items.some((a) => a.id === alicePose.id));
  const approved = await admin.patch(`/api/admin/assets/${alicePose.id}`, { review: "approved" });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  const listed = await bob.get("/api/library/poses?origin=user");
  assert.equal(listed.data.total, 1);
  assert.equal(listed.data.items[0].cover.price, 10);
  assert.equal(listed.data.items[0].cover.owner.id, alicePose.owner.id);

  const estimate = await bob.post("/api/generations/estimate", { poseId: alicePose.id, quality: "low", n: 1 });
  assert.equal(estimate.data.assetFee, 10);
  assert.equal(estimate.data.cost, 12);

  const bobBefore = await balance(bob);
  const aliceBefore = await balance(alice);
  const res = await bob.post("/api/generations", { poseId: alicePose.id, quality: "low", n: 1 });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  assert.equal(await balance(bob), bobBefore - 12);
  const gen = await pollWork(bob, res.data.generation.id);
  assert.equal(gen.status, "succeeded");
  assert.equal(await balance(alice), aliceBefore + 7, "70% of the price goes to the owner");
  const ledger = await alice.get("/api/me/ledger");
  assert.equal(ledger.data.items[0].kind, "asset_income");
  const mine = await alice.get("/api/my/assets");
  assert.equal(mine.data.summary.earned, 7);
  assert.equal(mine.data.summary.paidUses, 1);

  // Owners use their own assets for free.
  const own = await alice.post("/api/generations/estimate", { poseId: alicePose.id, quality: "low", n: 1 });
  assert.equal(own.data.assetFee, 0);
});

test("a failed job refunds the usage fee and pays the owner nothing", async () => {
  const bobId = (await bob.get("/api/me")).data.user.id;
  const topUp = await admin.post(`/api/admin/users/${bobId}/credits`, { delta: 50, reason: "test" });
  assert.equal(topUp.status, 200, JSON.stringify(topUp.data));
  const bobBefore = await balance(bob);
  const aliceBefore = await balance(alice);
  const res = await bob.post("/api/generations", { poseId: alicePose.id, prompt: "[fake:moderation]", quality: "low", n: 1 });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const gen = await pollWork(bob, res.data.generation.id);
  assert.equal(gen.status, "failed");
  assert.equal(await balance(bob), bobBefore);
  assert.equal(await balance(alice), aliceBefore);
});

test("a refused asset job mentions the refund only to users who paid", async () => {
  const tang = minorOf("outfit", "historical", "tang");
  const free = await admin.post("/api/admin/asset-jobs", { type: "outfit", categoryId: tang.id, description: "[fake:moderation]" });
  assert.equal(free.status, 201, JSON.stringify(free.data));
  const adminJob = await pollJob(admin, "/api/admin", free.data.items[0].id);
  assert.equal(adminJob.status, "failed");
  assert.equal(adminJob.errorMessage, "内容未通过模型的安全审核，请调整描述或参考图后重试。");

  const before = await balance(alice);
  const paid = await alice.post("/api/my/asset-jobs", { type: "outfit", categoryId: tang.id, description: "[fake:moderation]" });
  assert.equal(paid.status, 201, JSON.stringify(paid.data));
  const userJob = await pollJob(alice, "/api/my", paid.data.items[0].id);
  assert.equal(userJob.status, "failed");
  assert.match(userJob.errorMessage, /本次点数已退回。$/);
  assert.equal(await balance(alice), before);
});

test("random picks never return another user's priced asset", async () => {
  for (let i = 0; i < 12; i++) {
    const { data } = await bob.get("/api/library/random?type=pose");
    assert.notEqual(data.item?.id, alicePose.id);
  }
});

test("reference images need consent and make the asset non-commercial", async () => {
  const png = await sharp({ create: { width: 600, height: 800, channels: 3, background: { r: 120, g: 120, b: 120 } } }).png().toBuffer();
  const form = (consent) => {
    const f = new FormData();
    f.append("kind", "reference");
    if (consent) f.append("consent", "true");
    f.append("file", new Blob([png], { type: "image/png" }), "ref.png");
    return f;
  };
  assert.equal((await alice.upload("/api/uploads", form(false))).data.error.code, "CONSENT_REQUIRED");
  const up = await alice.upload("/api/uploads", form(true));
  assert.equal(up.status, 201, JSON.stringify(up.data));
  const tang = minorOf("outfit", "historical", "tang");
  const res = await alice.post("/api/my/asset-jobs", { type: "outfit", categoryId: tang.id, referenceUploadId: up.data.upload.id });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const job = await pollJob(alice, "/api/my", res.data.items[0].id);
  assert.equal(job.status, "succeeded", JSON.stringify(job));
  assert.equal(job.assets[0].license, "noncommercial");
  const call = fake.requests.at(-1);
  assert.equal(call.endpoint, "edits");
  assert.match(call.fields.prompt, /Image 1 shows an outfit/);
});

test("admins manage categories; a category in use cannot be deleted", async () => {
  const historical = taxonomy.outfit.find((m) => m.key === "historical");
  const created = await admin.post("/api/admin/asset-categories", { type: "outfit", parentId: historical.id, key: "nanbei",
    nameZh: "南北朝服饰", nameEn: "Northern and Southern dynasties", hint: "wide-sleeved robes" });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const dup = await admin.post("/api/admin/asset-categories", { type: "outfit", parentId: historical.id, key: "nanbei", nameZh: "重复" });
  assert.equal(dup.data.error.code, "KEY_TAKEN");
  const tree = await admin.get("/api/admin/asset-categories");
  const tang = tree.data.outfit.find((m) => m.key === "historical").children.find((c) => c.key === "tang");
  assert.ok(tang.count >= 2);
  const blocked = await admin.del(`/api/admin/asset-categories/${tang.id}`);
  assert.equal(blocked.data.error.code, "CATEGORY_IN_USE");
  const removed = await admin.del(`/api/admin/asset-categories/${created.data.category.id}`);
  assert.equal(removed.status, 200);
  assert.equal((await alice.get("/api/library/taxonomy")).data.outfit.find((m) => m.key === "historical")
    .children.some((c) => c.key === "nanbei"), false);
});

test("users can delete their own assets but not others'", async () => {
  const theirs = await bob.del(`/api/my/assets/${alicePose.id}`);
  assert.equal(theirs.status, 404);
  const mine = await alice.get("/api/my/assets?type=outfit");
  const target = mine.data.items[0];
  const removed = await alice.del(`/api/my/assets/${target.id}`);
  assert.equal(removed.status, 200);
  assert.equal((await alice.raw(`/media/library/${target.id}/thumb`)).status, 404);
});

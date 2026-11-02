// The extra libraries (scripts/import-libraries.js): AI portraits used as the
// person, anime hairstyles, CharaDB outfits and poses, and pose depth maps.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import sharp from "sharp";
import { startApp, client, waitFor, listenLocal, ROOT } from "./helpers.js";
import { createFakeOpenAI } from "../scripts/fake-openai.js";

const Database = createRequire(import.meta.url)("better-sqlite3");

let app, fake, admin, owner, other, faces;
const ok = (response, status = 200) => {
  assert.equal(response.status, status, JSON.stringify(response.data));
  return response.data;
};

async function img(file, w, h, color) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const pipeline = sharp({ create: { width: w, height: h, channels: 3, background: color } });
  await (file.endsWith(".png") ? pipeline.png() : file.endsWith(".webp") ? pipeline.webp() : pipeline.jpeg()).toFile(file);
}

// A portrait gallery, a depth map for one fixture pose, and a small CharaDB.
async function makeLibraries(dir) {
  const portraits = [
    { id: "f0000000001", section: "face", hair: "ロング", style: "" },
    { id: "f0000000002", section: "styling", hair: "ショート", style: "" },
    { id: "f0000000003", section: "face", hair: "ボブ", style: "" }
  ];
  for (const p of portraits.slice(0, 2)) {
    await img(path.join(dir, "portrait", "full", `${p.id}.png`), 600, 750, "#c8a090");
    await img(path.join(dir, "portrait", "thumb", `${p.id}.webp`), 400, 500, "#c8a090");
  }
  // The third one isn't downloaded yet: skipped.
  fs.writeFileSync(path.join(dir, "portrait", "images.js"), `window.GALLERY_IMAGES = ${JSON.stringify(portraits)};\n`);

  await img(path.join(dir, "depth", "img", "depth", "original", "std_P001_front.png"), 900, 1200, "#808080");
  await img(path.join(dir, "depth", "img", "depth", "thumbs", "std_P001_front.jpg"), 300, 400, "#808080");

  const items = [
    { id: "H001", set: "hair", cat: "髪型", jp: "ロングヘア", tags: "long hair", sub: "style" },
    { id: "H001-black", set: "hair", cat: "髪型", jp: "ロングヘア(黒)", tags: "long hair, black hair", sub: "style_color", parent: "H001" },
    { id: "O001", set: "outfit", cat: "制服・学生", jp: "セーラー服(紺)", tags: "serafuku, sailor collar, pleated skirt" },
    { id: "O011", set: "outfit", cat: "制服・学生", jp: "体操服・ブルマ", tags: "gym uniform" },
    { id: "O900", set: "outfit", cat: "水着", jp: "テスト水着", tags: "bikini" },
    { id: "P001", set: "pose", cat: "立ち", jp: "気をつけ", tags: "standing, arms at sides", line: true },
    { id: "P001-s", set: "pose", cat: "立ち", jp: "気をつけ(横から)", tags: "standing, from side", line: true }
  ];
  const chara = path.join(dir, "charadb");
  for (const item of items) {
    await img(path.join(chara, "img", `${item.id}.jpg`), 512, 768, "#9db4d8");
    await img(path.join(chara, "thumb", `${item.id}.webp`), 210, 315, "#9db4d8");
    if (item.line) await img(path.join(chara, "line", `${item.id}.png`), 512, 768, "#ffffff");
  }
  fs.writeFileSync(path.join(chara, "data.js"), `window.DB=${JSON.stringify({ tier: "public", items })};\n`);
}

function importLibraries(env, dir, extra = []) {
  return execFileSync(process.execPath, [path.join(ROOT, "scripts/import-libraries.js"), "--accept-license",
    "--portrait", path.join(dir, "portrait"), "--depth", path.join(dir, "depth"), "--charadb", path.join(dir, "charadb"), ...extra],
  { env, stdio: "pipe" }).toString();
}

before(async () => {
  fake = createFakeOpenAI();
  await listenLocal(fake.server);
  app = await startApp({
    prepare: async ({ env, tmp }) => {
      const dir = path.join(tmp, "libraries");
      await makeLibraries(dir);
      // Without the licence flag the script only explains the terms.
      assert.throws(() => execFileSync(process.execPath, [path.join(ROOT, "scripts/import-libraries.js"), "--charadb", path.join(dir, "charadb")],
        { env, stdio: "pipe" }), (err) => err.status === 2);
      const out = importLibraries(env, dir);
      assert.match(out, /Portraits: 2 of 3 downloaded/);
      assert.match(out, /Depth maps: 1 of \d+ library poses/);
      assert.match(out, /CharaDB: 3 outfits, 2 poses, 2 hairstyles and eyes/);
      // Running it again changes nothing.
      importLibraries(env, dir);
    }
  });
  admin = client(app.base); owner = client(app.base); other = client(app.base);
  for (const c of [admin, owner, other]) await c.get("/api/public/config");
  ok(await admin.post("/api/auth/login", { email: "admin@test.local", password: "admin-pass-123" }));
  const user = ok(await owner.post("/api/auth/register", { email: "libraries@example.com", password: "secret-pass-123", agree: true }), 201).user;
  ok(await other.post("/api/auth/register", { email: "libraries-other@example.com", password: "secret-pass-123", agree: true }), 201);
  ok(await admin.post(`/api/admin/users/${user.id}/credits`, { delta: 500, reason: "library tests" }));
  for (const channel of ok(await admin.get("/api/admin/channels")).items) {
    ok(await admin.put(`/api/admin/channels/${channel.id}`, channel.kind === "openai"
      ? { enabled: true, apiKey: "sk-test", baseUrl: `http://127.0.0.1:${fake.server.address().port}/v1` }
      : { enabled: false }));
  }
});

after(async () => { await app?.stop(); if (fake) await new Promise((resolve) => fake.server.close(resolve)); });

async function work(input) {
  const created = ok(await owner.post("/api/generations", { quality: "low", ratio: "2:3", ...input }), 201).generation;
  const done = await waitFor(async () => {
    const g = ok(await owner.get(`/api/generations/${created.id}`)).generation;
    return ["succeeded", "failed"].includes(g.status) ? g : null;
  });
  assert.equal(done.status, "succeeded", JSON.stringify(done));
  return done;
}

test("imported portraits, hairstyles, anime outfits and poses are listed, and depth maps are on the pose", async () => {
  const meta = ok(await owner.get("/api/library/meta"));
  assert.equal(meta.face.total, 2);
  assert.equal(meta.hair.total, 2);
  faces = ok(await owner.get("/api/library/faces")).items;
  assert.deepEqual(faces.map((f) => f.id).sort(), ["f0000000001", "f0000000002"]);
  assert.equal(faces.find((f) => f.id === "f0000000001").name.zh, "长发 · 正脸");
  // Shown and used for generation, but the files aren't offered for download.
  assert.equal(faces[0].downloadable, false);
  assert.equal(faces[0].original, null);
  assert.ok(ok(await owner.get("/api/library/assets/std_P001_front")).asset.original);
  const hairs = ok(await owner.get("/api/library/hairs")).items;
  assert.deepEqual(hairs.map((h) => h.name.zh).sort(), ["长发", "长发（黑）"].sort());

  const outfits = ok(await owner.get("/api/library/outfits?series=chara&size=60")).items.map((o) => o.id);
  assert.ok(outfits.includes("cd-O001"));
  // Items that read as children are never listed or usable.
  assert.ok(!outfits.includes("cd-O011"));
  assert.equal((await owner.post("/api/generations/estimate", { outfitId: "cd-O011" })).data.error.code, "OUTFIT_UNAVAILABLE");

  // The side view joins the front view as another angle of the same pose.
  const anime = ok(await owner.get("/api/library/assets/cd-P001"));
  assert.deepEqual(anime.angles.map((a) => a.id).sort(), ["cd-P001", "cd-P001-s"]);

  const pose = ok(await owner.get("/api/library/assets/std_P001_front")).asset;
  assert.equal(pose.hasDepth, true);
  assert.ok(pose.depthThumb);
  const res = await owner.raw(pose.depthThumb);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /image\/jpeg/);
  assert.equal(ok(await owner.get("/api/library/assets/sexy_P002_front")).asset.hasDepth, false);
});

test("a portrait is a virtual person; depth map and hair reach the model in the prompt's order", async () => {
  const g = await work({ poseId: "std_P001_front", poseDepth: true, outfitId: "cd-O001", personAssetId: "f0000000001", hairId: "cd-H001-black" });
  const call = fake.requests.at(-1);
  assert.deepEqual(call.files.map((f) => f.filename), ["pose.png", "pose-depth.png", "outfit.jpg", "person.jpg", "hair.jpg"]);
  assert.match(call.fields.prompt, /Image 2 is a DEPTH MAP of the same pose/);
  assert.match(call.fields.prompt, /Image 5 is a HAIR reference \(hairstyle: long hair, black hair\)/);
  assert.equal(g.personKind, "virtual");
  assert.equal(g.refs.poseDepth, true);
  assert.equal(g.refs.hair.id, "cd-H001-black");
  assert.equal(g.refs.person.source, "library");
  assert.equal(g.refs.person.id, "f0000000001");

  // A virtual person's work can go public, and the portrait shows as its person.
  ok(await owner.post(`/api/generations/${g.id}/publish`, { public: true }));
  const shared = ok(await other.get("/api/public/showcase")).items.find((p) => p.id === g.id);
  assert.equal(shared.refs.person.source, "library");
  assert.ok(shared.refs.person.thumb);

  // The admin detail lists the same references.
  const detail = ok(await admin.get(`/api/admin/generations?q=${g.id}`)).items.find((r) => r.id === g.id);
  assert.equal(detail.refs.hair.id, "cd-H001-black");
  assert.equal(detail.refs.poseDepth, true);
});

test("the depth map only goes along when asked for and when the pose has one", async () => {
  await work({ poseId: "std_P001_front" });
  assert.deepEqual(fake.requests.at(-1).files.map((f) => f.filename), ["pose.png"]);
  const g = await work({ poseId: "sexy_P002_front", poseDepth: true });
  assert.deepEqual(fake.requests.at(-1).files.map((f) => f.filename), ["pose.png"]);
  assert.doesNotMatch(fake.requests.at(-1).fields.prompt, /DEPTH MAP/);
  assert.equal(g.refs.poseDepth, false);
});

test("a portrait can't be combined with another person, and swimwear doesn't go with a real person's photo", async () => {
  const image = await sharp({ create: { width: 600, height: 800, channels: 3, background: "#aabbcc" } }).png().toBuffer();
  const form = new FormData();
  form.append("kind", "person");
  form.append("consent", "true");
  form.append("file", new Blob([image], { type: "image/png" }), "person.png");
  const upload = ok(await owner.upload("/api/uploads", form), 201).upload;
  assert.equal((await owner.post("/api/generations/estimate", { personAssetId: "f0000000001", personUploadId: upload.id })).data.error.code, "INVALID_INPUT");
  assert.equal((await owner.post("/api/generations/estimate", { personUploadId: upload.id, outfitId: "cd-O900" })).data.error.code,
    "OUTFIT_NOT_ALLOWED_WITH_PERSON");
  ok(await owner.post("/api/generations/estimate", { personAssetId: "f0000000001", outfitId: "cd-O900" }));
  assert.equal((await owner.post("/api/generations/estimate", { personAssetId: "cd-H001" })).data.error.code, "PERSON_UNAVAILABLE");
  assert.equal((await owner.post("/api/generations/estimate", { hairId: "f0000000001" })).data.error.code, "HAIR_UNAVAILABLE");
});

test("migration 13 keeps every asset and category, and adds the library columns and categories once", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "posewear-mig13-"));
  let fresh = await startApp({ env: { DATA_DIR: dataDir } });
  await fresh.stop();

  // Back to version 12: no depth or library-person columns, no library categories.
  const db = new Database(path.join(dataDir, "posewear.db"));
  const library = "(type IN ('face', 'hair') OR key LIKE 'chara%')";
  db.exec(`DELETE FROM asset_categories WHERE parent_id IN (SELECT id FROM asset_categories WHERE ${library});
    DELETE FROM asset_categories WHERE ${library};
    ALTER TABLE assets DROP COLUMN depth_path; ALTER TABLE assets DROP COLUMN depth_thumb_path;
    ALTER TABLE generations DROP COLUMN person_asset_id; ALTER TABLE generations DROP COLUMN hair_asset_id;
    ALTER TABLE generations DROP COLUMN pose_depth;`);
  const assets = db.prepare("SELECT id, type, rating FROM assets ORDER BY id").all();
  const categories = db.prepare("SELECT COUNT(*) AS n FROM asset_categories").get().n;
  assert.ok(assets.length >= 4);
  db.pragma("user_version = 12");
  db.close();

  const counts = [];
  for (let run = 0; run < 2; run++) {
    fresh = await startApp({ env: { DATA_DIR: dataDir }, importUpstream: false });
    await fresh.stop();
    const after = new Database(path.join(dataDir, "posewear.db"));
    assert.ok(after.pragma("user_version", { simple: true }) >= 13);
    assert.deepEqual(after.prepare("SELECT id, type, rating FROM assets ORDER BY id").all(), assets);
    assert.equal(after.prepare("SELECT COUNT(*) AS n FROM assets WHERE depth_path = ''").get().n, assets.length);
    after.prepare("SELECT person_asset_id, hair_asset_id, pose_depth FROM generations LIMIT 1").all();
    const majors = after.prepare("SELECT type, key FROM asset_categories WHERE parent_id IS NULL AND (type IN ('face', 'hair') OR key = 'chara') ORDER BY type, key").all();
    assert.deepEqual(majors.map((m) => `${m.type}/${m.key}`), ["face/face", "face/styling", "hair/chara", "outfit/chara", "pose/chara"]);
    counts.push(after.prepare("SELECT COUNT(*) AS n FROM asset_categories").get().n);
    // The new types are accepted.
    after.prepare(`INSERT INTO assets (id, type, group_key, thumb_path, original_path, created_at, updated_at)
      VALUES ('mig-face-${run}', 'face', 'mig-face-${run}', 't', 'o', 1, 1)`).run();
    after.prepare(`DELETE FROM assets WHERE id = 'mig-face-${run}'`).run();
    after.pragma("user_version = 12");
    after.close();
  }
  assert.ok(counts[0] > categories);
  assert.equal(counts[1], counts[0]);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

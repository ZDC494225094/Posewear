// Migration 14: stored copies of the 1.7 default prompt texts and presets
// become the rewritten ones; texts an admin wrote stay as they are.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { startApp, client } from "./helpers.js";
import { PROMPT, STYLES, CAMERAS, SCENES, PREVIOUS } from "../server/services/prompt-texts.js";

const Database = createRequire(import.meta.url)("better-sqlite3");

test("migration 14 upgrades untouched default prompts and presets and keeps the admin's own", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "posewear-mig14-"));
  let app = await startApp({ env: { DATA_DIR: dataDir }, importUpstream: false });
  await app.stop();

  const db = new Database(path.join(dataDir, "posewear.db"));
  const put = db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, 1)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
  put.run("prompt", JSON.stringify({ ...PREVIOUS.prompt, person: "Image {n} is our own person line." }));
  put.run("generation", JSON.stringify({
    maxN: 2,
    styles: [{ id: "photo", label: "写实摄影", prompt: PREVIOUS.styles.photo }, { id: "anime", label: "日系动漫", prompt: STYLES[3].prompt },
      { id: "oil", label: "油画", prompt: "oil painting" }],
    scenes: [{ id: "beach", label: "海边", prompt: PREVIOUS.scenes.beach }, { id: "city", label: "城市", prompt: "our own street" }],
    cameras: [{ id: "85mm", label: "85mm 人像", prompt: PREVIOUS.cameras["85mm"] }, { id: "mine", label: "我的镜头", prompt: "our lens" }]
  }));
  db.pragma("user_version = 13");
  db.close();

  app = await startApp({ env: { DATA_DIR: dataDir }, importUpstream: false });
  try {
    const after = new Database(path.join(dataDir, "posewear.db"), { readonly: true });
    const stored = (key) => JSON.parse(after.prepare("SELECT value FROM settings WHERE key = ?").get(key).value);
    const prompt = stored("prompt");
    assert.equal(prompt.intro, PROMPT.intro);
    assert.equal(prompt.realism, PROMPT.realism);
    assert.equal(prompt.upscale, PROMPT.upscale);
    assert.equal(prompt.person, "Image {n} is our own person line.");
    const gen = stored("generation");
    after.close();
    assert.equal(gen.maxN, 2);
    assert.deepEqual(gen.styles.map((s) => s.prompt), [STYLES[0].prompt, STYLES[3].prompt, "oil painting"]);
    assert.deepEqual(gen.scenes.map((s) => s.prompt), [SCENES.find((s) => s.id === "beach").prompt, "our own street"]);
    assert.deepEqual(gen.cameras.map((c) => c.id), ["85mm", "mine", "catalog"]);
    assert.equal(gen.cameras[0].prompt, CAMERAS.find((c) => c.id === "85mm").prompt);

    // Lists saved before 1.8 have no 写实 flag: known illustration styles get false, others true.
    const admin = client(app.base);
    await admin.get("/api/public/config");
    assert.equal((await admin.post("/api/auth/login", { email: "admin@test.local", password: "admin-pass-123" })).status, 200);
    const styles = (await admin.get("/api/admin/settings/generation")).data.value.styles;
    assert.deepEqual(styles.map((s) => [s.id, s.photo]), [["photo", true], ["anime", false], ["oil", true]]);
    const config = (await admin.get("/api/public/config")).data.generation;
    assert.equal(config.styles.find((s) => s.id === "anime").photo, false);
  } finally {
    await app.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

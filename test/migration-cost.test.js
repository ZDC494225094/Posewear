// Migration 9 re-estimates the model cost of finished jobs that came without
// token usage, by the size actually delivered.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { startApp } from "./helpers.js";

const Database = createRequire(import.meta.url)("better-sqlite3");

test("migration 9 re-estimates costs that had no usage, from the delivered size", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "posewear-mig9-"));
  let app = await startApp({ env: { DATA_DIR: dataDir } });
  await app.stop();

  // Back to version 8, with jobs as 1.5.0 recorded them.
  const db = new Database(path.join(dataDir, "posewear.db"));
  const userId = db.prepare("SELECT id FROM users LIMIT 1").get().id;
  const insert = db.prepare(`INSERT INTO generations (id, user_id, status, mode, ratio, tier, size, quality, n, cost_credits,
    model, usage, api_cost_usd, created_at) VALUES (?, ?, 'succeeded', 'generate', '2:3', ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  // A "2K" work the relay answered with 1086×1448: 0.1789 by the old area estimate.
  insert.run("relay2k", userId, "hd", "1536x2304", "medium", 1, 10, "gpt-image-2", null, 0.1789, Date.now());
  db.prepare(`INSERT INTO generation_images (id, generation_id, user_id, idx, path, thumb_path, width, height, created_at)
    VALUES ('img1', 'relay2k', ?, 0, 'x.png', 'x.thumb.webp', 1086, 1448, ?)`).run(userId, Date.now());
  // An asset job (no image rows): estimated from its recorded size.
  insert.run("asset1", userId, "standard", "1536x1024", "medium", 1, 6, "gpt-image-2", null, 0.0795, Date.now());
  // Left alone: real usage, and gpt-image-1.x.
  insert.run("withusage", userId, "standard", "1024x1536", "medium", 1, 6, "gpt-image-2", "{\"output_tokens\":1372}", 0.5, Date.now());
  insert.run("old15", userId, "standard", "1024x1536", "medium", 1, 6, "gpt-image-1.5", null, 0.051, Date.now());
  db.pragma("user_version = 8");
  db.close();

  app = await startApp({ env: { DATA_DIR: dataDir }, importUpstream: false });
  await app.stop();
  const after = new Database(path.join(dataDir, "posewear.db"), { readonly: true });
  const cost = (id) => after.prepare("SELECT api_cost_usd AS c FROM generations WHERE id = ?").get(id).c;
  assert.ok(after.pragma("user_version", { simple: true }) >= 9);
  // 1086×1448 medium: 1,544 output tokens × $30 / 1M.
  assert.equal(cost("relay2k").toFixed(5), "0.04632");
  // 1536×1024 medium: 1,372 tokens.
  assert.equal(cost("asset1").toFixed(5), "0.04116");
  assert.equal(cost("withusage"), 0.5);
  assert.equal(cost("old15"), 0.051);
  after.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

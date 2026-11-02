// Migration 10 rebuilds the channels table so it can hold Gemini channels,
// keeping every row and its id; migration 12 moves each channel's model, with
// its model settings and what the size check learned, into channel_models.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { startApp } from "./helpers.js";

const Database = createRequire(import.meta.url)("better-sqlite3");

test("migrations 10 and 12 keep the channels, let them be Gemini channels and give each its model", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "posewear-mig10-"));
  let app = await startApp({ env: { DATA_DIR: dataDir }, importUpstream: false });
  await app.stop();

  // Back to version 9: the old table, which only accepts openai and mock.
  const db = new Database(path.join(dataDir, "posewear.db"));
  db.exec(`
    DROP TABLE channels;
    CREATE TABLE channels (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('openai', 'mock')),
      base_url TEXT NOT NULL DEFAULT '', api_key_enc TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT 'gpt-image-2',
      options TEXT NOT NULL DEFAULT '{}', enabled INTEGER NOT NULL DEFAULT 1, priority INTEGER NOT NULL DEFAULT 0,
      success_count INTEGER NOT NULL DEFAULT 0, failure_count INTEGER NOT NULL DEFAULT 0, last_ok_at INTEGER,
      last_error TEXT, last_error_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, size_limit TEXT);
    INSERT INTO channels (id, name, kind, base_url, model, options, enabled, priority, success_count, created_at, updated_at, size_limit)
      VALUES (3, 'relay', 'openai', 'https://relay.example/v1', 'gpt-image-2.5-sunburst', '{"sizeMode":"auto"}', 1, 5, 42, 1, 2,
        '{"maxTier":"standard","requested":"1536x2304","delivered":"1024x1536","at":3}'),
      (7, 'mock', 'mock', '', 'mock', '{}', 0, 0, 0, 1, 1, NULL);
  `);
  assert.throws(() => db.prepare("INSERT INTO channels (name, kind, created_at, updated_at) VALUES ('g', 'gemini', 1, 1)").run(), /CHECK/);
  db.pragma("user_version = 9");
  db.close();

  app = await startApp({ env: { DATA_DIR: dataDir }, importUpstream: false });
  await app.stop();
  const after = new Database(path.join(dataDir, "posewear.db"));
  assert.ok(after.pragma("user_version", { simple: true }) >= 12);
  const rows = after.prepare("SELECT id, name, kind, options, priority, success_count FROM channels ORDER BY id").all();
  assert.deepEqual(rows.map((r) => [r.id, r.name, r.kind, r.priority, r.success_count]), [[3, "relay", "openai", 5, 42], [7, "mock", "mock", 0, 0]]);
  // The model, its size mode and the size check's finding now belong to the model; the channel keeps how to reach the API.
  const models = after.prepare("SELECT channel_id, model, options, size_limit, success_count FROM channel_models WHERE channel_id IN (3, 7) ORDER BY channel_id").all();
  assert.deepEqual(models.map((m) => [m.channel_id, m.model, m.success_count]), [[3, "gpt-image-2.5-sunburst", 42], [7, "mock", 0]]);
  assert.equal(JSON.parse(models[0].options).sizeMode, "auto");
  assert.equal(JSON.parse(models[0].size_limit).delivered, "1024x1536");
  assert.equal(JSON.parse(rows[0].options).sizeMode, undefined);
  after.prepare("INSERT INTO channels (name, kind, created_at, updated_at) VALUES ('g', 'gemini', 1, 1)").run();
  after.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

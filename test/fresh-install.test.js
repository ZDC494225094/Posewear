// A brand-new install that skips the upstream import (the usual commercial
// setup, since those assets are non-commercial) must start and work.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { startApp, client, ROOT } from "./helpers.js";

test("the server starts on an empty data directory without the upstream import", async () => {
  const app = await startApp({ importUpstream: false });
  try {
    const c = client(app.base);
    await c.get("/api/public/config");
    const login = await c.post("/api/auth/login", { email: "admin@test.local", password: "admin-pass-123" });
    assert.equal(login.status, 200, JSON.stringify(login.data));
    const catalog = await c.get("/api/wedding/catalog");
    assert.equal(catalog.status, 200, JSON.stringify(catalog.data));
    assert.equal(catalog.data.scenes.length, 12);
  } finally {
    await app.stop();
  }
});

test("admin:create works on an empty data directory", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "posewear-fresh-"));
  try {
    const env = { ...process.env, ENV_FILE: ".env.test-none", DATA_DIR: path.join(tmp, "data"),
      APP_SECRET: "test-secret-0123456789-0123456789-abcdef", LOG_LEVEL: "warn" };
    const out = execFileSync(process.execPath, [path.join(ROOT, "scripts/create-admin.js"), "--email", "owner@test.local", "--password", "owner-pass-123"],
      { env, encoding: "utf8", stdio: "pipe" });
    assert.match(out, /Created admin owner@test\.local/);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows may hold files briefly */ }
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { startApp, client, waitFor } from "./helpers.js";
import { classifyHttpError, classifyTransportError, summarizeFailures, PUBLIC_MESSAGES } from "../server/services/providers/errors.js";
import { requestOptions } from "../server/services/providers/transport.js";

const record = (error, channel = 1) => ({ channel, kind: error.kind, code: error.code,
  status: error.status, message: error.message, publicMessage: error.publicMessage, detail: error.detail });

test("connection timeouts keep their real cause instead of becoming service-busy errors", () => {
  const error = classifyTransportError(new TypeError("fetch failed", {
    cause: Object.assign(new Error("Connect Timeout Error"), { code: "UND_ERR_CONNECT_TIMEOUT" })
  }), 240_000);
  assert.equal(error.kind, "transient");
  assert.equal(error.code, "CONNECT_TIMEOUT");
  assert.equal(error.publicMessage, PUBLIC_MESSAGES.connectTimeout);
  const summary = summarizeFailures([record(error)]);
  assert.equal(summary.code, "UPSTREAM_ERROR");
  assert.equal(summary.publicMessage, PUBLIC_MESSAGES.connectTimeout);
  assert.match(JSON.parse(summary.detail)[0].detail, /UND_ERR_CONNECT_TIMEOUT/);
});

test("network, response deadline, and upstream overload remain distinguishable after retries", () => {
  for (const code of ["ECONNREFUSED", "ENOTFOUND", "UND_ERR_SOCKET"]) {
    const error = classifyTransportError(new TypeError("fetch failed", { cause: Object.assign(new Error(code), { code }) }), 30_000);
    assert.equal(error.code, "NETWORK");
    assert.equal(summarizeFailures([record(error)]).publicMessage, PUBLIC_MESSAGES.network);
  }
  for (const error of [new DOMException("deadline", "TimeoutError"),
    new TypeError("terminated", { cause: Object.assign(new Error("body timeout"), { code: "UND_ERR_BODY_TIMEOUT" }) })]) {
    const classified = classifyTransportError(error, 30_000);
    assert.equal(classified.code, "TIMEOUT");
    assert.equal(summarizeFailures([record(classified)]).publicMessage, PUBLIC_MESSAGES.timeout);
  }
  const busy = classifyHttpError(503, { error: { message: "overloaded" } }, "");
  assert.equal(summarizeFailures([record(busy)]).publicMessage, PUBLIC_MESSAGES.busy);
  const auth = classifyHttpError(401, { error: { message: "invalid key" } }, "");
  assert.equal(summarizeFailures([record(auth)]).publicMessage, PUBLIC_MESSAGES.unavailable);
  const network = classifyTransportError(new Error("ECONNRESET"), 30_000);
  assert.equal(summarizeFailures([record(network), record(auth, 2)]).publicMessage, PUBLIC_MESSAGES.network);
});

test("the configured connection deadline applies to a stalled TLS handshake", async (t) => {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  // This local socket never replies to the TLS client hello. No external call.
  await assert.rejects(fetch(`https://127.0.0.1:${server.address().port}/v1/models`, requestOptions(6000, 1)), (error) => {
    assert.equal(error.cause?.code, "UND_ERR_CONNECT_TIMEOUT");
    assert.equal(classifyTransportError(error, 6000).code, "CONNECT_TIMEOUT");
    return true;
  });
});

test("the full request deadline still bounds response reading", async (t) => {
  const server = http.createServer((req, res) => { res.writeHead(200); res.write("partial body"); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const response = await fetch(`http://127.0.0.1:${server.address().port}`, requestOptions(300, 1));
  await assert.rejects(response.text(), (error) => {
    assert.equal(classifyTransportError(error, 300).code, "TIMEOUT");
    return true;
  });
});

test("a real worker retries a broken response, reports a network error and refunds once", async (t) => {
  let requests = 0;
  const server = http.createServer(async (req, res) => {
    for await (const chunk of req) { /* consume the complete local request */ }
    if (req.url === "/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "gpt-image-2" }] }));
      return;
    }
    requests++;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.write('{"data":');
    setTimeout(() => res.destroy(), 30);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let app;
  t.after(async () => {
    await app?.stop();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  app = await startApp();
  const admin = client(app.base), user = client(app.base);
  await admin.get("/api/public/config");
  await user.get("/api/public/config");
  assert.equal((await admin.post("/api/auth/login", { email: "admin@test.local", password: "admin-pass-123" })).status, 200);
  assert.equal((await user.post("/api/auth/register", { email: "connectivity@example.com", password: "secret-pass-123", agree: true })).status, 201);
  const channels = (await admin.get("/api/admin/channels")).data.items;
  for (const channel of channels) {
    assert.equal(channel.options.connectTimeoutSec, 30);
    const response = await admin.put(`/api/admin/channels/${channel.id}`, channel.kind === "openai"
      ? { enabled: true, apiKey: "sk-test", baseUrl: `http://127.0.0.1:${server.address().port}/v1`, options: { connectTimeoutSec: 2 } }
      : { enabled: false });
    assert.equal(response.status, 200);
    if (channel.kind === "openai") {
      assert.equal(response.data.channel.options.connectTimeoutSec, 2);
      const ping = await admin.post(`/api/admin/channels/${channel.id}/test`, { mode: "ping" });
      assert.equal(ping.data.ok, true);
    }
  }
  const settings = (await admin.get("/api/admin/settings/generation")).data.value;
  await admin.put("/api/admin/settings/generation", { value: { ...settings, maxAttempts: 2 } });
  const balance = (await user.get("/api/me")).data.user.credits;
  const created = await user.post("/api/generations", { poseId: "std_P001_front", quality: "low", ratio: "2:3", n: 1 });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const id = created.data.generation.id;
  const failed = await waitFor(async () => {
    const response = await user.get(`/api/generations/${id}`);
    return response.data.generation.status === "failed" ? response.data.generation : null;
  });
  assert.equal(failed.errorMessage, PUBLIC_MESSAGES.network);
  assert.equal(failed.refunded, failed.cost);
  assert.equal((await user.get("/api/me")).data.user.credits, balance);
  assert.equal(requests, 2, "the transport must not add hidden POST retries");
  assert.equal(failed.errorDetail, undefined, "raw diagnostics are admin-only");
  const list = (await admin.get(`/api/admin/generations?q=${id}`)).data;
  const detail = list.items.find((g) => g.id === id);
  assert.equal(detail.attempts, 2);
  const errors = JSON.parse(detail.errorDetail);
  assert.equal(errors[0].code, "NETWORK");
  assert.match(errors[0].detail, /UND_ERR_SOCKET|ECONNRESET/);

  await t.test("a worker connection timeout keeps the exact failure and refunds the new task", async (t) => {
    const sockets = new Set();
    const stalled = net.createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => {});
    });
    await new Promise((resolve) => stalled.listen(0, "127.0.0.1", resolve));
    t.after(async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => stalled.close(resolve));
    });
    const openai = channels.find((channel) => channel.kind === "openai");
    assert.equal((await admin.put(`/api/admin/channels/${openai.id}`, {
      baseUrl: `https://127.0.0.1:${stalled.address().port}/v1`, options: { connectTimeoutSec: 1 }
    })).status, 200);
    await admin.put("/api/admin/settings/generation", { value: { ...settings, maxAttempts: 1 } });
    const created = await user.post("/api/generations", { prompt: "a ceramic cup", quality: "low", n: 1 });
    assert.equal(created.status, 201);
    const id = created.data.generation.id;
    const failed = await waitFor(async () => {
      const response = await user.get(`/api/generations/${id}`);
      return response.data.generation.status === "failed" ? response.data.generation : null;
    });
    assert.equal(failed.errorMessage, PUBLIC_MESSAGES.connectTimeout);
    assert.equal(failed.refunded, failed.cost);
    assert.equal((await user.get("/api/me")).data.user.credits, balance);
    const list = (await admin.get(`/api/admin/generations?q=${id}`)).data;
    const error = JSON.parse(list.items.find((g) => g.id === id).errorDetail)[0];
    assert.equal(error.code, "CONNECT_TIMEOUT");
    assert.match(error.detail, /UND_ERR_CONNECT_TIMEOUT/);
    const ping = await admin.post(`/api/admin/channels/${openai.id}/test`, { mode: "ping" });
    assert.equal(ping.data.ok, false);
    assert.equal(ping.data.code, "CONNECT_TIMEOUT");
  });
});

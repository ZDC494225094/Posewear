// 易支付: ordering through submit.php or mapi.php, the signed notification
// crediting the order once, and the order query.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import { startApp, client, waitFor, listenLocal } from "./helpers.js";

const KEY = "epay-merchant-key-123";
const md5 = (s) => crypto.createHash("md5").update(s, "utf8").digest("hex");
const signOf = (params) => md5(Object.keys(params).filter((k) => !["sign", "sign_type"].includes(k) && params[k] !== "")
  .sort().map((k) => `${k}=${params[k]}`).join("&") + KEY);

let app, admin, user, gateway, gatewayBase;
const calls = [];
const paidAtGateway = new Set();

before(async () => {
  // A stand-in for the gateway: mapi.php answers with a QR code, api.php reports orders paid at the gateway.
  gateway = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://gateway");
    let body = "";
    for await (const chunk of req) body += chunk;
    const params = Object.fromEntries(new URLSearchParams(req.method === "POST" ? body : url.search));
    calls.push({ path: url.pathname, params });
    res.setHeader("Content-Type", "application/json");
    if (url.pathname === "/mapi.php") {
      return res.end(JSON.stringify(params.sign === signOf(params)
        ? { code: 1, msg: "", trade_no: `T${params.out_trade_no}`, qrcode: "weixin://wxpay/bizpayurl?pr=abc123" }
        : { code: -1, msg: "签名错误" }));
    }
    if (url.pathname === "/api.php") {
      const paid = params.key === KEY && paidAtGateway.has(params.out_trade_no);
      return res.end(JSON.stringify({ code: 1, msg: "查询订单号成功！", trade_no: `Q${params.out_trade_no}`, status: paid ? 1 : 0, money: "9.90" }));
    }
    res.statusCode = 404;
    res.end("{}");
  });
  await listenLocal(gateway);
  gatewayBase = `http://127.0.0.1:${gateway.address().port}`;
  app = await startApp({ importUpstream: false });
  admin = client(app.base);
  user = client(app.base);
  for (const c of [admin, user]) await c.get("/api/public/config");
  assert.equal((await admin.post("/api/auth/login", { email: "admin@test.local", password: "admin-pass-123" })).status, 200);
  const saved = await admin.put("/api/admin/settings/payment", { value: { epay: { enabled: true, gateway: `${gatewayBase}/submit.php`, pid: "1001",
    key: KEY, mode: "page", types: ["alipay", "wxpay"] } } });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.deepEqual(saved.data.value.epay.key, { __secret: true, set: true, hint: saved.data.value.epay.key.hint }, "the key is masked");
  assert.equal((await user.post("/api/auth/register", { email: "ivy@example.com", password: "secret-pass-1", agree: true })).status, 201);
});

after(async () => {
  await app?.stop();
  gateway?.close();
});

const balance = async () => (await user.get("/api/me")).data.user.credits;
const pkg = async () => (await user.get("/api/billing/packages")).data.items.find((p) => p.priceCents === 990);
const notify = (params) => client(app.base).raw(`/api/pay/notify/epay?${new URLSearchParams(params)}`).then((r) => r.text());

test("the studio offers each 易支付 method the admin turned on", async () => {
  const cfg = (await user.get("/api/public/config")).data.payment;
  assert.ok(cfg.providers.includes("epay"));
  assert.deepEqual(cfg.epayTypes, ["alipay", "wxpay"]);
  const off = await user.post("/api/billing/orders", { packageId: (await pkg()).id, provider: "epay", method: "qqpay" });
  assert.equal(off.status, 400);
  assert.equal(off.data.error.code, "PROVIDER_DISABLED");
});

test("an order goes to submit.php signed, and the signed notification credits it once", async () => {
  const start = await balance();
  const p = await pkg();
  const res = await user.post("/api/billing/orders", { packageId: p.id, provider: "epay", method: "wxpay" });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const order = res.data.order;
  assert.equal(order.providerLabel, "微信支付（易支付）");
  assert.equal(order.pay.type, "redirect");
  const url = new URL(order.pay.url);
  assert.equal(`${url.origin}${url.pathname}`, `${gatewayBase}/submit.php`);
  const sent = Object.fromEntries(url.searchParams);
  assert.deepEqual([sent.pid, sent.type, sent.out_trade_no, sent.money, sent.sign_type], ["1001", "wxpay", order.id, "9.90", "MD5"]);
  assert.match(sent.notify_url, /\/api\/pay\/notify\/epay$/);
  assert.equal(sent.sign, signOf(sent));

  const paid = { pid: "1001", trade_no: "2026110222001", out_trade_no: order.id, type: "wxpay", name: sent.name, money: "9.90",
    trade_status: "TRADE_SUCCESS", sign_type: "MD5" };
  assert.equal(await notify({ ...paid, sign: "0".repeat(32) }), "fail", "a bad signature");
  assert.equal(await notify({ ...paid, pid: "2002", sign: signOf({ ...paid, pid: "2002" }) }), "fail", "another merchant");
  const cheap = { ...paid, money: "0.01" };
  assert.equal(await notify({ ...cheap, sign: signOf(cheap) }), "fail", "a different amount");
  assert.equal((await user.get(`/api/billing/orders/${order.id}`)).data.order.status, "pending");
  assert.equal(await notify({ ...paid, sign: signOf(paid) }), "success");
  assert.equal(await notify({ ...paid, sign: signOf(paid) }), "success", "a repeated notification is answered too");
  const after = (await user.get(`/api/billing/orders/${order.id}`)).data.order;
  assert.equal(after.status, "paid");
  assert.equal(await balance(), start + p.totalCredits, "credited once");
});

test("a reused request signature, repeated fields or another gateway's order don't confirm a payment", async () => {
  const p = await pkg();
  const start = await balance();
  const order = (await user.post("/api/billing/orders", { packageId: p.id, provider: "epay", method: "alipay" })).data.order;
  // The buyer holds the signed submit.php URL; sent back as a "notification" it must not count.
  const request = Object.fromEntries(new URL(order.pay.url).searchParams);
  assert.equal(await notify({ ...request, trade_status: "TRADE_SUCCESS" }), "fail");
  assert.equal(await notify(request), "fail", "fields a notification doesn't have");
  const paid = { pid: "1001", trade_no: "2026110222002", out_trade_no: order.id, type: "alipay", name: request.name, money: "9.9",
    trade_status: "TRADE_SUCCESS", sign_type: "MD5" };
  const sign = signOf(paid);
  const repeated = new URLSearchParams({ ...paid, sign });
  repeated.append("money", "0.01");
  assert.equal(await client(app.base).raw(`/api/pay/notify/epay?${repeated}`).then((r) => r.text()), "fail", "a repeated field");
  assert.equal((await user.get(`/api/billing/orders/${order.id}`)).data.order.status, "pending");
  // Newer gateways send the amount as a number ("9.9" for 9.90).
  assert.equal(await notify({ ...paid, sign }), "success");
  assert.equal((await user.get(`/api/billing/orders/${order.id}`)).data.order.status, "paid");
  assert.equal(await balance(), start + p.totalCredits);

  // A correctly signed 易支付 notification for an order made another way is refused.
  await admin.put("/api/admin/settings/payment", { value: { mock: { enabled: true } } });
  try {
    const mock = (await user.post("/api/billing/orders", { packageId: p.id, provider: "mock" })).data.order;
    const other = { ...paid, trade_no: "2026110222003", out_trade_no: mock.id, money: "9.90" };
    assert.equal(await notify({ ...other, sign: signOf(other) }), "fail");
    assert.equal((await user.get(`/api/billing/orders/${mock.id}`)).data.order.status, "pending");
  } finally {
    await admin.put("/api/admin/settings/payment", { value: { mock: { enabled: false } } });
  }
});

test("mapi.php orders show the gateway's QR code, and the order query confirms a payment", async () => {
  await admin.put("/api/admin/settings/payment", { value: { epay: { mode: "api" } } });
  const start = await balance();
  const res = await user.post("/api/billing/orders", { packageId: (await pkg()).id, provider: "epay", method: "alipay" });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const order = res.data.order;
  assert.equal(order.pay.type, "qr");
  const call = calls.findLast((c) => c.path === "/mapi.php");
  assert.deepEqual([call.params.type, call.params.out_trade_no, call.params.device], ["alipay", order.id, "pc"]);
  assert.ok(call.params.clientip, "the client IP goes with an API order");
  assert.equal((await user.raw(`/api/billing/orders/${order.id}/qr.svg`)).status, 200);

  // The notification never came; the gateway says it's paid.
  assert.equal((await user.post(`/api/billing/orders/${order.id}/refresh`)).data.order.status, "pending");
  paidAtGateway.add(order.id);
  const refreshed = await waitFor(async () => {
    const r = await user.post(`/api/billing/orders/${order.id}/refresh`);
    return r.data.order?.status === "paid" ? r.data.order : null;
  });
  assert.equal(refreshed.status, "paid");
  assert.equal(calls.findLast((c) => c.path === "/api.php").params.act, "order");
  assert.ok(await balance() > start);
});

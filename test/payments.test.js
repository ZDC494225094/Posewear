// Signature and decryption checks for the payment gateways, with locally
// generated keys standing in for the merchant and platform keys.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env.ENV_FILE = ".env.test-none";
process.env.APP_SECRET = "test-secret-0123456789-0123456789-abcdef";
const os = await import("node:os");
const path = await import("node:path");
const fs = await import("node:fs");
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "posewear-pay-"));

const alipay = await import("../server/payments/alipay.js");
const wechat = await import("../server/payments/wechat.js");

const pair = () => crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = (key, type) => key.export({ type, format: "pem" });
const bare = (key, type) => key.export({ type, format: "der" }).toString("base64");

test("alipay: sign content excludes sign/sign_type and empty values, sorted by key", () => {
  const content = alipay.signContent({ b: "2", a: "1", sign: "x", sign_type: "RSA2", empty: "" }, { excludeSignType: true });
  assert.equal(content, "a=1&b=2");
  assert.equal(alipay.signContent({ b: "2", a: "1", sign_type: "RSA2" }), "a=1&b=2&sign_type=RSA2");
});

test("alipay: notify verification accepts a valid signature and rejects tampering", () => {
  const platform = pair();
  const body = {
    app_id: "2021000000000001", out_trade_no: "PW20261029000000ABCDEF", trade_no: "2026102922001",
    total_amount: "29.90", trade_status: "TRADE_SUCCESS", notify_time: "2026-10-29 21:00:00", sign_type: "RSA2"
  };
  body.sign = crypto.sign("RSA-SHA256", Buffer.from(alipay.signContent(body, { excludeSignType: true })), platform.privateKey).toString("base64");
  const cfg = { appId: "2021000000000001", alipayPublicKey: bare(platform.publicKey, "spki") };
  const parsed = alipay.parseNotify(cfg, body);
  assert.deepEqual(parsed, { orderId: body.out_trade_no, tradeNo: body.trade_no, amountCents: 2990, paid: true });
  assert.equal(alipay.parseNotify(cfg, { ...body, total_amount: "0.01" }), null);
  assert.equal(alipay.parseNotify({ ...cfg, appId: "other" }, body), null);
});

test("alipay: page pay URL is signed with the app key (PKCS#1 or PKCS#8, bare or PEM)", async () => {
  const app = pair();
  for (const key of [pem(app.privateKey, "pkcs8"), bare(app.privateKey, "pkcs1"), bare(app.privateKey, "pkcs8")]) {
    const pay = await alipay.create({ appId: "2021000000000001", privateKey: key, mode: "page", sandbox: true },
      { id: "PW1", amount_cents: 990, title: "测试套餐", expires_at: Date.now() + 1800_000 },
      { notifyUrl: "https://example.com/n", returnUrl: "https://example.com/r" });
    assert.equal(pay.type, "redirect");
    const url = new URL(pay.url);
    assert.equal(url.origin + url.pathname, "https://openapi-sandbox.dl.alipaydev.com/gateway.do");
    const params = Object.fromEntries(url.searchParams);
    assert.equal(JSON.parse(params.biz_content).total_amount, "9.90");
    assert.ok(crypto.verify("RSA-SHA256", Buffer.from(alipay.signContent(params)), app.publicKey, Buffer.from(params.sign, "base64")));
  }
});

test("wechat: authorization header signs method, path, timestamp, nonce and body", () => {
  const merchant = pair();
  const cfg = { mchId: "1900000001", serialNo: "ABC123", privateKey: pem(merchant.privateKey, "pkcs8") };
  const header = wechat.authorization(cfg, "POST", "/v3/pay/transactions/native", "{\"a\":1}");
  const fields = Object.fromEntries([...header.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  assert.equal(fields.mchid, "1900000001");
  assert.equal(fields.serial_no, "ABC123");
  const message = `POST\n/v3/pay/transactions/native\n${fields.timestamp}\n${fields.nonce_str}\n{"a":1}\n`;
  assert.ok(crypto.verify("RSA-SHA256", Buffer.from(message), merchant.publicKey, Buffer.from(fields.signature, "base64")));
});

test("wechat: notify is verified with the platform key and decrypted with the APIv3 key", () => {
  const platform = pair();
  const apiV3Key = "0123456789abcdef0123456789abcdef";
  const transaction = {
    mchid: "1900000001", appid: "wx0000000000000001", out_trade_no: "PW20261029000000ABCDEF",
    transaction_id: "4200000000202610290000000001", trade_state: "SUCCESS", amount: { total: 2990, currency: "CNY" }
  };
  const nonce = "abcdefghijkl";
  const aad = "transaction";
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(apiV3Key), Buffer.from(nonce));
  cipher.setAAD(Buffer.from(aad));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(transaction)), cipher.final(), cipher.getAuthTag()]);
  const rawBody = JSON.stringify({
    id: "evt-1", event_type: "TRANSACTION.SUCCESS", resource_type: "encrypt-resource",
    resource: { algorithm: "AEAD_AES_256_GCM", ciphertext: encrypted.toString("base64"), nonce, associated_data: aad }
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const headerNonce = "n0nce";
  const signature = crypto.sign("RSA-SHA256", Buffer.from(`${timestamp}\n${headerNonce}\n${rawBody}\n`), platform.privateKey).toString("base64");
  const headers = { "wechatpay-timestamp": timestamp, "wechatpay-nonce": headerNonce, "wechatpay-signature": signature, "wechatpay-serial": "PUB_KEY_ID_1" };
  const cfg = { mchId: "1900000001", appId: "wx0000000000000001", apiV3Key,
    platformPublicKey: pem(platform.publicKey, "spki"), platformPublicKeyId: "PUB_KEY_ID_1" };

  assert.deepEqual(wechat.parseNotify(cfg, headers, rawBody),
    { orderId: transaction.out_trade_no, tradeNo: transaction.transaction_id, amountCents: 2990, paid: true });
  assert.equal(wechat.parseNotify(cfg, headers, rawBody.replace("TRANSACTION", "TAMPERED")), null);
  assert.equal(wechat.parseNotify({ ...cfg, platformPublicKeyId: "PUB_KEY_ID_2" }, headers, rawBody), null);
  const stale = { ...headers, "wechatpay-timestamp": String(Number(timestamp) - 3600) };
  assert.equal(wechat.parseNotify(cfg, stale, rawBody), null);
});

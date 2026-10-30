import crypto from "node:crypto";

// Payment consoles hand out keys in several shapes: PEM with headers, or a bare
// base64 body (PKCS#8 or PKCS#1). Accept all of them.
export function privateKeyFrom(raw) {
  const text = String(raw || "").trim();
  if (!text) throw new Error("私钥未配置");
  if (text.includes("-----BEGIN")) return crypto.createPrivateKey(text);
  const der = Buffer.from(text.replace(/\s+/g, ""), "base64");
  try { return crypto.createPrivateKey({ key: der, format: "der", type: "pkcs8" }); }
  catch { return crypto.createPrivateKey({ key: der, format: "der", type: "pkcs1" }); }
}

export function publicKeyFrom(raw) {
  const text = String(raw || "").trim();
  if (!text) throw new Error("公钥未配置");
  if (text.includes("-----BEGIN")) return crypto.createPublicKey(text);
  const der = Buffer.from(text.replace(/\s+/g, ""), "base64");
  try { return crypto.createPublicKey({ key: der, format: "der", type: "spki" }); }
  catch { return crypto.createPublicKey({ key: der, format: "der", type: "pkcs1" }); }
}

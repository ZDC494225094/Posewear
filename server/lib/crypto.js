import crypto from "node:crypto";
import { promisify } from "node:util";
import { config } from "../config.js";

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
// Short lowercase ids without ambiguous characters, for URLs and file names.
export function randomId(length = 16) {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
// Redeem codes: 16 symbols from a 32-symbol alphabet (80 bits), grouped by 4.
export function redeemCode() {
  const bytes = crypto.randomBytes(16);
  let raw = "";
  for (let i = 0; i < 16; i++) raw += CODE_ALPHABET[bytes[i] & 31];
  return raw.match(/.{4}/g).join("-");
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password.normalize("NFKC"), salt, SCRYPT.keylen,
    { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(String(password).normalize("NFKC"), Buffer.from(saltB64, "base64"),
    expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  return crypto.timingSafeEqual(actual, expected);
}

export function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

const encryptionKey = crypto.createHash("sha256").update("posewear:settings:" + config.appSecret).digest();

// AES-256-GCM for secrets at rest (API keys, payment keys, SMTP password).
export function encryptSecret(plain) {
  if (plain === undefined || plain === null || plain === "") return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
  const data = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  return "v1:" + Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}

export function decryptSecret(payload) {
  if (!payload) return "";
  if (!String(payload).startsWith("v1:")) throw new Error("Unsupported secret format");
  const raw = Buffer.from(String(payload).slice(3), "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

// "sk-abc...wxyz" style hint so admins can tell keys apart without exposing them.
export function maskSecret(plain) {
  if (!plain) return "";
  const value = String(plain).replace(/\s+/g, "");
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 3)}••••${value.slice(-4)}`;
}

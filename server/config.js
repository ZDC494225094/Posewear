import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// .env is optional; real environment variables always win.
const envFile = path.join(ROOT, process.env.ENV_FILE || ".env");
if (fs.existsSync(envFile) && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(envFile);
}

const env = process.env;
const fromRoot = (value, fallback) => path.resolve(ROOT, value || fallback);

function flag(value, fallback) {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

const dataDir = fromRoot(env.DATA_DIR, "storage");
fs.mkdirSync(dataDir, { recursive: true });

// The app secret encrypts API keys and payment credentials stored in the
// database. Losing it makes those values unreadable, so a generated secret is
// persisted next to the data and the dashboard warns until one is configured.
let appSecret = env.APP_SECRET || "";
let appSecretGenerated = false;
if (!appSecret) {
  const secretFile = path.join(dataDir, ".app-secret");
  if (fs.existsSync(secretFile)) {
    appSecret = fs.readFileSync(secretFile, "utf8").trim();
  } else {
    appSecret = crypto.randomBytes(48).toString("base64url");
    fs.writeFileSync(secretFile, appSecret + "\n", { mode: 0o600 });
  }
  appSecretGenerated = true;
}
if (appSecret.length < 32) {
  throw new Error("APP_SECRET must be at least 32 characters long");
}

export const config = {
  root: ROOT,
  env: env.NODE_ENV || "development",
  isProd: env.NODE_ENV === "production",
  host: env.HOST || "0.0.0.0",
  port: Number(env.PORT) || 3000,
  dataDir,
  dbFile: path.join(dataDir, "posewear.db"),
  libraryDir: fromRoot(env.LIBRARY_DIR, "storage/library"),
  publicDir: path.join(ROOT, "public"),
  trustProxy: env.TRUST_PROXY ?? "loopback",
  cookieSecure: (env.COOKIE_SECURE || "auto").toLowerCase(),
  publicBaseUrl: (env.PUBLIC_BASE_URL || "").replace(/\/+$/, ""),
  tzOffsetMinutes: Number.isFinite(Number(env.TZ_OFFSET_MINUTES)) && env.TZ_OFFSET_MINUTES !== undefined
    ? Number(env.TZ_OFFSET_MINUTES) : 480,
  appSecret,
  appSecretGenerated,
  adminEmail: env.ADMIN_EMAIL || "",
  adminPassword: env.ADMIN_PASSWORD || "",
  workerEnabled: flag(env.WORKER_ENABLED, true),
  logLevel: env.LOG_LEVEL || "info"
};

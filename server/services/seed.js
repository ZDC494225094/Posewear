import { db } from "../db.js";
import { config } from "../config.js";
import * as channels from "./channels.js";
import { log } from "../lib/logger.js";

// First run only: an OpenAI gpt-image-2 channel (enabled when OPENAI_API_KEY
// is set in the environment) and a mock channel for demos outside production.
export function seedChannels() {
  if (db.prepare("SELECT COUNT(*) AS n FROM channels").get().n) return;
  const key = process.env.OPENAI_API_KEY || "";
  channels.create({
    name: "OpenAI 官方 · gpt-image-2",
    kind: "openai",
    baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    apiKey: key,
    model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2",
    priority: 10,
    enabled: !!key,
    options: { sizeMode: "flexible", inputFidelity: "omit" }
  });
  channels.create({
    name: "演示用模拟渠道",
    kind: "mock",
    model: "mock",
    priority: 0,
    enabled: !key && !config.isProd,
    options: { mockDelayMs: 2500 }
  });
  log.info(`Seeded channels (OpenAI ${key ? "enabled from OPENAI_API_KEY" : "disabled until an API key is set"})`);
}

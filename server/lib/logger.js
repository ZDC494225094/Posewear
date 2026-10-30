import { config } from "../config.js";

const levels = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = levels[config.logLevel] ?? levels.info;

function write(level, message, detail) {
  if (levels[level] < threshold) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}`;
  const out = level === "error" || level === "warn" ? console.error : console.log;
  if (detail === undefined) out(line);
  else out(line, detail instanceof Error ? (detail.stack || detail.message) : detail);
}

export const log = {
  debug: (message, detail) => write("debug", message, detail),
  info: (message, detail) => write("info", message, detail),
  warn: (message, detail) => write("warn", message, detail),
  error: (message, detail) => write("error", message, detail)
};

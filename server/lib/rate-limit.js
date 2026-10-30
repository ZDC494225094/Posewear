import { tooMany } from "./errors.js";

// In-memory fixed-window counters. The app runs as a single process (SQLite),
// so a shared store is not needed; counters reset on restart.
const buckets = new Map();

export function hit(key, max, windowMs) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  return bucket.count <= max;
}

export function enforce(key, max, windowMs, message) {
  if (!hit(key, max, windowMs)) throw tooMany(message);
}

export function reset(key) {
  buckets.delete(key);
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
}, 60_000).unref();

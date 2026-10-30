import { db } from "../db.js";
import { purgeExpired } from "./uploads.js";
import { closeExpiredOrders } from "./billing.js";
import { log } from "../lib/logger.js";

// Periodic housekeeping: expired sessions and tokens, person photos past their
// retention period, and pending orders past their payment window.
export function runMaintenance() {
  try {
    const now = Date.now();
    const sessions = db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now).changes;
    const tokens = db.prepare("DELETE FROM user_tokens WHERE expires_at <= ?").run(now - 24 * 3600_000).changes;
    const uploads = purgeExpired();
    const orders = closeExpiredOrders();
    if (sessions || tokens || uploads || orders) {
      log.info(`Maintenance: ${sessions} sessions, ${tokens} tokens, ${uploads} uploads purged; ${orders} orders closed`);
    }
  } catch (err) {
    log.error("Maintenance failed", err);
  }
}

export function startMaintenance() {
  runMaintenance();
  setInterval(runMaintenance, 10 * 60 * 1000).unref();
}

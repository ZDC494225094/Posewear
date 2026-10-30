import { db } from "../db.js";
import * as settings from "./settings.js";
import * as credits from "./credits.js";

// Usage fees for other users' shared assets. The payer is charged together
// with the generation; the owner's share is paid when the job succeeds and
// the whole fee goes back with the refund when it fails. Callers run these
// inside the transaction that charges or settles the job.

export function hold(generationId, payerId, fees) {
  const insert = db.prepare(`INSERT INTO asset_fees (generation_id, asset_id, owner_id, payer_id, price, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`);
  const now = Date.now();
  for (const f of fees) insert.run(generationId, f.asset.id, f.asset.owner_id, payerId, f.price, now);
}

export function settle(generationId) {
  const rows = db.prepare("SELECT * FROM asset_fees WHERE generation_id = ? AND status = 'held'").all(generationId);
  const percent = settings.get("assets").rebatePercent;
  const now = Date.now();
  for (const fee of rows) {
    const rebate = Math.floor((fee.price * percent) / 100);
    if (rebate > 0) {
      const asset = db.prepare("SELECT name_zh, name FROM assets WHERE id = ?").get(fee.asset_id);
      credits.adjust(fee.owner_id, rebate, "asset_income", {
        refType: "asset", refId: fee.asset_id, note: `素材「${asset?.name_zh || asset?.name || fee.asset_id}」被使用`
      });
      db.prepare("UPDATE assets SET earned = earned + ? WHERE id = ?").run(rebate, fee.asset_id);
    }
    db.prepare("UPDATE asset_fees SET status = 'paid', rebate = ?, settled_at = ? WHERE id = ?").run(rebate, now, fee.id);
  }
}

export function release(generationId) {
  db.prepare("UPDATE asset_fees SET status = 'refunded', settled_at = ? WHERE generation_id = ? AND status = 'held'")
    .run(Date.now(), generationId);
}

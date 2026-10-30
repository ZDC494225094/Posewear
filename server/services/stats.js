import { db } from "../db.js";
import { config } from "../config.js";
import * as settings from "./settings.js";
import * as channels from "./channels.js";
import { DAY, localDate, startOfLocalDay, sqlLocalDate } from "../lib/time.js";
import { counts as libraryCounts } from "./library.js";

function series(days, rows, fields) {
  const map = new Map(rows.map((r) => [r.day, r]));
  const out = [];
  const today = startOfLocalDay();
  for (let i = days - 1; i >= 0; i--) {
    const day = localDate(today - i * DAY + 12 * 3600_000);
    const row = map.get(day) || {};
    const entry = { day };
    for (const f of fields) entry[f] = Number(row[f] || 0);
    out.push(entry);
  }
  return out;
}

export function overview({ days = 30 } = {}) {
  const span = Math.max(7, Math.min(90, days));
  const since = startOfLocalDay() - (span - 1) * DAY;
  const today = startOfLocalDay();
  const gen = settings.get("generation");

  const users = db.prepare(`SELECT COUNT(*) AS total, SUM(created_at >= ?) AS today, SUM(created_at >= ?) AS week FROM users`)
    .get(today, today - 6 * DAY);
  const g = db.prepare(`SELECT COUNT(*) AS total, SUM(created_at >= ?) AS today,
      SUM(status = 'succeeded' AND created_at >= ?) AS ok7, SUM(status = 'failed' AND created_at >= ?) AS fail7,
      SUM(status IN ('queued','running')) AS active,
      COALESCE(SUM(CASE WHEN created_at >= ? THEN api_cost_usd END), 0) AS cost30
    FROM generations`).get(today, today - 6 * DAY, today - 6 * DAY, since);
  const images = db.prepare("SELECT COUNT(*) AS n FROM generation_images WHERE created_at >= ?").get(since).n;
  const revenue = db.prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS total,
      COALESCE(SUM(CASE WHEN paid_at >= ? THEN amount_cents END), 0) AS today,
      COALESCE(SUM(CASE WHEN paid_at >= ? THEN amount_cents END), 0) AS period,
      COUNT(*) AS orders
    FROM orders WHERE status = 'paid'`).get(today, since);
  // Net credits consumed: usage fees paid on to asset owners are not spent.
  const spent = db.prepare(`SELECT COALESCE(-SUM(delta), 0) AS n FROM credit_ledger
    WHERE kind IN ('generation', 'asset_generation', 'asset_income', 'refund') AND created_at >= ?`).get(since).n;
  const outstanding = db.prepare("SELECT COALESCE(SUM(credits), 0) AS n FROM users").get().n;

  const genDaily = db.prepare(`SELECT ${sqlLocalDate("created_at")} AS day, COUNT(*) AS total,
      SUM(status = 'succeeded') AS succeeded, SUM(status = 'failed') AS failed
    FROM generations WHERE created_at >= ? GROUP BY day`).all(since);
  const revDaily = db.prepare(`SELECT ${sqlLocalDate("paid_at")} AS day, SUM(amount_cents) AS revenue, COUNT(*) AS orders
    FROM orders WHERE status = 'paid' AND paid_at >= ? GROUP BY day`).all(since);
  const userDaily = db.prepare(`SELECT ${sqlLocalDate("created_at")} AS day, COUNT(*) AS signups
    FROM users WHERE created_at >= ? GROUP BY day`).all(since);
  const costDaily = db.prepare(`SELECT ${sqlLocalDate("created_at")} AS day, SUM(api_cost_usd) AS cost
    FROM generations WHERE created_at >= ? AND api_cost_usd IS NOT NULL GROUP BY day`).all(since);

  const recentFailures = db.prepare(`SELECT g.id, g.error_code, g.error_message, g.created_at, u.email
    FROM generations g JOIN users u ON u.id = g.user_id WHERE g.status = 'failed' ORDER BY g.created_at DESC LIMIT 6`).all();
  const qualityMix = db.prepare(`SELECT quality, COUNT(*) AS n FROM generations WHERE created_at >= ? GROUP BY quality`).all(since);
  const pendingReports = db.prepare("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'").get().n;
  const pendingReview = settings.get("safety").showcaseReview ? db.prepare(`SELECT COUNT(*) AS n FROM generations
    WHERE is_public = 1 AND approved = 0 AND hidden = 0 AND deleted_at IS NULL`).get().n : 0;
  const pendingAssets = db.prepare(`SELECT COUNT(*) AS n FROM assets
    WHERE review = 'pending' AND visibility = 'public' AND enabled = 1`).get().n;

  const rev = series(span, revDaily, ["revenue"]);
  const signups = series(span, userDaily, ["signups"]);
  const cost = series(span, costDaily, ["cost"]);
  const daily = series(span, genDaily, ["total", "succeeded", "failed"]).map((d, i) => ({
    ...d,
    revenue: rev[i].revenue,
    signups: signups[i].signups,
    costUsd: Math.round(cost[i].cost * 10000) / 10000
  }));

  const done7 = (g.ok7 || 0) + (g.fail7 || 0);
  return {
    span,
    users: { total: users.total, today: users.today || 0, week: users.week || 0 },
    generations: {
      total: g.total, today: g.today || 0, active: g.active || 0, images,
      successRate7: done7 ? (g.ok7 || 0) / done7 : null
    },
    revenue: { totalCents: revenue.total, todayCents: revenue.today, periodCents: revenue.period, orders: revenue.orders },
    credits: { spentPeriod: spent, outstanding },
    cost: { periodUsd: g.cost30, periodCny: g.cost30 * gen.usdToCny, usdToCny: gen.usdToCny },
    daily,
    qualityMix,
    recentFailures,
    pendingReports,
    pendingReview,
    pendingAssets,
    library: libraryCounts(),
    warnings: warnings()
  };
}

export function warnings() {
  const list = [];
  const site = settings.get("site");
  const payment = settings.get("payment");
  const enabled = channels.enabledChannels();
  if (!enabled.length) list.push({ level: "error", text: "还没有启用任何 AI 渠道，用户无法生成。请到「AI 渠道」添加 gpt-image-2 的 API Key。", link: "/admin/channels" });
  else if (enabled.every((c) => c.kind === "mock")) list.push({ level: "warning", text: "当前只启用了模拟渠道，生成结果是占位图，不会调用真实模型。", link: "/admin/channels" });
  if (config.appSecretGenerated) list.push({ level: "warning", text: "APP_SECRET 为自动生成并保存在 storage/.app-secret。请在 .env 中固定它，并与数据一起备份，否则已保存的密钥将无法解密。" });
  if (!site.publicBaseUrl) list.push({ level: "warning", text: "未设置站点公网地址，支付回调和邮件链接可能不正确。", link: "/admin/site" });
  if (payment.mock.enabled) list.push({ level: "warning", text: "模拟支付已开启，任何用户都可以免费“支付”。正式运营前务必关闭。", link: "/admin/payments" });
  if (!libraryCounts().poses) list.push({ level: "error", text: "素材库为空。请运行导入脚本或在「素材库」上传素材。", link: "/admin/assets" });
  return list;
}

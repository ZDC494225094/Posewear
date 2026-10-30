import { h, tile, replace } from "../../core/dom.js";
import { api } from "../../core/api.js";
import { toastError } from "../../core/ui.js";
import { yuan, number, dateTime } from "../../core/format.js";
import { pageHead, section, table } from "../kit.js";
import { columnChart } from "../chart.js";

function stat(iconName, color, label, value, note) {
  return h("div.stat-tile",
    h("p.stat-label", tile(iconName, color), label),
    h("p.stat-value.num", value),
    note ? h("p.stat-note.small.muted", note) : null);
}

export async function render() {
  let days = 30;
  const body = h("div.a-dash");
  const rangeBar = h("div.a-range");

  async function load() {
    body.classList.add("is-loading");
    let o;
    try { o = await api.get("/api/admin/overview", { days }); }
    catch (err) { toastError(err); body.classList.remove("is-loading"); return; }
    body.classList.remove("is-loading");
    replace(rangeBar, h("div.seg", { role: "group", "aria-label": "时间范围" }, [7, 30, 90].map((d) =>
      h("button", { type: "button", "aria-pressed": String(d === days), onclick: () => { days = d; load(); } }, `近 ${d} 天`))));

    const rate = o.generations.successRate7 === null ? "—" : `${Math.round(o.generations.successRate7 * 100)}%`;
    const revenueCny = o.revenue.periodCents / 100;
    const margin = revenueCny > 0 ? Math.round((1 - o.cost.periodCny / revenueCny) * 100) : null;
    const label = (d) => d.day.slice(5).replace("-", "/");

    replace(body,
      o.warnings.length ? h("div.a-warnings", o.warnings.map((w) => h("div.a-warning", { class: `is-${w.level}` },
        h("span", w.text), w.link ? h("a.link", { href: w.link }, "去处理") : null))) : null,
      h("div.a-overview",
        h("div.hero-figure",
          h("div",
            h("p.stat-label", tile("receipt", "green"), `近 ${o.span} 天收入`),
            h("p.hero-figure-value.num", yuan(o.revenue.periodCents))),
          h("p.small", `累计 ${yuan(o.revenue.totalCents)} · ${number(o.revenue.orders)} 笔已支付订单 · 今日 ${yuan(o.revenue.todayCents)}`)),
        h("div.stat-row",
          stat("sparkle", "orange", "今日生成", number(o.generations.today), `进行中 ${o.generations.active}`),
          stat("checkCircle", "green", "近 7 天成功率", rate, "失败的任务已自动退点"),
          stat("photos", "purple", `近 ${o.span} 天出图`, number(o.generations.images), `消耗 ${number(o.credits.spentPeriod)} 点`),
          stat("users", "indigo", "用户", number(o.users.total), `今日新增 ${o.users.today} · 近 7 天 ${o.users.week}`),
          stat("bolt", "orange", `近 ${o.span} 天模型成本`, `¥${(o.cost.periodCny).toFixed(2)}`,
            margin === null ? `约 $${o.cost.periodUsd.toFixed(2)}，按 ${o.cost.usdToCny} 汇率折算` : `毛利率约 ${margin}%（按收入估算）`),
          stat("gem", "blue", "用户未用余额", number(o.credits.outstanding), "全部用户的点数合计"))),
      h("div.chart-grid",
        columnChart({ title: "每日生成次数", iconName: "sparkle", color: "orange", points: o.daily.map((d) => ({ label: label(d), value: d.total,
          detail: [["成功", d.succeeded], ["失败", d.failed]] })) }),
        columnChart({ title: "每日收入（元）", iconName: "receipt", color: "green", points: o.daily.map((d) => ({ label: label(d), value: d.revenue / 100 })),
          format: (v) => `¥${v.toFixed(2)}` }),
        columnChart({ title: "每日新增用户", iconName: "users", color: "indigo", points: o.daily.map((d) => ({ label: label(d), value: d.signups })) }),
        columnChart({ title: "每日模型成本（美元）", iconName: "bolt", color: "orange", points: o.daily.map((d) => ({ label: label(d), value: d.costUsd })),
          format: (v) => `$${v.toFixed(3)}` })),
      section("最近失败", "失败任务已退点。错误详情见「生成记录」。",
        table([
          { label: "时间", render: (r) => dateTime(r.created_at), className: "num" },
          { label: "用户", render: (r) => r.email },
          { label: "原因", render: (r) => h("span", h("code", r.error_code || ""), " ", r.error_message || "") },
          { label: "", render: (r) => h("a.link", { href: `/admin/generations?q=${r.id}` }, "查看") }
        ], o.recentFailures, { empty: "最近没有失败的任务" })),
      h("p.small.faint", `素材库：${number(o.library.poseGroups)} 组姿势（${number(o.library.poses)} 张） · ${number(o.library.outfits)} 套服装 · 队列中运行 ${o.worker.running} 个任务`));
  }
  load();
  return h("div", pageHead("数据概览", "收入、生成量和成本一览。"), rangeBar, body);
}

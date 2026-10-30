import { h, replace } from "../../core/dom.js";
import { api } from "../../core/api.js";
import { toast, toastError, busy, copyText } from "../../core/ui.js";
import { dateTime, date } from "../../core/format.js";
import { pageHead, section, form, listView, table, statusPill } from "../kit.js";

export async function render() {
  const created = h("div");
  const f = form([
    { key: "count", label: "数量", type: "number", min: 1, max: 1000 },
    { key: "credits", label: "每个码的点数", type: "number", min: 1 },
    { key: "expiresDate", label: "过期日期（可选）", placeholder: "2026-12-31" },
    { key: "note", label: "备注", placeholder: "如：小红书活动", max: 100 }
  ], { count: 10, credits: 100, expiresDate: "", note: "" });

  const view = listView({
    size: 50,
    filters: [
      { key: "q", label: "搜索兑换码", placeholder: "兑换码" },
      { key: "status", type: "select", label: "状态", options: [["", "全部状态"], ["active", "未使用"], ["used", "已使用"], ["disabled", "已停用"]] }
    ],
    load: (q) => api.get("/api/admin/redeem", q),
    render: (items, data, refresh) => h("div.stack",
      data.batches.length ? h("div.batch-list", data.batches.map((b) => h("div.batch",
        h("strong.num", b.batch), h("span.small.muted", `${b.credits} 点 · 已用 ${b.used}/${b.total}${b.note ? ` · ${b.note}` : ""} · ${date(b.created_at)}`),
        h("a.btn.btn-sm", { href: `/api/admin/redeem/export.csv?batch=${encodeURIComponent(b.batch)}`, "data-native": "" }, "导出 CSV")))) : null,
      table([
        { label: "兑换码", render: (r) => h("code", r.code) },
        { label: "点数", render: (r) => r.credits, className: "right num" },
        { label: "批次", render: (r) => r.batch, className: "num small" },
        { label: "状态", render: (r) => r.status === "active" ? statusPill("未使用", "mat") : r.status === "used" ? statusPill("已使用") : statusPill("已停用", "pin") },
        { label: "使用者", render: (r) => (r.used_by_email ? [r.used_by_email, h("div.small.faint", dateTime(r.used_at))] : "—") },
        { label: "过期", render: (r) => (r.expires_at ? date(r.expires_at) : "长期"), className: "num" },
        { label: "", render: (r) => r.status !== "used" ? h("button.btn.btn-sm.btn-ghost", { type: "button", onclick: async () => {
          try { await api.patch(`/api/admin/redeem/${r.id}`, { status: r.status === "active" ? "disabled" : "active" }); refresh(); } catch (err) { toastError(err); }
        } }, r.status === "active" ? "停用" : "启用") : null }
      ], items, { empty: "还没有兑换码" }))
  });

  const generate = h("button.btn.btn-primary", { type: "button", onclick: (e) => busy(e.currentTarget, async () => {
    const v = f.value;
    let expiresAt = null;
    if (v.expiresDate) {
      const t = new Date(`${v.expiresDate}T23:59:59`).getTime();
      if (!Number.isFinite(t)) { toast("过期日期格式应为 2026-12-31", { type: "error" }); return; }
      expiresAt = t;
    }
    try {
      const r = await api.post("/api/admin/redeem", { count: v.count, credits: v.credits, note: v.note, expiresAt });
      const text = r.codes.join("\n");
      replace(created, section(`已生成 ${r.codes.length} 个兑换码（批次 ${r.batch}）`, "请妥善保存，可以在下方批次列表重新导出。",
        h("textarea.textarea", { rows: Math.min(10, r.codes.length + 1), readOnly: true, value: text }),
        h("div.a-row-actions", h("button.btn", { type: "button", onclick: () => copyText(text) }, "复制全部"),
          h("a.btn", { href: `/api/admin/redeem/export.csv?batch=${encodeURIComponent(r.batch)}`, "data-native": "" }, "下载 CSV"))));
      view.refresh();
    } catch (err) { toastError(err); }
  }) }, "生成兑换码");

  return h("div",
    pageHead("兑换码", "批量生成点数兑换码，用于活动赠送或在第三方渠道售卖。每个码只能使用一次。"),
    section("批量生成", null, f.node, h("div.a-form-actions", generate)),
    created,
    section("兑换码列表", null, view.node));
}

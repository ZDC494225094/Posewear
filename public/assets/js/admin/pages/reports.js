import { h } from "../../core/dom.js";
import { api } from "../../core/api.js";
import { toast, toastError } from "../../core/ui.js";
import { dateTime } from "../../core/format.js";
import { pageHead, listView, table, statusPill, section } from "../kit.js";

export async function render() {
  const reports = listView({
    filters: [{ key: "status", type: "select", label: "状态", value: "open", options: [["open", "待处理"], ["resolved", "已隐藏"], ["dismissed", "已驳回"], ["", "全部"]] }],
    load: (q) => api.get("/api/admin/reports", q),
    render: (items, data, refresh) => table([
      { label: "作品", render: (r) => r.thumb ? h("a", { href: `/admin/generations?q=${r.generation_id}` }, h("img.a-thumb", { src: r.thumb, alt: "" })) : r.generation_id },
      { label: "原因", render: (r) => [h("strong", r.reasonLabel), r.detail ? h("div.small.muted", r.detail) : null] },
      { label: "举报人", render: (r) => r.reporter_email || "—" },
      { label: "时间", render: (r) => dateTime(r.created_at), className: "num" },
      { label: "状态", render: (r) => r.status === "open" ? statusPill("待处理", "tape") : r.status === "resolved" ? statusPill("已隐藏", "pin") : statusPill("已驳回") },
      { label: "", render: (r) => r.status === "open" ? [
        h("button.btn.btn-sm.btn-danger", { type: "button", onclick: () => resolve(r, "hide", refresh) }, "隐藏作品"),
        h("button.btn.btn-sm.btn-ghost", { type: "button", onclick: () => resolve(r, "dismiss", refresh) }, "驳回")
      ] : r.note }
    ], items, { empty: "没有待处理的举报" })
  });

  const review = listView({
    size: 24,
    load: (q) => api.get("/api/admin/generations", { ...q, public: "pending" }),
    render: (items, data, refresh) => items.length ? h("div.review-grid", items.map((g) => h("figure.review-card",
      h("img", { src: g.images[0]?.thumb, alt: "" }),
      h("figcaption.small", g.userEmail),
      h("div.a-row-actions",
        h("button.btn.btn-sm.btn-primary", { type: "button", onclick: () => patch(g, { approved: true }, refresh) }, "通过"),
        h("button.btn.btn-sm.btn-ghost", { type: "button", onclick: () => patch(g, { hidden: true }, refresh) }, "隐藏"))))) : h("div.a-empty.muted", "没有待审核的作品（在「内容安全」开启“发布需审核”后，用户发布的作品会出现在这里）")
  });

  async function resolve(r, action, refresh) {
    try { await api.post(`/api/admin/reports/${r.id}/resolve`, { action }); toast(action === "hide" ? "作品已隐藏" : "已驳回", { type: "success" }); refresh(); }
    catch (err) { toastError(err); }
  }
  async function patch(g, body, refresh) {
    try { await api.patch(`/api/admin/generations/${g.id}`, body); refresh(); } catch (err) { toastError(err); }
  }

  return h("div", pageHead("举报与审核", "用户举报的公开作品，以及等待审核的广场投稿。"),
    section("举报", null, reports.node),
    section("广场待审核", null, review.node));
}

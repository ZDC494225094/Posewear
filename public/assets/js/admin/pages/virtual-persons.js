import { h } from "../../core/dom.js";
import { api } from "../../core/api.js";
import { toast, toastError, busy } from "../../core/ui.js";
import { dateTime } from "../../core/format.js";
import { pageHead, listView, table, statusPill, drawer } from "../kit.js";

const STATUS = { pending: ["待审核", "tape"], approved: ["已通过", "mat"], rejected: ["未通过", "pin"] };

function review(person, refresh) {
  const note = h("textarea.textarea", { rows: 3, maxLength: 200, value: person.virtualNote || "", placeholder: "驳回原因（用户可见，最多 200 字）", "aria-label": "驳回原因" });
  async function submit(action) {
    if (action === "reject" && !note.value.trim()) { toast("请填写驳回原因", { type: "error" }); note.focus(); return; }
    try {
      await api.post(`/api/admin/virtual-persons/${person.id}`, { action, note: note.value.trim() });
      m.close();
      toast(action === "approve" ? "已通过，用户现在可以使用这个虚拟人" : "已驳回", { type: "success" });
      refresh();
      document.dispatchEvent(new Event("pw:moderation-changed"));
    } catch (err) { toastError(err); }
  }
  const m = drawer("虚拟人审核", h("div.stack",
    h("img.a-virtual-preview", { src: person.url, alt: "待审核人物形象" }),
    h("p.small.muted", `${person.userEmail} · 申请时间 ${dateTime(person.virtualAt)}`),
    h("p.a-callout.small", "用户已声明这不是任何真实存在的人，也不是真人照片或肖像改绘，且形象为成年人。请核对后再通过；有疑问时驳回并说明原因。通过后可组合所有允许用于 AI 的素材，作品可以公开。"),
    note,
    h("div.a-form-actions",
      h("button.btn", { type: "button", onclick: () => m.close() }, "取消"),
      h("button.btn.btn-danger", { type: "button", onclick: (e) => busy(e.currentTarget, () => submit("reject")) }, "驳回"),
      person.virtual !== "approved" ? h("button.btn.btn-primary", { type: "button", onclick: (e) => busy(e.currentTarget, () => submit("approve")) }, "通过审核") : null)), { width: 620 });
}

export async function render() {
  const list = listView({
    size: 24,
    filters: [{ key: "status", type: "select", label: "审核状态", value: "pending", options: [["pending", "待审核"], ["approved", "已通过"], ["rejected", "未通过"], ["", "全部"]] }],
    load: (query) => api.get("/api/admin/virtual-persons", query),
    render: (items, data, refresh) => table([
      { label: "人物", render: (p) => h("button.a-virtual-thumb", { type: "button", "aria-label": "查看人物并审核", onclick: () => review(p, refresh) }, h("img.a-thumb", { src: p.thumb, alt: "人物缩略图", loading: "lazy" })) },
      { label: "申请人", render: (p) => p.userEmail },
      { label: "申请时间", render: (p) => dateTime(p.virtualAt) },
      { label: "状态", render: (p) => statusPill(...STATUS[p.virtual]) },
      { label: "审核说明", render: (p) => p.virtualNote || "—" },
      { label: "", render: (p) => h("button.btn.btn-sm", { type: "button", onclick: () => review(p, refresh) }, p.virtual === "pending" ? "审核" : "查看 / 复核") }
    ], items, { empty: "没有符合条件的虚拟人申请" })
  });
  return h("div", pageHead("虚拟人审核", "审核用户声明的虚拟人形象。通过后解除真人照片的组合及公开限制；平台通用内容安全规则仍然适用。", [
    h("button.btn", { type: "button", onclick: () => { list.refresh(); document.dispatchEvent(new Event("pw:moderation-changed")); } }, "刷新列表")
  ]), list.node);
}

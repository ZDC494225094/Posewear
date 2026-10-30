import { h } from "../../core/dom.js";
import { api } from "../../core/api.js";
import { toast, toastError, confirmDialog } from "../../core/ui.js";
import { dateTime, yuan, number } from "../../core/format.js";
import { pageHead, listView, table, statusPill } from "../kit.js";

const STATUS = { pending: ["待支付", "tape"], paid: ["已支付", "mat"], closed: ["已关闭", ""], refunded: ["已退款", "pin"] };

export async function render() {
  const view = listView({
    filters: [
      { key: "q", label: "搜索", placeholder: "订单号 / 用户邮箱 / 支付流水号" },
      { key: "status", type: "select", label: "状态", options: [["", "全部状态"], ["pending", "待支付"], ["paid", "已支付"], ["closed", "已关闭"], ["refunded", "已退款"]] }
    ],
    load: (q) => api.get("/api/admin/orders", q),
    render: (items, data, refresh) => table([
      { label: "订单号", render: (o) => o.id, className: "num" },
      { label: "用户", render: (o) => o.userEmail },
      { label: "商品", render: (o) => `${o.title}（${number(o.credits)} 点）` },
      { label: "金额", render: (o) => yuan(o.amountCents), className: "right num" },
      { label: "方式", render: (o) => o.providerLabel },
      { label: "状态", render: (o) => statusPill(...(STATUS[o.status] || [o.status])) },
      { label: "流水号", render: (o) => o.tradeNo || "—", className: "num small" },
      { label: "时间", render: (o) => [dateTime(o.createdAt), o.paidAt ? h("div.small.faint", `付 ${dateTime(o.paidAt)}`) : null], className: "num" },
      { label: "", render: (o) => [
        o.status === "pending" || o.status === "closed" ? h("button.btn.btn-sm", { type: "button", onclick: async () => {
          if (!(await confirmDialog({ title: "确认已收款？", message: `将为 ${o.userEmail} 增加 ${o.credits} 点。只在核实收到款项后操作。`, confirmText: "确认到账" }))) return;
          try { await api.post(`/api/admin/orders/${o.id}/mark-paid`, {}); toast("已入账", { type: "success" }); refresh(); } catch (err) { toastError(err); }
        } }, "确认到账") : null,
        o.status === "paid" ? h("button.btn.btn-sm.btn-ghost", { type: "button", onclick: async () => {
          const note = prompt("退款备注（需先在支付平台完成退款，这里只做记录）", "已线下退款");
          if (note === null) return;
          try { await api.post(`/api/admin/orders/${o.id}/refund`, { note }); toast("已标记退款", { type: "success" }); refresh(); } catch (err) { toastError(err); }
        } }, "标记退款") : null
      ] }
    ], items, { empty: "还没有订单" })
  });
  return h("div", pageHead("订单", "充值订单。支付通知会自动入账；通知丢失或线下收款时可以人工确认。标记退款不会扣回点数，请按需在用户页调整。"), view.node);
}

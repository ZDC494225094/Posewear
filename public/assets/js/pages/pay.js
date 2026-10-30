import { h, tile, cicon, replace } from "../core/dom.js";
import { api } from "../core/api.js";
import { store } from "../core/store.js";
import { toast, toastError, busy, emptyState } from "../core/ui.js";
import { yuan, number, dateTime } from "../core/format.js";

export async function render(ctx) {
  const id = ctx.params.id;
  let order;
  try { order = (await api.get(`/api/billing/orders/${encodeURIComponent(id)}`)).order; }
  catch (err) { return h("div.wrap", emptyState({ title: "订单不存在", text: err.message, action: h("a.btn", { href: "/pricing" }, "返回充值") })); }

  const box = h("div.pay-box");
  let timer = null;
  let stopped = false;

  function paint() {
    const status = {
      pending: "待支付", paid: "支付成功", closed: "已关闭", refunded: "已退款"
    }[order.status];
    let body;
    if (order.status === "paid") {
      body = h("div.pay-done",
        tile("checkCircle", "green", "lg"),
        h("p.pay-done-title.num", `+${number(order.credits)} 点`),
        h("p.muted", "点数已到账，可以开始创作了。"),
        h("div.pay-actions", h("a.btn.btn-primary", { href: "/studio" }, cicon("sparkle", "yellow"), "去创作台"), h("a.btn", { href: "/account" }, "查看流水")));
    } else if (order.status === "pending" && order.pay) {
      const pay = order.pay;
      body = h("div.pay-pending",
        pay.type === "qr" ? h("figure.pay-qr", h("img", { src: `/api/billing/orders/${order.id}/qr.svg`, alt: "支付二维码", width: 240, height: 240 }),
          h("figcaption.small.muted", order.provider === "wechat" ? "请使用微信扫一扫完成支付" : "请使用支付宝扫一扫完成支付")) : null,
        pay.type === "redirect" ? h("a.btn.btn-primary.btn-lg", { href: pay.url, "data-native": "" }, "前往支付宝付款") : null,
        pay.type === "mock" ? h("div.stack",
          h("p.small.muted", "模拟支付仅用于测试，点击即视为支付成功。"),
          h("button.btn.btn-primary.btn-lg", { type: "button", onclick: (e) => busy(e.currentTarget, async () => {
            try { order = (await api.post(`/api/billing/orders/${order.id}/mock-pay`)).order; finish(); }
            catch (err) { toastError(err); }
          }) }, cicon("checkCircle", "green"), "模拟支付成功")) : null,
        h("p.small.muted", `请在 ${dateTime(order.expiresAt)} 前完成支付。支付完成后本页会自动更新。`),
        h("button.btn.btn-ghost", { type: "button", onclick: (e) => busy(e.currentTarget, refresh) }, "我已支付，刷新状态"));
    } else {
      body = h("div", h("p.muted", "订单已关闭。如已付款但点数未到账，请联系客服并提供订单号。"), h("a.btn", { href: "/pricing" }, "重新下单"));
    }
    replace(box,
      h("div.pay-head",
        h("div", h("p.small.muted", "订单号"), h("p.num.pay-no", order.id)),
        h("span.pill", { class: order.status === "paid" ? "pill-green" : order.status === "pending" ? "pill-orange" : "" }, status)),
      h("div.pay-summary",
        h("div", h("p.small.muted", "商品"), h("p", order.title)),
        h("div", h("p.small.muted", "金额"), h("p.pay-amount.num", yuan(order.amountCents))),
        h("div", h("p.small.muted", "到账点数"), h("p.num", `${number(order.credits)} 点`))),
      body);
  }

  async function refresh() {
    try {
      order = (await api.post(`/api/billing/orders/${order.id}/refresh`)).order;
      if (order.status === "paid") finish();
      else { paint(); toast("暂未查询到支付结果，请稍后再试"); }
    } catch (err) { toastError(err); }
  }

  function finish() {
    stopped = true;
    clearTimeout(timer);
    paint();
    store.refreshUser();
    toast("支付成功，点数已到账", { type: "success" });
  }

  async function poll() {
    if (stopped || order.status !== "pending") return;
    try {
      const next = (await api.get(`/api/billing/orders/${order.id}`)).order;
      if (next.status !== order.status) {
        order = next;
        if (order.status === "paid") { finish(); return; }
        paint();
      }
    } catch { /* keep polling */ }
    timer = setTimeout(poll, 3000);
  }

  paint();
  if (order.status === "pending") timer = setTimeout(poll, 3000);
  if (order.status === "pending" && ctx.query.from === "return") refresh();

  return {
    node: h("div.pay.wrap", h("header.page-head", h("h1", "支付订单")), box),
    cleanup() { stopped = true; clearTimeout(timer); }
  };
}

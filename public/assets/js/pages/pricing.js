import { h, tile, cicon } from "../core/dom.js";
import { api } from "../core/api.js";
import { store } from "../core/store.js";
import { toast, toastError, busy } from "../core/ui.js";
import { number } from "../core/format.js";
import { navigate } from "../core/nav.js";
import { priceCard, packagePerks } from "./home.js";

const PROVIDERS = { alipay: "支付宝", wechat: "微信支付", mock: "模拟支付（测试）" };

export async function render() {
  const cfg = store.config;
  let packages = [];
  try { packages = (await api.get("/api/billing/packages")).items; } catch (err) { toastError(err); }
  const providers = cfg.payment.providers;
  let provider = providers[0] || "";

  async function buy(pkg, button) {
    if (!store.user) { navigate(`/login?next=${encodeURIComponent("/pricing")}`); return; }
    if (!provider) { toast("暂未开通在线支付，请使用兑换码充值", { type: "error" }); return; }
    await busy(button, async () => {
      try {
        const { order } = await api.post("/api/billing/orders", { packageId: pkg.id, provider });
        navigate(`/pay/${order.id}`);
      } catch (err) { toastError(err); }
    });
  }

  const providerPicker = providers.length > 1 ? h("div.field.pay-methods", h("span", "支付方式"),
    h("div.seg", { style: { maxWidth: "420px" } }, providers.map((p) => h("button", { type: "button", "aria-pressed": String(p === provider), onclick: (e) => {
      provider = p;
      e.currentTarget.parentElement.querySelectorAll("button").forEach((c) => c.setAttribute("aria-pressed", String(c === e.currentTarget)));
    } }, PROVIDERS[p] || p)))) : providers.length === 1 ? h("p.small.muted.pay-methods", `支付方式：${PROVIDERS[providers[0]]}`) : null;

  const codeInput = h("input.input.input-filled.redeem-input", { placeholder: "XXXX-XXXX-XXXX-XXXX", autocomplete: "off", maxLength: 24, "aria-label": "兑换码" });
  const redeem = h("form.redeem", { onsubmit: async (e) => {
    e.preventDefault();
    if (!store.user) { navigate(`/login?next=${encodeURIComponent("/pricing")}`); return; }
    const button = e.currentTarget.querySelector("button");
    await busy(button, async () => {
      try {
        const res = await api.post("/api/billing/redeem", { code: codeInput.value });
        store.patchUser({ credits: res.balance });
        codeInput.value = "";
        toast(`兑换成功，增加 ${res.credits} 点`, { type: "success" });
      } catch (err) { toastError(err); }
    });
  } }, codeInput, h("button.btn.btn-primary", { type: "submit" }, "兑换"));

  const q = cfg.generation.qualities;
  const t = cfg.generation.tiers;
  const table = h("table.cost-table",
    h("caption.sr-only", "每张图片消耗的点数"),
    h("thead", h("tr", h("th", { scope: "col" }, "画质"), t.map((tier) => h("th", { scope: "col" }, tier.label)))),
    h("tbody", q.map((quality) => h("tr", h("th", { scope: "row" }, quality.label),
      t.map((tier) => h("td.num", `${Math.ceil(quality.credits * tier.multiplier)} 点`))))));

  return h("div.pricing.wrap",
    h("header.page-head", h("div", h("h1", "价格"), h("p", "按需购买点数，生成时按画质和清晰度扣除。"),
      store.user ? h("p.balance-line", tile("gem", "orange"), "当前余额 ", h("strong.num", number(store.user.credits)), " 点") : null)),
    packages.length
      ? h("div.price-grid", packages.map((pkg) => priceCard(pkg, { perks: packagePerks(pkg, cfg),
        action: h("button.btn.btn-block.btn-primary.btn-lg", { type: "button", onclick: (e) => buy(pkg, e.currentTarget) }, store.user ? "购买" : "登录后购买") })))
      : h("p.muted", "暂无可购买的套餐。"),
    providerPicker,
    h("section.pricing-grid",
      h("div.pricing-card",
        h("h2", tile("ticket", "purple"), "兑换码"),
        h("p.small.muted", "在活动或渠道获得的兑换码，在这里兑换成点数。"),
        redeem),
      h("div.pricing-card",
        h("h2", tile("gem", "orange"), "每张图消耗多少点"),
        table,
        h("p.small.muted", "一次生成多张时按张数计算。被安全审核拦截或生成失败的不扣点数。"))));
}

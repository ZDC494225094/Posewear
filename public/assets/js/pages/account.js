import { h, tile, cicon, replace } from "../core/dom.js";
import { api } from "../core/api.js";
import { store } from "../core/store.js";
import { toast, toastError, busy, copyText } from "../core/ui.js";
import { dateTime, number, yuan } from "../core/format.js";

function pager(total, page, size, onPage) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages <= 1) return null;
  return h("div.pager",
    h("button.btn.btn-sm", { type: "button", disabled: page <= 1, onclick: () => onPage(page - 1) }, "上一页"),
    h("span.small.muted.num", `${page} / ${pages}`),
    h("button.btn.btn-sm", { type: "button", disabled: page >= pages, onclick: () => onPage(page + 1) }, "下一页"));
}

export async function render(ctx) {
  const cfg = store.config;
  if (ctx.query.verified === "1") { toast("邮箱验证成功", { type: "success" }); store.refreshUser(); }
  if (ctx.query.verified === "0") toast("验证链接无效或已过期，请重新发送", { type: "error" });
  if (ctx.query.verified) history.replaceState({}, "", "/account");

  const profile = h("section.paper.account-card");
  const credits = h("section.paper.account-card.is-credits");
  const invite = h("section.paper.account-card");
  const ledger = h("section.paper.account-card.account-wide");
  const orders = h("section.paper.account-card.account-wide");
  const security = h("section.paper.account-card");

  function renderProfile() {
    const user = store.user;
    const nick = h("input.input", { value: user.nickname, maxLength: 20, "aria-label": "昵称" });
    replace(profile,
      h("h2", tile("person", "blue"), "个人资料"),
      h("dl.kv",
        h("dt", "邮箱"), h("dd", user.email, " ", user.emailVerified ? h("span.pill.pill-green", "已验证") : h("span.pill.pill-orange", "未验证")),
        h("dt", "注册时间"), h("dd", dateTime(user.createdAt))),
      !user.emailVerified && cfg.auth.requireEmailVerification ? h("button.btn.btn-sm", { type: "button", onclick: (e) => busy(e.currentTarget, async () => {
        try { await api.post("/api/auth/resend-verification"); toast("验证邮件已发送，请查收", { type: "success" }); } catch (err) { toastError(err); }
      }) }, "重新发送验证邮件") : null,
      h("form.inline-form", { onsubmit: async (e) => {
        e.preventDefault();
        await busy(e.currentTarget.querySelector("button"), async () => {
          try { const res = await api.patch("/api/me", { nickname: nick.value }); store.setUser(res.user); toast("已保存", { type: "success" }); }
          catch (err) { toastError(err); }
        });
      } }, h("label.field", h("span", "昵称"), nick), h("button.btn", { type: "submit" }, "保存")));
  }

  function renderCredits() {
    const user = store.user;
    const checkin = cfg.auth.checkinCredits > 0 ? h("button.btn.btn-glass", { type: "button", disabled: user.checkedInToday,
      onclick: (e) => busy(e.currentTarget, async () => {
        try {
          const res = await api.post("/api/me/checkin");
          store.patchUser({ credits: res.balance, checkedInToday: true });
          toast(`签到成功，+${res.amount} 点`, { type: "success" });
          renderCredits();
          loadLedger(1);
        } catch (err) { toastError(err); }
      }) }, cicon("calendar", "red"), user.checkedInToday ? "今日已签到" : `每日签到 +${cfg.auth.checkinCredits} 点`) : null;
    replace(credits,
      h("h2", tile("gem", "orange"), "点数余额"),
      h("p.account-balance", h("span.num", number(user.credits)), " 点"),
      h("p.small", "点数长期有效，生成失败自动退回。"),
      h("div.account-actions", h("a.btn.btn-white", { href: "/pricing" }, cicon("bag", "orange"), "充值"), checkin));
  }

  async function renderInvite() {
    if (!cfg.auth.inviteReward && !cfg.auth.inviteeBonus) { invite.hidden = true; return; }
    try {
      const data = await api.get("/api/me/invite");
      const link = `${location.origin}/register?ref=${data.code}`;
      replace(invite,
        h("h2", tile("gift", "pink"), "邀请好友"),
        h("p.small.muted", [data.reward ? `好友注册后你得 ${data.reward} 点` : "", data.inviteeBonus ? `好友额外得 ${data.inviteeBonus} 点` : ""].filter(Boolean).join("，") + "。"),
        h("div.copy-row", h("input.input", { value: link, readOnly: true, "aria-label": "邀请链接", onfocus: (e) => e.target.select() }),
          h("button.btn", { type: "button", onclick: () => copyText(link) }, cicon("copy", "blue"), "复制")),
        h("p.small.muted", `已邀请 ${data.invited} 人，累计获得 ${number(data.earned)} 点`));
    } catch { invite.hidden = true; }
  }

  async function loadLedger(page) {
    try {
      const data = await api.get("/api/me/ledger", { page, size: 15 });
      replace(ledger,
        h("h2", tile("list", "teal"), "点数流水"),
        data.items.length ? h("div.table-wrap", h("table.data-table",
          h("thead", h("tr", h("th", "时间"), h("th", "类型"), h("th", "说明"), h("th.right", "变动"), h("th.right", "余额"))),
          h("tbody", data.items.map((r) => h("tr",
            h("td.num", dateTime(r.created_at)), h("td", r.kindLabel), h("td.muted", r.note),
            h("td.right.num", { class: r.delta > 0 ? "plus" : "minus" }, `${r.delta > 0 ? "+" : ""}${r.delta}`),
            h("td.right.num", r.balance_after)))))) : h("p.muted", "还没有点数变动。"),
        pager(data.total, page, 15, loadLedger));
    } catch (err) { toastError(err); }
  }

  async function loadOrders(page) {
    try {
      const data = await api.get("/api/me/orders", { page, size: 10 });
      const status = { pending: "待支付", paid: "已支付", closed: "已关闭", refunded: "已退款" };
      replace(orders,
        h("h2", tile("receipt", "green"), "充值订单"),
        data.items.length ? h("div.table-wrap", h("table.data-table",
          h("thead", h("tr", h("th", "订单号"), h("th", "商品"), h("th.right", "金额"), h("th", "状态"), h("th", "时间"))),
          h("tbody", data.items.map((o) => h("tr",
            h("td.num", o.status === "pending" ? h("a.link", { href: `/pay/${o.id}` }, o.id) : o.id),
            h("td", o.title), h("td.right.num", yuan(o.amountCents)), h("td", status[o.status]), h("td.num", dateTime(o.createdAt))))))) : h("p.muted", "还没有充值记录。"),
        pager(data.total, page, 10, loadOrders));
    } catch (err) { toastError(err); }
  }

  function renderSecurity() {
    const current = h("input.input", { type: "password", autocomplete: "current-password", required: true });
    const next = h("input.input", { type: "password", autocomplete: "new-password", minLength: 8, required: true });
    replace(security,
      h("h2", tile("lock", "gray"), "修改密码"),
      h("form.stack", { onsubmit: async (e) => {
        e.preventDefault();
        await busy(e.currentTarget.querySelector("button"), async () => {
          try {
            await api.post("/api/me/password", { current: current.value, next: next.value });
            current.value = ""; next.value = "";
            toast("密码已修改，其他设备已退出登录", { type: "success" });
          } catch (err) { toastError(err); }
        });
      } },
      h("label.field", h("span", "当前密码"), current),
      h("label.field", h("span", "新密码"), next, h("small", "至少 8 位")),
      h("button.btn", { type: "submit" }, "修改密码")));
  }

  renderProfile();
  renderCredits();
  renderInvite();
  renderSecurity();
  loadLedger(1);
  loadOrders(1);
  const unsubscribe = store.subscribe(() => { if (store.user) { renderCredits(); } });

  return {
    node: h("div.account.wrap",
      h("header.page-head", h("div", h("h1", "账户"), h("p", store.user.email))),
      h("div.account-grid", credits, profile, invite, security, ledger, orders)),
    cleanup: unsubscribe
  };
}

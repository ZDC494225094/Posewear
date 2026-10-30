import { h, replace } from "../../core/dom.js";
import { api } from "../../core/api.js";
import { toast, toastError, busy, confirmDialog } from "../../core/ui.js";
import { dateTime, yuan, number, STATUS_TEXT } from "../../core/format.js";
import { pageHead, listView, table, statusPill, drawer, kv, section } from "../kit.js";

function openUser(id, onChanged) {
  const body = h("div.stack", h("div.spinner"));
  const m = drawer("用户详情", body, { width: 760 });
  async function load() {
    let d;
    try { d = await api.get(`/api/admin/users/${id}`); } catch (err) { toastError(err); m.close(); return; }
    const u = d.user;
    const delta = h("input.input", { type: "number", placeholder: "如 100 或 -50", "aria-label": "调整点数" });
    const reason = h("input.input", { placeholder: "原因（用户可见）", maxLength: 100, "aria-label": "原因" });
    const pwd = h("input.input", { type: "password", placeholder: "新密码，至少 8 位", autocomplete: "new-password", "aria-label": "新密码" });
    const note = h("textarea.textarea", { rows: 2, value: u.note || "", placeholder: "仅管理员可见", "aria-label": "备注" });
    replace(body,
      kv([
        ["ID", u.id], ["邮箱", u.email], ["昵称", u.nickname],
        ["状态", u.status === "active" ? statusPill("正常", "mat") : statusPill("已停用", "pin")],
        ["角色", u.role === "admin" ? "管理员" : "用户"], ["点数", h("strong.num", number(u.credits))],
        ["邮箱验证", u.emailVerified ? "已验证" : "未验证"], ["邀请码", u.inviteCode],
        ["邀请人", u.referrer ? u.referrer.email : "—"], ["注册", `${dateTime(u.createdAt)} · ${u.signupIp || ""}`],
        ["最近登录", `${dateTime(u.lastLoginAt)} · ${u.lastLoginIp || ""}`]
      ]),
      section("调整点数", null, h("div.copy-row", delta, reason,
        h("button.btn.btn-primary", { type: "button", onclick: (e) => busy(e.currentTarget, async () => {
          try {
            const r = await api.post(`/api/admin/users/${u.id}/credits`, { delta: Number(delta.value), reason: reason.value });
            toast(`已调整，当前余额 ${r.balance}`, { type: "success" }); load(); onChanged();
          } catch (err) { toastError(err); }
        }) }, "确认"))),
      section("账号操作", null,
        h("div.a-row-actions",
          h("button.btn", { type: "button", onclick: async () => {
            const banning = u.status === "active";
            if (!(await confirmDialog({ title: banning ? "停用这个账号？" : "恢复这个账号？", message: banning ? "停用后该用户会被立即登出，无法登录和生成。" : "恢复后用户可以正常登录。", danger: banning, confirmText: banning ? "停用" : "恢复" }))) return;
            try { await api.patch(`/api/admin/users/${u.id}`, { status: banning ? "banned" : "active" }); load(); onChanged(); } catch (err) { toastError(err); }
          } }, u.status === "active" ? "停用账号" : "恢复账号"),
          h("button.btn", { type: "button", onclick: async () => {
            const toAdmin = u.role !== "admin";
            if (!(await confirmDialog({ title: toAdmin ? "设为管理员？" : "取消管理员？", message: toAdmin ? "管理员可以访问整个后台，包括支付和 API 密钥配置。" : "取消后该账号无法进入后台。", confirmText: "确定", danger: toAdmin }))) return;
            try { await api.patch(`/api/admin/users/${u.id}`, { role: toAdmin ? "admin" : "user" }); load(); onChanged(); } catch (err) { toastError(err); }
          } }, u.role === "admin" ? "取消管理员" : "设为管理员"),
          !u.emailVerified ? h("button.btn", { type: "button", onclick: async () => {
            try { await api.patch(`/api/admin/users/${u.id}`, { emailVerified: true }); load(); } catch (err) { toastError(err); }
          } }, "标记邮箱已验证") : null),
        h("div.copy-row", pwd, h("button.btn", { type: "button", onclick: (e) => busy(e.currentTarget, async () => {
          try { await api.post(`/api/admin/users/${u.id}/password`, { password: pwd.value }); pwd.value = ""; toast("密码已重置，该用户已被登出", { type: "success" }); }
          catch (err) { toastError(err); }
        }) }, "重置密码")),
        h("div.copy-row", note, h("button.btn", { type: "button", onclick: (e) => busy(e.currentTarget, async () => {
          try { await api.patch(`/api/admin/users/${u.id}`, { note: note.value }); toast("备注已保存", { type: "success" }); } catch (err) { toastError(err); }
        }) }, "保存备注"))),
      section("点数流水", null, table([
        { label: "时间", render: (r) => dateTime(r.created_at), className: "num" },
        { label: "类型", render: (r) => r.kindLabel },
        { label: "说明", render: (r) => r.note },
        { label: "变动", render: (r) => `${r.delta > 0 ? "+" : ""}${r.delta}`, className: "right num" },
        { label: "余额", render: (r) => r.balance_after, className: "right num" }
      ], d.ledger.items)),
      section("最近生成", null, table([
        { label: "时间", render: (g) => dateTime(g.createdAt), className: "num" },
        { label: "状态", render: (g) => STATUS_TEXT[g.status] },
        { label: "结果", render: (g) => g.images[0] ? h("img.a-thumb", { src: g.images[0].thumb, alt: "" }) : g.errorCode || "" },
        { label: "点数", render: (g) => g.cost, className: "right num" }
      ], d.generations.items)),
      section("订单", null, table([
        { label: "订单号", render: (o) => o.id, className: "num" },
        { label: "金额", render: (o) => yuan(o.amountCents), className: "right num" },
        { label: "状态", render: (o) => o.status },
        { label: "时间", render: (o) => dateTime(o.createdAt), className: "num" }
      ], d.orders.items)),
      d.invited.length ? section(`邀请的用户（${d.invited.length}）`, null, h("p.small", d.invited.map((x) => x.email).join("、"))) : null);
  }
  load();
}

export async function render() {
  const view = listView({
    filters: [
      { key: "q", label: "搜索", placeholder: "邮箱 / 昵称 / ID / 邀请码" },
      { key: "status", type: "select", label: "状态", options: [["", "全部状态"], ["active", "正常"], ["banned", "已停用"]] },
      { key: "role", type: "select", label: "角色", options: [["", "全部角色"], ["user", "用户"], ["admin", "管理员"]] }
    ],
    load: (q) => api.get("/api/admin/users", q),
    render: (items, data, refresh) => table([
      { label: "ID", render: (u) => u.id, className: "num" },
      { label: "邮箱", render: (u) => h("button.link", { type: "button", onclick: () => openUser(u.id, refresh) }, u.email) },
      { label: "昵称", render: (u) => u.nickname },
      { label: "点数", render: (u) => number(u.credits), className: "right num" },
      { label: "已付", render: (u) => (u.paidCents ? yuan(u.paidCents) : "—"), className: "right num" },
      { label: "生成", render: (u) => u.generations, className: "right num" },
      { label: "状态", render: (u) => [u.status === "banned" ? statusPill("已停用", "pin") : statusPill("正常", "mat"), u.role === "admin" ? statusPill("管理员", "tape") : null] },
      { label: "注册时间", render: (u) => dateTime(u.createdAt), className: "num" },
      { label: "最近登录", render: (u) => dateTime(u.lastLoginAt), className: "num" }
    ], items, { empty: "没有匹配的用户" })
  });

  const grant = h("button.btn", { type: "button", onclick: async () => {
    const amount = Number(prompt("给所有正常用户各发多少点？（例如服务故障补偿）") || 0);
    if (!amount) return;
    const reason = prompt("原因（用户可在流水里看到）") || "";
    if (!reason) return;
    if (!(await confirmDialog({ title: `给所有用户各发 ${amount} 点？`, message: `原因：${reason}`, confirmText: "确认发放" }))) return;
    try { const r = await api.post("/api/admin/credits/grant-all", { amount, reason }); toast(`已发放给 ${r.users} 个用户`, { type: "success" }); view.refresh(); }
    catch (err) { toastError(err); }
  } }, "全员发放点数");
  return h("div", pageHead("用户", "查看用户、调整点数、停用账号。所有操作记录在操作日志中。", grant), view.node);
}

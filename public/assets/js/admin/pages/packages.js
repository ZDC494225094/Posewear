import { h, replace } from "../../core/dom.js";
import { api } from "../../core/api.js";
import { toast, toastError, busy, confirmDialog } from "../../core/ui.js";
import { yuan, number } from "../../core/format.js";
import { pageHead, table, form, drawer, statusPill } from "../kit.js";

const FIELDS = [
  { key: "name", label: "名称", max: 40 },
  { key: "priceYuan", label: "价格（元）", type: "number", min: 0.01, step: 0.01 },
  { key: "credits", label: "点数", type: "number", min: 1 },
  { key: "bonusCredits", label: "赠送点数", type: "number", min: 0 },
  { key: "badge", label: "角标", placeholder: "如：最多人选", max: 12 },
  { key: "description", label: "说明", placeholder: "如：约 55 张标准画质", max: 200 },
  { key: "sort", label: "排序", type: "number", help: "数字小的排在前面。" },
  { key: "enabled", label: "上架", type: "switch" }
];

function edit(pkg, onSaved) {
  const isNew = !pkg?.id;
  const f = form(FIELDS, isNew ? { name: "", priceYuan: 9.9, credits: 100, bonusCredits: 0, badge: "", description: "", sort: 0, enabled: true }
    : { ...pkg, priceYuan: pkg.priceCents / 100 });
  const m = drawer(isNew ? "新建套餐" : `编辑套餐 · ${pkg.name}`, h("div.stack", f.node, h("div.a-form-actions",
    h("button.btn", { type: "button", onclick: () => m.close() }, "取消"),
    h("button.btn.btn-primary", { type: "button", onclick: (e) => busy(e.currentTarget, async () => {
      const v = f.value;
      const body = { ...v, priceCents: Math.round(Number(v.priceYuan) * 100) };
      try {
        if (isNew) await api.post("/api/admin/packages", body); else await api.put(`/api/admin/packages/${pkg.id}`, body);
        toast("已保存", { type: "success" }); m.close(); onSaved();
      } catch (err) { toastError(err); }
    }) }, "保存"))), { width: 560 });
}

export async function render() {
  const box = h("div");
  async function load() {
    try {
      const { items } = await api.get("/api/admin/packages");
      replace(box, table([
        { label: "名称", render: (p) => [h("strong", p.name), p.badge ? statusPill(p.badge, "tape") : null] },
        { label: "价格", render: (p) => yuan(p.priceCents), className: "right num" },
        { label: "到账点数", render: (p) => `${number(p.totalCredits)}${p.bonusCredits ? `（含赠 ${p.bonusCredits}）` : ""}`, className: "right num" },
        { label: "每元点数", render: (p) => (p.totalCredits / (p.priceCents / 100)).toFixed(1), className: "right num" },
        { label: "说明", render: (p) => p.description },
        { label: "状态", render: (p) => (p.enabled ? statusPill("上架", "mat") : statusPill("下架")) },
        { label: "", render: (p) => [
          h("button.btn.btn-sm", { type: "button", onclick: () => edit(p, load) }, "编辑"),
          h("button.btn.btn-sm.btn-ghost", { type: "button", onclick: async () => {
            if (!(await confirmDialog({ title: `删除套餐「${p.name}」？`, message: "已有订单的套餐会改为下架。", confirmText: "删除", danger: true }))) return;
            try { const r = await api.del(`/api/admin/packages/${p.id}`); toast(r.disabled ? "该套餐已有订单，已改为下架" : "已删除", { type: "success" }); load(); }
            catch (err) { toastError(err); }
          } }, "删除")
        ] }
      ], items, { empty: "还没有套餐" }));
    } catch (err) { toastError(err); }
  }
  load();
  return h("div", pageHead("充值套餐", "显示在充值页的点数包。改价不影响已创建的订单。",
    h("button.btn.btn-primary", { type: "button", onclick: () => edit(null, load) }, "新建套餐")), box);
}

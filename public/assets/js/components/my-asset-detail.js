import { h, cicon } from "../core/dom.js";
import { api } from "../core/api.js";
import { store } from "../core/store.js";
import { modal, toast, toastError, busy, confirmDialog } from "../core/ui.js";
import { label, number } from "../core/format.js";
import { useInStudio, TYPE_TEXT } from "./library-browser.js";
import { openAssetGenerator } from "./asset-generator.js";
import { assetGenerationInfo } from "./asset-generation-info.js";

// The detail dialog of one of the user's own assets: preview (all angles of a
// pose), how it was generated, sharing and price, and actions.

export function shareState(a) {
  if (!a.enabled) return { text: "已被下架", tone: "pin" };
  if (a.visibility !== "public") return { text: "私有", tone: "" };
  if (a.review === "pending") return { text: "审核中", tone: "tape" };
  if (a.review === "rejected") return { text: "未通过", tone: "pin" };
  return { text: "已公开", tone: "mat" };
}

// onChanged(): after save or delete. onCreated(jobs): after starting new angles.
export async function openMyAsset(asset, { onChanged, onCreated } = {}) {
  const cfg = store.config.assets;
  let a = asset;
  let groupItems = [];
  if (a.type === "pose") {
    try { groupItems = (await api.get(`/api/library/assets/${encodeURIComponent(a.id)}`)).angles; } catch { /* optional */ }
  }
  const preview = h("img.my-preview", { src: a.preview, alt: a.name.zh });
  const name = h("input.input.input-filled", { value: a.name.zh, maxLength: 40, "aria-label": "名称" });
  const shareInput = h("input", { type: "checkbox", checked: a.visibility === "public", disabled: !a.enabled });
  const price = h("input.input.input-filled", { type: "number", min: 0, max: cfg.maxPrice, step: 1, value: a.price || 0, "aria-label": "使用点数" });
  const priceField = h("div.field", h("span", "使用点数"),
    h("div.with-suffix", price, h("span.suffix", "点 / 次")),
    h("small", `0 表示免费。别人每次用它生成，需另付这些点数，你获得其中 ${cfg.rebatePercent}%；你自己使用永远免费。`));
  const syncPrice = () => { priceField.hidden = !shareInput.checked; };
  shareInput.onchange = syncPrice;
  syncPrice();
  const state = shareState(a);

  const save = h("button.btn.btn-primary", { type: "button", onclick: (e) => busy(e.currentTarget, async () => {
    try {
      const { asset: next } = await api.patch(`/api/my/assets/${encodeURIComponent(a.id)}`, {
        name: name.value, visibility: shareInput.checked ? "public" : "private", price: Number(price.value) || 0
      });
      a = next;
      m.close();
      toast(next.visibility === "public" && next.review === "pending" ? "已提交审核，通过后会出现在素材库" : "已保存", { type: "success" });
      onChanged?.();
    } catch (err) { toastError(err); }
  }) }, "保存");

  const missing = a.type === "pose" ? 5 - (a.groupAngles || []).length : 0;

  const m = modal({
    title: `${TYPE_TEXT[a.type]}素材详情`, wide: true,
    content: h("div.my-detail",
      h("div.my-detail-media", { class: `is-${a.type}` }, preview,
        groupItems.length > 1 ? h("div.my-angles", groupItems.map((g) => h("button", { type: "button", "aria-label": label(g.angle),
          "aria-pressed": String(g.id === a.id), onclick: (e) => {
            preview.src = g.preview;
            e.currentTarget.parentElement.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget)));
          } }, h("img", { src: g.thumb, alt: "" }), h("span", label(g.angle))))) : null),
      h("div.my-detail-side.stack",
        h("p.small.faint", `${label(a.series)} · ${label(a.category)}${a.angle ? ` · ${label(a.angle)}` : ""} · ${a.license === "commercial" ? "可商用" : "非商用"}`),
        h("div.field", h("span", "名称"), name),
        h("div.my-share",
          h("label.switch", shareInput, h("span.switch-ui", { "aria-hidden": "true" }), h("span.switch-text", "公开到素材库")),
          h("span.pill", { class: state.tone ? `pill-${state.tone}` : "" }, state.text)),
        a.review === "rejected" && a.reviewNote ? h("p.small.text-error", `未通过原因：${a.reviewNote}`) : null,
        !a.enabled ? h("p.small.text-error", "这个素材已被管理员下架，只能删除。") : null,
        cfg.publicReview ? h("p.small.muted", "公开前需要管理员审核，通过后其他用户才能看到。") : null,
        priceField,
        h("p.small.muted", `被使用 ${number(a.useCount)} 次 · 累计收益 ${number(a.earned)} 点`),
        assetGenerationInfo(a),
        h("div.my-actions",
          a.enabled ? h("button.btn", { type: "button", onclick: () => { m.close(); useInStudio(a); } }, cicon("sparkle", "yellow"), "带入创作台") : null,
          a.type === "pose" && missing > 0 && cfg.generation && a.enabled ? h("button.btn", { type: "button", onclick: () => {
            m.close();
            openAssetGenerator({ source: a, onCreated });
          } }, cicon("layers", "indigo"), `补全角度（还差 ${missing} 个）`) : null,
          h("a.btn", { href: `/media/library/${encodeURIComponent(a.id)}/original?download=1`, "data-native": "" }, cicon("download", "green"), "下载原图"),
          h("button.btn.btn-danger", { type: "button", onclick: async () => {
            if (!(await confirmDialog({ title: "删除这个素材？", message: "图片会一起删除。用它生成过的作品不受影响。", confirmText: "删除", danger: true }))) return;
            try {
              await api.del(`/api/my/assets/${encodeURIComponent(a.id)}`);
              m.close();
              toast("已删除", { type: "success" });
              onChanged?.();
            } catch (err) { toastError(err); }
          } }, cicon("trash", "red"), "删除")))),
    footer: [h("button.btn", { type: "button", onclick: () => m.close() }, "取消"), save]
  });
  return m;
}

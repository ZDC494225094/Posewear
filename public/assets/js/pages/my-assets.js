import { h, cicon, replace } from "../core/dom.js";
import { api } from "../core/api.js";
import { store, draft } from "../core/store.js";
import { modal, toast, toastError, busy, confirmDialog, emptyState } from "../core/ui.js";
import { label, number } from "../core/format.js";
import { navigate } from "../core/nav.js";
import { openAssetGenerator } from "../components/asset-generator.js";
import { assetJobList } from "../components/asset-jobs.js";

// 我的素材: assets the user generated. Private by default; shared assets
// appear in the library after review and earn the owner a share of the price.

export function shareState(a) {
  if (!a.enabled) return { text: "已被下架", tone: "pin" };
  if (a.visibility !== "public") return { text: "私有", tone: "" };
  if (a.review === "pending") return { text: "审核中", tone: "tape" };
  if (a.review === "rejected") return { text: "未通过", tone: "pin" };
  return { text: "已公开", tone: "mat" };
}

export async function render(ctx) {
  const cfg = store.config.assets;
  let type = ctx.query.type === "outfit" ? "outfit" : "pose";
  const grid = h("div.lib-grid.my-grid");
  const statsEl = h("p.my-stats.small");
  const jobs = assetJobList({
    endpoint: "/api/my/asset-jobs",
    onFinished: (job) => {
      if (job.status === "failed") { store.refreshUser(); toast(job.errorMessage || "生成失败，点数已退回", { type: "error" }); }
      if (job.type === type) load();
    },
    onOpenAsset: (a) => openAsset(a)
  });

  function generate(kind = type) {
    openAssetGenerator({ type: kind, onCreated: (items) => jobs.add(items) });
  }

  function card(a) {
    const state = shareState(a);
    return h("article.asset-card", { class: a.enabled ? "" : "is-disabled" },
      h("button.asset-hit", { type: "button", "aria-label": `${a.name.zh}（${state.text}）`, onclick: () => openAsset(a) },
        h("div.asset-img", h("img", { src: a.thumb, alt: "", loading: "lazy", decoding: "async" })),
        h("div.asset-info",
          h("div.asset-name", a.name.zh),
          h("div.asset-meta",
            h("span", label(a.category)),
            a.type === "pose" ? h("span", label(a.angle)) : null,
            a.visibility === "public" ? h("span", a.price ? `${a.price} 点` : "免费") : null,
            a.earned ? h("span", `收益 ${number(a.earned)}`) : null))),
      h("span.asset-flag", { class: state.tone ? `is-${state.tone}` : "" }, state.text));
  }

  async function load() {
    grid.classList.add("is-loading");
    try {
      const data = await api.get("/api/my/assets", { type, size: 96 });
      const s = data.summary;
      statsEl.replaceChildren(
        h("span", "素材 ", h("strong.num", number(s.total))),
        h("span", "已公开 ", h("strong.num", number(s.shared)), s.pending ? `（${s.pending} 个审核中）` : ""),
        h("span", "被使用 ", h("strong.num", number(s.paidUses)), " 次"),
        h("span", "累计收益 ", h("strong.num", number(s.earned)), " 点"));
      grid.className = `lib-grid my-grid ${type === "outfit" ? "is-outfit" : "is-pose"}`;
      replace(grid, data.items.length ? data.items.map(card) : emptyState({
        icon: "wand", color: "purple", title: `还没有${type === "pose" ? "姿势" : "服装"}素材`,
        text: type === "pose" ? "选一个姿势分类，写一句动作描述，就能生成和素材库同规格的线稿姿势。"
          : "选一个服装分类，比如唐朝服饰或医生，就能生成和素材库同规格的服装图。",
        action: cfg.generation ? h("button.btn.btn-primary", { type: "button", onclick: () => generate() }, cicon("wand", "purple"), "生成素材") : null
      }));
    } catch (err) { toastError(err); }
    grid.classList.remove("is-loading");
  }

  async function openAsset(asset) {
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
        load();
      } catch (err) { toastError(err); }
    }) }, "保存");

    const use = () => {
      if (a.type === "pose") draft.patch({ pose: a });
      else draft.patch({ outfit: a, outfitUpload: null });
      m.close();
      navigate("/studio");
    };
    const missing = a.type === "pose" ? 5 - (a.groupAngles || []).length : 0;

    const m = modal({
      title: "素材详情", wide: true,
      content: h("div.my-detail",
        h("div.my-detail-media", preview,
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
          h("div.my-actions",
            a.enabled ? h("button.btn", { type: "button", onclick: use }, cicon("sparkle", "yellow"), "用于创作") : null,
            a.type === "pose" && missing > 0 && cfg.generation && a.enabled ? h("button.btn", { type: "button", onclick: () => {
              m.close();
              openAssetGenerator({ source: a, onCreated: (items) => jobs.add(items) });
            } }, cicon("layers", "indigo"), `补全角度（还差 ${missing} 个）`) : null,
            h("a.btn", { href: `/media/library/${encodeURIComponent(a.id)}/original?download=1`, "data-native": "" }, cicon("download", "green"), "下载原图"),
            h("button.btn.btn-danger", { type: "button", onclick: async () => {
              if (!(await confirmDialog({ title: "删除这个素材？", message: "图片会一起删除。用它生成过的作品不受影响。", confirmText: "删除", danger: true }))) return;
              try {
                await api.del(`/api/my/assets/${encodeURIComponent(a.id)}`);
                m.close();
                toast("已删除", { type: "success" });
                load();
              } catch (err) { toastError(err); }
            } }, cicon("trash", "red"), "删除")))),
      footer: [h("button.btn", { type: "button", onclick: () => m.close() }, "取消"), save]
    });
  }

  const tabs = h("div.seg.lib-tabs", { role: "tablist", "aria-label": "素材类型" },
    [["pose", "姿势", "pose", "purple"], ["outfit", "服装", "shirt", "pink"]].map(([value, text, iconName, color]) =>
      h("button", { type: "button", role: "tab", "aria-selected": String(value === type), "aria-pressed": String(value === type),
        onclick: (e) => {
          type = value;
          e.currentTarget.parentElement.querySelectorAll("button").forEach((t) => {
            t.setAttribute("aria-selected", String(t === e.currentTarget));
            t.setAttribute("aria-pressed", String(t === e.currentTarget));
          });
          history.replaceState({}, "", value === "outfit" ? "/my-assets?type=outfit" : "/my-assets");
          load();
        } }, cicon(iconName, color, 15), text)));

  load();
  jobs.load();
  if (ctx.query.generate && cfg.generation) {
    history.replaceState({}, "", type === "outfit" ? "/my-assets?type=outfit" : "/my-assets");
    generate(ctx.query.generate === "outfit" ? "outfit" : "pose");
  }

  return {
    node: h("div.my-assets.wrap",
      h("header.page-head",
        h("div", h("h1", "我的素材"),
          h("p", "按素材库的规格生成自己的姿势和服装。素材默认只有你能用；公开后其他人使用要付你设定的点数，你获得分成。")),
        cfg.generation ? h("button.btn.btn-primary", { type: "button", onclick: () => generate() }, cicon("wand", "purple"), "生成素材")
          : h("p.small.muted", "素材生成暂未开放")),
      jobs.node,
      h("div.my-toolbar", tabs, statsEl),
      grid),
    cleanup() { jobs.stop(); }
  };
}

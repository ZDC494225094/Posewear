import { h, cicon, replace } from "../core/dom.js";
import { api } from "../core/api.js";
import { store } from "../core/store.js";
import { toastError, emptyState } from "../core/ui.js";
import { label, number } from "../core/format.js";
import { openAssetGenerator } from "../components/asset-generator.js";
import { activeJobsChip } from "../components/asset-jobs.js";
import { openMyAsset, shareState } from "../components/my-asset-detail.js";
import { TYPE_TEXT } from "../components/library-browser.js";

export { shareState };

// 我的素材: assets the user generated. Private by default; shared assets
// appear in the library after review and earn the owner a share of the price.
// Generation jobs and their history live on /my-assets/jobs.

const TYPES = [["pose", "pose", "purple"], ["outfit", "shirt", "pink"], ["scene", "mountain", "green"], ["item", "bag", "orange"]];
const EMPTY_TEXT = {
  pose: "选一个姿势分类，写一句动作描述，就能生成和素材库同规格的线稿姿势。",
  outfit: "选一个服装分类，比如唐朝服饰或医生，就能生成和素材库同规格的服装图。",
  scene: "选一个场景分类，比如江南水乡或咖啡馆，生成一张没有人物的背景图，创作时当作场景使用。",
  item: "选一个物品分类，比如项链、雨伞或扇子，生成一张物品图，创作时让人物佩戴或手持。"
};

export async function render(ctx) {
  const cfg = store.config.assets;
  let type = TYPES.some(([t]) => t === ctx.query.type) ? ctx.query.type : "pose";
  const grid = h("div.lib-grid.my-grid");
  const statsEl = h("p.my-stats.small");
  const chip = activeJobsChip({ endpoint: "/api/my/asset-jobs", href: "/my-assets/jobs", onSettled: () => { store.refreshUser(); load(); } });

  function generate(kind = type) {
    openAssetGenerator({ type: kind, onCreated: () => chip.refresh() });
  }

  function card(a) {
    const state = shareState(a);
    return h("article.asset-card", { class: a.enabled ? "" : "is-disabled" },
      h("button.asset-hit", { type: "button", "aria-label": `${a.name.zh}（${state.text}）`, onclick: () => open(a) },
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

  const open = (a) => openMyAsset(a, { onChanged: load, onCreated: () => chip.refresh() });

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
      grid.className = `lib-grid my-grid is-${type}`;
      replace(grid, data.items.length ? data.items.map(card) : emptyState({
        icon: "wand", color: "purple", title: `还没有${TYPE_TEXT[type]}素材`, text: EMPTY_TEXT[type],
        action: cfg.generation ? h("button.btn.btn-primary", { type: "button", onclick: () => generate() }, cicon("wand", "purple"), "生成素材") : null
      }));
    } catch (err) { toastError(err); }
    grid.classList.remove("is-loading");
  }

  const tabs = h("div.seg.lib-tabs", { role: "tablist", "aria-label": "素材类型" },
    TYPES.map(([value, iconName, color]) =>
      h("button", { type: "button", role: "tab", "aria-selected": String(value === type), "aria-pressed": String(value === type),
        onclick: (e) => {
          type = value;
          e.currentTarget.parentElement.querySelectorAll("button").forEach((t) => {
            t.setAttribute("aria-selected", String(t === e.currentTarget));
            t.setAttribute("aria-pressed", String(t === e.currentTarget));
          });
          history.replaceState({}, "", value === "pose" ? "/my-assets" : `/my-assets?type=${value}`);
          load();
        } }, cicon(iconName, color, 15), TYPE_TEXT[value])));

  load();
  if (ctx.query.generate && cfg.generation) {
    history.replaceState({}, "", type === "pose" ? "/my-assets" : `/my-assets?type=${type}`);
    generate(TYPES.some(([t]) => t === ctx.query.generate) ? ctx.query.generate : "pose");
  }

  return {
    node: h("div.my-assets.wrap",
      h("header.page-head",
        h("div", h("h1", "我的素材"),
          h("p", "按素材库的规格生成自己的姿势、服装、场景和物品。素材默认只有你能用；公开后其他人使用要付你设定的点数，你获得分成。")),
        h("div.lib-head-actions",
          chip.node,
          h("a.btn", { href: "/my-assets/jobs" }, cicon("list", "gray"), "生成记录"),
          cfg.generation ? h("button.btn.btn-primary", { type: "button", onclick: () => generate() }, cicon("wand", "purple"), "生成素材")
            : h("p.small.muted", "素材生成暂未开放"))),
      h("div.my-toolbar", tabs, statsEl),
      grid),
    cleanup() { chip.stop(); }
  };
}

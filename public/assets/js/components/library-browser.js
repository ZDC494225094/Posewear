import { h, icon, replace } from "../core/dom.js";
import { api } from "../core/api.js";
import { store, draft } from "../core/store.js";
import { label, number } from "../core/format.js";
import { toast, toastError, emptyState } from "../core/ui.js";
import { selectMenu } from "../core/select.js";
import { navigate } from "../core/nav.js";

// Browse poses, outfits, scenes or items with filters and paging. Used
// full-page in the library and inside the studio's picker dialogs.
//   mode "page":   card click -> onOpen(item, group)
//   mode "picker": card click -> onSelect(asset) (poses first ask for an angle)

let metaCache = null;
export async function libraryMeta({ fresh = false } = {}) {
  if (fresh) metaCache = null;
  if (!metaCache) metaCache = api.get("/api/library/meta").catch((err) => { metaCache = null; throw err; });
  return metaCache;
}

export function usableNote(asset, withPerson) {
  if (!asset.ai) return "仅供浏览";
  if (withPerson && !asset.aiWithPerson) return "不能与人物照片同用";
  return "";
}

// Credits the signed-in user pays to use someone else's shared asset.
export const assetFee = (asset) => (asset?.price && asset.owner?.id !== store.user?.id ? asset.price : 0);

// Put a library asset on the studio. Items join the list; past the limit the
// oldest one makes room.
export function useInStudio(asset) {
  if (asset.type === "pose") draft.patch({ pose: asset });
  else if (asset.type === "outfit") draft.patch({ outfit: asset, outfitUpload: null });
  else if (asset.type === "scene") draft.patch({ sceneAsset: asset, scene: "" });
  else {
    const items = (draft.read().items || []).filter((a) => a.id !== asset.id);
    const max = store.config.generation.maxItems || 3;
    if (items.length >= max) toast(`物品最多 ${max} 件，已替换最早选的那件`);
    draft.patch({ items: [...items.slice(-(max - 1)), asset] });
  }
  navigate("/studio");
}

const EMPTY = { series: "", category: "", angle: "", q: "", origin: "", license: "", view: "group" };
export const TYPE_TEXT = { pose: "姿势", outfit: "服装", scene: "场景", item: "物品" };
const PATHS = { pose: "/api/library/poses", outfit: "/api/library/outfits", scene: "/api/library/scenes", item: "/api/library/items" };
const UNITS = { outfit: "套服装", scene: "个场景", item: "件物品" };
const SEARCH_HINT = { pose: "搜索姿势名称、编号", outfit: "搜索颜色、单品、编号", scene: "搜索地点、氛围", item: "搜索名称、材质、颜色" };

export function libraryBrowser({ type = "pose", mode = "page", withPerson = false, filters: initial = {}, onSelect, onOpen, onFiltersChange }) {
  const state = {
    type,
    filters: { ...EMPTY, ...initial },
    page: 1, items: [], total: 0, loading: false, token: 0
  };
  const PAGE = mode === "picker" ? 36 : 48;
  let meta = null;

  const filterBar = h("div.lib-filters");
  const summary = h("p.lib-summary.small.muted", { "aria-live": "polite" });
  const grid = h("div.lib-grid", { class: `is-${state.type}` });
  const more = h("button.btn.lib-more", { type: "button", hidden: true, onclick: () => load(false) }, "加载更多");
  const sheet = h("div.angle-sheet", { hidden: true });
  const node = h("div.lib-browser", { class: `mode-${mode}` }, filterBar, sheet, summary, grid, h("div.lib-more-wrap", more));

  let searchTimer = null;
  function setFilter(patch, { reload = true } = {}) {
    Object.assign(state.filters, patch);
    onFiltersChange?.({ type: state.type, ...state.filters });
    renderFilters();
    if (reload) load(true);
  }

  function select(name, value, options, placeholder, onchange) {
    return selectMenu({ label: placeholder, value, filled: true, className: `lib-select-${name}`,
      options: [{ value: "", text: placeholder }, ...options], onChange: onchange }).node;
  }

  // 平台 / 用户共享 / 我的, shown only when there is something to tell apart.
  function originSelect(origins) {
    const options = [{ value: "platform", text: "平台素材", note: number(origins.platform) }];
    if (origins.user) options.push({ value: "user", text: "用户共享", note: number(origins.user) });
    if (store.user && origins.mine) options.push({ value: "mine", text: "我的素材", note: number(origins.mine) });
    if (options.length < 2 && !state.filters.origin) return null;
    return select("origin", state.filters.origin, options, "全部来源", (origin) => setFilter({ origin }));
  }

  function licenseSelect(origins) {
    if (!origins.commercial && !state.filters.license) return null;
    return select("license", state.filters.license,
      [{ value: "commercial", text: "可商用", note: number(origins.commercial) }, { value: "noncommercial", text: "非商用" }],
      "全部授权", (license) => setFilter({ license }));
  }

  function seriesChips(list, ariaLabel, countOf) {
    const f = state.filters;
    return h("div.chips.lib-series", { role: "group", "aria-label": ariaLabel },
      [{ key: "", zh: "全部" }, ...list].map((s) =>
        h("button.chip", { type: "button", "aria-pressed": String(f.series === s.key),
          onclick: () => setFilter({ series: s.key, category: "" }) },
          s.key ? label(s) : "全部", s.key ? h("span.chip-note", number(countOf(s))) : null)));
  }

  function renderFilters() {
    if (!meta) return;
    const f = state.filters;
    const search = h("label.lib-search",
      icon("search", 17),
      h("span.sr-only", "搜索"),
      h("input.input", { type: "search", value: f.q, placeholder: SEARCH_HINT[state.type],
        oninput: (e) => {
          clearTimeout(searchTimer);
          const q = e.target.value;
          searchTimer = setTimeout(() => setFilter({ q }, { reload: true }), 280);
        } }));
    const m = meta[state.type];
    const cats = m.categories.filter((c) => !f.series || c.series === f.series);
    const categoryOptions = cats.map((c) => ({ value: c.key, text: label(c), note: number(c.count) }));
    if (state.type === "pose") {
      const uniqueCats = [...new Map(categoryOptions.map((c) => [c.value, c])).values()];
      replace(filterBar,
        seriesChips(m.series, "姿势系列", (s) => s.count),
        h("div.lib-filter-row",
          search,
          select("category", f.category, uniqueCats, "全部分类", (category) => setFilter({ category })),
          select("angle", f.angle, m.angles.map((a) => ({ value: a.key, text: label(a) })), "全部角度",
            (angle) => setFilter({ angle })),
          originSelect(m.origins),
          licenseSelect(m.origins),
          mode === "page" ? select("view", f.view === "image" ? "image" : "", [{ value: "image", text: "逐张显示" }], "按姿势分组",
            (view) => setFilter({ view: view || "group" })) : null));
    } else {
      // Outfits, scenes and items: 大类 as chips, 小类 in a menu grouped by 大类.
      const grouped = f.series ? categoryOptions : m.series.flatMap((s) => [
        { group: label(s) }, ...m.categories.filter((c) => c.series === s.key).map((c) => ({ value: c.key, text: label(c), note: number(c.count) }))
      ]);
      replace(filterBar,
        seriesChips(m.series, `${TYPE_TEXT[state.type]}大类`, (s) => s.count),
        h("div.lib-filter-row",
          search,
          select("category", f.category, grouped, f.series ? "全部小类" : "全部分类", (category) => {
            const owner = category && !f.series ? m.categories.find((c) => c.key === category)?.series || "" : f.series;
            setFilter({ category, series: owner });
          }),
          originSelect(m.origins),
          licenseSelect(m.origins)));
    }
  }

  function badges(asset) {
    const out = [];
    if (asset.owner) out.push(h("span.asset-owner", `@${asset.owner.name}`));
    const fee = assetFee(asset);
    if (fee) out.push(h("span.asset-price", `${fee} 点`));
    if (asset.license === "commercial") out.push(h("span.asset-license", "可商用"));
    return out;
  }

  function card(item) {
    const isGroup = !!item.cover;
    const asset = isGroup ? item.cover : item;
    const note = mode === "picker" ? usableNote(asset, withPerson) : "";
    const angles = isGroup ? item.images.length : 0;
    // Imported outfits have no names, only codes.
    const name = state.type !== "outfit" || asset.generated ? label(asset.name) || asset.id : asset.id;
    const tags = state.type === "pose"
      ? [label(asset.category), angles > 1 ? `${angles} 个角度` : label(asset.angle)]
      : [label(asset.category)];
    return h("article.asset-card", { class: note ? "is-disabled" : "" },
      h("button.asset-hit", { type: "button", "aria-label": `${name}${note ? `（${note}）` : ""}`,
        onclick: () => (mode === "picker" ? pick(item) : onOpen?.(asset, isGroup ? item.images : [asset])) },
        h("div.asset-img", h("img", { src: asset.thumb, alt: "", loading: "lazy", decoding: "async" })),
        h("div.asset-info",
          h("div.asset-name", name),
          h("div.asset-meta", tags.filter(Boolean).map((m) => h("span", m)), badges(asset)))),
      note ? h("span.asset-flag", note) : null);
  }

  function pick(item) {
    if (!item.cover) {
      if (usableNote(item, withPerson)) return;
      onSelect?.(item);
      return;
    }
    const usable = item.images.filter((img) => !usableNote(img, withPerson));
    if (!usable.length) return;
    if (item.images.length === 1) { onSelect?.(usable[0]); return; }
    // Ask which angle to use.
    replace(sheet,
      h("div.angle-sheet-head",
        h("div", h("strong", label(item.cover.name)), h("p.small.muted", "选择一个角度，镜头会按这个角度构图")),
        h("button.btn.btn-sm.btn-ghost", { type: "button", onclick: () => { sheet.hidden = true; } }, "返回列表")),
      h("div.angle-row", item.images.map((img) => {
        const note = usableNote(img, withPerson);
        return h("button.angle-pick", { type: "button", disabled: !!note, onclick: () => onSelect?.(img),
          "aria-label": `${label(img.angle)}${note ? `（${note}）` : ""}` },
          h("img", { src: img.thumb, alt: "" }),
          h("span", label(img.angle)));
      })));
    sheet.hidden = false;
    sheet.scrollIntoView({ block: "nearest" });
  }

  async function load(reset) {
    const token = ++state.token;
    if (reset) { state.page = 1; state.items = []; grid.replaceChildren(...Array.from({ length: 8 }, () => h("div.asset-card.skeleton"))); }
    else state.page += 1;
    state.loading = true;
    more.disabled = true;
    sheet.hidden = true;
    try {
      const f = state.filters;
      const path = PATHS[state.type];
      const common = { series: f.series, category: f.category, q: f.q, origin: f.origin, license: f.license, page: state.page, size: PAGE };
      const query = state.type === "pose"
        ? { ...common, angle: f.angle, view: mode === "picker" ? "group" : f.view }
        : common;
      const data = await api.get(path, query);
      if (token !== state.token) return;
      state.total = data.total;
      state.items.push(...data.items);
      if (reset) grid.replaceChildren();
      grid.append(...data.items.map(card));
      const filtered = Object.entries(f).some(([k, v]) => k !== "view" && v);
      if (!state.items.length && filtered) {
        grid.replaceChildren(emptyState({ title: "没有找到匹配的素材", text: "换个关键词，或清除筛选条件试试。",
          action: h("button.btn", { type: "button", onclick: () => setFilter({ ...EMPTY, view: state.filters.view }) }, "清除筛选") }));
      } else if (!state.items.length) {
        const canGenerate = store.config.assets.generation;
        grid.replaceChildren(emptyState({ icon: "wand", color: "purple", title: `还没有${TYPE_TEXT[state.type]}素材`,
          text: canGenerate ? `可以在「我的素材」里按分类生成${TYPE_TEXT[state.type]}，生成后自己可以直接使用。` : "管理员添加后会出现在这里。",
          action: canGenerate && mode === "page" ? h("a.btn.btn-primary", { href: store.user ? `/my-assets?generate=${state.type}` : "/login" }, "生成素材") : null }));
      }
      const unit = state.type === "pose" && (mode === "picker" || f.view !== "image") ? "组姿势" : state.type === "pose" ? "张姿势图" : UNITS[state.type];
      summary.textContent = `共 ${number(state.total)} ${unit}`;
      more.hidden = state.items.length >= state.total;
    } catch (err) {
      if (token === state.token) { toastError(err); grid.replaceChildren(); }
    } finally {
      if (token === state.token) { state.loading = false; more.disabled = false; }
    }
  }

  async function init() {
    try { meta = await libraryMeta(); } catch (err) { toastError(err); return; }
    renderFilters();
    load(true);
  }
  init();

  return {
    node,
    setType(next, filters = {}) {
      state.type = next;
      state.filters = { ...EMPTY, ...filters };
      grid.className = `lib-grid is-${next}`;
      renderFilters();
      load(true);
    }
  };
}

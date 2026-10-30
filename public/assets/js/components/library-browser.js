import { h, icon, replace } from "../core/dom.js";
import { api } from "../core/api.js";
import { label, number } from "../core/format.js";
import { toastError, emptyState } from "../core/ui.js";

// Browse poses or outfits with filters and paging. Used full-page in the
// library and inside the studio's picker dialog.
//   mode "page":   card click -> onOpen(item, group)
//   mode "picker": card click -> onSelect(asset) (poses first ask for an angle)

let metaCache = null;
export async function libraryMeta() {
  if (!metaCache) metaCache = api.get("/api/library/meta").catch((err) => { metaCache = null; throw err; });
  return metaCache;
}

export function usableNote(asset, withPerson) {
  if (!asset.ai) return "仅供浏览";
  if (withPerson && !asset.aiWithPerson) return "不能与人物照片同用";
  return "";
}

export function libraryBrowser({ type = "pose", mode = "page", withPerson = false, filters: initial = {}, onSelect, onOpen, onFiltersChange }) {
  const state = {
    type,
    filters: { series: "", category: "", angle: "", q: "", view: "group", ...initial },
    page: 1, items: [], total: 0, loading: false, token: 0
  };
  const PAGE = mode === "picker" ? 36 : 48;
  let meta = null;

  const filterBar = h("div.lib-filters");
  const summary = h("p.lib-summary.small.muted", { "aria-live": "polite" });
  const grid = h("div.lib-grid", { class: state.type === "outfit" ? "is-outfit" : "is-pose" });
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
    return h("label.lib-select",
      h("span.sr-only", placeholder),
      h("select.select", { onchange: (e) => onchange(e.target.value) },
        h("option", { value: "" }, placeholder),
        options.map((o) => h("option", { value: o.value, selected: o.value === value }, o.text))));
  }

  function renderFilters() {
    if (!meta) return;
    const f = state.filters;
    const search = h("label.lib-search",
      icon("search", 17),
      h("span.sr-only", "搜索"),
      h("input.input", { type: "search", value: f.q, placeholder: state.type === "pose" ? "搜索姿势名称、编号" : "搜索颜色、单品、编号",
        oninput: (e) => {
          clearTimeout(searchTimer);
          const q = e.target.value;
          searchTimer = setTimeout(() => setFilter({ q }, { reload: true }), 280);
        } }));
    if (state.type === "pose") {
      const seriesChips = h("div.chips.lib-series", { role: "group", "aria-label": "姿势系列" },
        [{ key: "", zh: "全部" }, ...meta.pose.series].map((s) =>
          h("button.chip", { type: "button", "aria-pressed": String(f.series === s.key),
            onclick: () => setFilter({ series: s.key, category: "" }) },
            s.key ? label(s) : "全部", s.key ? h("span.chip-note", number(s.count)) : null)));
      const cats = meta.pose.categories.filter((c) => !f.series || c.series === f.series);
      const uniqueCats = [...new Map(cats.map((c) => [c.key, c])).values()];
      replace(filterBar,
        seriesChips,
        h("div.lib-filter-row",
          search,
          select("category", f.category, uniqueCats.map((c) => ({ value: c.key, text: label(c) })), "全部分类",
            (category) => setFilter({ category })),
          select("angle", f.angle, meta.pose.angles.map((a) => ({ value: a.key, text: label(a) })), "全部角度",
            (angle) => setFilter({ angle })),
          mode === "page" ? select("view", f.view === "image" ? "image" : "", [{ value: "image", text: "逐张显示" }], "按姿势分组",
            (view) => setFilter({ view: view || "group" })) : null));
    } else {
      replace(filterBar,
        h("div.chips.lib-series", { role: "group", "aria-label": "服装分类" },
          [{ key: "", zh: "全部" }, ...meta.outfit.categories].map((c) =>
            h("button.chip", { type: "button", "aria-pressed": String(f.category === c.key),
              onclick: () => setFilter({ category: c.key }) },
              c.key ? label(c) : "全部", c.key ? h("span.chip-note", number(c.count)) : null))),
        h("div.lib-filter-row", search));
    }
  }

  function card(item) {
    const isGroup = !!item.cover;
    const asset = isGroup ? item.cover : item;
    const note = mode === "picker" ? usableNote(asset, withPerson) : "";
    const angles = isGroup ? item.images.length : 0;
    const name = state.type === "pose" ? label(asset.name) : asset.id;
    const tags = state.type === "pose"
      ? [label(asset.category), angles > 1 ? `${angles} 个角度` : label(asset.angle)]
      : [label(asset.category)];
    return h("article.asset-card", { class: note ? "is-disabled" : "" },
      h("button.asset-hit", { type: "button", "aria-label": `${name}${note ? `（${note}）` : ""}`,
        onclick: () => (mode === "picker" ? pick(item) : onOpen?.(asset, isGroup ? item.images : [asset])) },
        h("div.asset-img", h("img", { src: asset.thumb, alt: "", loading: "lazy", decoding: "async" })),
        h("div.asset-info",
          h("div.asset-name", name),
          h("div.asset-meta", tags.filter(Boolean).map((m) => h("span", m))))),
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
      const path = state.type === "pose" ? "/api/library/poses" : "/api/library/outfits";
      const query = state.type === "pose"
        ? { series: f.series, category: f.category, angle: f.angle, q: f.q, view: mode === "picker" ? "group" : f.view, page: state.page, size: PAGE }
        : { category: f.category, q: f.q, page: state.page, size: PAGE };
      const data = await api.get(path, query);
      if (token !== state.token) return;
      state.total = data.total;
      state.items.push(...data.items);
      if (reset) grid.replaceChildren();
      grid.append(...data.items.map(card));
      if (!state.items.length) {
        grid.replaceChildren(emptyState({ title: "没有找到匹配的素材", text: "换个关键词，或清除筛选条件试试。",
          action: h("button.btn", { type: "button", onclick: () => setFilter({ series: "", category: "", angle: "", q: "" }) }, "清除筛选") }));
      }
      const unit = state.type === "pose" && (mode === "picker" || f.view !== "image") ? "组姿势" : state.type === "pose" ? "张姿势图" : "套服装";
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
      state.filters = { series: "", category: "", angle: "", q: "", view: "group", ...filters };
      grid.className = `lib-grid ${next === "outfit" ? "is-outfit" : "is-pose"}`;
      renderFilters();
      load(true);
    }
  };
}

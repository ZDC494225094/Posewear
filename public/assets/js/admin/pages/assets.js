import { h, replace } from "../../core/dom.js";
import { api } from "../../core/api.js";
import { toast, toastError, busy, confirmDialog } from "../../core/ui.js";
import { selectMenu } from "../../core/select.js";
import { label, number } from "../../core/format.js";
import { pageHead, section, form, drawer, statusPill } from "../kit.js";

const RATINGS = [["general", "普通"], ["suggestive", "敏感"], ["explicit", "限制"]];
const RATING_TONE = { general: "mat", suggestive: "tape", explicit: "pin" };
const RATING_HELP = "普通：可与人物照片同用；敏感：可用于 AI 生成（可在内容安全中关闭），但不能与人物照片同用；限制：只能浏览，永不发给模型。";

function uploadDialog(onDone) {
  const f = form([
    { key: "type", label: "类型", type: "select", options: [["pose", "姿势"], ["outfit", "服装"]] },
    { key: "rating", label: "分级", type: "select", options: RATINGS, help: RATING_HELP },
    { key: "category", label: "分类 key", placeholder: "如 standing、spring", help: "与已有分类一致时会归到同一类。" },
    { key: "categoryZh", label: "分类中文名", placeholder: "如 站姿、春季" },
    { key: "nameZh", label: "名称", placeholder: "如 双手叉腰站姿" },
    { key: "keywords", label: "英文关键词（服装）", placeholder: "white blouse, pleated skirt", help: "会附在提示词里帮助模型还原服装。" },
    { key: "seriesZh", label: "姿势系列中文名", placeholder: "自定义" },
    { key: "people", label: "人数（姿势）", type: "select", number: true, options: [[1, "单人"], [2, "双人"]] }
  ], { type: "outfit", rating: "general", category: "", categoryZh: "", nameZh: "", keywords: "", seriesZh: "自定义", people: 1 });
  const file = h("input.input", { type: "file", accept: "image/png,image/jpeg,image/webp", multiple: true });
  const progress = h("p.small.muted");
  const m = drawer("上传素材", h("div.stack",
    h("p.a-callout.small", "只上传你拥有版权或已获授权的图片。姿势建议使用白底线稿，服装建议使用纯色背景的平铺或模特图。"),
    f.node, h("div.a-field.is-wide", h("label", "图片（可多选，每张生成一个素材）"), file), progress,
    h("div.a-form-actions",
      h("button.btn", { type: "button", onclick: () => m.close() }, "取消"),
      h("button.btn.btn-primary", { type: "button", onclick: (e) => busy(e.currentTarget, async () => {
        const files = [...file.files];
        if (!files.length) { toast("请选择图片", { type: "error" }); return; }
        let ok = 0;
        for (const [i, item] of files.entries()) {
          progress.textContent = `正在上传 ${i + 1}/${files.length}…`;
          const fd = new FormData();
          for (const [k, v] of Object.entries(f.value)) fd.append(k, String(v ?? ""));
          if (!f.value.nameZh && files.length > 1) fd.set("nameZh", item.name.replace(/\.\w+$/, ""));
          fd.append("file", item);
          try { await api.upload("/api/admin/assets/upload", fd); ok += 1; } catch (err) { toastError(err); }
        }
        progress.textContent = "";
        toast(`已上传 ${ok} 个素材`, { type: "success" });
        m.close();
        onDone();
      }) }, "上传"))), { width: 600 });
}

function editAsset(a, onDone) {
  const f = form([
    { key: "rating", label: "分级", type: "select", options: RATINGS, help: RATING_HELP },
    { key: "enabled", label: "上架", type: "switch" },
    { key: "name_zh", label: "名称" },
    { key: "category_zh", label: "分类中文名" },
    { key: "keywords", label: "关键词", wide: true },
    { key: "sort", label: "排序", type: "number" }
  ], { rating: a.rating, enabled: a.enabled, name_zh: a.name.zh, category_zh: a.category.zh, keywords: a.keywords, sort: a.sort });
  const m = drawer(`素材 ${a.id}`, h("div.stack",
    h("img.a-asset-preview", { src: a.preview, alt: "" }),
    h("p.small.muted", `${label(a.series)} · ${label(a.category)}${a.angle ? ` · ${label(a.angle)}` : ""} · 被使用 ${a.useCount} 次 · 来源：${a.source === "custom" ? "后台上传" : "导入"}`),
    f.node,
    h("div.a-form-actions",
      a.source === "custom" ? h("button.btn.btn-danger", { type: "button", onclick: async () => {
        if (!(await confirmDialog({ title: "删除这个素材？", message: "图片文件会被删除。", confirmText: "删除", danger: true }))) return;
        try { await api.del(`/api/admin/assets/${encodeURIComponent(a.id)}`); m.close(); onDone(); } catch (err) { toastError(err); }
      } }, "删除") : null,
      h("button.btn", { type: "button", onclick: () => m.close() }, "取消"),
      h("button.btn.btn-primary", { type: "button", onclick: (e) => busy(e.currentTarget, async () => {
        try { await api.patch(`/api/admin/assets/${encodeURIComponent(a.id)}`, f.value); toast("已保存", { type: "success" }); m.close(); onDone(); }
        catch (err) { toastError(err); }
      }) }, "保存"))), { width: 560 });
}

export async function render() {
  let facets;
  try { facets = await api.get("/api/admin/assets/facets"); } catch (err) { toastError(err); return h("div"); }
  const state = { type: "pose", rating: "", enabled: "", series: "", category: "", q: "", page: 1 };
  const selected = new Set();
  const size = 60;
  const grid = h("div.a-asset-grid");
  const foot = h("div.a-list-foot");
  const bar = h("div.a-filters");
  const bulkBar = h("div.a-bulk", { hidden: true });
  const tabs = h("div.seg.a-type-tabs", { role: "tablist", "aria-label": "素材类型" });

  const typeCount = (type, rating) => facets.ratingCounts
    .filter((r) => r.type === type && (!rating || r.rating === rating)).reduce((n, r) => n + r.n, 0);

  function summary() {
    return h("p.a-rating-summary.small", RATINGS.map(([r, t]) => h("span", `${t} `, h("strong.num", number(typeCount(state.type, r))))));
  }

  function renderTabs() {
    replace(tabs, [["pose", "姿势"], ["outfit", "服装"]].map(([value, text]) =>
      h("button", { type: "button", role: "tab", "aria-selected": String(state.type === value), "aria-pressed": String(state.type === value),
        onclick: () => {
          if (state.type === value) return;
          Object.assign(state, { type: value, series: "", category: "", page: 1 });
          selected.clear();
          renderTabs();
          renderBar();
          load();
        } }, text, h("span.chip-note.num", number(typeCount(value))))));
    summaryBox.replaceChildren(summary());
  }

  function renderBar() {
    const sel = (key, options, aria) => selectMenu({ label: aria, value: state[key], options,
      onChange: (v) => { state[key] = v; state.page = 1; load(); } }).node;
    const cats = state.type === "pose" ? facets.pose.categories : facets.outfit.categories;
    replace(bar,
      state.type === "pose" ? sel("series", [["", "全部系列"], ...facets.pose.series.map((s) => [s.key, s.zh])], "系列") : null,
      sel("category", [["", "全部分类"], ...cats.map((c) => [c.key, c.zh])], "分类"),
      sel("rating", [["", "全部分级"], ...RATINGS], "分级"),
      sel("enabled", [["", "上架和下架"], ["1", "仅上架"], ["0", "仅下架"]], "上架状态"),
      h("input.input", { type: "search", placeholder: "搜索 ID / 名称 / 关键词", "aria-label": "搜索", value: state.q,
        oninput: (e) => { clearTimeout(bar._t); bar._t = setTimeout(() => { state.q = e.target.value.trim(); state.page = 1; load(); }, 300); } }));
  }

  function renderBulk() {
    bulkBar.hidden = false;
    const scope = selected.size ? `已选 ${selected.size} 个` : (state.series || state.category)
      ? `当前筛选（${state.type === "pose" ? "姿势" : "服装"}${state.series ? ` · ${facets.pose.series.find((s) => s.key === state.series)?.zh}` : ""}${state.category ? ` · ${(state.type === "pose" ? facets.pose.categories : facets.outfit.categories).find((c) => c.key === state.category)?.zh}` : ""}）`
      : null;
    if (!scope) { replace(bulkBar, h("span.small.muted", "勾选素材，或按系列/分类筛选后，可批量修改分级和上架状态。")); return; }
    const apply = (set) => async (e) => busy(e.currentTarget, async () => {
      const body = selected.size ? { ids: [...selected], set } : { filter: { type: state.type, series: state.series, category: state.category }, set };
      if (!(await confirmDialog({ title: `批量修改${scope}`, message: `将设置为：${set.rating ? RATINGS.find(([r]) => r === set.rating)[1] : ""}${set.enabled !== undefined ? (set.enabled ? "上架" : "下架") : ""}`, confirmText: "确认修改" }))) return;
      try {
        const r = await api.post("/api/admin/assets/bulk", body);
        toast(`已修改 ${r.changed} 个素材`, { type: "success" });
        selected.clear();
        facets = await api.get("/api/admin/assets/facets");
        renderTabs();
        load();
      } catch (err) { toastError(err); }
    });
    replace(bulkBar, h("strong.small", scope), " ",
      RATINGS.map(([r, t]) => h("button.btn.btn-sm", { type: "button", onclick: apply({ rating: r }) }, `设为${t}`)),
      h("button.btn.btn-sm", { type: "button", onclick: apply({ enabled: true }) }, "上架"),
      h("button.btn.btn-sm", { type: "button", onclick: apply({ enabled: false }) }, "下架"),
      selected.size ? h("button.btn.btn-sm.btn-ghost", { type: "button", onclick: () => { selected.clear(); load(); } }, "取消选择") : null);
  }

  async function load() {
    grid.classList.add("is-loading");
    try {
      const data = await api.get("/api/admin/assets", { ...state, size });
      replace(grid, data.items.length ? data.items.map((a) => h("article.a-asset", { class: a.enabled ? "" : "is-off" },
        h("label.a-asset-check", h("input", { type: "checkbox", checked: selected.has(a.id), "aria-label": `选择 ${a.id}`,
          onchange: (e) => { if (e.target.checked) selected.add(a.id); else selected.delete(a.id); renderBulk(); } })),
        h("button.a-asset-hit", { type: "button", onclick: () => editAsset(a, load) },
          h("img", { src: a.thumb, alt: "", loading: "lazy" }),
          h("span.a-asset-name.small", label(a.name)),
          h("span.a-asset-tags", statusPill(a.ratingLabel, RATING_TONE[a.rating]), a.enabled ? null : statusPill("下架"),
            a.source === "custom" ? statusPill("上传") : null)))) : h("div.a-empty.muted", "没有匹配的素材"));
      const pages = Math.max(1, Math.ceil(data.total / size));
      replace(foot, h("div.pager",
        h("span.small.muted", `共 ${number(data.total)} 个`),
        h("button.btn.btn-sm", { type: "button", disabled: state.page <= 1, onclick: () => { state.page -= 1; load(); } }, "上一页"),
        h("span.small.muted.num", `${state.page} / ${pages}`),
        h("button.btn.btn-sm", { type: "button", disabled: state.page >= pages, onclick: () => { state.page += 1; load(); } }, "下一页")));
      renderBulk();
    } catch (err) { toastError(err); }
    grid.classList.remove("is-loading");
  }

  const summaryBox = h("div.a-tabs-note");
  renderTabs();
  renderBar();
  load();
  return h("div",
    pageHead("素材库", "管理姿势和服装素材的分级与上架。导入的原项目素材只能停用，后台上传的可以删除。",
      h("button.btn.btn-primary", { type: "button", onclick: () => uploadDialog(async () => { facets = await api.get("/api/admin/assets/facets"); renderTabs(); renderBar(); load(); }) }, "上传素材")),
    h("p.a-callout.small", "版权提醒：原项目的图片素材不在 MIT 许可范围内，商用前请取得权利人授权，或替换为自有素材。"),
    h("div.a-tabs-row", tabs, summaryBox),
    section(null, null, bar, bulkBar, grid, foot));
}

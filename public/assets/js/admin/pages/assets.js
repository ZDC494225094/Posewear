import { h, replace, cicon } from "../../core/dom.js";
import { api } from "../../core/api.js";
import { toast, toastError, busy, confirmDialog, lightbox } from "../../core/ui.js";
import { selectMenu } from "../../core/select.js";
import { label, number, dateTime } from "../../core/format.js";
import { pageHead, section, form, drawer, statusPill } from "../kit.js";
import { openAssetGenerator, taxonomy, categoryOptions } from "../../components/asset-generator.js";
import { activeJobsChip } from "../../components/asset-jobs.js";
import { TYPE_TEXT } from "../../components/library-browser.js";
import { assetGenerationInfo } from "../../components/asset-generation-info.js";

const TYPES = Object.entries(TYPE_TEXT);

const RATINGS = [["general", "普通"], ["suggestive", "敏感"], ["explicit", "限制"]];
const RATING_TONE = { general: "mat", suggestive: "tape", explicit: "pin" };
const RATING_HELP = "普通：可与真人照片同用；敏感：可用于 AI 生成（可在内容安全中关闭），但不能与真人照片同用；虚拟人不受此额外限制。限制：只能浏览，永不发给模型。";
const LICENSES = [["commercial", "可商用"], ["noncommercial", "非商用"]];
const SOURCE_TEXT = { upstream: "导入", custom: "上传", ai: "AI 生成" };
const REVIEW_TEXT = { none: "", pending: "待审核", approved: "已通过", rejected: "未通过" };
// One menu for where an asset came from; each value maps to list filters.
const ORIGINS = [
  ["", "全部来源", {}],
  ["upstream", "平台 · 导入", { origin: "platform", source: "upstream" }],
  ["custom", "平台 · 后台上传", { origin: "platform", source: "custom" }],
  ["ai", "平台 · AI 生成", { origin: "platform", source: "ai" }],
  ["user", "用户生成", { origin: "user" }]
];

function minorOf(tree, asset) {
  const major = tree[asset.type].find((m) => m.key === asset.series?.key);
  return major?.children.find((c) => c.key === asset.category?.key) || null;
}

async function uploadDialog(onDone, initialType = "outfit") {
  let tree;
  try { tree = await taxonomy({ fresh: true }); } catch (err) { toastError(err); return; }
  let type = initialType;
  let f;
  const formBox = h("div");
  const typeSeg = h("div.seg", { role: "radiogroup", "aria-label": "素材类型" });
  function build() {
    replace(typeSeg, TYPES.map(([value, text]) => h("button", { type: "button", role: "radio",
      "aria-checked": String(value === type), "aria-pressed": String(value === type), onclick: () => { type = value; build(); } }, text)));
    f = form([
      { key: "categoryId", label: "分类", type: "select", options: categoryOptions(tree[type]) },
      { key: "rating", label: "分级", type: "select", options: RATINGS, help: RATING_HELP },
      { key: "license", label: "授权", type: "select", options: LICENSES, help: "只有你拥有版权或已获商用授权的图片才选“可商用”。" },
      { key: "nameZh", label: "名称", placeholder: { pose: "如 双手叉腰站姿", outfit: "如 红色齐胸襦裙", scene: "如 黄昏江边步道", item: "如 珍珠吊坠项链" }[type] },
      type !== "pose" ? { key: "keywords", label: "英文关键词（选填）", placeholder: { outfit: "white blouse, pleated skirt", scene: "riverside at sunset, arch bridge", item: "pearl pendant, gold chain" }[type], help: "会附在提示词里帮助模型还原素材。" } : null,
      type === "pose" ? { key: "people", label: "人数", type: "select", number: true, options: [[1, "单人"], [2, "双人"]] } : null
    ].filter(Boolean), { categoryId: tree[type][0]?.children[0]?.id, rating: "general", license: "commercial", nameZh: "", keywords: "", people: 1 });
    replace(formBox, f.node);
  }
  build();
  const fileNote = h("span.small.muted", "未选择图片");
  const file = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", multiple: true, hidden: true,
    onchange: () => { fileNote.textContent = file.files.length ? `已选 ${file.files.length} 张` : "未选择图片"; } });
  const progress = h("p.small.muted");
  const m = drawer("上传素材", h("div.stack",
    h("p.a-callout.small", "只上传你拥有版权或已获授权的图片。姿势建议使用白底线稿，服装使用纯色背景，场景使用无人环境图，物品使用清晰的单件产品图。"),
    typeSeg, formBox,
    h("div.a-field.is-wide", h("label", "图片（可多选，每张生成一个素材）"),
      h("div.a-file", h("button.btn.btn-sm", { type: "button", onclick: () => file.click() }, cicon("upload", "blue", 15), "选择图片"), fileNote, file)),
    progress,
    h("div.a-form-actions",
      h("button.btn", { type: "button", onclick: () => m.close() }, "取消"),
      h("button.btn.btn-primary", { type: "button", onclick: (e) => busy(e.currentTarget, async () => {
        const files = [...file.files];
        if (!files.length) { toast("请选择图片", { type: "error" }); return; }
        let ok = 0;
        for (const [i, item] of files.entries()) {
          progress.textContent = `正在上传 ${i + 1}/${files.length}…`;
          const fd = new FormData();
          fd.append("type", type);
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

export async function editAsset(a, onDone, { onGenerated } = {}) {
  let tree;
  try { tree = await taxonomy(); } catch (err) { toastError(err); return; }
  const current = minorOf(tree, a);
  const isUser = !!a.owner;
  const f = form([
    { key: "categoryId", label: "分类", type: "select", options: categoryOptions(tree[a.type]),
      placeholder: `未归入分类树（${label(a.series)} · ${label(a.category)}）` },
    { key: "license", label: "授权", type: "select", options: LICENSES },
    { key: "rating", label: "分级", type: "select", options: RATINGS, help: RATING_HELP },
    { key: "enabled", label: "上架", type: "switch", help: isUser ? "下架后作者也不能再使用。" : "" },
    { key: "name_zh", label: "名称" },
    { key: "keywords", label: "关键词", wide: true },
    { key: "sort", label: "排序", type: "number", help: "数字越小越靠前。" }
  ], { categoryId: current?.id ?? "", license: a.license, rating: a.rating, enabled: a.enabled, name_zh: a.name.zh, keywords: a.keywords, sort: a.sort });
  const note = h("input.input", { placeholder: "驳回原因（作者可见）", maxLength: 200 });

  async function save(patch, message = "已保存") {
    try {
      await api.patch(`/api/admin/assets/${encodeURIComponent(a.id)}`, patch);
      toast(message, { type: "success" });
      m.close();
      onDone();
      document.dispatchEvent(new Event("pw:moderation-changed"));
    } catch (err) { toastError(err); }
  }

  const reviewBox = isUser && a.visibility === "public" ? h("div.a-review",
    h("p.small", "作者已公开这个素材", a.price ? `，使用费 ${a.price} 点` : "，免费使用", "。", a.review === "pending" ? "通过后其他用户才能看到。" : `审核状态：${REVIEW_TEXT[a.review] || "—"}`),
    h("div.a-review-row",
      note,
      h("button.btn.btn-sm.btn-danger", { type: "button", onclick: (e) => busy(e.currentTarget, () => save({ review: "rejected", reviewNote: note.value }, "已驳回")) }, "驳回"),
      h("button.btn.btn-sm.btn-primary", { type: "button", onclick: (e) => busy(e.currentTarget, () => save({ review: "approved" }, "已通过")) }, "通过"))) : null;

  const missing = a.type === "pose" ? 5 - (a.groupAngles || []).length : 0;
  const canExtend = a.type === "pose" && missing > 0 && a.source !== "upstream";
  const m = drawer(`素材 ${a.id}`, h("div.stack",
    h("button.a-preview-btn", { type: "button", "aria-label": "查看大图", onclick: () => lightbox([{ src: a.preview, alt: a.name.zh }]) },
      h("img.a-asset-preview", { src: a.preview, alt: "" })),
    h("p.small.muted", [label(a.series), label(a.category), a.angle ? label(a.angle) : null, `被使用 ${a.useCount} 次`,
      `来源：${isUser ? `用户 ${a.ownerEmail || a.owner.name}` : SOURCE_TEXT[a.source] || a.source}`, dateTime(a.createdAt)].filter(Boolean).join(" · ")),
    isUser ? h("p.small.muted", `作者设置：${a.visibility === "public" ? "公开" : "私有"} · 使用费 ${a.price} 点 · 作者累计收益 ${a.earned} 点`) : null,
    reviewBox,
    a.generated ? assetGenerationInfo(a, { admin: true }) : null,
    f.node,
    h("div.a-form-actions",
      a.source !== "upstream" ? h("button.btn.btn-danger", { type: "button", onclick: async () => {
        if (!(await confirmDialog({ title: "删除这个素材？", message: isUser ? "图片文件会被删除，作者的素材也会消失。" : "图片文件会被删除。", confirmText: "删除", danger: true }))) return;
        try { await api.del(`/api/admin/assets/${encodeURIComponent(a.id)}`); m.close(); onDone(); } catch (err) { toastError(err); }
      } }, "删除") : null,
      canExtend ? h("button.btn", { type: "button", onclick: () => { m.close(); openAssetGenerator({ admin: true, source: a, onCreated: onGenerated }); } },
        cicon("layers", "indigo"), `补全角度（差 ${missing} 个）`) : null,
      h("button.btn", { type: "button", onclick: () => m.close() }, "取消"),
      h("button.btn.btn-primary", { type: "button", onclick: (e) => busy(e.currentTarget, () => {
        const { categoryId, ...rest } = f.value;
        return save(categoryId && categoryId !== current?.id ? { ...rest, categoryId } : rest);
      }) }, "保存"))), { width: 580 });
}

export async function render(ctx) {
  let facets;
  try { facets = await api.get("/api/admin/assets/facets"); } catch (err) { toastError(err); return h("div"); }
  const state = { type: Object.hasOwn(TYPE_TEXT, ctx.query.type) ? ctx.query.type : "pose", rating: "", enabled: "", series: "", category: "", origin: "", license: "", review: "", q: "", page: 1 };
  const selected = new Set();
  const size = 60;
  const grid = h("div.a-asset-grid");
  const foot = h("div.a-list-foot");
  const bar = h("div.a-filters");
  const bulkBar = h("div.a-bulk", { hidden: true });
  const tabs = h("div.seg.a-type-tabs", { role: "tablist", "aria-label": "素材类型" });
  const summaryBox = h("div.a-tabs-note");
  const jobs = activeJobsChip({ endpoint: "/api/admin/asset-jobs", href: "/admin/asset-jobs", onSettled: () => refresh() });
  const onGenerated = () => jobs.refresh();

  const typeCount = (type, rating) => facets.ratingCounts
    .filter((r) => r.type === type && (!rating || r.rating === rating)).reduce((n, r) => n + r.n, 0);
  const originFilter = () => ORIGINS.find(([v]) => v === state.origin)?.[2] || {};

  async function refresh() {
    try { facets = await api.get("/api/admin/assets/facets"); } catch { /* keep old counts */ }
    renderTabs();
    renderBar();
    load();
  }

  function renderTabs() {
    replace(tabs, TYPES.map(([value, text]) =>
      h("button", { type: "button", role: "tab", "aria-selected": String(state.type === value), "aria-pressed": String(state.type === value),
        onclick: () => {
          if (state.type === value) return;
          Object.assign(state, { type: value, series: "", category: "", page: 1 });
          history.replaceState({}, "", value === "pose" ? "/admin/assets" : `/admin/assets?type=${value}`);
          selected.clear();
          renderTabs();
          renderBar();
          load();
        } }, text, h("span.chip-note.num", number(typeCount(value))))));
    const f = facets[state.type];
    replace(summaryBox, h("p.a-rating-summary.small",
      RATINGS.map(([r, t]) => h("span", `${t} `, h("strong.num", number(typeCount(state.type, r))))),
      h("span", "可商用 ", h("strong.num", number(f.commercial))),
      f.user ? h("span", "用户素材 ", h("strong.num", number(f.user))) : null),
    f.pending ? h("button.chip", { type: "button", "aria-pressed": String(state.review === "pending"), onclick: () => {
      state.review = state.review === "pending" ? "" : "pending";
      state.page = 1;
      renderTabs();
      renderBar();
      load();
    } }, "待审核", h("span.chip-note.num", number(f.pending))) : null);
  }

  function renderBar() {
    const sel = (key, options, aria, after) => selectMenu({ label: aria, value: state[key], options,
      onChange: (v) => { state[key] = v; after?.(); state.page = 1; load(); } }).node;
    const f = facets[state.type];
    const cats = f.categories.filter((c) => !state.series || c.series === state.series);
    replace(bar,
      sel("series", [["", state.type === "pose" ? "全部系列" : "全部大类"], ...f.series.map((s) => [s.key, s.zh])], "大类",
        () => { state.category = ""; renderBar(); }),
      sel("category", [["", state.type === "pose" ? "全部分类" : "全部小类"], ...[...new Map(cats.map((c) => [c.key, c])).values()].map((c) => [c.key, c.zh])], "小类"),
      sel("origin", ORIGINS.map(([v, t]) => [v, t]), "来源"),
      sel("license", [["", "全部授权"], ...LICENSES], "授权"),
      sel("rating", [["", "全部分级"], ...RATINGS], "分级"),
      sel("review", [["", "全部审核状态"], ["pending", "待审核"], ["approved", "已通过"], ["rejected", "未通过"]], "审核状态", renderTabs),
      sel("enabled", [["", "上架和下架"], ["1", "仅上架"], ["0", "仅下架"]], "上架状态"),
      h("input.input", { type: "search", placeholder: "搜索 ID / 名称 / 关键词 / 作者", "aria-label": "搜索", value: state.q,
        oninput: (e) => { clearTimeout(bar._t); bar._t = setTimeout(() => { state.q = e.target.value.trim(); state.page = 1; load(); }, 300); } }));
  }

  function renderBulk() {
    bulkBar.hidden = false;
    const f = facets[state.type];
    const scopeParts = [TYPE_TEXT[state.type],
      state.series ? f.series.find((s) => s.key === state.series)?.zh : null,
      state.category ? f.categories.find((c) => c.key === state.category && (!state.series || c.series === state.series))?.zh : null,
      state.origin ? ORIGINS.find(([v]) => v === state.origin)?.[1] : null].filter(Boolean);
    const byFilter = state.series || state.category || state.origin;
    const scope = selected.size ? `已选 ${selected.size} 个` : byFilter ? `当前筛选（${scopeParts.join(" · ")}）` : null;
    if (!scope) { replace(bulkBar, h("span.small.muted", "勾选素材，或按大类、小类、来源筛选后，可批量修改分级、授权和上架状态。")); return; }
    const describe = (set) => [set.rating ? RATINGS.find(([r]) => r === set.rating)[1] : null,
      set.license ? LICENSES.find(([l]) => l === set.license)[1] : null,
      set.enabled !== undefined ? (set.enabled ? "上架" : "下架") : null].filter(Boolean).join("、");
    const apply = (set) => async (e) => busy(e.currentTarget, async () => {
      const body = selected.size ? { ids: [...selected], set }
        : { filter: { type: state.type, series: state.series, category: state.category, ...originFilter() }, set };
      if (!(await confirmDialog({ title: `批量修改${scope}`, message: `将设置为：${describe(set)}`, confirmText: "确认修改" }))) return;
      try {
        const r = await api.post("/api/admin/assets/bulk", body);
        toast(`已修改 ${r.changed} 个素材`, { type: "success" });
        selected.clear();
        refresh();
      } catch (err) { toastError(err); }
    });
    replace(bulkBar, h("strong.small", scope), " ",
      RATINGS.map(([r, t]) => h("button.btn.btn-sm", { type: "button", onclick: apply({ rating: r }) }, `设为${t}`)),
      h("button.btn.btn-sm", { type: "button", onclick: apply({ license: "commercial" }) }, "设为可商用"),
      h("button.btn.btn-sm", { type: "button", onclick: apply({ license: "noncommercial" }) }, "设为非商用"),
      h("button.btn.btn-sm", { type: "button", onclick: apply({ enabled: true }) }, "上架"),
      h("button.btn.btn-sm", { type: "button", onclick: apply({ enabled: false }) }, "下架"),
      selected.size ? h("button.btn.btn-sm.btn-ghost", { type: "button", onclick: () => { selected.clear(); load(); } }, "取消选择") : null);
  }

  function tile(a) {
    return h("article.a-asset", { class: a.enabled ? "" : "is-off" },
      h("label.a-asset-check", h("input", { type: "checkbox", checked: selected.has(a.id), "aria-label": `选择 ${a.id}`,
        onchange: (e) => { if (e.target.checked) selected.add(a.id); else selected.delete(a.id); renderBulk(); } })),
      h("button.a-asset-hit", { type: "button", onclick: () => editAsset(a, refresh, { onGenerated }) },
        h("img", { src: a.thumb, alt: "", loading: "lazy" }),
        h("span.a-asset-name.small", label(a.name)),
        h("span.a-asset-tags",
          statusPill(a.ratingLabel, RATING_TONE[a.rating]),
          a.license === "commercial" ? statusPill("可商用", "blue") : statusPill("非商用"),
          a.owner ? statusPill("用户") : a.source !== "upstream" ? statusPill(SOURCE_TEXT[a.source]) : null,
          a.owner && a.visibility === "public" && a.review === "pending" ? statusPill("待审核", "tape") : null,
          a.enabled ? null : statusPill("下架"))));
  }

  async function load() {
    grid.classList.add("is-loading");
    try {
      const { origin, ...rest } = state;
      const data = await api.get("/api/admin/assets", { ...rest, ...originFilter(), size });
      replace(grid, data.items.length ? data.items.map(tile) : h("div.a-empty.muted", "没有匹配的素材"));
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

  renderTabs();
  renderBar();
  load();
  const node = h("div",
    pageHead("素材库", "姿势、服装、场景和物品的分类、授权、审核与上架。生成任务集中在独立的「素材生成记录」页面。", [
      jobs.node,
      h("a.btn", { href: "/admin/asset-jobs" }, cicon("list", "gray"), "生成记录"),
      h("a.btn", { href: "/admin/asset-categories" }, cicon("folder", "blue"), "分类管理"),
      h("button.btn", { type: "button", onclick: () => uploadDialog(refresh, state.type) }, cicon("upload", "blue"), "上传素材"),
      h("button.btn.btn-primary", { type: "button", onclick: () => openAssetGenerator({ admin: true, type: state.type, onCreated: onGenerated }) },
        cicon("wand", "purple"), "AI 生成素材")
    ]),
    h("p.a-callout.small", "版权提醒：导入的原项目图片不在 MIT 许可范围内，已标记为“非商用”。取得权利人书面授权后，可批量改为“可商用”；也可以用 AI 生成可商用的平台素材替换。"),
    h("div.a-tabs-row", tabs, summaryBox),
    section(null, null, bar, bulkBar, grid, foot));
  return { node, cleanup: () => { jobs.stop(); clearTimeout(bar._t); } };
}

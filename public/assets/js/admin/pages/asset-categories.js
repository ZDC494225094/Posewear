import { h, replace, cicon } from "../../core/dom.js";
import { api } from "../../core/api.js";
import { toast, toastError, busy, confirmDialog } from "../../core/ui.js";
import { number } from "../../core/format.js";
import { pageHead, form, drawer, statusPill, table } from "../kit.js";
import { taxonomy } from "../../components/asset-generator.js";
import { TYPE_TEXT } from "../../components/library-browser.js";

// The two-level category tree. Minor categories carry the hint that AI asset
// generation adds to its prompt, and decide whether generation is open.

const RATINGS = [["general", "普通"], ["suggestive", "敏感"], ["explicit", "限制"]];
const RATING_TONE = { general: "mat", suggestive: "tape", explicit: "pin" };

function editCategory({ type, parent = null, category = null, onDone }) {
  const isMinor = parent ? true : !!category?.parentKey;
  const f = form([
    { key: "nameZh", label: "中文名", placeholder: isMinor ? "如 唐朝服饰" : "如 古装 · 历代服饰" },
    { key: "nameEn", label: "英文名", placeholder: isMinor ? "Tang dynasty" : "Chinese historical dress", help: "会写进生成提示词，帮助模型理解分类。" },
    { key: "key", label: "标识", type: category ? "readonly" : "text", placeholder: "留空自动生成",
      help: category ? "标识创建后不能修改，素材按它归类。" : "字母、数字、中文、- 或 _，同一级内不能重复。" },
    { key: "sort", label: "排序", type: "number", help: "数字越小越靠前。" },
    isMinor ? { key: "hint", label: "生成提示（英文）", type: "textarea", rows: 4, wide: true,
      placeholder: "Tang dynasty hanfu: high-waisted ruqun skirt, wide sleeves, long pibo shawl",
      help: "描述这个分类典型的款式和单品。用户的描述会排在它后面，两者冲突时以用户描述为准。" } : null,
    { key: "rating", label: "分级", type: "select", options: RATINGS, help: "这个分类下生成的素材按此分级。用户只能在“普通”分类里生成，“限制”分类不能生成。" },
    isMinor ? { key: "genEnabled", label: "开放 AI 生成", type: "switch" } : null
  ].filter(Boolean), {
    nameZh: category?.zh || "", nameEn: category?.en || "", key: category?.key || "", hint: category?.hint || "",
    rating: category?.rating || "general", genEnabled: category ? category.genEnabled : true, sort: category?.sort ?? ""
  });
  const title = category ? `编辑${isMinor ? "小类" : "大类"}` : parent ? `在「${parent.zh}」下添加小类` : "添加大类";
  const m = drawer(title, h("div.stack",
    f.node,
    h("div.a-form-actions",
      category ? h("button.btn.btn-danger", { type: "button", onclick: async () => {
        const message = isMinor ? "删除后不能恢复。分类下还有素材时不能删除。" : "会一并删除它的所有小类。分类下还有素材时不能删除。";
        if (!(await confirmDialog({ title: `删除「${category.zh}」？`, message, confirmText: "删除", danger: true }))) return;
        try { await api.del(`/api/admin/asset-categories/${category.id}`); toast("已删除", { type: "success" }); m.close(); onDone(); }
        catch (err) { toastError(err); }
      } }, "删除") : null,
      h("button.btn", { type: "button", onclick: () => m.close() }, "取消"),
      h("button.btn.btn-primary", { type: "button", onclick: (e) => busy(e.currentTarget, async () => {
        const v = f.value;
        const body = { nameZh: v.nameZh, nameEn: v.nameEn, rating: v.rating, ...(isMinor ? { hint: v.hint, genEnabled: v.genEnabled } : {}),
          ...(v.sort === "" ? {} : { sort: v.sort }) };
        try {
          if (category) await api.put(`/api/admin/asset-categories/${category.id}`, body);
          else await api.post("/api/admin/asset-categories", { ...body, type, parentId: parent?.id || null, key: v.key });
          toast("已保存", { type: "success" });
          m.close();
          onDone();
        } catch (err) { toastError(err); }
      }) }, "保存"))), { width: 560 });
}

export async function render(ctx) {
  let type = Object.hasOwn(TYPE_TEXT, ctx.query.type) ? ctx.query.type : "pose";
  let data;
  const body = h("div.a-cats");
  const tabs = h("div.seg.a-type-tabs", { role: "tablist", "aria-label": "素材类型" });

  async function reload() {
    try { data = await api.get("/api/admin/asset-categories"); } catch (err) { toastError(err); return; }
    taxonomy({ fresh: true }).catch(() => {});
    renderAll();
  }

  function renderAll() {
    const total = (t) => data[t].reduce((n, m) => n + m.children.length, 0);
    replace(tabs, Object.entries(TYPE_TEXT).map(([value, text]) =>
      h("button", { type: "button", role: "tab", "aria-selected": String(type === value), "aria-pressed": String(type === value),
        onclick: () => { type = value; history.replaceState({}, "", value === "pose" ? "/admin/asset-categories" : `/admin/asset-categories?type=${value}`); renderAll(); } },
        text, h("span.chip-note.num", `${data[value].length} 大类 · ${total(value)} 小类`))));
    const majors = data[type];
    replace(body, majors.length ? majors.map((major) => h("section.a-section.a-cat",
      h("div.a-cat-head",
        h("div", h("h2", major.zh), h("p.small.muted", [major.en, major.key, `${number(major.count)} 个素材`].filter(Boolean).join(" · "))),
        h("div.a-row-actions",
          h("button.btn.btn-sm", { type: "button", onclick: () => editCategory({ type, category: major, onDone: reload }) }, "编辑"),
          h("button.btn.btn-sm", { type: "button", onclick: () => editCategory({ type, parent: major, onDone: reload }) }, cicon("plus", "blue", 15), "添加小类"))),
      table([
        { label: "小类", render: (c) => h("div", h("strong", c.zh), c.en ? h("div.small.faint", c.en) : null) },
        { label: "标识", render: (c) => h("code", c.key) },
        { label: "分级", render: (c) => statusPill(RATINGS.find(([r]) => r === c.rating)[1], RATING_TONE[c.rating]) },
        { label: "AI 生成", render: (c) => (c.canGenerate ? statusPill("开放", "blue") : statusPill("关闭")) },
        { label: "素材", className: "num", render: (c) => number(c.count) },
        { label: "生成提示", render: (c) => h("span.a-detail.small.muted", { title: c.hint }, c.hint || "—") },
        { label: "", render: (c) => h("button.btn.btn-sm", { type: "button", onclick: () => editCategory({ type, category: { ...c, parentKey: major.key }, onDone: reload }) }, "编辑") }
      ], major.children, { empty: "还没有小类" })))
      : h("div.a-empty.muted", "还没有分类"));
  }

  await reload();
  return h("div",
    pageHead("素材分类", "姿势、服装、场景和物品按大类、小类整理。素材库筛选、上传和 AI 生成都用这棵分类树。", [
      h("a.btn", { href: "/admin/asset-settings" }, cicon("sliders", "gray"), "生成与分成设置"),
      h("button.btn.btn-primary", { type: "button", onclick: () => editCategory({ type, onDone: reload }) }, cicon("plus", "blue"), "添加大类")
    ]),
    h("div.a-tabs-row", tabs),
    body);
}

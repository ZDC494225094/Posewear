import { h, cicon, tile, replace } from "../core/dom.js";
import { api } from "../core/api.js";
import { store } from "../core/store.js";
import { modal, toast, toastError, busy } from "../core/ui.js";
import { selectMenu } from "../core/select.js";
import { number } from "../core/format.js";

// The "generate an asset" dialog, shared by 我的素材 and the admin library.
// Users pay per image; admin jobs are free and make platform assets.

let treeCache = null;
export function taxonomy({ fresh = false } = {}) {
  if (fresh) treeCache = null;
  if (!treeCache) treeCache = api.get("/api/library/taxonomy").catch((err) => { treeCache = null; throw err; });
  return treeCache;
}

// selectMenu options: 大类 as headings, 小类 as choices.
export function categoryOptions(tree, { generatable = false } = {}) {
  return tree.flatMap((major) => [
    { group: major.zh },
    ...major.children.map((c) => ({
      value: c.id, text: c.zh,
      note: generatable && !c.canGenerate ? "暂不开放" : c.count !== undefined ? number(c.count) : "",
      disabled: generatable && !c.canGenerate
    }))
  ]);
}

const PLACEHOLDER = {
  pose: "例如：双手叉腰，重心在左腿，头微微向右偏",
  outfit: "例如：正红色齐胸襦裙，金色披帛，盘发簪花"
};
const REF_HINT = {
  pose: "上传一张人物照片，按其中的姿势画成线稿模特",
  outfit: "上传一张服装照片，按素材规格重新渲染这套衣服"
};

// source: an existing pose to add camera angles to.
export async function openAssetGenerator({ admin = false, type = "pose", source = null, onCreated } = {}) {
  let tree;
  try { tree = await taxonomy(); } catch (err) { toastError(err); return; }
  const cfg = store.config.assets;
  const angles = tree.angles;
  const state = {
    type: source ? "pose" : type, categoryId: null, description: "", angle: angles[0].key, n: 1,
    file: null, consent: false, publish: true, license: "commercial",
    extraAngles: source ? angles.map((a) => a.key).filter((k) => !(source.groupAngles || []).includes(k)) : []
  };
  const unit = () => (admin ? 0 : state.type === "pose" ? cfg.poseCredits : cfg.outfitCredits);
  const count = () => (source ? state.extraAngles.length : state.n);

  const body = h("div.stack.agen");
  const costEl = h("p.agen-cost.small");
  const submit = h("button.btn.btn-primary", { type: "button", onclick: (e) => busy(e.currentTarget, send) },
    cicon("wand", "purple"), "开始生成");

  function firstOpen(list) {
    for (const major of list) for (const c of major.children) if (c.canGenerate) return c.id;
    return null;
  }

  function seg(name, options, value, onPick) {
    return h("div.seg", { role: "radiogroup", "aria-label": name },
      options.map((o) => h("button", { type: "button", role: "radio", "aria-checked": String(o.value === value),
        "aria-pressed": String(o.value === value), onclick: () => onPick(o.value) }, o.text)));
  }

  const field = (text, control, help) => h("div.field", h("span", text), control, help ? h("small", help) : null);

  function referenceField() {
    const input = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", hidden: true,
      onchange: () => { state.file = input.files[0] || null; render(); } });
    const preview = state.file ? h("img.agen-ref-img", { src: URL.createObjectURL(state.file), alt: "参考图预览" }) : tile("image", "blue");
    return field("参考图（选填）", h("div.agen-ref",
      preview,
      h("div.agen-ref-text",
        h("p.small", state.file ? state.file.name : REF_HINT[state.type]),
        h("div.agen-ref-actions",
          h("button.btn.btn-sm", { type: "button", onclick: () => input.click() }, cicon("upload", "blue", 15), state.file ? "换一张" : "选择图片"),
          state.file ? h("button.btn.btn-sm.btn-ghost", { type: "button", onclick: () => { state.file = null; state.consent = false; render(); } }, "移除") : null)),
      input),
    state.file ? null : admin ? "只上传你拥有版权或已获授权的图片。" : "用参考图生成的素材默认标记为非商用。");
  }

  function render() {
    if (source) {
      replace(body,
        h("div.agen-source", h("img", { src: source.thumb, alt: "" }),
          h("div", h("strong", source.name), h("p.small.muted", "从这张图出发，画出同一个姿势的其他角度。"))),
        field("要补全的角度", h("div.chips", { role: "group", "aria-label": "角度" }, angles.map((a) => {
          const has = (source.groupAngles || []).includes(a.key);
          const on = state.extraAngles.includes(a.key);
          return h("button.chip", { type: "button", disabled: has, "aria-pressed": String(on), onclick: () => {
            state.extraAngles = on ? state.extraAngles.filter((k) => k !== a.key) : [...state.extraAngles, a.key];
            render();
          } }, a.zh, has ? h("span.chip-note", "已有") : null);
        })), "每个角度单独生成一张。"));
      updateCost();
      return;
    }
    const list = tree[state.type];
    if (!state.categoryId || !list.some((m) => m.children.some((c) => c.id === state.categoryId))) state.categoryId = firstOpen(list);
    const description = h("textarea.textarea.input-filled", { rows: 3, maxLength: 300, value: state.description,
      placeholder: PLACEHOLDER[state.type], oninput: (e) => { state.description = e.target.value; } });
    replace(body,
      seg("素材类型", [{ value: "pose", text: "姿势" }, { value: "outfit", text: "服装" }], state.type,
        (v) => { if (v !== state.type) { state.type = v; state.categoryId = null; render(); } }),
      field("分类", selectMenu({ label: "分类", value: state.categoryId, filled: true, searchable: true,
        options: categoryOptions(list, { generatable: true }), onChange: (v) => { state.categoryId = v; } }).node,
        state.type === "pose" ? "线稿模特，900 × 1200，白底。" : "隐形模特展示的整套服装，1366 × 2048，浅灰背景。"),
      field("描述（选填）", description, "不写描述时，按分类随机设计。"),
      state.type === "pose" && !state.file ? field("拍摄角度", seg("拍摄角度", angles.map((a) => ({ value: a.key, text: a.zh })), state.angle,
        (v) => { state.angle = v; render(); }), "先生成一个角度，满意后可以补全其他角度。") : null,
      cfg.maxPerJob > 1 ? field("张数", seg("张数", Array.from({ length: cfg.maxPerJob }, (_, i) => ({ value: i + 1, text: `${i + 1} 张` })),
        state.n, (v) => { state.n = v; render(); }), "每张是一个独立的素材。") : null,
      referenceField(),
      state.file ? h("label.check.consent", h("input", { type: "checkbox", checked: state.consent,
        onchange: (e) => { state.consent = e.target.checked; updateCost(); } }),
        h("span", `我确认拥有这张图片的使用权；图中如有人物，已取得本人授权且其已年满 18 周岁。参考图只用于这次生成，${cfg.referenceRetentionDays} 天后自动删除。`)) : null,
      admin ? h("div.agen-admin",
        h("label.switch", h("input", { type: "checkbox", checked: state.publish, onchange: (e) => { state.publish = e.target.checked; } }),
          h("span.switch-ui", { "aria-hidden": "true" }), h("span.switch-text", "生成后直接上架")),
        selectMenu({ label: "授权", value: state.license, options: [["commercial", "可商用"], ["noncommercial", "非商用"]],
          onChange: (v) => { state.license = v; } }).node) : null);
    updateCost();
  }

  function updateCost() {
    const total = unit() * count();
    const balance = store.user?.credits ?? 0;
    costEl.replaceChildren(admin ? "平台生成不扣点数" : `消耗 ${number(total)} 点 · 余额 ${number(balance)} 点 · 失败自动退回`);
    submit.disabled = !count() || (!!state.file && !state.consent) || (!admin && total > balance) || (!source && !state.categoryId);
    if (!admin && total > balance) costEl.append(" · ", h("a.link", { href: "/pricing" }, "去充值"));
  }

  async function send() {
    const endpoint = admin ? "/api/admin/asset-jobs" : "/api/my/asset-jobs";
    try {
      let payload;
      if (source) payload = { sourceAssetId: source.id, angles: state.extraAngles };
      else {
        payload = { type: state.type, categoryId: state.categoryId, description: state.description.trim(), n: state.n,
          angle: state.type === "pose" ? state.angle : undefined };
        if (admin) Object.assign(payload, { publish: state.publish, license: state.license });
        if (state.file) {
          const form = new FormData();
          form.append("kind", "reference");
          form.append("consent", "true");
          form.append("file", state.file);
          payload.referenceUploadId = (await api.upload("/api/uploads", form)).upload.id;
        }
      }
      const { items } = await api.post(endpoint, payload);
      if (!admin) store.refreshUser();
      m.close();
      toast(`已开始生成 ${items.reduce((n, j) => n + j.n, 0)} 张，一般需要几十秒`, { type: "success" });
      onCreated?.(items);
    } catch (err) {
      if (err.code === "INSUFFICIENT_CREDITS") store.refreshUser();
      toastError(err);
    }
  }

  render();
  const m = modal({
    title: source ? "补全姿势角度" : admin ? "AI 生成平台素材" : "生成素材",
    content: body,
    footer: [costEl, h("button.btn", { type: "button", onclick: () => m.close() }, "取消"), submit]
  });
  m.el.classList.add("modal-agen");
  return m;
}

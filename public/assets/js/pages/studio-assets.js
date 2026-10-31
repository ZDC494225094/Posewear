import { h, tile, cicon, icon, replace } from "../core/dom.js";
import { api } from "../core/api.js";
import { store } from "../core/store.js";
import { toast, toastError, busy, lightbox } from "../core/ui.js";
import { label, number } from "../core/format.js";
import { taxonomy } from "../components/asset-generator.js";
import { assetJobList } from "../components/asset-jobs.js";
import { openMyAsset } from "../components/my-asset-detail.js";
import { studioTabs } from "./studio.js";

// 素材创作: many different assets in one go. Pick a type and a 大类, tick the
// 小类 to make, choose how to split each one (gender, season, time of day) and
// add rows of your own; every row becomes one new asset, so a batch never
// holds two of the same thing.

const TYPES = [["outfit", "服装", "shirt", "pink"], ["pose", "姿势", "pose", "purple"], ["scene", "场景", "mountain", "green"], ["item", "物品", "bag", "orange"]];
// [key, label, options]; "" means "don't split by this".
const SPLITS = {
  outfit: [["gender", "性别", [["female", "女款"], ["male", "男款"]]],
    ["season", "季节", [["", "不分季节"], ["spring-summer", "春夏"], ["autumn-winter", "秋冬"]]]],
  pose: [["gender", "性别", [["female", "女"], ["male", "男"]]]],
  scene: [["time", "时段", [["", "不限"], ["day", "白天"], ["dusk", "黄昏"], ["night", "夜晚"]]],
    ["season", "季节", [["", "不限"], ["spring", "春"], ["summer", "夏"], ["autumn", "秋"], ["winter", "冬"]]]],
  item: []
};
const SPEC_TEXT = {
  outfit: "每个素材是一套隐形模特展示的服装，1366 × 2048。",
  pose: "每个素材是一张线稿模特姿势，900 × 1200；满意后可以在素材详情里补全其他角度。",
  scene: "每个素材是一张没有人物的背景照片，1536 × 1024。",
  item: "每个素材是一件物品的产品图，1024 × 1024。"
};
const DETAIL_HINT = {
  outfit: "例如：交警制服，荧光背心", pose: "例如：单手扶墙回头看", scene: "例如：雨后的街道，地面有倒影", item: "例如：珍珠吊坠，细金链"
};

const cartesian = (lists) => lists.reduce((acc, list) => acc.flatMap((a) => list.map((b) => [...a, b])), [[]]);

export async function render(ctx) {
  const cfg = store.config.assets;
  const admin = store.user?.role === "admin";
  let tree;
  try { tree = await taxonomy(); } catch (err) { toastError(err); tree = null; }

  const state = {
    type: TYPES.some(([t]) => t === ctx.query.type) ? ctx.query.type : "outfit",
    majorId: null,
    minors: new Set(),
    splits: { gender: ["female"], season: [""], time: [""] },
    angle: "正面",
    note: "",
    custom: new Map(),   // minor id -> [detail, ...]
    removed: new Set(),  // keys of generated rows the user took out
    platform: admin,
    publish: true
  };
  const max = admin ? 60 : 20;

  const panel = h("div.panel-scroll");
  const actionEl = h("div.studio-action.stack");

  const majors = () => (tree?.[state.type] || []).filter((m) => m.children.some((c) => c.canGenerate));
  const major = () => majors().find((m) => m.id === state.majorId) || null;
  const chosenMinors = () => (major()?.children || []).filter((c) => state.minors.has(c.id) && c.canGenerate);

  function guessGender(text) {
    if (!SPLITS[state.type].some(([key]) => key === "gender")) return "";
    if (/男/.test(text) && !/女/.test(text)) return "male";
    if (/女/.test(text) && !/男/.test(text)) return "female";
    return state.splits.gender[0] || "female";
  }

  const valueText = (key, value) => SPLITS[state.type].find(([k]) => k === key)?.[2].find(([v]) => v === value)?.[1] || "";

  // Every asset the batch will make, in tree order.
  function rows() {
    const splits = SPLITS[state.type];
    const combos = cartesian(splits.map(([key]) => state.splits[key].map((value) => [key, value])));
    const out = [];
    for (const minor of chosenMinors()) {
      for (const combo of combos) {
        const fields = Object.fromEntries(combo);
        const key = `${minor.id}|${combo.map(([, value]) => value).join("|")}`;
        if (state.removed.has(key)) continue;
        const text = combo.map(([k, value]) => (value ? valueText(k, value) : "")).filter(Boolean).join(" · ");
        out.push({ key, minor, ...fields, detail: "", text: text || "默认" });
      }
      for (const detail of state.custom.get(minor.id) || []) {
        const gender = guessGender(detail);
        out.push({ key: `${minor.id}|custom|${detail}`, minor, gender, detail, custom: true,
          text: [gender && SPLITS[state.type].length ? valueText("gender", gender) : "", detail].filter(Boolean).join(" · ") });
      }
    }
    return out;
  }

  const sectionHead = (iconName, color, text, aside) => h("div.panel-sec-head", tile(iconName, color), text, aside || null);

  function seg(name, options, value, onPick) {
    return h("div.seg", { role: "radiogroup", "aria-label": name }, options.map(([v, text]) =>
      h("button", { type: "button", role: "radio", "aria-checked": String(v === value), "aria-pressed": String(v === value),
        onclick: () => onPick(v) }, text)));
  }

  // Multi-select chips; "" is exclusive ("not split by this").
  function splitChips(key, name, options) {
    const selected = state.splits[key];
    return h("div.chips", { role: "group", "aria-label": name }, options.map(([value, text]) =>
      h("button.chip", { type: "button", "aria-pressed": String(selected.includes(value)), onclick: () => {
        let next;
        if (value === "") next = [""];
        else if (selected.includes(value)) next = selected.filter((v) => v !== value);
        else next = [...selected.filter((v) => v !== ""), value];
        if (!next.length) next = options.some(([v]) => v === "") ? [""] : [options[0][0]];
        state.splits[key] = next;
        state.removed.clear();
        update();
      } }, text)));
  }

  function previewList(list) {
    if (!list.length) return h("p.small.muted", "先勾选要生成的小类。");
    const groups = new Map();
    for (const row of list) {
      if (!groups.has(row.minor.id)) groups.set(row.minor.id, { minor: row.minor, rows: [] });
      groups.get(row.minor.id).rows.push(row);
    }
    // Minors whose generated rows were all removed still show, so custom rows can be added.
    for (const minor of chosenMinors()) if (!groups.has(minor.id)) groups.set(minor.id, { minor, rows: [] });
    return h("div.batch-groups", [...groups.values()].map(({ minor, rows: items }) => {
      const input = h("input.input.input-filled", { placeholder: DETAIL_HINT[state.type], maxLength: 60, "aria-label": `${minor.zh}的自定义细分`,
        onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } } });
      function addCustom() {
        const text = input.value.trim();
        if (!text) return;
        const list = state.custom.get(minor.id) || [];
        if (list.includes(text)) { toast("这一行已经有了", { type: "error" }); return; }
        state.custom.set(minor.id, [...list, text]);
        update();
      }
      return h("section.batch-group",
        h("div.batch-group-head", h("strong", minor.zh), h("span.small.muted", `${items.length} 个`)),
        h("div.batch-rows", items.map((row) => h("span.batch-row", { class: row.custom ? "is-custom" : "" }, row.text,
          h("button", { type: "button", "aria-label": `删除「${row.text}」`, onclick: () => {
            if (row.custom) state.custom.set(minor.id, (state.custom.get(minor.id) || []).filter((d) => d !== row.detail));
            else state.removed.add(row.key);
            update();
          } }, "×")))),
        h("div.batch-add", input, h("button.btn.btn-sm", { type: "button", onclick: addCustom }, icon("plus", 14), "细分")));
    }));
  }

  function renderPanel() {
    if (!tree) { replace(panel, h("div.panel-title", studioTabs("assets")), h("p.muted", "分类加载失败，请刷新页面重试。")); return; }
    const list = majors();
    if (!list.some((m) => m.id === state.majorId)) { state.majorId = list[0]?.id ?? null; state.minors.clear(); }
    const current = major();
    const all = (current?.children || []).filter((c) => c.canGenerate);
    const batch = rows();
    replace(panel,
      h("div.panel-title", h("h1.sr-only", "素材创作"), studioTabs("assets")),
      h("p.small.muted", "一次生成多个不同的素材：选一个大类，勾选小类，再按性别、季节等细分。每一行生成一个素材，保存在「我的素材」里。"),
      h("section.panel-sec", sectionHead("layers", "blue", "素材类型"),
        h("div.seg", { role: "radiogroup", "aria-label": "素材类型" }, TYPES.map(([value, text, iconName, color]) =>
          h("button", { type: "button", role: "radio", "aria-checked": String(value === state.type), "aria-pressed": String(value === state.type),
            onclick: () => { if (value !== state.type) { Object.assign(state, { type: value, majorId: null }); state.minors.clear(); state.custom.clear(); state.removed.clear(); update(); } } },
            cicon(iconName, color, 15), text))),
        h("p.small.faint", SPEC_TEXT[state.type])),
      h("section.panel-sec", sectionHead("folder", "orange", "大类"),
        list.length ? h("div.chips", { role: "radiogroup", "aria-label": "大类" }, list.map((m) =>
          h("button.chip", { type: "button", role: "radio", "aria-checked": String(m.id === state.majorId), "aria-pressed": String(m.id === state.majorId),
            onclick: () => { if (m.id !== state.majorId) { state.majorId = m.id; state.minors.clear(); state.custom.clear(); state.removed.clear(); update(); } } }, m.zh)))
          : h("p.small.muted", "这个类型暂时没有开放生成的分类。")),
      current ? h("section.panel-sec", sectionHead("checkCircle", "green", "小类",
        h("span.aside", h("button.link.small", { type: "button", onclick: () => { all.forEach((c) => state.minors.add(c.id)); update(); } }, "全选"),
          " · ", h("button.link.small", { type: "button", onclick: () => { state.minors.clear(); update(); } }, "清空"))),
        h("div.chips", { role: "group", "aria-label": "小类" }, current.children.map((c) =>
          h("button.chip", { type: "button", disabled: !c.canGenerate, "aria-pressed": String(state.minors.has(c.id)),
            title: c.canGenerate ? "" : "暂不开放生成", onclick: () => {
              if (state.minors.has(c.id)) state.minors.delete(c.id); else state.minors.add(c.id);
              update();
            } }, state.minors.has(c.id) ? icon("check", 13) : null, c.zh)))) : null,
      SPLITS[state.type].length || state.type === "pose" ? h("section.panel-sec", sectionHead("sliders", "gray", "细分"),
        SPLITS[state.type].map(([key, name, options]) => h("div.batch-split", h("span.batch-split-label", name), splitChips(key, name, options))),
        state.type === "pose" ? h("div.batch-split", h("span.batch-split-label", "角度"),
          seg("角度", tree.angles.map((a) => [a.key, a.zh]), state.angle, (v) => { state.angle = v; update(); })) : null,
        h("p.small.faint", "选了几个就按几种细分，每个小类各生成一份。")) : null,
      h("section.panel-sec", sectionHead("text", "gray", "统一描述（选填）"),
        h("input.input.input-filled", { value: state.note, maxLength: 120, placeholder: "所有素材都会带上，比如：配色以藏青和白色为主",
          oninput: (e) => { state.note = e.target.value; } })),
      h("section.panel-sec", sectionHead("list", "indigo", "将要生成", h("span.aside.num", `${batch.length} 个素材`)),
        previewList(batch)),
      admin ? h("section.panel-sec.batch-admin",
        h("label.switch", h("input", { type: "checkbox", checked: state.platform, onchange: (e) => { state.platform = e.target.checked; update(); } }),
          h("span.switch-ui", { "aria-hidden": "true" }), h("span.switch-text", "生成为平台素材（免费，可商用）")),
        state.platform ? h("label.switch", h("input", { type: "checkbox", checked: state.publish, onchange: (e) => { state.publish = e.target.checked; } }),
          h("span.switch-ui", { "aria-hidden": "true" }), h("span.switch-text", "生成后直接上架")) : null) : null);
    renderAction(batch);
  }

  function renderAction(batch) {
    const user = store.user;
    const unit = admin && state.platform ? 0 : cfg[`${state.type}Credits`] ?? 0;
    const total = unit * batch.length;
    let button, reason = "";
    if (!admin && !cfg.generation) reason = "素材生成暂未开放";
    else if (!batch.length) reason = "勾选小类后才能开始";
    else if (batch.length > max) reason = `一次最多生成 ${max} 个，请减少小类或细分`;
    if (!user) {
      button = h("a.btn.btn-primary.btn-block.btn-generate", { href: "/login?next=%2Fstudio%2Fassets" }, icon("sparkle", 19), "登录后生成");
    } else if (!reason && user.credits < total) {
      button = h("a.btn.btn-primary.btn-block.btn-generate", { href: "/pricing" }, cicon("gem", "orange", 19), `点数不足（需 ${number(total)} 点），去充值`);
    } else {
      button = h("button.btn.btn-primary.btn-block.btn-generate", { type: "button", disabled: !!reason,
        onclick: (e) => busy(e.currentTarget, () => start(batch)) }, cicon("wand", "purple", 19),
        batch.length ? `生成 ${batch.length} 个素材${total ? ` · ${number(total)} 点` : ""}` : "开始生成");
    }
    replace(actionEl, button,
      reason ? h("p.action-reason", { role: "status" }, reason)
        : h("p.action-balance", unit ? `每个 ${unit} 点 · 余额 ${number(user?.credits ?? 0)} 点 · 失败自动退回` : "平台素材免费生成"));
  }

  async function start(batch) {
    const description = (row) => [state.note.trim(), row.detail].filter(Boolean).join("，");
    const body = {
      type: state.type, publish: state.publish,
      items: batch.map((row) => ({ categoryId: row.minor.id, gender: row.gender || undefined, season: row.season || undefined,
        time: row.time || undefined, angle: state.type === "pose" ? state.angle : undefined, description: description(row) }))
    };
    try {
      const { items } = await api.post(admin && state.platform ? "/api/admin/asset-jobs/batch" : "/api/my/asset-jobs/batch", body);
      jobs.add(items);
      store.refreshUser();
      toast(`已开始生成 ${items.length} 个素材，完成后出现在右侧`, { type: "success" });
      state.minors.clear();
      state.custom.clear();
      state.removed.clear();
      update();
    } catch (err) {
      if (err.code === "INSUFFICIENT_CREDITS") store.refreshUser();
      toastError(err);
    }
  }

  function update() { renderPanel(); }

  function openAsset(a) {
    if (a.owner) { openMyAsset(a, { onChanged: () => jobs.load(), onCreated: (items) => jobs.add(items) }); return; }
    lightbox([{ src: a.preview, zoomSrc: `/media/library/${encodeURIComponent(a.id)}/original`, alt: label(a.name) }], 0, {
      renderAside: () => h("div.viewer-aside",
        h("p.viewer-code.num", a.id),
        h("h2.viewer-title", label(a.name)),
        h("div.pills", h("span.pill", label(a.series)), h("span.pill", label(a.category)), h("span.pill.pill-mat", "平台素材")),
        h("p.small.muted", a.enabled ? "已上架，用户可以在素材库里看到。" : "还没有上架，可以在后台素材库里上架。"),
        h("div.viewer-actions", h("a.btn.btn-block", { href: "/admin/assets", "data-native": "" }, cicon("hanger", "teal"), "到后台素材库管理")))
    });
  }

  const jobs = assetJobList({
    endpoint: "/api/my/asset-jobs", size: 24, emptyText: "生成的素材会出现在这里",
    onFinished: (job) => {
      if (job.status === "failed") toast(job.errorMessage || "生成失败，点数已退回", { type: "error" });
      store.refreshUser();
    },
    onOpenAsset: openAsset
  });
  if (store.user) jobs.load();

  const unsubscribe = store.subscribe(() => renderAction(rows()));
  update();

  return {
    node: h("div.studio.studio-assets.ambient",
      h("div.studio-shell",
        h("aside.studio-panel.glass", { "aria-label": "素材创作设置" }, panel, h("div.panel-foot", actionEl)),
        h("section.studio-canvas", { "aria-label": "素材生成记录" },
          h("div.canvas-head", h("h2", "素材生成记录"),
            h("div.canvas-tools", h("a.link.link-arrow", { href: "/my-assets" }, "我的素材"), h("a.link.link-arrow", { href: "/my-assets/jobs" }, "全部记录"))),
          store.user ? jobs.node : h("div.feed-empty", tile("wand", "purple", "lg"), h("h3", "登录后开始素材创作"),
            h("a.btn.btn-primary", { href: "/login?next=%2Fstudio%2Fassets" }, "登录"))))),
    cleanup() { unsubscribe(); jobs.stop(); }
  };
}

import { h, replace, cicon, icon } from "../../core/dom.js";
import { api } from "../../core/api.js";
import { toast, toastError, busy, confirmDialog, lightbox } from "../../core/ui.js";
import { pageHead, section, form, drawer, statusPill } from "../kit.js";

// 婚纱场景: the locations couples pick per look. Each scene has a prompt, an
// empty location plate (a scene asset) and sample photos with a virtual couple.

const ORDER = ["studio", "outdoor", "chinese"];
const PLATE_TEXT = { queued: "底图排队中", running: "底图生成中", failed: "底图生成失败" };
const busyScene = (s) => ["queued", "running"].includes(s.plateJob) || s.samplesActive > 0;

export async function render() {
  let scenes = [];
  let options;
  let timer = null;
  let stopped = false;
  let openEditor = null; // { id, redraw } while a drawer is open
  const body = h("div");

  async function load() {
    const data = await api.get("/api/admin/wedding/scenes");
    scenes = data.items;
    options = data.options;
  }
  try { await load(); } catch (err) { toastError(err); return h("div.a-empty", "暂时无法读取场景"); }

  function cover(scene) {
    const src = scene.samples[0]?.thumb || scene.plate?.thumb;
    return src ? h("img", { src, alt: "", loading: "lazy" }) : h("span.a-wd-cover-empty", icon("camera", 26));
  }

  function card(scene) {
    const plate = scene.plate ? null : PLATE_TEXT[scene.plateJob] || "缺底图";
    return h(`button.a-wd-scene${scene.enabled ? "" : ".is-off"}`, { type: "button", onclick: () => edit(scene.id) },
      h("div.a-wd-cover", cover(scene), busyScene(scene) ? h("span.a-wd-busy", h("span.spinner"), "生成中") : null),
      h("div.a-wd-body",
        h("strong", scene.name),
        h("span.small.faint", scene.description || "未填写介绍"),
        h("div.a-asset-tags",
          scene.enabled ? statusPill("已上线", "green") : statusPill("已下线"),
          plate ? statusPill(plate, scene.plateJob === "failed" ? "red" : "orange") : null,
          statusPill(`示例 ${scene.samples.length}`, scene.samples.length ? "" : "orange"))));
  }

  function draw() {
    const missing = scenes.filter((s) => s.enabled && (!s.plate || s.samples.length < 2)).length;
    replace(body,
      missing ? h("p.a-callout.small", `${missing} 个已上线的场景缺少底图或示例照片。用户选场景时只能看到文字介绍，建议点「补齐示例」一次生成。`) : null,
      ORDER.map((cat) => {
        const list = scenes.filter((s) => s.category === cat);
        return section(`${options.categories[cat]} · ${list.length}`, null,
          list.length ? h("div.a-wd-grid", list.map(card)) : h("p.small.muted", "这个分类还没有场景"));
      }));
    openEditor?.redraw();
    schedule();
  }

  function schedule() {
    clearTimeout(timer);
    if (stopped || !scenes.some(busyScene)) return;
    timer = setTimeout(async () => { try { await load(); draw(); } catch { schedule(); } }, 5000);
  }

  async function reload() { try { await load(); draw(); } catch (err) { toastError(err); } }

  const select = (list) => list.map((o) => [o.key, o.name]);
  function fields(isNew) {
    return [
      { key: "name", label: "场景名称", max: 20, placeholder: "如 海边日落" },
      isNew ? { key: "key", label: "标识（选填）", max: 40, placeholder: "beach-sunset", help: "小写字母、数字和 -，留空自动生成。" } : { key: "key", label: "标识", type: "readonly" },
      { key: "category", label: "分类", type: "select", options: ORDER.map((k) => [k, options.categories[k]]) },
      { key: "sort", label: "排序", type: "number", step: 1, help: "数字小的排在前面。" },
      { key: "enabled", label: "对用户上线", type: "switch", help: "下线后用户看不到，已拍的相册不受影响。" },
      { key: "description", label: "一句话介绍", type: "textarea", rows: 2, wide: true, help: "用户选场景时看到，最多 80 字。" },
      { key: "prompt", label: "场景描述（英文）", type: "textarea", rows: 4, wide: true, help: "用于生成底图；没有底图时直接写进成片提示词。" },
      { key: "light", label: "光线与色调（英文）", type: "textarea", rows: 3, wide: true },
      { heading: "推荐造型（用户可改）" },
      { key: "brideOutfit", label: "新娘礼服", type: "select", options: select(options.outfits.bride) },
      { key: "groomOutfit", label: "新郎礼服", type: "select", options: select(options.outfits.groom) },
      { key: "hair", label: "发型", type: "select", options: select(options.styling.hair) },
      { key: "headpiece", label: "头饰", type: "select", options: select(options.styling.headpiece) },
      { key: "makeup", label: "妆容", type: "select", options: select(options.styling.makeup) }
    ];
  }
  const formValue = (s) => ({ name: s.name, key: s.key, category: s.category, sort: s.sort, enabled: s.enabled, description: s.description,
    prompt: s.prompt, light: s.light, brideOutfit: s.recommend.bride, groomOutfit: s.recommend.groom,
    hair: s.recommend.hair, headpiece: s.recommend.headpiece, makeup: s.recommend.makeup });

  function media(scene) {
    const plateBox = scene.plate
      ? h("button.a-wd-plate", { type: "button", "aria-label": "查看底图", onclick: () => lightbox([{ src: scene.plate.preview, alt: scene.name }]) },
        h("img", { src: scene.plate.thumb, alt: `${scene.name}底图` }))
      : h("div.a-wd-plate.is-empty", ["queued", "running"].includes(scene.plateJob) ? [h("span.spinner"), PLATE_TEXT[scene.plateJob]] : (PLATE_TEXT[scene.plateJob] || "还没有底图"));
    const samples = h("div.a-wd-samples",
      scene.samples.map((s, i) => h("div.a-wd-sample",
        h("button", { type: "button", "aria-label": "查看示例", onclick: () => lightbox(scene.samples.map((x) => ({ src: x.url, alt: scene.name })), i) },
          h("img", { src: s.thumb, alt: `示例 ${i + 1}`, loading: "lazy" })),
        h("button.a-wd-sample-del", { type: "button", "aria-label": "删除这张示例", title: "删除", onclick: async () => {
          if (!(await confirmDialog({ title: "删除示例", message: "删除后用户不再看到这张示例。", confirmText: "删除", danger: true }))) return;
          try { await api.del(`/api/admin/wedding/samples/${s.id}`); toast("已删除"); reload(); } catch (err) { toastError(err); }
        } }, "×"))),
      scene.samplesActive ? h("div.a-wd-sample.is-wait", h("span.spinner"), h("span.small", `${scene.samplesActive} 张生成中`)) : null);
    if (!scene.samples.length && !scene.samplesActive) samples.append(h("p.small.muted", "还没有示例照片"));
    return h("div.a-wd-media",
      h("div",
        h("div.a-wd-media-head", h("strong", "场景底图"),
          h("button.btn.btn-sm", { type: "button", disabled: ["queued", "running"].includes(scene.plateJob), onclick: (e) => busy(e.currentTarget, async () => {
            if (scene.plate && !(await confirmDialog({ title: "重新生成底图", message: "会按当前的场景描述生成一张新底图并替换现在的。先保存修改过的描述再生成。", confirmText: "重新生成" }))) return;
            try { await api.post(`/api/admin/wedding/scenes/${scene.id}/plate`); toast("已开始生成底图"); reload(); } catch (err) { toastError(err); }
          }) }, cicon("sparkle", "purple", 15), scene.plate ? "重新生成" : "生成底图")),
        plateBox,
        h("p.small.faint", "没有人物的空场景，生成成片时作为场景参考图。")),
      h("div",
        h("div.a-wd-media-head", h("strong", `示例照片 · ${scene.samples.length}`),
          h("button.btn.btn-sm", { type: "button", onclick: (e) => busy(e.currentTarget, async () => {
            try { const res = await api.post(`/api/admin/wedding/scenes/${scene.id}/samples`, { count: 2 }); toast(`已开始生成 ${res.ids.length} 张示例`); reload(); } catch (err) { toastError(err); }
          }) }, cicon("plus", "pink", 15), "生成 2 张")),
        samples,
        h("p.small.faint", "由虚拟新人按推荐造型拍摄，用户选场景时会看到。")));
  }

  function edit(id) {
    const isNew = id == null;
    const scene = isNew ? null : scenes.find((s) => s.id === id);
    const initial = isNew
      ? { name: "", key: "", category: "studio", sort: "", enabled: true, description: "", prompt: "", light: "",
        brideOutfit: options.outfits.bride[0]?.key, groomOutfit: options.outfits.groom[0]?.key, hair: "low-bun", headpiece: "veil", makeup: "natural" }
      : formValue(scene);
    const f = form(fields(isNew), initial);
    const mediaBox = h("div");
    const m = drawer(isNew ? "新建场景" : scene.name, h("div.stack",
      isNew ? h("p.small.muted", "保存后可以生成底图和示例照片。") : mediaBox,
      f.node,
      h("div.a-form-actions",
        isNew ? null : h("button.btn.btn-danger", { type: "button", style: { marginRight: "auto" }, onclick: (e) => busy(e.currentTarget, async () => {
          if (!(await confirmDialog({ title: "删除场景", message: `删除「${scene.name}」？已用过这个场景的相册不能删，可以改为下线。`, confirmText: "删除", danger: true }))) return;
          try { await api.del(`/api/admin/wedding/scenes/${scene.id}`); m.close(); toast("已删除"); reload(); } catch (err) { toastError(err); }
        }) }, "删除"),
        h("button.btn", { type: "button", onclick: () => m.close() }, "取消"),
        h("button.btn.btn-primary", { type: "button", onclick: (e) => busy(e.currentTarget, async () => {
          const value = { ...f.value };
          if (value.sort === "") delete value.sort;
          if (!isNew) delete value.key;
          try {
            const res = isNew ? await api.post("/api/admin/wedding/scenes", value) : await api.put(`/api/admin/wedding/scenes/${scene.id}`, value);
            toast("已保存", { type: "success" });
            m.close();
            await reload();
            if (isNew) edit(res.scene.id);
          } catch (err) { toastError(err); }
        }) }, isNew ? "创建" : "保存"))), { width: 720, onClose: () => { if (openEditor?.id === id) openEditor = null; } });
    if (!isNew) {
      openEditor = { id, redraw: () => { const s = scenes.find((x) => x.id === id); if (s) replace(mediaBox, media(s)); } };
      openEditor.redraw();
    }
  }

  async function seed(button) {
    await busy(button, async () => {
      let plan;
      try { plan = await api.get("/api/admin/wedding/seed"); } catch (err) { toastError(err); return; }
      const total = plan.plates + plan.samples + plan.outfits;
      if (!total) { toast("所有已上线的场景都有底图和示例，礼服分类也都有图了"); return; }
      const ok = await confirmDialog({ title: "补齐示例",
        message: `将生成 ${plan.plates} 张场景底图、${plan.samples} 张示例照片、${plan.outfits} 张礼服素材，共 ${total} 张，预计模型费用约 $${plan.estimatedUsd}。生成在后台进行，可以离开这个页面。`,
        confirmText: `生成 ${total} 张` });
      if (!ok) return;
      try { await api.post("/api/admin/wedding/seed"); toast("已开始生成，完成后会出现在这里", { type: "success" }); reload(); } catch (err) { toastError(err); }
    });
  }

  draw();
  return {
    node: h("div",
      pageHead("婚纱场景", "用户每套造型选一个场景。底图让场景更稳定，示例照片帮用户挑选。", [
        h("a.btn", { href: "/admin/wedding-settings" }, cicon("sliders", "gray"), "套系与提示词"),
        h("button.btn", { type: "button", onclick: (e) => seed(e.currentTarget) }, cicon("sparkle", "purple"), "补齐示例"),
        h("button.btn.btn-primary", { type: "button", onclick: () => edit(null) }, cicon("plus", "pink"), "新建场景")
      ]),
      body),
    cleanup() { stopped = true; clearTimeout(timer); }
  };
}

import { h, icon, tile, cicon, replace } from "../core/dom.js";
import { api } from "../core/api.js";
import { store, draft } from "../core/store.js";
import { modal, toast, toastError, busy, confirmDialog } from "../core/ui.js";
import { label, number } from "../core/format.js";
import { navigate } from "../core/nav.js";
import { libraryBrowser, usableNote, assetFee } from "../components/library-browser.js";
import { genCard, jobWatcher, cardSizeSwitch } from "../components/gen-card.js";
import { openBoardDialog } from "../components/board.js";

const RATIO_SHAPES = { "2:3": [2, 3], "3:4": [3, 4], "1:1": [1, 1], "4:3": [4, 3], "3:2": [3, 2], "9:16": [9, 16], "16:9": [16, 9] };
const PICKER_TITLE = { pose: "选择姿势", outfit: "选择服装", scene: "选择场景", item: "选择物品" };

function ratioShape(ratio) {
  const [w, hh] = RATIO_SHAPES[ratio] || [1, 1];
  const scale = 16 / Math.max(w, hh);
  return h("span.ratio-shape", { "aria-hidden": "true", style: { width: `${Math.round(w * scale)}px`, height: `${Math.round(hh * scale)}px` } });
}

// The person in the studio: { source: "upload" | "image", id, url, virtual }.
// Older drafts stored the upload itself.
function normalizePerson(p) {
  if (!p?.id) return null;
  if (p.source === "image") return { source: "image", id: p.id, url: p.url, virtual: !!p.virtual };
  return { source: "upload", id: p.id, url: p.url?.endsWith("/thumb") ? p.url : p.thumb || p.url,
    virtual: p.virtual === true || p.virtual === "approved" };
}
const personFromUpload = (u) => ({ source: "upload", id: u.id, url: u.thumb || u.url, virtual: u.virtual === "approved" });

export async function render(ctx) {
  const cfg = store.config.generation;
  const maxItems = cfg.maxItems || 3;
  const saved = draft.read();
  const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
  const state = {
    pose: saved.pose || null,
    outfit: saved.outfit || null,
    outfitUpload: saved.outfitUpload || null,
    person: normalizePerson(saved.person),
    sceneAsset: saved.sceneAsset || null,
    items: Array.isArray(saved.items) ? saved.items.slice(0, maxItems) : [],
    ratio: pick(saved.ratio, cfg.ratios, cfg.defaultRatio),
    tier: pick(saved.tier, cfg.tiers.map((t) => t.id), cfg.defaultTier),
    quality: pick(saved.quality, cfg.qualities.map((q) => q.id), cfg.defaultQuality),
    n: Math.min(cfg.maxN, Math.max(1, Number(saved.n) || 1)),
    style: pick(saved.style, ["", ...cfg.styles.map((s) => s.id)], ""),
    scene: pick(saved.scene, ["", ...cfg.scenes.map((s) => s.id)], ""),
    prompt: typeof saved.prompt === "string" ? saved.prompt : ""
  };
  // Uploads and works belong to whoever made them; drop them if the session changed.
  if (!store.user) { state.person = null; state.outfitUpload = null; }

  // Links like /studio?pose=ID&outfit=ID&sceneId=ID&items=A,B&style=photo prefill the selection.
  const fetchAsset = async (id) => (await api.get(`/api/library/assets/${encodeURIComponent(id)}`)).asset;
  const q = ctx.query;
  try {
    if (q.pose) state.pose = await fetchAsset(q.pose);
    if (q.outfit) { state.outfit = await fetchAsset(q.outfit); state.outfitUpload = null; }
    if (q.sceneId) { state.sceneAsset = await fetchAsset(q.sceneId); state.scene = ""; }
    if (q.items) state.items = await Promise.all(q.items.split(",").filter(Boolean).slice(0, maxItems).map(fetchAsset));
  } catch { toast("链接中的部分素材已下架", { type: "error" }); }
  if (q.style && cfg.styles.some((s) => s.id === q.style)) state.style = q.style;
  if (q.scene && cfg.scenes.some((s) => s.id === q.scene) && !state.sceneAsset) state.scene = q.scene;
  if (q.pose || q.outfit || q.sceneId || q.items || q.style || q.scene) history.replaceState({}, "", "/studio");

  const save = () => draft.write(state);
  // A real person's photo limits what it can be combined with; a virtual person doesn't.
  const realPerson = () => !!state.person && !state.person.virtual;

  // ---------- reference tiles

  const refsEl = h("div.ref-grid");
  const ruleEl = h("p.ref-rule");

  function toolButton(iconName, color, text, onclick) {
    return h("button.btn", { type: "button", title: text, "aria-label": text, onclick }, cicon(iconName, color, 14));
  }

  function ref({ key, title, optional, iconName, color, filled, image, code, note, fee, emptyText, onPick, tools }) {
    return h("div.ref", { class: `is-${key}` },
      h("div.ref-label", title, code ? h("span.code.num", code) : optional ? h("span.code", "可选") : null),
      h("button.ref-frame", { type: "button", onclick: onPick, "aria-label": filled ? `更换${title}` : emptyText },
        filled ? h("img", { src: image, alt: title, decoding: "async" })
          : h("div.ref-empty", tile(iconName, color), h("span", emptyText))),
      note ? h("p.ref-note", note) : fee ? h("p.ref-fee", `使用费 ${fee} 点`) : null,
      h("div.ref-tools", tools.filter(Boolean)));
  }

  const noteFor = (asset) => (asset ? usableNote(asset, realPerson()) : "");

  // Up to maxItems small thumbnails, each removable, plus an add button.
  function itemsRef() {
    const notes = state.items.map(noteFor).filter(Boolean);
    const fee = state.items.reduce((sum, a) => sum + assetFee(a), 0);
    const frame = state.items.length
      ? h("div.ref-frame.ref-items",
        state.items.map((a) => h("div.ref-item", { class: noteFor(a) ? "is-bad" : "", title: label(a.name) },
          h("img", { src: a.thumb, alt: label(a.name), decoding: "async" }),
          h("button.ref-item-del", { type: "button", "aria-label": `移除${label(a.name)}`, onclick: () => {
            state.items = state.items.filter((x) => x.id !== a.id);
            update();
          } }, "×"))),
        state.items.length < maxItems ? h("button.ref-item-add", { type: "button", "aria-label": "添加物品", onclick: () => openPicker("item") }, icon("plus", 18)) : null)
      : h("button.ref-frame", { type: "button", onclick: () => openPicker("item"), "aria-label": "选择物品" },
        h("div.ref-empty", tile("bag", "orange"), h("span", "选择物品")));
    return h("div.ref.is-item",
      h("div.ref-label", "物品", h("span.code.num", state.items.length ? `${state.items.length}/${maxItems}` : "可选")),
      frame,
      notes.length ? h("p.ref-note", `有物品${notes[0]}`) : fee ? h("p.ref-fee", `使用费 ${fee} 点`) : null,
      h("div.ref-tools",
        state.items.length < maxItems ? toolButton("shuffle", "purple", "随机加一件物品", (e) => busy(e.currentTarget, () => randomize("item"))) : null,
        state.items.length ? toolButton("close", "gray", "清空物品", () => { state.items = []; update(); }) : null));
  }

  function renderRefs() {
    const real = realPerson();
    const poseNote = state.pose ? noteFor(state.pose) || (real && state.pose.people > 1 ? "双人姿势不能搭配真人照片" : "") : "";
    replace(refsEl,
      ref({
        key: "pose", title: "姿势", iconName: "pose", color: "purple", filled: !!state.pose,
        image: state.pose?.preview, code: state.pose?.code, note: poseNote, fee: assetFee(state.pose), emptyText: "选择姿势",
        onPick: () => openPicker("pose"),
        tools: [
          toolButton("shuffle", "purple", "随机姿势", (e) => busy(e.currentTarget, () => randomize("pose"))),
          state.pose ? toolButton("close", "gray", "移除姿势", () => { state.pose = null; update(); }) : null
        ]
      }),
      ref({
        key: "outfit", title: "服装", iconName: "shirt", color: "pink", filled: !!(state.outfit || state.outfitUpload),
        image: state.outfit?.preview || state.outfitUpload?.url, code: state.outfit?.id || (state.outfitUpload ? "上传" : ""),
        note: noteFor(state.outfit), fee: assetFee(state.outfit), emptyText: "选择服装", onPick: () => openPicker("outfit"),
        tools: [
          toolButton("shuffle", "purple", "随机服装", (e) => busy(e.currentTarget, () => randomize("outfit"))),
          cfg.allowOutfitUpload ? toolButton("upload", "blue", "上传服装图", (e) => uploadOutfit(e.currentTarget)) : null,
          state.outfit || state.outfitUpload ? toolButton("close", "gray", "移除服装", () => { state.outfit = null; state.outfitUpload = null; update(); }) : null
        ]
      }),
      ref({
        key: "person", title: "人物", optional: !state.person, iconName: "person", color: "green", filled: !!state.person,
        image: state.person?.url, code: state.person ? (state.person.virtual ? "虚拟人" : "真人") : "",
        emptyText: "选择人物", onPick: () => openPersonDialog(),
        tools: [
          toolButton("photos", "blue", "选择人物", () => openPersonDialog()),
          state.person ? toolButton("close", "gray", "移除人物", () => { state.person = null; update(); }) : null
        ]
      }),
      ref({
        key: "scene", title: "场景", optional: true, iconName: "mountain", color: "green", filled: !!state.sceneAsset,
        image: state.sceneAsset?.thumb, note: noteFor(state.sceneAsset), fee: assetFee(state.sceneAsset), emptyText: "选择场景",
        onPick: () => openPicker("scene"),
        tools: [
          toolButton("shuffle", "purple", "随机场景", (e) => busy(e.currentTarget, () => randomize("scene"))),
          state.sceneAsset ? toolButton("close", "gray", "移除场景", () => { state.sceneAsset = null; update(); }) : null
        ]
      }),
      itemsRef());
    ruleEl.textContent = !state.person
      ? "每一项都可以不选；都不选时，用文字描述也能生成。"
      : real ? "已添加真人照片：只能搭配普通级素材，作品仅自己可见。"
        : "已添加虚拟人：可以搭配任意姿势、服装、场景和物品，作品可以公开。";
  }

  function setAsset(type, asset) {
    if (type === "pose") state.pose = asset;
    else if (type === "outfit") { state.outfit = asset; state.outfitUpload = null; }
    else if (type === "scene") { state.sceneAsset = asset; state.scene = ""; }
    else if (state.items.some((a) => a.id === asset.id)) toast("这件物品已经选了", { type: "error" });
    else if (state.items.length >= maxItems) toast(`最多选择 ${maxItems} 件物品`, { type: "error" });
    else state.items = [...state.items, asset];
  }

  async function randomize(type) {
    try {
      const exclude = type === "pose" ? state.pose?.groupKey : type === "outfit" ? state.outfit?.id
        : type === "scene" ? state.sceneAsset?.id : state.items.at(-1)?.id;
      const { item } = await api.get("/api/library/random", { type, forAI: 1, withPerson: realPerson() ? 1 : 0, exclude });
      if (!item) { toast("没有可用的素材", { type: "error" }); return; }
      setAsset(type, item);
      update();
    } catch (err) { toastError(err); }
  }

  function openPicker(type) {
    let m;
    const browser = libraryBrowser({
      type, mode: "picker", withPerson: realPerson(),
      onSelect(asset) {
        setAsset(type, asset);
        m.close();
        update();
      }
    });
    m = modal({ title: PICKER_TITLE[type], wide: true, content: browser.node });
    m.el.classList.add("modal-picker");
  }

  const fileInput = (accept) => h("input", { type: "file", accept, hidden: true });

  function requireLogin() {
    if (store.user) return true;
    navigate(`/login?next=${encodeURIComponent("/studio")}`);
    return false;
  }

  function uploadOutfit(button) {
    if (!requireLogin()) return;
    const input = fileInput("image/png,image/jpeg,image/webp");
    input.onchange = () => {
      const file = input.files[0];
      if (!file) return;
      busy(button, async () => {
        const form = new FormData();
        form.append("kind", "outfit");
        form.append("file", file);
        try {
          const { upload } = await api.upload("/api/uploads", form);
          state.outfitUpload = upload;
          state.outfit = null;
          update();
        } catch (err) { toastError(err); }
      });
    };
    input.click();
  }

  // ---------- person: upload a photo, reuse an earlier one, or take an image from a work

  function openPersonDialog() {
    if (!requireLogin()) return;
    let tab = cfg.allowPersonPhoto ? "upload" : "works";
    const body = h("div.person-body");
    const tabs = h("div.seg.person-tabs", { role: "tablist", "aria-label": "人物来源" });
    const m = modal({
      title: "选择人物", wide: true,
      content: h("div.stack", tabs, body),
      footer: [h("button.btn", { type: "button", onclick: () => m.close() }, "关闭")]
    });
    m.el.classList.add("modal-person");

    function choose(person) {
      state.person = person;
      m.close();
      afterPersonChange();
    }

    function renderTabs() {
      const list = [cfg.allowPersonPhoto ? ["upload", "上传照片"] : null, cfg.allowPersonPhoto ? ["photos", "我的照片"] : null, ["works", "我的作品"]].filter(Boolean);
      replace(tabs, list.map(([value, text]) => h("button", { type: "button", role: "tab", "aria-selected": String(tab === value),
        "aria-pressed": String(tab === value), onclick: () => { tab = value; renderTabs(); show(); } }, text)));
    }

    function uploadTab() {
      let kind = "real";
      const box = h("div.stack");
      const draw = () => {
        const check = h("input", { type: "checkbox" });
        const uploadBtn = h("button.btn.btn-primary", { type: "button", disabled: true }, cicon("upload", "blue"), "选择图片上传");
        check.onchange = () => { uploadBtn.disabled = !check.checked; };
        const input = fileInput("image/png,image/jpeg,image/webp");
        uploadBtn.onclick = () => input.click();
        input.onchange = () => {
          const file = input.files[0];
          if (!file) return;
          busy(uploadBtn, async () => {
            const form = new FormData();
            form.append("kind", "person");
            if (kind === "real") form.append("consent", "true");
            else { form.append("virtual", "true"); form.append("declare", "true"); }
            form.append("file", file);
            try {
              const { upload } = await api.upload("/api/uploads", form);
              if (kind === "real" || upload.virtual === "approved") { choose(personFromUpload(upload)); return; }
              toast("已提交虚拟人审核，通过后就能在「我的照片」里使用", { type: "success", timeout: 6000 });
              tab = "photos";
              renderTabs();
              show();
            } catch (err) { toastError(err); }
          });
        };
        replace(box,
          h("div.seg.person-kind", { role: "radiogroup", "aria-label": "照片类型" }, [["real", "真人照片"], ["virtual", "虚拟人形象"]].map(([value, text]) =>
            h("button", { type: "button", role: "radio", "aria-checked": String(kind === value), "aria-pressed": String(kind === value),
              onclick: () => { kind = value; draw(); } }, text))),
          kind === "real"
            ? h("ul.person-tips",
              h("li", tile("lock", "blue"), "照片只用于你发起的生成任务，并发送给图像模型服务商处理。"),
              h("li", tile("clock", "orange"), `照片会在 ${cfg.personRetentionDays} 天后自动删除，也可以随时手动删除。`),
              h("li", tile("shield", "green"), "使用真人照片时，只能搭配普通级的素材，作品不能公开发布。"))
            : h("ul.person-tips",
              h("li", tile("sparkle", "purple"), "虚拟人是 AI 生成或原创的角色形象，不是真实存在的人。"),
              h("li", tile("shield", "green"), "提交后由管理员审核，通过后可以搭配任意姿势和服装，作品可以公开。"),
              h("li", tile("clock", "orange"), `审核通过后照片会一直保留；未通过的照片 ${cfg.personRetentionDays} 天后自动删除。`)),
          h("label.check.consent", check, h("span", kind === "real"
            ? "我确认照片中是我本人，或我已取得照片中人物的明确授权，且该人物已年满 18 周岁。我不会用它制作色情、侮辱或冒充他人的内容。"
            : "我确认图中的人物不是任何真实存在的人，也不是真人照片或肖像改绘；人物形象为成年人。如发现冒用真人，平台可删除图片和相关作品。")),
          h("div.person-actions", uploadBtn, input));
      };
      draw();
      return box;
    }

    const VIRTUAL_PILL = { approved: ["虚拟人", "mat"], pending: ["审核中", "tape"], rejected: ["未通过", "pin"] };

    async function photosTab() {
      const box = h("div.stack", h("p.small.muted", "正在加载…"));
      let list = [];
      try { list = (await api.get("/api/uploads", { kind: "person" })).items; } catch (err) { toastError(err); }
      const usable = (u) => u.virtual === "approved" || u.consent;
      replace(box,
        h("div.person-list-head", h("p.small.muted", "审核通过的虚拟人可直接使用。"),
          h("button.btn.btn-sm", { type: "button", onclick: show }, "刷新审核状态")),
        list.length ? h("div.person-grid", list.map((u) => {
        const [pillText, tone] = VIRTUAL_PILL[u.virtual] || ["真人", ""];
        return h("figure.person-card", { class: usable(u) ? "" : "is-off" },
          h("button.person-pick", { type: "button", disabled: !usable(u), "aria-label": usable(u) ? "使用这张照片" : "这张照片暂不能使用",
            onclick: () => choose(personFromUpload(u)) }, h("img", { src: u.thumb, alt: "", loading: "lazy" })),
          h("figcaption",
            h("span.pill", { class: tone ? `pill-${tone}` : "" }, pillText),
            u.virtual === "rejected" && u.virtualNote ? h("span.small.text-error", u.virtualNote) : null,
            h("span.person-card-actions",
              u.virtual === "rejected" || (u.consent && u.virtual === "none")
                ? h("button.link.small", { type: "button", onclick: () => askVirtual(u) }, u.virtual === "rejected" ? "重新申请" : "申请虚拟人") : null,
              h("button.link.small.text-error", { type: "button", onclick: () => removeUpload(u) }, "删除"))));
      })) : h("p.muted", "还没有上传过人物照片。"));
      return box;
    }

    async function askVirtual(u) {
      const ok = await confirmDialog({ title: "申请标记为虚拟人？",
        message: "请确认图中的人物不是任何真实存在的人，也不是真人照片或肖像改绘。管理员审核通过后，这张照片可以搭配任意姿势和服装，作品可以公开。",
        confirmText: "确认并提交" });
      if (!ok) return;
      try {
        const { upload } = await api.post(`/api/uploads/${u.id}/virtual`, { virtual: true, declare: true });
        toast(upload.virtual === "approved" ? "已标记为虚拟人" : "已提交审核", { type: "success" });
        show();
      } catch (err) { toastError(err); }
    }

    async function removeUpload(u) {
      if (!(await confirmDialog({ title: "删除这张照片？", message: "删除后无法恢复，已生成的作品不受影响。", confirmText: "删除", danger: true }))) return;
      try {
        await api.del(`/api/uploads/${u.id}`);
        if (state.person?.source === "upload" && state.person.id === u.id) { state.person = null; update(); }
        show();
      } catch (err) { toastError(err); }
    }

    function worksTab() {
      const grid = h("div.person-grid");
      const more = h("button.btn", { type: "button", hidden: true }, "加载更多");
      let page = 1;
      let shown = 0;
      async function load() {
        more.disabled = true;
        try {
          const data = await api.get("/api/generations", { status: "succeeded", page, size: 12 });
          for (const gen of data.items) {
            for (const img of gen.images) {
              const virtual = gen.personKind !== "real";
              grid.append(h("figure.person-card",
                h("button.person-pick", { type: "button", "aria-label": "用这张图作人物",
                  onclick: () => choose({ source: "image", id: img.id, url: img.thumb, virtual }) },
                  h("img", { src: img.thumb, alt: "", loading: "lazy" })),
                h("figcaption", h("span.pill", { class: virtual ? "pill-mat" : "" }, virtual ? "虚拟人" : "含真人照片"))));
            }
          }
          shown += data.items.length;
          page += 1;
          more.hidden = shown >= data.total;
          if (!data.total) grid.replaceWith(h("p.muted", "还没有生成成功的作品。"));
        } catch (err) { toastError(err); }
        more.disabled = false;
      }
      more.onclick = load;
      load();
      return h("div.stack",
        h("p.small.muted", "从自己的作品里挑一张，让新作品里出现同一个人物。没有用真人照片的作品算作虚拟人，可以搭配任意素材，作品可以公开。"),
        grid, h("div.lib-more-wrap", more));
    }

    async function show() {
      const content = tab === "upload" ? uploadTab() : tab === "photos" ? await photosTab() : worksTab();
      replace(body, content);
    }

    renderTabs();
    show();
  }

  // A real person's photo only goes with general-rated references.
  function afterPersonChange() {
    if (realPerson()) {
      const dropped = [];
      if (state.pose && (!state.pose.aiWithPerson || state.pose.people > 1)) { dropped.push("姿势"); state.pose = null; }
      if (state.outfit && !state.outfit.aiWithPerson) { dropped.push("服装"); state.outfit = null; }
      if (state.sceneAsset && !state.sceneAsset.aiWithPerson) { dropped.push("场景"); state.sceneAsset = null; }
      const items = state.items.filter((a) => a.aiWithPerson);
      if (items.length < state.items.length) { dropped.push("物品"); state.items = items; }
      if (dropped.length) toast(`当前${dropped.join("、")}不能与真人照片同用，已移除，请重新选择`, { type: "error", timeout: 6000 });
    }
    update();
  }

  // ---------- settings

  const settingsEl = h("div.panel-settings.stack");
  const promptInput = h("textarea.textarea.input-filled", { rows: 3, maxLength: 1000, value: state.prompt,
    placeholder: "描述画面细节，比如：黄昏的天台，逆光，微笑看向镜头",
    oninput: (e) => { state.prompt = e.target.value; counter.textContent = `${state.prompt.length}/1000`; save(); updateAction(); } });
  const counter = h("span.aside.num", `${state.prompt.length}/1000`);
  const actionEl = h("div.studio-action.stack");

  const sectionHead = (iconName, color, text, aside) => h("div.panel-sec-head", tile(iconName, color), text, aside || null);

  function seg(name, options, value, onPick) {
    return h("div.seg", { role: "radiogroup", "aria-label": name },
      options.map((o) => h("button", { type: "button", role: "radio", "aria-checked": String(o.value === value),
        "aria-pressed": String(o.value === value), onclick: () => onPick(o.value) }, o.content ?? o.text)));
  }

  function chips(name, options, value, onPick, { disabled = false } = {}) {
    return h("div.chips", { role: "radiogroup", "aria-label": name },
      options.map((o) => h("button.chip", { type: "button", role: "radio", disabled, "aria-checked": String(o.value === value),
        "aria-pressed": String(o.value === value), onclick: () => onPick(o.value) }, o.text)));
  }

  function unit() {
    const qq = cfg.qualities.find((x) => x.id === state.quality);
    const t = cfg.tiers.find((x) => x.id === state.tier);
    return Math.ceil((qq?.credits || 0) * (t?.multiplier || 1));
  }

  function renderSettings() {
    replace(settingsEl,
      h("section.panel-sec", sectionHead("text", "gray", "画面描述", counter), promptInput),
      cfg.styles.length ? h("section.panel-sec", sectionHead("palette", "pink", "风格"),
        chips("风格", [{ value: "", text: "不指定" }, ...cfg.styles.map((s) => ({ value: s.id, text: s.label }))], state.style, (v) => { state.style = v; update(); })) : null,
      cfg.scenes.length ? h("section.panel-sec", sectionHead("mountain", "green", "快速场景", state.sceneAsset ? h("span.aside", "已选场景图，以场景图为准") : null),
        chips("快速场景", [{ value: "", text: "不指定" }, ...cfg.scenes.map((s) => ({ value: s.id, text: s.label }))], state.sceneAsset ? "" : state.scene,
          (v) => { state.scene = v; update(); }, { disabled: !!state.sceneAsset })) : null,
      h("section.panel-sec", sectionHead("ratio", "indigo", "画幅"),
        h("div.ratio-grid", { role: "radiogroup", "aria-label": "画幅" }, cfg.ratios.map((r) =>
          h("button.ratio-opt", { type: "button", role: "radio", "aria-checked": String(r === state.ratio), "aria-pressed": String(r === state.ratio),
            onclick: () => { state.ratio = r; update(); } }, ratioShape(r), r)))),
      cfg.tiers.length > 1 ? h("section.panel-sec", sectionHead("expand", "blue", "清晰度"),
        seg("清晰度", cfg.tiers.map((t) => ({ value: t.id, content: [t.label, t.multiplier !== 1 ? h("span.chip-note", `×${t.multiplier}`) : null] })),
          state.tier, (v) => { state.tier = v; update(); })) : null,
      h("section.panel-sec", sectionHead("gem", "orange", "画质"),
        seg("画质", cfg.qualities.map((x) => ({ value: x.id, content: [x.label, h("span.chip-note", `${x.credits} 点`)] })),
          state.quality, (v) => { state.quality = v; update(); })),
      cfg.maxN > 1 ? h("section.panel-sec", sectionHead("stack", "teal", "张数"),
        seg("张数", Array.from({ length: cfg.maxN }, (_, i) => ({ value: i + 1, text: `${i + 1} 张` })), state.n, (v) => { state.n = v; update(); })) : null,
      h("button.btn.btn-ghost.board-link", { type: "button", onclick: () => {
        if (!state.pose && !state.outfit && !state.outfitUpload) { toast("先选择姿势或服装，再导出参考板", { type: "error" }); return; }
        openBoardDialog(state);
      } }, icon("board", 16), "导出参考板（免费，可用于其他 AI 工具）"));
  }

  function blocker() {
    if (!cfg.enabled) return cfg.maintenanceMessage || "生成服务维护中";
    const real = realPerson();
    const checks = [[state.pose, "姿势", "换一个"], [state.outfit, "服装", "换一套"], [state.sceneAsset, "场景", "换一个"],
      ...state.items.map((a) => [a, "物品", "换一件"])];
    for (const [asset, name, fix] of checks) {
      const note = asset ? usableNote(asset, real) : "";
      if (note) return `所选${name}${note}，请${fix}`;
    }
    if (real && state.pose?.people > 1) return "双人姿势不能搭配真人照片";
    const hasRefs = state.pose || state.outfit || state.outfitUpload || state.person || state.sceneAsset || state.items.length;
    if (!hasRefs && !cfg.allowTextOnly) return "请至少选择一张参考图";
    if (!hasRefs && !state.prompt.trim()) return "选一个姿势或服装，或者写下想要的画面";
    return "";
  }

  // Shared assets from other users add their price once per job.
  const fees = () => [state.pose, state.outfit, state.sceneAsset, ...state.items].reduce((sum, a) => sum + assetFee(a), 0);

  function updateAction() {
    const fee = fees();
    const cost = unit() * state.n + fee;
    const reason = blocker();
    const user = store.user;
    let button;
    if (!user) {
      button = h("a.btn.btn-primary.btn-block.btn-generate", { href: "/login?next=%2Fstudio" }, icon("sparkle", 19), "登录后生成");
    } else if (!reason && user.credits < cost) {
      button = h("a.btn.btn-primary.btn-block.btn-generate", { href: "/pricing" }, cicon("gem", "orange", 19), `点数不足（需 ${cost} 点），去充值`);
    } else {
      button = h("button.btn.btn-primary.btn-block.btn-generate", { type: "button", disabled: !!reason,
        onclick: (e) => busy(e.currentTarget, generate) }, icon("sparkle", 19), `生成 · ${number(cost)} 点`);
    }
    replace(actionEl,
      button,
      reason ? h("p.action-reason", { role: "status" }, reason)
        : h("p.action-balance", user ? `余额 ${number(user.credits)} 点${fee ? ` · 含素材使用费 ${fee} 点` : ""} · 失败自动退回`
          : store.config.auth.signupBonus ? `新用户注册送 ${store.config.auth.signupBonus} 点` : ""));
  }

  function update() {
    save();
    renderRefs();
    renderSettings();
    updateAction();
  }

  // ---------- results feed

  let filter = "";
  const feed = h("div.feed");
  const feedEmpty = h("div.feed-empty",
    h("div.feed-empty-tiles", tile("pose", "purple", "lg"), h("span.plus", "+"), tile("shirt", "pink", "lg"), h("span.plus", "="), tile("sparkle", "orange", "lg")),
    h("h3", "作品会出现在这里"),
    h("p", "在左侧选好姿势和服装，设置画幅和画质，点击生成。一般几十秒就能出图。"),
    store.user ? null : h("a.btn.btn-primary", { href: "/register" }, "免费注册开始"));
  const cards = new Map();
  const watcher = jobWatcher((gen) => {
    cards.get(gen.id)?.update(gen);
    if (gen.status === "failed" || gen.refunded) store.refreshUser();
  });
  const keep = (g) => !g.userHidden && (filter !== "favorite" || g.favorite);
  const showEmpty = () => {
    feedEmpty.hidden = cards.size > 0;
    feedEmpty.querySelector("h3").textContent = filter === "favorite" ? "还没有收藏的作品" : "作品会出现在这里";
  };

  function addCard(gen, { prepend = false } = {}) {
    const card = genCard(gen, {
      keep,
      onChange: (g) => { if (!g) { cards.delete(gen.id); showEmpty(); } }
    });
    cards.set(gen.id, card);
    if (prepend) feed.prepend(card.node); else feed.append(card.node);
    showEmpty();
    if (gen.status === "queued" || gen.status === "running") watcher.watch(gen.id);
  }

  async function loadFeed() {
    cards.forEach((c) => c.destroy());
    cards.clear();
    feed.replaceChildren();
    if (!store.user) { showEmpty(); return; }
    try {
      const { items } = await api.get("/api/generations", { size: 12, status: filter });
      items.forEach((g) => addCard(g));
    } catch { /* the feed is optional */ }
    showEmpty();
  }

  async function generate() {
    try {
      const { generation } = await api.post("/api/generations", {
        poseId: state.pose?.id, outfitId: state.outfit?.id, outfitUploadId: state.outfitUpload?.id,
        personUploadId: state.person?.source === "upload" ? state.person.id : undefined,
        personImageId: state.person?.source === "image" ? state.person.id : undefined,
        sceneAssetId: state.sceneAsset?.id, itemIds: state.items.map((a) => a.id),
        prompt: state.prompt.trim(), style: state.style, scene: state.sceneAsset ? "" : state.scene,
        ratio: state.ratio, tier: state.tier, quality: state.quality, n: state.n
      });
      if (filter === "favorite") { filter = ""; renderFeedTools(); await loadFeed(); }
      if (!cards.has(generation.id)) addCard(generation, { prepend: true });
      store.patchUser({ credits: store.user.credits - generation.cost });
      canvas.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      if (["UPLOAD_GONE", "PERSON_IMAGE_GONE"].includes(err.code)) { state.person = null; state.outfitUpload = null; update(); }
      if (err.code === "INSUFFICIENT_CREDITS") { store.refreshUser(); }
      toastError(err);
    }
  }

  const feedTools = h("div.canvas-tools");
  function renderFeedTools() {
    replace(feedTools,
      store.user ? h("div.seg.feed-filter", { role: "radiogroup", "aria-label": "筛选" }, [["", "全部"], ["favorite", "收藏"]].map(([value, text]) =>
        h("button", { type: "button", role: "radio", "aria-checked": String(filter === value), "aria-pressed": String(filter === value),
          onclick: () => { if (filter !== value) { filter = value; renderFeedTools(); loadFeed(); } } }, text))) : null,
      cardSizeSwitch(feed, "pw-size-studio"),
      store.user ? h("a.link.link-arrow", { href: "/works" }, "全部作品") : null);
  }
  renderFeedTools();
  loadFeed();

  const canvas = h("section.studio-canvas", { "aria-label": "创作记录" },
    h("div.canvas-head", h("h2", "创作记录"), feedTools),
    feedEmpty, feed);

  const unsubscribe = store.subscribe(() => updateAction());
  update();

  const node = h("div.studio.ambient",
    h("div.studio-shell",
      h("aside.studio-panel.glass", { "aria-label": "创作设置" },
        h("div.panel-scroll",
          h("div.panel-title", h("h1", "创作")),
          h("section.panel-sec", sectionHead("photos", "blue", "参考图"), refsEl, ruleEl),
          settingsEl),
        h("div.panel-foot", actionEl)),
      canvas));

  return {
    node,
    cleanup() {
      unsubscribe();
      watcher.stop();
      cards.forEach((c) => c.destroy());
    }
  };
}

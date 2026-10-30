import { h, icon, tile, cicon, replace } from "../core/dom.js";
import { api } from "../core/api.js";
import { store, draft } from "../core/store.js";
import { modal, toast, toastError, busy, confirmDialog } from "../core/ui.js";
import { label, number } from "../core/format.js";
import { navigate } from "../core/nav.js";
import { libraryBrowser, usableNote } from "../components/library-browser.js";
import { genCard, jobWatcher } from "../components/gen-card.js";
import { openBoardDialog } from "../components/board.js";

const RATIO_SHAPES = { "2:3": [2, 3], "3:4": [3, 4], "1:1": [1, 1], "4:3": [4, 3], "3:2": [3, 2], "9:16": [9, 16], "16:9": [16, 9] };

function ratioShape(ratio) {
  const [w, hh] = RATIO_SHAPES[ratio] || [1, 1];
  const scale = 16 / Math.max(w, hh);
  return h("span.ratio-shape", { "aria-hidden": "true", style: { width: `${Math.round(w * scale)}px`, height: `${Math.round(hh * scale)}px` } });
}

export async function render(ctx) {
  const cfg = store.config.generation;
  const saved = draft.read();
  const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
  const state = {
    pose: saved.pose || null,
    outfit: saved.outfit || null,
    outfitUpload: saved.outfitUpload || null,
    person: saved.person || null,
    ratio: pick(saved.ratio, cfg.ratios, cfg.defaultRatio),
    tier: pick(saved.tier, cfg.tiers.map((t) => t.id), cfg.defaultTier),
    quality: pick(saved.quality, cfg.qualities.map((q) => q.id), cfg.defaultQuality),
    n: Math.min(cfg.maxN, Math.max(1, Number(saved.n) || 1)),
    style: pick(saved.style, ["", ...cfg.styles.map((s) => s.id)], ""),
    scene: pick(saved.scene, ["", ...cfg.scenes.map((s) => s.id)], ""),
    prompt: typeof saved.prompt === "string" ? saved.prompt : ""
  };
  // Uploads belong to whoever made them; drop them if the session changed.
  if (!store.user) { state.person = null; state.outfitUpload = null; }

  // Links like /studio?pose=ID&outfit=ID&style=photo prefill the selection.
  const fetchAsset = async (id) => (await api.get(`/api/library/assets/${encodeURIComponent(id)}`)).asset;
  try {
    if (ctx.query.pose) state.pose = await fetchAsset(ctx.query.pose);
    if (ctx.query.outfit) { state.outfit = await fetchAsset(ctx.query.outfit); state.outfitUpload = null; }
  } catch { toast("链接中的素材已下架", { type: "error" }); }
  if (ctx.query.style && cfg.styles.some((s) => s.id === ctx.query.style)) state.style = ctx.query.style;
  if (ctx.query.scene && cfg.scenes.some((s) => s.id === ctx.query.scene)) state.scene = ctx.query.scene;
  if (ctx.query.pose || ctx.query.outfit) history.replaceState({}, "", "/studio");

  const save = () => draft.write(state);

  // ---------- reference tiles

  const refsEl = h("div.ref-grid");
  const ruleEl = h("p.ref-rule");

  function toolButton(iconName, color, text, onclick) {
    return h("button.btn", { type: "button", title: text, "aria-label": text, onclick }, cicon(iconName, color, 14));
  }

  function ref({ key, title, optional, iconName, color, filled, image, code, note, emptyText, onPick, tools }) {
    return h("div.ref", { class: `is-${key}` },
      h("div.ref-label", title, code ? h("span.code.num", code) : optional ? h("span.code", "可选") : null),
      h("button.ref-frame", { type: "button", onclick: onPick, "aria-label": filled ? `更换${title}` : emptyText },
        filled ? h("img", { src: image, alt: title, decoding: "async" })
          : h("div.ref-empty", tile(iconName, color), h("span", emptyText))),
      note ? h("p.ref-note", note) : null,
      h("div.ref-tools", tools.filter(Boolean)));
  }

  function renderRefs() {
    const withPerson = !!state.person;
    const poseNote = state.pose ? usableNote(state.pose, withPerson) || (withPerson && state.pose.people > 1 ? "双人姿势不能搭配人物照片" : "") : "";
    const outfitNote = state.outfit ? usableNote(state.outfit, withPerson) : "";
    replace(refsEl,
      ref({
        key: "pose", title: "姿势", iconName: "pose", color: "purple", filled: !!state.pose,
        image: state.pose?.preview, code: state.pose?.code, note: poseNote, emptyText: "选择姿势",
        onPick: () => openPicker("pose"),
        tools: [
          toolButton("shuffle", "purple", "随机姿势", (e) => busy(e.currentTarget, () => randomize("pose"))),
          state.pose ? toolButton("close", "gray", "移除姿势", () => { state.pose = null; update(); }) : null
        ]
      }),
      ref({
        key: "outfit", title: "服装", iconName: "shirt", color: "pink", filled: !!(state.outfit || state.outfitUpload),
        image: state.outfit?.preview || state.outfitUpload?.url, code: state.outfit?.id || (state.outfitUpload ? "上传" : ""),
        note: outfitNote, emptyText: "选择服装", onPick: () => openPicker("outfit"),
        tools: [
          toolButton("shuffle", "purple", "随机服装", (e) => busy(e.currentTarget, () => randomize("outfit"))),
          cfg.allowOutfitUpload ? toolButton("upload", "blue", "上传服装图", (e) => uploadOutfit(e.currentTarget)) : null,
          state.outfit || state.outfitUpload ? toolButton("close", "gray", "移除服装", () => { state.outfit = null; state.outfitUpload = null; update(); }) : null
        ]
      }),
      cfg.allowPersonPhoto ? ref({
        key: "person", title: "人物", optional: true, iconName: "person", color: "green", filled: !!state.person,
        image: state.person?.url, emptyText: "上传照片", onPick: () => openPersonDialog(),
        tools: [
          toolButton("upload", "blue", "上传人物照片", () => openPersonDialog()),
          state.person ? toolButton("close", "gray", "移除人物照片", () => { state.person = null; update(); }) : null
        ]
      }) : null);
    ruleEl.textContent = withPerson
      ? "已添加人物照片：只能搭配普通级姿势和服装，作品仅自己可见。"
      : "姿势和服装可以只选一个，都不选时用文字描述也能生成。";
  }

  async function randomize(type) {
    try {
      const exclude = type === "pose" ? state.pose?.groupKey : state.outfit?.id;
      const { item } = await api.get("/api/library/random", { type, forAI: 1, withPerson: state.person ? 1 : 0, exclude });
      if (!item) { toast("没有可用的素材", { type: "error" }); return; }
      if (type === "pose") state.pose = item;
      else { state.outfit = item; state.outfitUpload = null; }
      update();
    } catch (err) { toastError(err); }
  }

  function openPicker(type) {
    let m;
    const browser = libraryBrowser({
      type, mode: "picker", withPerson: !!state.person,
      onSelect(asset) {
        if (type === "pose") state.pose = asset;
        else { state.outfit = asset; state.outfitUpload = null; }
        m.close();
        update();
      }
    });
    m = modal({ title: type === "pose" ? "选择姿势" : "选择服装", wide: true, content: browser.node });
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

  async function openPersonDialog() {
    if (!requireLogin()) return;
    let recent = [];
    try { recent = (await api.get("/api/uploads", { kind: "person" })).items; } catch { /* list is optional */ }
    const consent = h("input", { type: "checkbox" });
    const uploadBtn = h("button.btn.btn-primary", { type: "button", disabled: true }, cicon("upload", "blue"), "选择照片上传");
    consent.onchange = () => { uploadBtn.disabled = !consent.checked; };
    const input = fileInput("image/png,image/jpeg,image/webp");
    uploadBtn.onclick = () => input.click();
    input.onchange = () => {
      const file = input.files[0];
      if (!file) return;
      busy(uploadBtn, async () => {
        const form = new FormData();
        form.append("kind", "person");
        form.append("consent", "true");
        form.append("file", file);
        try {
          const { upload } = await api.upload("/api/uploads", form);
          state.person = upload;
          m.close();
          afterPersonChange();
        } catch (err) { toastError(err); }
      });
    };
    const recentList = recent.length ? h("div.field", h("span", "最近上传（点击使用）"),
      h("div.person-recent", recent.map((u) => h("div.person-recent-item",
        h("button", { type: "button", "aria-label": "使用这张照片", onclick: () => { state.person = u; m.close(); afterPersonChange(); } },
          h("img", { src: u.url, alt: "" })),
        h("button.person-recent-del", { type: "button", "aria-label": "删除这张照片", onclick: async (e) => {
          const item = e.currentTarget.parentElement;
          if (!(await confirmDialog({ title: "删除这张照片？", message: "删除后无法恢复，已生成的作品不受影响。", confirmText: "删除", danger: true }))) return;
          try {
            await api.del(`/api/uploads/${u.id}`);
            item.remove();
            if (state.person?.id === u.id) { state.person = null; update(); }
          } catch (err) { toastError(err); }
        } }, "×"))))) : null;
    const m = modal({
      title: "添加人物照片",
      content: h("div.stack",
        h("p.muted", "上传一张清晰的正面照片，成片会尽量保留这个人的五官和发型，衣服和姿势则按你选的参考来。"),
        h("ul.person-tips",
          h("li", tile("lock", "blue"), "照片只用于你发起的生成任务，并发送给图像模型服务商处理。"),
          h("li", tile("clock", "orange"), `照片会在 ${cfg.personRetentionDays} 天后自动删除，也可以随时手动删除。`),
          h("li", tile("shield", "green"), "使用人物照片时，只能搭配普通级的姿势和服装，作品不能公开发布。")),
        recentList,
        h("label.check.consent", consent,
          h("span", "我确认照片中是我本人，或我已取得照片中人物的明确授权，且该人物已年满 18 周岁。我不会用它制作色情、侮辱或冒充他人的内容。"))),
      footer: [h("button.btn", { type: "button", onclick: () => m.close() }, "取消"), uploadBtn]
    });
  }

  function afterPersonChange() {
    const dropped = [];
    if (state.pose && (!state.pose.aiWithPerson || state.pose.people > 1)) { dropped.push("姿势"); state.pose = null; }
    if (state.outfit && !state.outfit.aiWithPerson) { dropped.push("服装"); state.outfit = null; }
    if (dropped.length) toast(`当前${dropped.join("和")}不能与人物照片同用，已移除，请重新选择`, { type: "error", timeout: 6000 });
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

  function chips(name, options, value, onPick) {
    return h("div.chips", { role: "radiogroup", "aria-label": name },
      options.map((o) => h("button.chip", { type: "button", role: "radio", "aria-checked": String(o.value === value),
        "aria-pressed": String(o.value === value), onclick: () => onPick(o.value) }, o.text)));
  }

  function unit() {
    const q = cfg.qualities.find((x) => x.id === state.quality);
    const t = cfg.tiers.find((x) => x.id === state.tier);
    return Math.ceil((q?.credits || 0) * (t?.multiplier || 1));
  }

  function renderSettings() {
    replace(settingsEl,
      h("section.panel-sec", sectionHead("text", "gray", "画面描述", counter), promptInput),
      cfg.styles.length ? h("section.panel-sec", sectionHead("palette", "pink", "风格"),
        chips("风格", [{ value: "", text: "不指定" }, ...cfg.styles.map((s) => ({ value: s.id, text: s.label }))], state.style, (v) => { state.style = v; update(); })) : null,
      cfg.scenes.length ? h("section.panel-sec", sectionHead("mountain", "green", "场景"),
        chips("场景", [{ value: "", text: "不指定" }, ...cfg.scenes.map((s) => ({ value: s.id, text: s.label }))], state.scene, (v) => { state.scene = v; update(); })) : null,
      h("section.panel-sec", sectionHead("ratio", "indigo", "画幅"),
        h("div.ratio-grid", { role: "radiogroup", "aria-label": "画幅" }, cfg.ratios.map((r) =>
          h("button.ratio-opt", { type: "button", role: "radio", "aria-checked": String(r === state.ratio), "aria-pressed": String(r === state.ratio),
            onclick: () => { state.ratio = r; update(); } }, ratioShape(r), r)))),
      cfg.tiers.length > 1 ? h("section.panel-sec", sectionHead("expand", "blue", "清晰度"),
        seg("清晰度", cfg.tiers.map((t) => ({ value: t.id, content: [t.label, t.multiplier !== 1 ? h("span.chip-note", `×${t.multiplier}`) : null] })),
          state.tier, (v) => { state.tier = v; update(); })) : null,
      h("section.panel-sec", sectionHead("gem", "orange", "画质"),
        seg("画质", cfg.qualities.map((q) => ({ value: q.id, content: [q.label, h("span.chip-note", `${q.credits} 点`)] })),
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
    const withPerson = !!state.person;
    if (state.pose) {
      const note = usableNote(state.pose, withPerson);
      if (note) return `所选姿势${note}，请换一个`;
      if (withPerson && state.pose.people > 1) return "双人姿势不能搭配人物照片";
    }
    if (state.outfit) {
      const note = usableNote(state.outfit, withPerson);
      if (note) return `所选服装${note}，请换一套`;
    }
    const hasRefs = state.pose || state.outfit || state.outfitUpload || state.person;
    if (!hasRefs && !cfg.allowTextOnly) return "请至少选择一张参考图";
    if (!hasRefs && !state.prompt.trim()) return "选一个姿势或服装，或者写下想要的画面";
    return "";
  }

  function updateAction() {
    const cost = unit() * state.n;
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
        : h("p.action-balance", user ? `余额 ${number(user.credits)} 点 · 失败自动退回`
          : store.config.auth.signupBonus ? `新用户注册送 ${store.config.auth.signupBonus} 点` : ""));
  }

  function update() {
    save();
    renderRefs();
    renderSettings();
    updateAction();
  }

  // ---------- results feed

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

  function addCard(gen, { prepend = false } = {}) {
    const card = genCard(gen, {
      onChange: (g) => { if (!g) { cards.delete(gen.id); feedEmpty.hidden = cards.size > 0; } },
      onReuse: reuse
    });
    cards.set(gen.id, card);
    if (prepend) feed.prepend(card.node); else feed.append(card.node);
    feedEmpty.hidden = true;
    if (gen.status === "queued" || gen.status === "running") watcher.watch(gen.id);
  }

  async function reuse(gen) {
    Object.assign(state, {
      ratio: pick(gen.ratio, cfg.ratios, state.ratio), tier: pick(gen.tier, cfg.tiers.map((t) => t.id), state.tier),
      quality: pick(gen.quality, cfg.qualities.map((q) => q.id), state.quality), n: Math.min(cfg.maxN, gen.n),
      style: pick(gen.style, ["", ...cfg.styles.map((s) => s.id)], ""), scene: pick(gen.scene, ["", ...cfg.scenes.map((s) => s.id)], ""),
      prompt: gen.prompt || ""
    });
    promptInput.value = state.prompt;
    counter.textContent = `${state.prompt.length}/1000`;
    try {
      if (gen.refs?.pose?.id) state.pose = await fetchAsset(gen.refs.pose.id);
      if (gen.refs?.outfit?.id) { state.outfit = await fetchAsset(gen.refs.outfit.id); state.outfitUpload = null; }
    } catch { toast("部分素材已下架", { type: "error" }); }
    if (gen.refs?.outfit?.upload && !state.outfitUpload) toast("上传的服装图需要重新选择", { type: "error" });
    if (gen.refs?.person && !state.person) toast("人物照片需要重新选择", { type: "error" });
    update();
    toast("已填入这次的设置", { type: "success" });
  }

  async function generate() {
    try {
      const { generation } = await api.post("/api/generations", {
        poseId: state.pose?.id, outfitId: state.outfit?.id, outfitUploadId: state.outfitUpload?.id,
        personUploadId: state.person?.id, prompt: state.prompt.trim(), style: state.style, scene: state.scene,
        ratio: state.ratio, tier: state.tier, quality: state.quality, n: state.n
      });
      addCard(generation, { prepend: true });
      store.patchUser({ credits: store.user.credits - generation.cost });
      canvas.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      if (err.code === "UPLOAD_GONE") { state.person = null; state.outfitUpload = null; update(); }
      if (err.code === "INSUFFICIENT_CREDITS") { store.refreshUser(); }
      toastError(err);
    }
  }

  if (store.user) {
    api.get("/api/generations", { size: 12 }).then(({ items }) => items.forEach((g) => addCard(g))).catch(() => {});
  }

  const canvas = h("section.studio-canvas", { "aria-label": "创作记录" },
    h("div.canvas-head", h("h2", "创作记录"), store.user ? h("a.link.link-arrow", { href: "/works" }, "全部作品") : null),
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

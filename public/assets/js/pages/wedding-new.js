import { h, icon, cicon } from "../core/dom.js";
import { api } from "../core/api.js";
import { store } from "../core/store.js";
import { toast, toastError, busy, emptyState, modal, zoomImage } from "../core/ui.js";
import { number } from "../core/format.js";
import { loadCatalog, sceneCover, packageCard, weddingDraft, CATEGORY_ORDER } from "../components/wedding-kit.js";

// The order wizard: 套系 → 照片 → 造型 → 确认. A sticky bar shows the price and
// moves between steps; the draft survives leaving the page.
const STEPS = ["套系", "照片", "造型", "确认"];
const ROLES = { bride: "新娘", groom: "新郎" };

export async function render(ctx) {
  let catalog;
  try { catalog = await loadCatalog({ fresh: true }); } catch (err) {
    toastError(err);
    return h("div.wrap", emptyState({ title: "暂时无法打开婚纱影楼", text: "请稍后刷新页面重试。", icon: "alert", color: "orange" }));
  }
  if (!catalog.enabled) return h("div.wrap", emptyState({ title: "婚纱影楼暂未开放", icon: "camera", color: "pink" }));

  const sceneById = new Map(catalog.scenes.map((s) => [s.id, s]));
  const saved = weddingDraft.read();
  const state = {
    step: 0, packageKey: catalog.packages.find((p) => p.badge)?.key || catalog.packages[0]?.key, extra: 0, title: "",
    consent: false, bride: [], groom: [], looks: [], ...(saved && saved.userId === store.user?.id ? saved : {})
  };
  if (ctx.query.package && catalog.packages.some((p) => p.key === ctx.query.package)) { state.packageKey = ctx.query.package; state.step = 0; }
  const pkg = () => catalog.packages.find((p) => p.key === state.packageKey) || catalog.packages[0];
  const perLook = () => pkg().shots + state.extra;
  const price = () => pkg().price + state.extra * pkg().looks * catalog.extraPhotoPrice;
  const maxExtra = () => Math.max(0, Math.min(catalog.maxExtra, catalog.shots.length - pkg().shots));
  const save = () => weddingDraft.write({ ...state, userId: store.user?.id });

  // A look with the scene's recommendations filled in.
  const outfitByKey = (role, key) => catalog.outfits[role].find((o) => o.key === key) || catalog.outfits[role][0];
  function lookFor(scene) {
    const r = scene.recommend;
    const pick = (role) => {
      const option = outfitByKey(role, r[role]);
      return { categoryId: option?.categoryId, assetId: option?.assets[0]?.id || null };
    };
    return { sceneId: scene.id, bride: pick("bride"), groom: pick("groom"), hair: r.hair || "low-bun", headpiece: r.headpiece || "veil", makeup: r.makeup || "natural" };
  }
  // Keep the looks in step with the package: new looks get a scene from a
  // category not used yet, so 3 looks start as 影棚 + 外景 + 中式.
  function fitLooks() {
    const want = pkg().looks;
    state.looks = state.looks.filter((l) => sceneById.has(l.sceneId)).slice(0, want);
    const preset = Number(ctx.query.scene);
    if (!state.looks.length && sceneById.has(preset)) state.looks.push(lookFor(sceneById.get(preset)));
    while (state.looks.length < want) {
      const used = new Set(state.looks.map((l) => sceneById.get(l.sceneId)?.category));
      const usedScenes = new Set(state.looks.map((l) => l.sceneId));
      const cat = CATEGORY_ORDER.find((c) => !used.has(c)) || CATEGORY_ORDER[state.looks.length % 3];
      const scene = catalog.scenes.find((s) => s.category === cat && !usedScenes.has(s.id))
        || catalog.scenes.find((s) => !usedScenes.has(s.id)) || catalog.scenes[0];
      if (!scene) break;
      state.looks.push(lookFor(scene));
    }
  }
  fitLooks();

  const body = h("div.wd-wizard-body");
  const stepper = h("ol.wd-stepper");
  const priceEl = h("div.wd-bar-price");
  const back = h("button.btn.btn-white", { type: "button", onclick: () => go(state.step - 1) }, "上一步");
  const next = h("button.btn.btn-primary.btn-lg", { type: "button", onclick: () => (state.step === 3 ? submit(next) : go(state.step + 1)) });
  const hint = h("span.wd-bar-hint");

  function problems(step) {
    if (step === 1) {
      if (!state.consent) return "请先勾选同意使用照片";
      if (!state.bride.length) return "请上传新娘的照片";
      if (!state.groom.length) return "请上传新郎的照片";
    }
    if (step === 2 && state.looks.some((l) => !sceneById.has(l.sceneId))) return "有造型的场景已下线，请重新选择";
    return "";
  }
  function go(step) {
    if (step > state.step) {
      for (let s = state.step; s < step; s++) {
        const problem = problems(s);
        if (problem) { toast(problem, { type: "error" }); return; }
      }
    }
    state.step = Math.max(0, Math.min(3, step));
    save();
    draw();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function draw() {
    stepper.replaceChildren(...STEPS.map((name, i) => h(`li${i === state.step ? ".is-current" : i < state.step ? ".is-done" : ""}`,
      h("button", { type: "button", disabled: i > state.step, onclick: () => go(i) },
        h("span.num", i < state.step ? icon("check", 14) : i + 1), name))));
    body.replaceChildren([stepPackage, stepPhotos, stepLooks, stepConfirm][state.step]());
    back.hidden = state.step === 0;
    next.replaceChildren(state.step === 3 ? `支付 ${price()} 点，开始拍摄` : `下一步：${STEPS[state.step + 1]}`);
    drawBar();
  }
  function drawBar() {
    const balance = store.user?.credits ?? 0;
    priceEl.replaceChildren(h("strong.num", price()), h("span", "点"),
      h("span.faint.small", `${pkg().name} · ${pkg().looks} 套 · ${pkg().looks * perLook()} 张`));
    hint.replaceChildren(balance < price() ? h("a.link", { href: "/pricing" }, `余额 ${number(balance)} 点，还差 ${number(price() - balance)} 点，去充值`) : "");
  }

  // ---------- step 1: package
  function stepPackage() {
    const extraRow = h("div.wd-extra");
    const shots = h("div.wd-shotlist");
    function drawShots() {
      shots.replaceChildren(
        h("strong", `每套造型拍这 ${perLook()} 个镜头`),
        h("ol", catalog.shots.map((s, i) => h(`li${i < perLook() ? "" : ".is-off"}`, h("span.num", i + 1), s.name,
          h("span.faint", s.people === "couple" ? "合影" : s.people === "bride" ? "新娘" : "新郎")))));
    }
    function drawExtra() {
      drawShots();
      const max = maxExtra();
      if (state.extra > max) state.extra = max;
      extraRow.hidden = !max;
      extraRow.replaceChildren(
        h("div", h("strong", "每套造型加拍"), h("p.faint.small", `每张 ${catalog.extraPhotoPrice} 点，加拍的是 ${catalog.shots.slice(pkg().shots, pkg().shots + max).map((s) => s.name).join("、")}`)),
        h("div.wd-stepper-num",
          h("button.btn.btn-white.btn-icon", { type: "button", "aria-label": "少加一张", disabled: state.extra <= 0, onclick: () => { state.extra -= 1; save(); drawExtra(); drawBar(); } }, "−"),
          h("strong.num", state.extra),
          h("button.btn.btn-white.btn-icon", { type: "button", "aria-label": "多加一张", disabled: state.extra >= max, onclick: () => { state.extra += 1; save(); drawExtra(); drawBar(); } }, "+")));
    }
    const cards = h("div.wd-pkgs", { role: "radiogroup", "aria-label": "套系" });
    function drawCards() {
      cards.replaceChildren(...catalog.packages.map((p) => packageCard(p, { selected: p.key === state.packageKey, onSelect: (chosen) => {
        state.packageKey = chosen.key;
        fitLooks();
        save();
        drawCards(); drawExtra(); drawBar();
      } })));
    }
    drawCards();
    drawExtra();
    const title = h("input.input", { value: state.title, maxLength: 30, placeholder: "例如：阿杰 & 小雨", oninput: (e) => { state.title = e.target.value; save(); } });
    return h("div.stack.wd-step",
      h("header.wd-step-head", h("h2", "选一个套系"), h("p", "造型越多，场景和礼服就越丰富。")),
      cards, extraRow,
      h("div.wd-two", shots, h("label.field", h("span", "相册名称（可选）"), title, h("small.faint", "会显示在相册和下载的文件名里。"))));
  }

  // ---------- step 2: photos
  function stepPhotos() {
    const consent = h("input", { type: "checkbox", checked: state.consent, onchange: (e) => { state.consent = e.target.checked; save(); drawPeople(); } });
    const people = h("div.wd-people");
    function drawPeople() { people.replaceChildren(personBox("bride"), personBox("groom")); }
    function personBox(role) {
      const list = state[role];
      const input = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp", multiple: true, hidden: true,
        onchange: (e) => { const files = [...e.target.files]; e.target.value = ""; addFiles(role, files); } });
      const full = list.length >= catalog.maxPhotos;
      const drop = h("button.wd-drop", { type: "button", disabled: !state.consent || full, onclick: () => input.click() },
        icon("upload", 22), h("strong", full ? "已经够了" : "上传照片"), h("span", state.consent ? "可多选，拖进来也行" : "先勾选上方的同意"));
      for (const ev of ["dragenter", "dragover"]) drop.addEventListener(ev, (e) => { e.preventDefault(); if (state.consent) drop.classList.add("is-over"); });
      for (const ev of ["dragleave", "drop"]) drop.addEventListener(ev, () => drop.classList.remove("is-over"));
      drop.addEventListener("drop", (e) => { e.preventDefault(); if (state.consent) addFiles(role, [...e.dataTransfer.files]); });
      return h("section.wd-person",
        h("header", h("h3", ROLES[role]), h("span.faint.small.num", `${list.length}/${catalog.maxPhotos}`)),
        h("div.wd-thumbs",
          list.map((u, i) => h("figure.wd-thumb",
            h("img", { src: u.thumb, alt: `${ROLES[role]}照片 ${i + 1}`, onclick: () => zoomImage(u.url || u.thumb) }),
            i === 0 ? h("span.wd-thumb-tag", "主照") : null,
            u.warnings?.length ? h("span.wd-thumb-warn", { title: u.warnings.join("；") }, icon("alert", 13), u.warnings[0]) : null,
            h("button.wd-thumb-x", { type: "button", "aria-label": "移除", onclick: () => { state[role].splice(i, 1); save(); drawPeople(); } }, icon("close", 14)))),
          list.length < catalog.maxPhotos ? drop : null),
        h("div.wd-person-foot",
          h("button.link", { type: "button", disabled: !state.consent, onclick: () => pickEarlier(role) }, "从上传过的照片里选"),
          input));
    }
    async function addFiles(role, files) {
      const room = catalog.maxPhotos - state[role].length;
      if (files.length > room) toast(`${ROLES[role]}最多 ${catalog.maxPhotos} 张，多出的没有上传`);
      for (const file of files.slice(0, room)) {
        const form = new FormData();
        form.append("consent", "true");
        form.append("file", file);
        const pending = h("figure.wd-thumb.is-loading", h("span.spinner"));
        people.querySelectorAll(".wd-person")[role === "bride" ? 0 : 1]?.querySelector(".wd-thumbs")?.prepend(pending);
        try {
          const { upload, warnings } = await api.upload("/api/wedding/photos", form);
          state[role].push({ id: upload.id, thumb: upload.thumb, url: upload.url, warnings });
          if (warnings.length) toast(`${ROLES[role]}的照片：${warnings.join("，")}，建议换一张更清楚的`);
          save();
        } catch (err) { toastError(err); }
        pending.remove();
        drawPeople();
      }
    }
    async function pickEarlier(role) {
      let items = [];
      try { items = (await api.get("/api/wedding/photos")).items; } catch (err) { toastError(err); return; }
      const taken = new Set([...state.bride, ...state.groom].map((u) => u.id));
      const grid = h("div.wd-pick-grid", items.length ? items.map((u) => h("button.wd-pick", { type: "button", disabled: taken.has(u.id),
        onclick: () => {
          if (state[role].length >= catalog.maxPhotos) { toast(`最多 ${catalog.maxPhotos} 张`); return; }
          state[role].push({ id: u.id, thumb: u.thumb, url: u.url, warnings: [] });
          save(); m.close(); drawPeople();
        } }, h("img", { src: u.thumb, alt: "" }))) : h("p.muted", "还没有上传过照片。"));
      const m = modal({ title: `选择${ROLES[role]}的照片`, content: grid });
    }
    drawPeople();
    return h("div.stack.wd-step",
      h("header.wd-step-head", h("h2", "上传两个人的照片"), h("p", "照片越清楚，拍出来越像。只用来认出你们的长相，衣服和背景都不影响。")),
      h("label.wd-consent", consent,
        h("span", h("strong", "两位都同意使用这些照片，并且都已年满 18 周岁"),
          h("span.faint.small", `照片只用于这次拍摄，成片只有你能看到，上传的照片 ${catalog.retentionDays} 天后自动删除。`))),
      people,
      h("div.wd-tips",
        h("strong", "怎样的照片效果最好"),
        h("ul",
          h("li.is-good", icon("check", 15), "第一张放正脸，光线均匀、五官清楚"),
          h("li.is-good", icon("check", 15), "再加一两张侧脸或半侧脸，拍出来更像"),
          h("li.is-good", icon("check", 15), "单人照，脸占画面的三分之一以上"),
          h("li.is-bad", icon("close", 15), "不要美颜过重、戴墨镜或口罩"),
          h("li.is-bad", icon("close", 15), "不要多人合影、远景或很模糊的照片"))));
  }

  // ---------- step 3: looks
  function stepLooks() {
    const wrap = h("div.wd-looks");
    function drawLooks() {
      wrap.replaceChildren(...state.looks.map((look, i) => lookCard(look, i)));
    }
    function lookCard(look, i) {
      const scene = sceneById.get(look.sceneId);
      const update = (patch) => { Object.assign(look, patch); save(); wrap.children[i].replaceWith(lookCard(look, i)); };
      const chips = (kind) => h("div.chips", catalog.styling[kind].map((x) => h("button.chip", { type: "button", "aria-pressed": String(look[kind] === x.key),
        onclick: () => update({ [kind]: x.key }) }, x.name)));
      const outfitRow = (role) => {
        const current = catalog.outfits[role].find((o) => o.categoryId === look[role].categoryId) || catalog.outfits[role][0];
        return h("div.wd-outfit",
          h("div.wd-outfit-head", h("span", ROLES[role] === "新娘" ? "新娘礼服" : "新郎礼服"), h("strong", current?.name || "")),
          h("div.wd-outfit-row", catalog.outfits[role].map((o) => {
            const thumb = o.assets[0]?.thumb;
            const on = o.categoryId === look[role].categoryId;
            return h(`button.wd-outfit-opt${on ? ".is-on" : ""}`, { type: "button", title: o.name,
              onclick: () => update({ [role]: { categoryId: o.categoryId, assetId: o.assets[0]?.id || null } }) },
              thumb ? h("img", { src: thumb, alt: "", loading: "lazy" }) : h("span.wd-outfit-ph", icon(role === "bride" ? "heart" : "shirt", 18)),
              h("span", o.name));
          })),
          current?.assets.length > 1 ? h("div.wd-outfit-styles", h("span.faint.small", "款式"),
            current.assets.map((a) => h(`button.wd-style${a.id === look[role].assetId ? ".is-on" : ""}`, { type: "button",
              onclick: () => update({ [role]: { categoryId: current.categoryId, assetId: a.id } }) }, h("img", { src: a.thumb, alt: a.name?.zh || "" })))) : null);
      };
      return h("article.wd-look",
        h("div.wd-look-scene",
          h("button.wd-look-cover", { type: "button", onclick: () => pickScene(look, i, update), "aria-label": "更换场景" },
            scene ? sceneCover(scene) : h("div.wd-cover", h("span.wd-cover-mark", icon("alert", 24)))),
          h("div.wd-look-meta",
            h("span.wd-look-no", `造型 ${i + 1}`),
            h("p.faint.small", scene?.description || "场景已下线，请重新选择"),
            h("div.wd-look-actions",
              h("button.btn.btn-white.btn-sm", { type: "button", onclick: () => pickScene(look, i, update) }, cicon("mountain", "teal", 15), "换场景"),
              scene ? h("button.btn.btn-ghost.btn-sm", { type: "button", onclick: () => update(lookFor(scene)) }, cicon("wand", "purple", 15), "恢复推荐") : null))),
        h("div.wd-look-body",
          outfitRow("bride"), outfitRow("groom"),
          h("div.wd-styling",
            h("div", h("span.wd-label", "发型"), chips("hair")),
            h("div", h("span.wd-label", "头饰"), chips("headpiece")),
            h("div", h("span.wd-label", "妆容"), chips("makeup")))));
    }
    function pickScene(look, i, update) {
      let cat = sceneById.get(look.sceneId)?.category || "";
      const used = new Set(state.looks.filter((_, j) => j !== i).map((l) => l.sceneId));
      const grid = h("div.wd-scenes.is-picker");
      const tabs = h("div.seg.wd-tabs", [["", "全部"], ...CATEGORY_ORDER.map((k) => [k, catalog.categories[k]])].map(([value, text]) =>
        h("button", { type: "button", "aria-pressed": String(value === cat), onclick: (e) => {
          cat = value;
          tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget)));
          fillGrid();
        } }, text)));
      function fillGrid() {
        grid.replaceChildren(...catalog.scenes.filter((s) => !cat || s.category === cat).map((s) =>
          h(`button.wd-scene${s.id === look.sceneId ? ".is-on" : ""}`, { type: "button", onclick: () => { m.close(); update(lookFor(s)); } },
            sceneCover(s), used.has(s.id) ? h("span.wd-scene-used", "其他造型已选") : null, h("p.wd-scene-desc", s.description))));
      }
      fillGrid();
      const m = modal({ title: `造型 ${i + 1} · 选择场景`, wide: true, content: h("div.stack", tabs, grid,
        h("p.faint.small", "换场景会同时换上这个场景推荐的礼服和造型，之后还可以再改。")) });
    }
    drawLooks();
    return h("div.stack.wd-step",
      h("header.wd-step-head", h("h2", `定下 ${state.looks.length} 套造型`), h("p", "每套造型一个场景、一套新娘礼服和一套新郎礼服。选场景时会自动配好推荐的礼服和造型。")),
      wrap);
  }

  // ---------- step 4: confirm
  function stepConfirm() {
    const p = pkg();
    const balance = store.user?.credits ?? 0;
    return h("div.stack.wd-step",
      h("header.wd-step-head", h("h2", "确认订单"), h("p", "支付后马上开始拍摄，照片会一张张出现在相册里，大约每张 1 分钟。")),
      h("div.wd-confirm",
        h("div.wd-confirm-main",
          h("div.wd-confirm-people", ["bride", "groom"].map((role) => h("div",
            h("span.wd-label", ROLES[role]),
            h("div.wd-confirm-faces", state[role].map((u) => h("img", { src: u.thumb, alt: "" }))))),
            h("button.link", { type: "button", onclick: () => go(1) }, "修改")),
          h("ol.wd-confirm-looks", state.looks.map((look, i) => {
            const scene = sceneById.get(look.sceneId);
            const name = (role) => catalog.outfits[role].find((o) => o.categoryId === look[role].categoryId)?.name || "";
            const sty = (kind) => catalog.styling[kind].find((x) => x.key === look[kind])?.name || "";
            return h("li", scene ? sceneCover(scene, { label: false }) : null,
              h("div", h("strong", `造型 ${i + 1} · ${scene?.name || ""}`),
                h("span.faint.small", `${name("bride")} + ${name("groom")}`),
                h("span.faint.small", [sty("hair"), sty("headpiece"), sty("makeup")].filter(Boolean).join(" · "))));
          })),
          h("button.link", { type: "button", onclick: () => go(2) }, "修改造型")),
        h("aside.wd-receipt",
          h("h3", state.title || "我的婚纱照"),
          h("dl",
            h("dt", "套系"), h("dd", `${p.name} · ${p.price} 点`),
            h("dt", "张数"), h("dd.num", `${p.looks} 套 × ${perLook()} 张 = ${p.looks * perLook()} 张`),
            state.extra ? [h("dt", "加拍"), h("dd.num", `${state.extra * p.looks} 张 × ${catalog.extraPhotoPrice} 点`)] : null,
            h("dt", "免费重拍"), h("dd.num", `${p.retakes} 次`),
            h("dt", "画质"), h("dd", "2K 高清原图")),
          h("div.wd-receipt-total", h("span", "合计"), h("strong.num", price()), h("span", "点")),
          h("p.faint.small", `当前余额 ${number(balance)} 点${balance < price() ? `，还差 ${number(price() - balance)} 点` : ""}`),
          balance < price() ? h("a.btn.btn-white.btn-block", { href: "/pricing" }, cicon("gem", "orange"), "去充值") : null,
          h("p.faint.small", "没拍成的照片可以申请退回该张的点数。"))));
  }

  async function submit(button) {
    for (let s = 0; s < 3; s++) {
      const problem = problems(s);
      if (problem) { toast(problem, { type: "error" }); go(s); return; }
    }
    await busy(button, async () => {
      try {
        const { shoot } = await api.post("/api/wedding/shoots", {
          packageKey: state.packageKey, extraPerLook: state.extra, title: state.title.trim(), consent: state.consent,
          brideUploadIds: state.bride.map((u) => u.id), groomUploadIds: state.groom.map((u) => u.id),
          looks: state.looks.map(({ sceneId, bride, groom, hair, headpiece, makeup }) => ({ sceneId, bride, groom, hair, headpiece, makeup }))
        });
        weddingDraft.clear();
        store.refreshUser();
        toast("已开始拍摄，照片会陆续出现在相册里", { type: "success" });
        ctx.navigate(`/wedding/albums/${shoot.id}`);
      } catch (err) {
        if (err.code === "INSUFFICIENT_CREDITS") {
          toast(err.message, { type: "error" });
          drawBar();
        } else toastError(err);
      }
    });
  }

  draw();
  const unsubscribe = store.subscribe(() => drawBar());
  return {
    node: h("div.wd-wizard",
      h("div.wrap",
        h("header.wd-wizard-head", h("a.link", { href: "/wedding" }, "← 婚纱影楼"), stepper),
        body),
      h("div.wd-bar", h("div.wrap.wd-bar-row", h("div", priceEl, hint), h("div.wd-bar-actions", back, next)))),
    cleanup() { unsubscribe(); }
  };
}

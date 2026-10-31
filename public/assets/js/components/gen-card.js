import { h, icon, tile, cicon, replace } from "../core/dom.js";
import { api } from "../core/api.js";
import { store, draft } from "../core/store.js";
import { toast, toastError, confirmDialog, lightbox, modal } from "../core/ui.js";
import { relative, STATUS_TEXT, QUALITY_TEXT, number } from "../core/format.js";
import { navigate } from "../core/nav.js";

// Typical durations per quality, used only to pace the progress bar.
const EXPECTED_SECONDS = { low: 25, medium: 55, high: 110 };

function waitingView(gen) {
  const fill = h("div.progress-fill");
  const text = h("span");
  const bar = h("div.progress", { role: "progressbar", "aria-label": "生成进度", "aria-valuemin": 0, "aria-valuemax": 100 }, fill);
  const node = h("div.gen-wait", { style: { aspectRatio: gen.ratio.replace(":", " / ") } }, h("div.spinner"), text, bar);
  function update() {
    if (gen.status === "queued") {
      fill.style.width = "4%";
      text.textContent = gen.n > 1 ? `排队中 · ${gen.n} 张` : "排队中";
      return;
    }
    const elapsed = Math.max(0, (Date.now() - (gen.startedAt || gen.createdAt)) / 1000);
    const expected = (EXPECTED_SECONDS[gen.quality] || 55) * (gen.tier === "hd" ? 1.3 : gen.tier === "uhd" ? 1.8 : 1) * (1 + (gen.n - 1) * 0.25);
    // Approaches 94% asymptotically; the real result replaces this view.
    const pct = Math.min(94, 6 + 88 * (1 - Math.exp(-elapsed / (expected * 0.6))));
    fill.style.width = `${pct.toFixed(1)}%`;
    bar.setAttribute("aria-valuenow", String(Math.round(pct)));
    text.textContent = `正在生成${gen.n > 1 ? ` ${gen.n} 张` : ""} · ${Math.round(elapsed)} 秒`;
  }
  update();
  const timer = setInterval(update, 1000);
  return { node, stop: () => clearInterval(timer) };
}

const PERSON_TEXT = { real: "真人照片", virtual: "虚拟人" };

// Every reference a work used, labelled: [label, thumb url or null, chip text].
export function refEntries(refs = {}) {
  const out = [];
  if (refs.pose) out.push(["姿势", refs.pose.thumb, refs.pose.thumb ? "" : "已下架"]);
  if (refs.outfit?.thumb) out.push(["服装", refs.outfit.thumb, ""]);
  else if (refs.outfit?.upload) out.push(["服装", null, "自定义服装"]);
  else if (refs.outfit) out.push(["服装", null, "已下架"]);
  if (refs.person) out.push(["人物", refs.person.thumb || null, PERSON_TEXT[refs.person.kind] || "人物"]);
  if (refs.scene) out.push(["场景", refs.scene.thumb, refs.scene.thumb ? "" : "已下架"]);
  for (const item of refs.items || []) out.push(["物品", item.thumb, item.thumb ? "" : "已下架"]);
  return out;
}

function refThumbs(gen) {
  const entries = refEntries(gen.refs);
  if (!entries.length) return null;
  return h("div.gen-refs", entries.map(([name, thumb, chip]) => (thumb
    ? h("img", { src: thumb, alt: `${name}参考`, title: chip ? `${name}（${chip}）` : `${name}参考` })
    : h("span.ref-chip", { title: name }, chip))));
}

// The larger, labelled version for detail views.
export function refBlock(refs) {
  const entries = refEntries(refs);
  if (!entries.length) return h("p.small.muted", "这张图只用了文字描述。");
  return h("div.ref-block", entries.map(([name, thumb, chip]) => h("figure.ref-block-item",
    thumb ? h("img", { src: thumb, alt: "" }) : h("span.ref-block-empty", chip),
    h("figcaption", name, chip && thumb ? h("span.faint", ` · ${chip}`) : null))));
}

export function settingsText(gen) {
  const cfg = store.config.generation;
  const style = cfg.styles.find((s) => s.id === gen.style)?.label;
  const scene = cfg.scenes.find((s) => s.id === gen.scene)?.label;
  // The base tier (multiplier 1) goes unnamed so "标准" isn't shown twice.
  const tier = cfg.tiers.find((t) => t.id === gen.tier);
  const quality = cfg.qualities.find((q) => q.id === gen.quality)?.label || QUALITY_TEXT[gen.quality] || gen.quality;
  return [gen.ratio, `${quality}画质`, tier && tier.multiplier !== 1 ? tier.label : null, style, scene].filter(Boolean).join(" · ");
}

// Send a work's references and settings back to the studio. Library assets go
// in the URL so the studio loads them fresh; the person goes in the draft.
export function reuseInStudio(gen) {
  const refs = gen.refs || {};
  const person = refs.person?.id && refs.person.thumb
    ? { source: refs.person.source, id: refs.person.id, url: refs.person.thumb, virtual: refs.person.kind === "virtual" }
    : null;
  draft.patch({ ratio: gen.ratio, tier: gen.tier, quality: gen.quality, n: gen.n, style: gen.style, scene: gen.scene,
    prompt: gen.prompt || "", pose: null, outfit: null, outfitUpload: null, sceneAsset: null, items: [], person });
  const params = new URLSearchParams();
  if (refs.pose?.id) params.set("pose", refs.pose.id);
  if (refs.outfit?.id) params.set("outfit", refs.outfit.id);
  if (refs.scene?.id) params.set("sceneId", refs.scene.id);
  if (refs.items?.length) params.set("items", refs.items.map((i) => i.id).join(","));
  if (refs.outfit?.upload) toast("上传的服装图需要重新选择", { type: "error" });
  if (refs.person && !person) toast("人物照片已删除，需要重新选择", { type: "error" });
  navigate(`/studio${params.size ? `?${params}` : ""}`);
}

// Use one image of a work as the person, keeping the rest of the studio as is.
// It counts as virtual unless the work itself used a real person's photo.
export function useAsPerson(gen, img) {
  draft.patch({ person: { source: "image", id: img.id, url: img.thumb, virtual: gen.personKind !== "real" } });
  toast(gen.personKind === "real" ? "已把这张图设为人物（含真人照片，作品仅自己可见）" : "已把这张图设为人物（虚拟人）", { type: "success" });
  navigate("/studio");
}

// Card size for lists of works, remembered per page: s / m / l.
const SIZES = [["s", "小"], ["m", "中"], ["l", "大"]];
export function cardSizeSwitch(list, storageKey) {
  let size = "m";
  try { size = localStorage.getItem(storageKey) || "m"; } catch { /* private mode */ }
  if (!SIZES.some(([v]) => v === size)) size = "m";
  list.dataset.size = size;
  return h("div.seg.size-seg", { role: "radiogroup", "aria-label": "卡片大小" }, SIZES.map(([value, text]) =>
    h("button", { type: "button", role: "radio", "aria-checked": String(value === size), "aria-pressed": String(value === size),
      title: `${text}卡片`, onclick: (e) => {
        list.dataset.size = value;
        try { localStorage.setItem(storageKey, value); } catch { /* private mode */ }
        e.currentTarget.parentElement.querySelectorAll("button").forEach((b) => {
          b.setAttribute("aria-checked", String(b === e.currentTarget));
          b.setAttribute("aria-pressed", String(b === e.currentTarget));
        });
      } }, text)));
}

const actionButton = (iconName, color, text, onclick, { pressed } = {}) =>
  h("button.btn.btn-ghost.gen-act", { type: "button", title: text, "aria-label": text, onclick,
    ...(pressed !== undefined ? { "aria-pressed": String(pressed) } : {}) }, cicon(iconName, color), h("span.btn-label", text));

// One generation job: progress while it runs, then the images. `onChange(gen | null)`
// reports updates and removal. `keep(gen)` says whether the card still belongs
// in its list after the user hides, unhides or unfavourites it.
export function genCard(gen, { onChange, keep } = {}) {
  const root = h("article.gen", { dataset: { id: gen.id } });
  let waiting = null;

  function render() {
    waiting?.stop();
    waiting = null;
    root.className = `gen is-${gen.status}`;
    const head = h("div.gen-head",
      h("span.gen-status", STATUS_TEXT[gen.status]),
      h("span.gen-time", relative(gen.createdAt)),
      gen.favorite ? h("span.gen-fav", { title: "已收藏" }, icon("heart", 13)) : null,
      h("span.gen-cost.num", gen.refunded ? `${gen.refunded} 点已退回` : `${number(gen.cost)} 点`),
      h("span.gen-meta", settingsText(gen)));
    let body;
    if (gen.status === "queued" || gen.status === "running") {
      waiting = waitingView(gen);
      body = waiting.node;
    } else if (gen.status === "failed") {
      body = h("div.gen-fail", tile("alert", "red"),
        h("div", h("p", gen.errorMessage || "生成失败"), gen.refunded ? h("p.small.muted", `已退回 ${gen.refunded} 点`) : null));
    } else {
      body = h("div.gen-grid", { class: `n-${Math.min(gen.images.length, 4)}` },
        gen.images.map((img, i) => h("div.gen-shot",
          h("button.gen-shot-open", { type: "button", "aria-label": `查看第 ${i + 1} 张大图`,
            onclick: () => openViewer(gen, i, { onChange: (g) => { if (g) { gen = g; render(); onChange?.(g); } } }) },
            h("img", { src: img.thumb, alt: `生成结果 ${i + 1}`, loading: "lazy", style: { aspectRatio: `${img.width} / ${img.height}` } })),
          h("div.gen-shot-tools",
            h("a", { href: img.download, download: "", "data-native": "", title: "下载原图", "aria-label": `下载第 ${i + 1} 张` }, icon("download", 16))))));
    }
    const done = gen.status !== "queued" && gen.status !== "running";
    const canPublish = store.config.showcase.enabled && gen.status === "succeeded" && gen.personKind !== "real";
    const actions = h("div.gen-actions",
      done ? actionButton("redo", "blue", "再来一次", () => reuseInStudio(gen)) : null,
      canPublish ? actionButton("share", "purple", gen.isPublic ? "取消公开" : "公开", togglePublic) : null,
      done ? actionButton("heart", "pink", gen.favorite ? "取消收藏" : "收藏", () => setFlag({ favorite: !gen.favorite }), { pressed: gen.favorite }) : null,
      done ? actionButton(gen.userHidden ? "eye" : "eyeOff", "gray", gen.userHidden ? "取消隐藏" : "隐藏", () => setFlag({ hidden: !gen.userHidden })) : null,
      done ? actionButton("trash", "red", "删除", remove) : null);
    replace(root, head, body, h("div.gen-foot", refThumbs(gen), gen.prompt ? h("p.gen-prompt", gen.prompt) : null, actions));
  }

  async function setFlag(patch) {
    try {
      const { generation } = await api.post(`/api/generations/${gen.id}/flags`, patch);
      gen = generation;
      if (keep && !keep(gen)) {
        waiting?.stop();
        root.remove();
        onChange?.(null);
      } else {
        render();
        onChange?.(gen);
      }
      if (patch.hidden !== undefined) toast(gen.userHidden ? "已隐藏，可在「我的作品 → 已隐藏」里找回" : "已取消隐藏", { type: "success" });
      else toast(gen.favorite ? "已收藏" : "已取消收藏", { type: "success" });
    } catch (err) { toastError(err); }
  }

  async function togglePublic() {
    try {
      const { generation } = await api.post(`/api/generations/${gen.id}/publish`, { public: !gen.isPublic });
      gen = generation;
      render();
      onChange?.(gen);
      toast(gen.isPublic ? "已发布到灵感广场" : "已取消公开", { type: "success" });
    } catch (err) { toastError(err); }
  }

  async function remove() {
    if (!(await confirmDialog({ title: "删除这个作品？", message: "图片文件会一起删除，无法恢复。", confirmText: "删除", danger: true }))) return;
    try {
      await api.del(`/api/generations/${gen.id}`);
      waiting?.stop();
      root.remove();
      onChange?.(null);
      toast("已删除", { type: "success" });
    } catch (err) { toastError(err); }
  }

  render();
  return {
    node: root,
    update(next) { gen = next; render(); },
    get gen() { return gen; },
    destroy() { waiting?.stop(); }
  };
}

const REPORT_REASONS = [["sexual", "色情低俗"], ["minor", "涉及未成年人"], ["portrait", "侵犯肖像或隐私"],
  ["copyright", "侵犯版权"], ["illegal", "违法违规"], ["other", "其他"]];

export function reportDialog(generationId) {
  if (!store.user) { location.href = `/login?next=${encodeURIComponent(location.pathname)}`; return; }
  let reason = "";
  const detail = h("textarea.textarea", { rows: 3, maxLength: 500, placeholder: "补充说明（选填）" });
  const send = h("button.btn.btn-primary", { type: "button", disabled: true, onclick: async () => {
    try {
      await api.post("/api/reports", { generationId, reason, detail: detail.value });
      m.close();
      toast("已提交，我们会尽快处理", { type: "success" });
    } catch (err) { toastError(err); }
  } }, "提交举报");
  const m = modal({
    title: "举报作品",
    content: h("div.stack",
      h("div.chips", REPORT_REASONS.map(([value, text]) => h("button.chip", { type: "button", "aria-pressed": "false",
        onclick: (e) => {
          reason = value;
          e.currentTarget.parentElement.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c === e.currentTarget)));
          send.disabled = false;
        } }, text))),
      detail),
    footer: [h("button.btn", { type: "button", onclick: () => m.close() }, "取消"), send]
  });
}

// Full-size viewer for the owner's work: what it was made from, download,
// publishing, and sending it back to the studio.
export function openViewer(gen, start = 0, { onChange } = {}) {
  const items = gen.images.map((img, i) => ({ src: img.url, alt: `生成结果 ${i + 1}`, img }));
  return lightbox(items, start, {
    renderAside: (item, { close }) => {
      const canPublish = store.config.showcase.enabled && gen.personKind !== "real";
      const publish = canPublish ? h("button.btn.btn-block", { type: "button", onclick: async (e) => {
        const button = e.currentTarget;
        try {
          const { generation } = await api.post(`/api/generations/${gen.id}/publish`, { public: !gen.isPublic });
          gen = generation;
          onChange?.(gen);
          button.replaceChildren(cicon("share", "purple"), gen.isPublic ? "取消公开" : "发布到灵感广场");
          toast(gen.isPublic ? "已发布到灵感广场" : "已取消公开", { type: "success" });
        } catch (err) { toastError(err); }
      } }, cicon("share", "purple"), gen.isPublic ? "取消公开" : "发布到灵感广场") : null;
      const allowPerson = store.config.generation.allowPersonPhoto || gen.personKind !== "real";
      return h("div.viewer-aside",
        h("p.viewer-title", settingsText(gen)),
        gen.prompt ? h("p.small.muted", gen.prompt) : null,
        h("div.viewer-sec", h("p.viewer-sec-title", "所用参考"), refBlock(gen.refs)),
        gen.refs?.license ? h("p.small.muted", gen.refs.license === "commercial"
          ? "用到的素材均可商用。" : "用到了非商用素材，这张图仅限个人非商业用途。") : null,
        h("p.small.faint", `${item.img.width} × ${item.img.height} · ${item.img.format.toUpperCase()}`),
        h("div.viewer-actions",
          h("a.btn.btn-primary.btn-block", { href: item.img.download, download: "", "data-native": "" }, cicon("download", "green"), "下载原图"),
          h("button.btn.btn-block", { type: "button", onclick: () => { close(); reuseInStudio(gen); } },
            cicon("redo", "blue"), "用同样的参考再创作"),
          allowPerson ? h("button.btn.btn-block", { type: "button", onclick: () => { close(); useAsPerson(gen, item.img); } },
            cicon("person", "green"), "用这张图作人物继续创作") : null,
          publish,
          gen.personKind === "real" ? h("p.small.muted", "使用了真人照片的作品仅自己可见，不能公开。") : null,
          h("button.btn.btn-ghost.btn-block", { type: "button", onclick: close }, "关闭")));
    }
  });
}

// Polls active jobs and reports each update. One request covers every job.
export function jobWatcher(onUpdate) {
  const ids = new Set();
  let timer = null;
  let stopped = false;
  async function tick() {
    timer = null;
    if (stopped || !ids.size) return;
    try {
      const { items } = await api.get("/api/generations/status", { ids: [...ids].join(",") });
      for (const gen of items) {
        onUpdate(gen);
        if (gen.status === "succeeded" || gen.status === "failed") ids.delete(gen.id);
      }
    } catch { /* retry next tick */ }
    schedule();
  }
  function schedule() {
    if (!stopped && ids.size && !timer) timer = setTimeout(tick, document.hidden ? 8000 : 2500);
  }
  return {
    watch(id) { ids.add(id); schedule(); },
    stop() { stopped = true; clearTimeout(timer); }
  };
}

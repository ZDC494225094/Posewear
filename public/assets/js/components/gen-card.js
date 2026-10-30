import { h, icon, tile, cicon, replace } from "../core/dom.js";
import { api } from "../core/api.js";
import { store } from "../core/store.js";
import { toast, toastError, confirmDialog, lightbox, modal } from "../core/ui.js";
import { relative, STATUS_TEXT, QUALITY_TEXT, number } from "../core/format.js";

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

function refThumbs(gen) {
  const refs = [];
  if (gen.refs?.pose?.thumb) refs.push(h("img", { src: gen.refs.pose.thumb, alt: "姿势参考", title: "姿势参考" }));
  if (gen.refs?.outfit?.thumb) refs.push(h("img", { src: gen.refs.outfit.thumb, alt: "服装参考", title: "服装参考" }));
  else if (gen.refs?.outfit?.upload) refs.push(h("span.ref-chip", "自定义服装"));
  if (gen.refs?.person) refs.push(h("span.ref-chip", "人物照片"));
  return refs.length ? h("div.gen-refs", refs) : null;
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

// One generation job: progress while it runs, then the images. `onChange(gen | null)`
// reports updates and deletion; `onReuse(gen)` refills the studio with its settings.
export function genCard(gen, { onChange, onReuse } = {}) {
  const root = h("article.gen", { dataset: { id: gen.id } });
  let waiting = null;

  function render() {
    waiting?.stop();
    waiting = null;
    root.className = `gen is-${gen.status}`;
    const head = h("div.gen-head",
      h("span.gen-status", STATUS_TEXT[gen.status]),
      h("span.gen-meta", settingsText(gen)),
      h("span.gen-time", relative(gen.createdAt)),
      h("span.gen-cost.num", gen.refunded ? `${gen.refunded} 点已退回` : `${number(gen.cost)} 点`));
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
    const canPublish = store.config.showcase.enabled && gen.status === "succeeded" && !gen.refs?.person;
    const actions = h("div.gen-actions",
      onReuse && done ? h("button.btn.btn-ghost", { type: "button", onclick: () => onReuse(gen) }, cicon("redo", "blue"), "再来一次") : null,
      canPublish ? h("button.btn.btn-ghost", { type: "button", onclick: togglePublic }, cicon("share", "purple"), gen.isPublic ? "取消公开" : "公开") : null,
      done ? h("button.btn.btn-ghost.btn-icon", { type: "button", "aria-label": "删除", title: "删除", onclick: remove }, cicon("trash", "red")) : null);
    replace(root, head, body, h("div.gen-foot", refThumbs(gen), gen.prompt ? h("p.gen-prompt", gen.prompt) : h("span", { style: { flex: 1 } }), actions));
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

// Full-size viewer for the owner's work, with download and publish actions.
export function openViewer(gen, start = 0, { onChange } = {}) {
  const items = gen.images.map((img, i) => ({ src: img.url, alt: `生成结果 ${i + 1}`, img }));
  return lightbox(items, start, {
    renderAside: (item, { close }) => {
      const canPublish = store.config.showcase.enabled && !gen.refs?.person;
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
      return h("div.viewer-aside",
        h("p.viewer-title", settingsText(gen)),
        gen.prompt ? h("p.small.muted", gen.prompt) : null,
        refThumbs(gen),
        gen.refs?.license ? h("p.small.muted", gen.refs.license === "commercial"
          ? "用到的素材均可商用。" : "用到了非商用素材，这张图仅限个人非商业用途。") : null,
        h("p.small.faint", `${item.img.width} × ${item.img.height} · ${item.img.format.toUpperCase()}`),
        h("div.viewer-actions",
          h("a.btn.btn-primary.btn-block", { href: item.img.download, download: "", "data-native": "" }, cicon("download", "green"), "下载原图"),
          publish,
          gen.refs?.person ? h("p.small.muted", "使用了人物照片的作品仅自己可见，不能公开。") : null,
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

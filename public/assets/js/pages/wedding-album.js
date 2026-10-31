import { h, icon, cicon } from "../core/dom.js";
import { api } from "../core/api.js";
import { store } from "../core/store.js";
import { toast, toastError, busy, emptyState, confirmDialog, lightbox, modal } from "../core/ui.js";
import { dateTime } from "../core/format.js";
import { statusPill } from "../components/wedding-kit.js";
import { albumCard } from "./wedding.js";

// One album: progress while the photos come in, the photos grouped by look,
// and per photo the versions, retake, favourite and refund. Polls while any
// photo is still being shot.
export async function render(ctx) {
  if (!ctx.params.id) return renderList();
  let shoot;
  try { shoot = (await api.get(`/api/wedding/shoots/${ctx.params.id}`)).shoot; } catch (err) {
    return h("div.wrap", emptyState({ title: err.status === 404 ? "相册不存在或已删除" : "暂时无法打开相册", text: err.status === 404 ? "" : err.message,
      icon: "alert", color: "orange", action: h("a.btn.btn-primary", { href: "/wedding/albums" }, "我的相册") }));
  }
  let filter = "all";
  let timer = null;
  let stopped = false;
  const head = h("header.wd-album-head");
  const progress = h("div.wd-progress");
  const toolbar = h("div.wd-album-toolbar");
  const groups = h("div.wd-groups");

  const visible = (item) => filter === "all" || (filter === "favorite" ? item.favorite : filter === "attention" ? item.status === "failed" : true);
  const ready = () => shoot.items.filter((it) => it.image && it.status !== "cancelled");

  function draw() {
    const p = shoot.package;
    head.replaceChildren(
      h("div",
        h("a.link", { href: "/wedding/albums" }, "← 我的相册"),
        h("h1", h("span", shoot.title || `${p.name}套系`),
          h("button.btn.btn-ghost.btn-sm.wd-rename", { type: "button", "aria-label": "修改相册名称", onclick: renameAlbum }, "改名")),
        h("p.faint", `${p.name}套系 · ${shoot.looks.length} 套造型 · ${shoot.photos} 张 · ${dateTime(shoot.createdAt)}`)),
      h("div.wd-album-actions",
        statusPill(shoot.status),
        h("a.btn.btn-primary", { href: `/api/wedding/shoots/${shoot.id}/download`, download: "", "aria-disabled": String(!ready().length),
          onclick: (e) => { if (!ready().length) { e.preventDefault(); toast("还没有拍好的照片"); } } }, cicon("download", "green"), "下载整册"),
        h("button.btn.btn-white.btn-icon", { type: "button", "aria-label": "删除相册", title: "删除相册", onclick: removeAlbum }, cicon("trash", "red"))));

    const pr = shoot.progress;
    const pct = pr.total ? Math.round((pr.done / Math.max(1, pr.total - pr.cancelled)) * 100) : 0;
    progress.hidden = !pr.active && !pr.failed;
    progress.replaceChildren(
      h("div.wd-progress-row",
        h("strong", pr.active ? `正在拍摄 · 已完成 ${pr.done}/${pr.total - pr.cancelled} 张` : `有 ${pr.failed} 张没拍成功`),
        h("span.faint.small", pr.active ? `大约还需 ${Math.max(1, Math.ceil(pr.active * 0.8))} 分钟，可以先离开，拍好后会保存在这里` : "可以免费重试，多次失败也可以退回该张的点数")),
      h("div.progress", h("div.progress-fill", { style: { width: `${pct}%` } })));

    const favs = shoot.items.filter((it) => it.favorite).length;
    toolbar.replaceChildren(
      h("div.seg.wd-tabs", { role: "group", "aria-label": "筛选" },
        [["all", `全部 ${shoot.items.length}`], ["favorite", `收藏 ${favs}`], pr.failed ? ["attention", `需要处理 ${pr.failed}`] : null].filter(Boolean)
          .map(([value, text]) => h("button", { type: "button", "aria-pressed": String(filter === value), onclick: () => { filter = value; draw(); } }, text))),
      h("span.faint.small", `免费重拍剩 ${shoot.retakesLeft} 次${shoot.retakesLeft ? "" : `，之后每张 ${shoot.retakePrice} 点`}`));

    groups.replaceChildren(...shoot.looks.map((look) => {
      const items = shoot.items.filter((it) => it.look === look.index && visible(it));
      if (!items.length) return null;
      return h("section.wd-group",
        h("header.wd-group-head",
          look.scene.thumb ? h("img", { src: look.scene.thumb, alt: "" }) : null,
          h("div", h("strong", `造型 ${look.index + 1} · ${look.scene.name}`),
            h("span.faint.small", [look.scene.categoryText, `${look.bride.name} + ${look.groom.name}`, look.styling.hair, look.styling.headpiece !== "不戴头饰" ? look.styling.headpiece : "", look.styling.makeup]
              .filter(Boolean).join(" · ")))),
        h("div.wd-photos", items.map(photoCard)));
    }).filter(Boolean));
    if (!groups.children.length) groups.append(emptyState({ title: filter === "favorite" ? "还没有收藏的照片" : "没有需要处理的照片", icon: "heart", color: "pink" }));
  }

  function photoCard(item) {
    const ratio = item.shot.ratio.split(":").map(Number);
    const media = h("div.wd-photo-media", { style: { aspectRatio: `${ratio[0]} / ${ratio[1]}` } });
    if (item.status === "cancelled") {
      media.append(h("div.wd-photo-state", icon("coins", 22), h("span", "已退回点数")));
    } else if (item.image) {
      media.append(h("img", { src: item.image.thumb, alt: item.shot.name, loading: "lazy", decoding: "async" }));
      media.addEventListener("click", () => openViewer(item));
      if (item.status === "queued" || item.status === "running") media.append(h("div.wd-photo-busy", h("span.spinner"), "重拍中"));
    } else if (item.status === "failed") {
      media.append(h("div.wd-photo-state.is-failed", icon("alert", 22), h("span", "这张没拍成功"), h("span.faint.small", item.errorMessage || "")));
    } else {
      media.append(h("div.wd-photo-state.is-wait", h("div.wd-shimmer"), h("span.spinner"), h("span", item.status === "running" ? "拍摄中" : "排队中")));
    }
    const active = item.status === "queued" || item.status === "running";
    const actions = [];
    if (item.image && !active) {
      actions.push(
        h(`button.wd-icon-btn${item.favorite ? ".is-on" : ""}`, { type: "button", "aria-label": item.favorite ? "取消收藏" : "收藏", title: item.favorite ? "取消收藏" : "收藏",
          onclick: (e) => favorite(e.currentTarget, item) }, icon("heart", 16)),
        h("a.wd-icon-btn", { href: item.image.download, download: "", "aria-label": "下载", title: "下载原图" }, icon("download", 16)),
        h("button.wd-icon-btn", { type: "button", "aria-label": "重拍", title: "重拍这张", onclick: (e) => retake(e.currentTarget, item) }, icon("redo", 16)));
    }
    if (item.status === "failed") {
      actions.push(h("button.btn.btn-primary.btn-sm", { type: "button", onclick: (e) => retake(e.currentTarget, item) }, item.freeRetry ? "免费重试" : "重拍"));
      if (!item.versions.length) actions.push(h("button.btn.btn-ghost.btn-sm", { type: "button", onclick: (e) => refund(e.currentTarget, item) }, "退回点数"));
    }
    return h(`figure.wd-photo${item.favorite ? ".is-fav" : ""}${ratio[0] > ratio[1] ? ".is-wide" : ""}`, { style: { "--ar": String(ratio[0] / ratio[1]) } },
      media,
      h("figcaption",
        h("div", h("strong", item.shot.name), item.versions.length > 1 ? h("span.wd-ver", `${item.versions.length} 个版本`) : null),
        h("div.wd-photo-actions", actions)));
  }

  // Large view across all finished photos; the side shows this photo's versions.
  function openViewer(start) {
    const list = ready().filter(visible);
    const index = Math.max(0, list.findIndex((it) => it.id === start.id));
    lightbox(list.map((it) => ({ src: it.image.url, zoomSrc: it.image.url, alt: it.shot.name, item: it })), index, {
      renderAside: ({ item }, { close }) => h("div.wd-viewer-aside",
        h("span.faint.small", `造型 ${item.look + 1} · ${shoot.looks[item.look]?.scene.name || ""}`),
        h("h3", item.shot.name),
        item.versions.length > 1 ? h("div",
          h("span.wd-label", "选择要保留的版本"),
          h("div.wd-versions", item.versions.map((v, i) => h(`button.wd-version${v.id === item.image.id ? ".is-on" : ""}`, { type: "button",
            onclick: async () => {
              try {
                shoot = (await api.post(`/api/wedding/shoots/${shoot.id}/photos/${item.id}/choose`, { imageId: v.id })).shoot;
                close(); draw(); toast(`已选用第 ${i + 1} 版`);
              } catch (err) { toastError(err); }
            } }, h("img", { src: v.thumb, alt: `第 ${i + 1} 版` }), h("span.num", i + 1))))) : null,
        h("div.stack",
          h("a.btn.btn-primary.btn-block", { href: item.image.download, download: "" }, cicon("download", "green"), "下载原图"),
          h("button.btn.btn-white.btn-block", { type: "button", onclick: (e) => { close(); retake(e.currentTarget, item); } }, cicon("redo", "blue"), "重拍这张")),
        h("p.faint.small", `${item.image.width} × ${item.image.height}，点图片可放大查看细节`))
    });
  }

  async function refresh() {
    try { shoot = (await api.get(`/api/wedding/shoots/${shoot.id}`)).shoot; draw(); } catch { /* keep the last view */ }
  }
  function poll() {
    clearTimeout(timer);
    if (stopped || !shoot.progress.active) return;
    timer = setTimeout(async () => {
      const before = shoot.progress.active;
      await refresh();
      if (before && !shoot.progress.active) {
        store.refreshUser();
        toast(shoot.progress.failed ? `拍摄完成，有 ${shoot.progress.failed} 张需要处理` : "整套照片都拍好了", { type: shoot.progress.failed ? "info" : "success" });
      }
      poll();
    }, 4000);
  }

  async function retake(button, item) {
    const free = item.freeRetry || shoot.retakesLeft > 0;
    if (!free) {
      const ok = await confirmDialog({ title: "重拍这张", message: `免费重拍次数已用完，这次重拍需要 ${shoot.retakePrice} 点。原来的照片会保留，可以在两个版本里选。`, confirmText: `支付 ${shoot.retakePrice} 点重拍` });
      if (!ok) return;
    }
    await busy(button, async () => {
      try {
        const res = await api.post(`/api/wedding/shoots/${shoot.id}/photos/${item.id}/retake`);
        shoot = res.shoot;
        toast(res.free ? "已免费重试" : res.usedRetake ? `已开始重拍，免费次数还剩 ${shoot.retakesLeft} 次` : `已开始重拍，扣除 ${res.charged} 点`);
        if (res.charged) store.refreshUser();
        draw(); poll();
      } catch (err) { toastError(err); }
    });
  }

  async function favorite(button, item) {
    try {
      shoot = (await api.post(`/api/wedding/shoots/${shoot.id}/photos/${item.id}/favorite`, { favorite: !item.favorite })).shoot;
      draw();
    } catch (err) { toastError(err); }
  }

  async function refund(button, item) {
    const ok = await confirmDialog({ title: "退回这张的点数", message: "退回后这张不会再拍，相应的点数会退到你的余额。", confirmText: "退回点数" });
    if (!ok) return;
    await busy(button, async () => {
      try {
        const res = await api.post(`/api/wedding/shoots/${shoot.id}/photos/${item.id}/cancel`);
        shoot = res.shoot;
        store.refreshUser();
        toast(`已退回 ${res.refunded} 点`, { type: "success" });
        draw();
      } catch (err) { toastError(err); }
    });
  }

  function renameAlbum() {
    const input = h("input.input", { value: shoot.title, maxLength: 30, placeholder: "例如：阿杰 & 小雨", autofocus: true });
    const m = modal({ title: "相册名称", content: input, footer: [
      h("button.btn", { type: "button", onclick: () => m.close() }, "取消"),
      h("button.btn.btn-primary", { type: "button", onclick: async (e) => {
        await busy(e.currentTarget, async () => {
          try { shoot = (await api.patch(`/api/wedding/shoots/${shoot.id}`, { title: input.value })).shoot; m.close(); draw(); } catch (err) { toastError(err); }
        });
      } }, "保存")] });
  }

  async function removeAlbum() {
    const ok = await confirmDialog({ title: "删除相册", message: "相册里的照片和两位上传的照片都会被删除，无法恢复。建议先下载整册。", confirmText: "删除", danger: true });
    if (!ok) return;
    try { await api.del(`/api/wedding/shoots/${shoot.id}`); toast("相册已删除"); ctx.navigate("/wedding/albums"); } catch (err) { toastError(err); }
  }

  draw();
  poll();
  return {
    node: h("div.wrap.wd-album-page", head, progress, toolbar, groups),
    cleanup() { stopped = true; clearTimeout(timer); }
  };
}

async function renderList() {
  let data;
  try { data = await api.get("/api/wedding/shoots", { size: 60 }); } catch (err) {
    toastError(err);
    return h("div.wrap", emptyState({ title: "暂时无法打开相册", icon: "alert", color: "orange" }));
  }
  return h("div.wrap.wd-albums-page",
    h("header.page-head", h("div", h("h1", "我的相册"), h("p", "每次拍摄是一本相册，可以挑版本、重拍和整册下载。")),
      h("a.btn.btn-primary", { href: "/wedding/new" }, cicon("plus", "pink"), "新的拍摄")),
    data.total
      ? h("div.wd-albums", data.items.map(albumCard))
      : emptyState({ title: "还没有婚纱照", text: "选个套系，上传两个人的照片就能开始。", icon: "heart", color: "pink",
        action: h("a.btn.btn-primary", { href: "/wedding" }, "去看看") }));
}

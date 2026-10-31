import { h, cicon } from "../core/dom.js";
import { api } from "../core/api.js";
import { store } from "../core/store.js";
import { lightbox, toastError, emptyState } from "../core/ui.js";
import { relative } from "../core/format.js";
import { reportDialog, refBlock } from "../components/gen-card.js";

// The library references of a public work, as a studio link. The person is
// never shared, only whether there was one.
export function sameRefsLink(g) {
  const params = new URLSearchParams();
  if (g.refs?.pose?.id) params.set("pose", g.refs.pose.id);
  if (g.refs?.outfit?.id && !g.refs.outfit.upload) params.set("outfit", g.refs.outfit.id);
  if (g.refs?.scene?.id) params.set("sceneId", g.refs.scene.id);
  if (g.refs?.items?.length) params.set("items", g.refs.items.map((i) => i.id).join(","));
  if (g.style) params.set("style", g.style);
  if (g.scene) params.set("scene", g.scene);
  if (g.camera) params.set("camera", g.camera);
  return `/studio?${params}`;
}

const hasLibraryRefs = (g) => !!(g.refs?.pose?.id || g.refs?.outfit?.id || g.refs?.scene?.id || g.refs?.items?.length);

export async function render() {
  if (!store.config.showcase.enabled) {
    return h("div.wrap", emptyState({ icon: "photos", color: "purple", title: "灵感广场暂未开放", text: "先去创作台做一张自己的作品吧。", action: h("a.btn.btn-primary", { href: "/studio" }, "去创作台") }));
  }
  let page = 1;
  let total = 0;
  const items = [];
  const grid = h("div.masonry.explore-grid");
  const more = h("button.btn", { type: "button", hidden: true, onclick: () => load() }, "加载更多");
  const styles = Object.fromEntries(store.config.generation.styles.map((s) => [s.id, s.label]));

  function open(index) {
    const flat = items.flatMap((g) => g.images.map((img) => ({ src: img.url, alt: "用户作品", g, img })));
    const start = flat.findIndex((x) => x.g === items[index]);
    lightbox(flat, Math.max(0, start), {
      renderAside: (item, { close }) => h("div.viewer-aside",
        h("p.viewer-title", item.g.author || "匿名创作者"),
        h("p.small.muted", [styles[item.g.style], relative(item.g.publishedAt)].filter(Boolean).join(" · ")),
        h("div.viewer-sec", h("p.viewer-sec-title", "所用参考"), refBlock(item.g.refs)),
        h("div.viewer-actions",
          hasLibraryRefs(item.g)
            ? h("a.btn.btn-primary.btn-block", { href: sameRefsLink(item.g), onclick: close }, cicon("sparkle", "yellow"), "用同款参考创作") : null,
          item.g.refs?.person ? h("p.small.muted", "人物参考不会公开，同款创作时可以换成自己的人物。") : null,
          h("button.btn.btn-ghost.btn-block", { type: "button", onclick: () => reportDialog(item.g.id) }, cicon("flag", "red", 15), "举报")))
    });
  }

  async function load() {
    more.disabled = true;
    try {
      const data = await api.get("/api/public/showcase", { page, size: 24 });
      total = data.total;
      for (const g of data.items) {
        const index = items.length;
        items.push(g);
        const img = g.images[0];
        if (!img) continue;
        grid.append(h("button.masonry-item", { type: "button", "aria-label": `查看 ${g.author || "创作者"} 的作品`, onclick: () => open(index) },
          h("img", { src: img.thumb, alt: "", loading: "lazy", style: { aspectRatio: `${img.width} / ${img.height}` } }),
          g.featured ? h("span.masonry-badge", "推荐") : null,
          h("span.masonry-author.small", g.author || "")));
      }
      page += 1;
      more.hidden = items.length >= total;
      if (!total) grid.replaceWith(emptyState({ icon: "photos", color: "purple", title: "广场上还没有作品", text: "生成满意的作品后，在作品详情里点“发布到灵感广场”。",
        action: h("a.btn.btn-primary", { href: "/studio" }, "去创作") }));
    } catch (err) { toastError(err); }
    more.disabled = false;
  }
  load();

  return h("div.explore.wrap",
    h("header.page-head", h("div", h("h1", "灵感广场"), h("p", "大家公开分享的作品。看到喜欢的，可以直接用同一组姿势、服装、场景和物品创作。"))),
    grid,
    h("div.lib-more-wrap", more));
}

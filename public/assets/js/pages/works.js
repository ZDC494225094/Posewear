import { h, cicon } from "../core/dom.js";
import { api } from "../core/api.js";
import { store, draft } from "../core/store.js";
import { toastError, emptyState } from "../core/ui.js";
import { navigate } from "../core/nav.js";
import { genCard, jobWatcher } from "../components/gen-card.js";

const TABS = [["", "全部"], ["active", "进行中"], ["succeeded", "已完成"], ["failed", "失败"], ["public", "已公开"]];

export async function render(ctx) {
  let status = TABS.some(([v]) => v === ctx.query.status) ? ctx.query.status : "";
  let page = 1;
  const size = 24;
  const cards = new Map();
  const list = h("div.works-grid");
  const more = h("button.btn", { type: "button", hidden: true, onclick: () => load(false) }, "加载更多");
  const summary = h("p.small.muted");
  const watcher = jobWatcher((gen) => {
    cards.get(gen.id)?.update(gen);
    if (gen.status === "failed" || gen.refunded) store.refreshUser();
  });

  function reuse(gen) {
    const patch = { ratio: gen.ratio, tier: gen.tier, quality: gen.quality, n: gen.n, style: gen.style, scene: gen.scene, prompt: gen.prompt };
    draft.patch(patch);
    const params = new URLSearchParams();
    if (gen.refs?.pose?.id) params.set("pose", gen.refs.pose.id);
    if (gen.refs?.outfit?.id) params.set("outfit", gen.refs.outfit.id);
    navigate(`/studio${params.size ? `?${params}` : ""}`);
  }

  async function load(reset) {
    if (reset) { page = 1; cards.forEach((c) => c.destroy()); cards.clear(); list.replaceChildren(); }
    else page += 1;
    more.disabled = true;
    try {
      const data = await api.get("/api/generations", { status, page, size });
      for (const gen of data.items) {
        const card = genCard(gen, { onReuse: reuse, onChange: (g) => { if (!g) cards.delete(gen.id); } });
        cards.set(gen.id, card);
        list.append(card.node);
        if (gen.status === "queued" || gen.status === "running") watcher.watch(gen.id);
      }
      summary.textContent = `共 ${data.total} 个作品`;
      more.hidden = cards.size >= data.total;
      if (!data.total) {
        list.replaceChildren(emptyState({
          icon: status ? "photos" : "sparkle", color: status ? "purple" : "orange",
          icon: status ? "photos" : "sparkle", color: status ? "purple" : "orange",
          icon: status ? "photos" : "sparkle", color: status ? "purple" : "orange",
          title: status ? "这里还没有作品" : "还没有生成过作品",
          text: status ? "换个分类看看。" : "去创作台挑个姿势和服装，生成第一张吧。",
          action: h("a.btn.btn-primary", { href: "/studio" }, "去创作台")
        }));
      }
    } catch (err) { toastError(err); }
    more.disabled = false;
  }

  const tabs = h("div.seg.works-tabs", { role: "group", "aria-label": "作品状态" }, TABS.map(([value, text]) =>
    h("button", { type: "button", "aria-pressed": String(value === status), onclick: (e) => {
      status = value;
      e.currentTarget.parentElement.querySelectorAll("button").forEach((c) => c.setAttribute("aria-pressed", String(c === e.currentTarget)));
      history.replaceState({}, "", value ? `/works?status=${value}` : "/works");
      load(true);
    } }, text)));

  load(true);
  return {
    node: h("div.works.wrap",
      h("header.page-head", h("div", h("h1", "我的作品"), h("p", "生成记录永久保存在这里，可以下载原图、发布到灵感广场或用同样的设置再来一次。")),
        h("a.btn.btn-primary", { href: "/studio" }, cicon("sparkle", "yellow"), "新建创作")),
      h("div.works-toolbar", tabs, summary),
      list,
      h("div.lib-more-wrap", more)),
    cleanup() { watcher.stop(); cards.forEach((c) => c.destroy()); }
  };
}

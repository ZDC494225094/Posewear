import { h, cicon } from "../core/dom.js";
import { api } from "../core/api.js";
import { store } from "../core/store.js";
import { toastError, emptyState } from "../core/ui.js";
import { genCard, jobWatcher, cardSizeSwitch } from "../components/gen-card.js";

const TABS = [["", "全部"], ["active", "进行中"], ["succeeded", "已完成"], ["failed", "失败"], ["public", "已公开"],
  ["favorite", "收藏"], ["hidden", "已隐藏"]];
const EMPTY_TEXT = { favorite: "点作品上的“收藏”，常用的作品就会集中在这里。", hidden: "隐藏的作品不会出现在其他列表里，在这里可以取消隐藏。" };

export async function render(ctx) {
  let status = TABS.some(([v]) => v === ctx.query.status) ? ctx.query.status : "";
  let page = 1;
  const size = 24;
  const cards = new Map();
  const list = h("div.feed.works-feed");
  const more = h("button.btn", { type: "button", hidden: true, onclick: () => load(false) }, "加载更多");
  const summary = h("p.small.muted");
  let total = 0;
  const watcher = jobWatcher((gen) => {
    cards.get(gen.id)?.update(gen);
    if (gen.status === "failed" || gen.refunded) store.refreshUser();
  });

  // Whether a work still belongs in the current tab after the user files it.
  const keep = (g) => (status === "hidden" ? g.userHidden : !g.userHidden && (status !== "favorite" || g.favorite));

  function showEmpty() {
    list.replaceChildren(emptyState({
      icon: status ? "photos" : "sparkle", color: status ? "purple" : "orange",
      title: status ? "这里还没有作品" : "还没有生成过作品",
      text: EMPTY_TEXT[status] || (status ? "换个分类看看。" : "去创作台挑个姿势和服装，生成第一张吧。"),
      action: status === "hidden" || status === "favorite" ? null : h("a.btn.btn-primary", { href: "/studio" }, "去创作台")
    }));
  }

  async function load(reset) {
    if (reset) { page = 1; cards.forEach((c) => c.destroy()); cards.clear(); list.replaceChildren(); }
    else page += 1;
    more.disabled = true;
    try {
      const data = await api.get("/api/generations", { status, page, size });
      total = data.total;
      for (const gen of data.items) {
        const card = genCard(gen, { keep, onChange: (g) => {
          if (g) return;
          cards.delete(gen.id);
          total -= 1;
          summary.textContent = `共 ${total} 个作品`;
          if (!cards.size) showEmpty();
        } });
        cards.set(gen.id, card);
        list.append(card.node);
        if (gen.status === "queued" || gen.status === "running") watcher.watch(gen.id);
      }
      summary.textContent = `共 ${total} 个作品`;
      more.hidden = cards.size >= total;
      if (!total) showEmpty();
    } catch (err) { toastError(err); }
    more.disabled = false;
  }

  const tabs = h("div.seg.works-tabs", { role: "group", "aria-label": "作品分类" }, TABS.map(([value, text]) =>
    h("button", { type: "button", "aria-pressed": String(value === status), onclick: (e) => {
      status = value;
      e.currentTarget.parentElement.querySelectorAll("button").forEach((c) => c.setAttribute("aria-pressed", String(c === e.currentTarget)));
      history.replaceState({}, "", value ? `/works?status=${value}` : "/works");
      load(true);
    } }, text)));

  load(true);
  return {
    node: h("div.works.wrap",
      h("header.page-head", h("div", h("h1", "我的作品"), h("p", "生成记录永久保存在这里。可以下载原图、发布到灵感广场、收藏或隐藏，也可以带着同样的参考回到创作台再来一次。")),
        h("a.btn.btn-primary", { href: "/studio" }, cicon("sparkle", "yellow"), "新建创作")),
      h("div.works-toolbar", tabs, h("div.works-tools", summary, cardSizeSwitch(list, "pw-size-works"))),
      list,
      h("div.lib-more-wrap", more)),
    cleanup() { watcher.stop(); cards.forEach((c) => c.destroy()); }
  };
}

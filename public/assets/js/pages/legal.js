import { h } from "../core/dom.js";
import { api } from "../core/api.js";
import { emptyState } from "../core/ui.js";
import { markdown } from "../core/markdown.js";

export async function render(ctx) {
  try {
    const page = await api.get(`/api/public/legal/${encodeURIComponent(ctx.params.slug)}`);
    document.title = `${page.title} · ${document.title.split(" · ").pop()}`;
    return h("article.legal.wrap.paper", markdown(page.content));
  } catch {
    return h("div.wrap", emptyState({ title: "页面不存在", action: h("a.btn", { href: "/" }, "返回首页") }));
  }
}

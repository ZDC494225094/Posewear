import { h } from "../core/dom.js";
import { emptyState } from "../core/ui.js";

export function render() {
  return h("div.wrap", emptyState({
    icon: "alert", color: "gray",
    title: "这个页面不存在",
    text: "链接可能写错了，或者内容已经被删除。",
    action: h("a.btn.btn-primary", { href: "/" }, "返回首页")
  }));
}

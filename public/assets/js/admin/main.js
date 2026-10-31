import { h, tile, replace } from "../core/dom.js";
import { api } from "../core/api.js";
import { store } from "../core/store.js";
import { createRouter } from "../core/router.js";
import { setRouter } from "../core/nav.js";

// [path, title, icon, tile colour, page module]
const NAV = [
  ["概览", [["/admin", "数据概览", "chart", "blue", () => import("./pages/dashboard.js")]]],
  ["运营", [
    ["/admin/users", "用户", "users", "indigo", () => import("./pages/users.js")],
    ["/admin/generations", "生成记录", "photos", "purple", () => import("./pages/generations.js")],
    ["/admin/orders", "订单", "receipt", "green", () => import("./pages/orders.js")],
    ["/admin/reports", "举报与审核", "flag", "red", () => import("./pages/reports.js")]
  ]],
  ["商品", [
    ["/admin/packages", "充值套餐", "bag", "orange", () => import("./pages/packages.js")],
    ["/admin/redeem", "兑换码", "ticket", "pink", () => import("./pages/redeem.js")]
  ]],
  ["内容", [
    ["/admin/assets", "素材库", "hanger", "teal", () => import("./pages/assets.js")],
    ["/admin/asset-jobs", "素材生成记录", "list", "purple", () => import("./pages/asset-jobs.js")],
    ["/admin/asset-categories", "素材分类", "folder", "blue", () => import("./pages/asset-categories.js")],
    ["/admin/asset-settings", "素材生成与分成", "coins", "yellow", () => import("./pages/asset-settings.js")],
    ["/admin/virtual-persons", "虚拟人审核", "person", "green", () => import("./pages/virtual-persons.js")],
    ["/admin/safety", "内容安全", "shield", "green", () => import("./pages/safety.js")]
  ]],
  ["配置", [
    ["/admin/channels", "AI 渠道", "bolt", "orange", () => import("./pages/channels.js")],
    ["/admin/generation", "生成与计费", "sliders", "gray", () => import("./pages/generation.js")],
    ["/admin/prompt", "提示词模板", "text", "indigo", () => import("./pages/prompt.js")],
    ["/admin/payments", "支付", "card", "blue", () => import("./pages/payments.js")],
    ["/admin/site", "站点与注册", "globe", "teal", () => import("./pages/site.js")]
  ]],
  ["记录", [["/admin/audit", "操作日志", "list", "gray", () => import("./pages/audit.js")]]]
];

async function boot() {
  const root = document.getElementById("admin-root");
  try {
    await store.init();
  } catch {
    replace(root, h("div.boot", "暂时无法连接服务器"));
    return;
  }
  if (!store.user) { location.href = `/login?next=${encodeURIComponent(location.pathname)}`; return; }
  if (store.user.role !== "admin") {
    replace(root, h("div.boot", h("div.empty", h("div.empty-title", "没有后台权限"), h("a.btn", { href: "/" }, "返回首页"))));
    return;
  }
  const outlet = h("main#main.a-main", { tabIndex: -1 });
  const badges = new Map();
  const side = h("aside.a-side",
    h("a.a-brand", { href: "/admin" }, h("img", { src: "/assets/img/favicon.svg", alt: "", width: 28, height: 28 }),
      h("span.a-brand-name", store.config.site.name.split(" ")[0]), h("span.a-brand-tag", "后台")),
    h("nav.a-nav", { "aria-label": "后台导航" }, NAV.map(([group, items]) => h("div.a-nav-group",
      h("p.a-nav-label", group),
      items.map(([href, text, iconName, color]) => {
        const badge = h("span.a-badge", { hidden: true });
        badges.set(href, badge);
        return h("a.a-nav-link", { href, dataset: { nav: href } }, tile(iconName, color), text, badge);
      })))),
    h("div.a-side-foot",
      h("a.a-nav-link", { href: "/", "data-native": "" }, tile("arrowLeft", "black"), "返回前台"),
      h("p.small.faint", store.user.email)));
  replace(root, h("div.a-shell", side, outlet));

  const routes = NAV.flatMap(([, items]) => items.map(([path, title, , , load]) => ({ path, title, load })));
  const router = createRouter({
    routes, outlet,
    notFound: { path: "*", title: "页面不存在", load: async () => ({ render: () => h("div.a-empty", "页面不存在") }) },
    onChange(route) {
      document.title = `${route.title} · 管理后台`;
      for (const a of side.querySelectorAll("[data-nav]")) {
        const active = a.dataset.nav === location.pathname;
        a.classList.toggle("is-active", active);
        if (active) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
      }
    }
  });
  setRouter(router);
  await router.render();

  // Pending moderation work shows as a badge in the nav.
  async function refreshBadges() {
    try {
      const o = await api.get("/api/admin/overview", { days: 7 });
      const show = (href, n) => {
        const badge = badges.get(href);
        if (badge) { badge.textContent = String(n || ""); badge.hidden = !n; }
      };
      show("/admin/reports", o.pendingReports + o.pendingReview);
      show("/admin/assets", o.pendingAssets);
      show("/admin/virtual-persons", o.pendingVirtual);
    } catch { /* badge is optional */ }
  }
  document.addEventListener("pw:moderation-changed", refreshBadges);
  refreshBadges();
}

boot();

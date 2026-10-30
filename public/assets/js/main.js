import { h } from "./core/dom.js";
import { store } from "./core/store.js";
import { createRouter } from "./core/router.js";
import { renderHeader, renderFooter, markActiveNav } from "./components/chrome.js";
import { setRouter } from "./core/nav.js";

const routes = [
  { path: "/", load: () => import("./pages/home.js"), title: "" },
  { path: "/studio", load: () => import("./pages/studio.js"), title: "创作" },
  { path: "/library", load: () => import("./pages/library.js"), title: "素材库" },
  { path: "/explore", load: () => import("./pages/explore.js"), title: "灵感广场" },
  { path: "/works", load: () => import("./pages/works.js"), title: "我的作品", auth: true },
  { path: "/my-assets", load: () => import("./pages/my-assets.js"), title: "我的素材", auth: true },
  { path: "/pricing", load: () => import("./pages/pricing.js"), title: "充值" },
  { path: "/pay/:id", load: () => import("./pages/pay.js"), title: "支付", auth: true },
  { path: "/account", load: () => import("./pages/account.js"), title: "账户", auth: true },
  { path: "/login", load: () => import("./pages/auth.js"), title: "登录" },
  { path: "/register", load: () => import("./pages/auth.js"), title: "注册" },
  { path: "/forgot-password", load: () => import("./pages/auth.js"), title: "找回密码" },
  { path: "/reset-password", load: () => import("./pages/auth.js"), title: "重置密码" },
  { path: "/legal/:slug", load: () => import("./pages/legal.js"), title: "" }
];
const notFound = { path: "*", load: () => import("./pages/notfound.js"), title: "页面不存在" };

// Pages that need a session redirect guests to the login page and come back.
for (const route of routes.filter((r) => r.auth)) {
  const load = route.load;
  route.load = async () => {
    if (store.user) return load();
    return { render: ({ navigate }) => {
      navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
      return h("div");
    } };
  };
}

async function boot() {
  const outlet = document.getElementById("main");
  try {
    await store.init();
  } catch (err) {
    outlet.replaceChildren(h("div.wrap.empty", h("div.empty-title", "暂时无法连接服务器"), h("p", "请稍后刷新页面重试。")));
    return;
  }
  renderHeader();
  renderFooter();
  store.subscribe(() => renderHeader());
  const router = createRouter({
    routes, outlet, notFound,
    onChange(route) {
      const name = store.config.site.name;
      document.title = route.title ? `${route.title} · ${name}` : `${name} · ${store.config.site.tagline}`;
      document.body.dataset.page = route.path === "/" ? "home" : route.path.split("/")[1] || "page";
      markActiveNav();
    }
  });
  setRouter(router);
  await router.render();
}

boot();

import { h, icon, tile, replace } from "../core/dom.js";
import { api } from "../core/api.js";
import { store, draft } from "../core/store.js";
import { toastError } from "../core/ui.js";
import { number } from "../core/format.js";

// Site header, announcement banner and footer. Re-render on session changes.

let closeOpenMenu = null;
document.addEventListener("click", () => closeOpenMenu?.());
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeOpenMenu?.(); });

function brand(name) {
  const [first, ...rest] = String(name || "姿衣 PoseWear").split(" ");
  return h("a.brand", { href: "/", "aria-label": `${name} 首页` },
    h("img.brand-mark", { src: "/assets/img/favicon.svg", alt: "", width: 30, height: 30 }),
    h("span.brand-name", first),
    rest.length ? h("span.brand-sub", rest.join(" ")) : null);
}

export function creditTag(credits) {
  return h("a.credit-pill", { href: "/pricing", title: "点数余额，点击充值" },
    tile("gem", "orange"),
    h("span.credit-num.num", number(credits)),
    h("span.credit-unit", "点"));
}

function navLinks(config) {
  const links = [
    ["/studio", "创作"],
    ["/library", "素材库"],
    config?.showcase?.enabled ? ["/explore", "灵感广场"] : null,
    ["/pricing", "价格"]
  ].filter(Boolean);
  return links.map(([href, text]) => h("a.nav-link", { href, dataset: { nav: href } }, text));
}

function userMenu(user) {
  const item = (href, text, iconName, color) => h("a", { href, role: "menuitem" }, tile(iconName, color), text);
  const menu = h("div.user-menu-list", { role: "menu", hidden: true },
    h("div.user-menu-head", h("strong", user.nickname), h("span.faint.small", user.email)),
    item("/works", "我的作品", "photos", "blue"),
    item("/my-assets", "我的素材", "wand", "purple"),
    item("/account", "账户与点数", "person", "green"),
    item("/pricing", "充值", "gem", "orange"),
    user.role === "admin" ? item("/admin", "管理后台", "sliders", "gray") : null,
    h("button", { type: "button", role: "menuitem", onclick: logout }, tile("arrowLeft", "red"), "退出登录"));
  const toggle = h("button.user-menu-btn", { type: "button", "aria-haspopup": "menu", "aria-expanded": "false",
    onclick: (e) => { e.stopPropagation(); setOpen(menu.hidden); } },
    h("span.avatar", user.nickname.slice(0, 1).toUpperCase()), h("span.sr-only", "账户菜单"));
  function setOpen(open) {
    menu.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    closeOpenMenu = open ? () => setOpen(false) : null;
  }
  menu.addEventListener("click", (e) => { if (e.target.closest("a")) setOpen(false); });
  return h("div.user-menu", toggle, menu);
}

async function logout() {
  try {
    await api.post("/api/auth/logout");
    draft.write({});
    store.setUser(null);
    location.href = "/";
  } catch (err) { toastError(err); }
}

export function renderHeader() {
  const header = document.getElementById("site-header");
  const { config, user } = store;
  const drawer = h("nav.mobile-drawer", { "aria-label": "主导航", hidden: true }, navLinks(config),
    user ? null : h("a.nav-link", { href: "/login" }, "登录"));
  const burger = h("button.burger.btn.btn-ghost.btn-icon", { type: "button", "aria-label": "打开菜单", "aria-expanded": "false",
    onclick: () => {
      drawer.hidden = !drawer.hidden;
      burger.setAttribute("aria-expanded", String(!drawer.hidden));
    } }, icon("menu", 20));
  drawer.addEventListener("click", (e) => { if (e.target.closest("a")) { drawer.hidden = true; burger.setAttribute("aria-expanded", "false"); } });
  replace(header,
    h("div.header-row.wrap",
      brand(config?.site?.name),
      h("nav.main-nav", { "aria-label": "主导航" }, navLinks(config)),
      h("div.header-actions",
        user
          ? [creditTag(user.credits), userMenu(user)]
          : [h("a.btn.btn-ghost.btn-sm.hide-sm", { href: "/login" }, "登录"),
            h("a.btn.btn-primary.btn-sm", { href: "/register" }, "免费注册")],
        burger)),
    drawer);
  markActiveNav();

  const banner = document.getElementById("banner");
  const text = config?.site?.announcement;
  replace(banner, text ? h(`div.announcement.${config.site.announcementLevel === "warning" ? "is-warning" : "is-info"}`,
    h("div.wrap", text)) : "");
}

export function markActiveNav() {
  for (const a of document.querySelectorAll("[data-nav]")) {
    const active = location.pathname === a.dataset.nav || location.pathname.startsWith(a.dataset.nav + "/");
    a.classList.toggle("is-active", active);
    if (active) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
}

export function renderFooter() {
  const { config } = store;
  const site = config?.site || {};
  replace(document.getElementById("site-footer"),
    h("div.wrap.footer-grid",
      h("div.footer-brand",
        h("p.footer-name", site.name || "姿衣 PoseWear"),
        h("p", "图片由 AI 生成，已按《人工智能生成合成内容标识办法》添加显式与隐式标识。"),
        site.footerNote ? h("p", site.footerNote) : null),
      h("nav.footer-links", { "aria-label": "页脚" },
        h("a", { href: "/legal/terms" }, "用户协议"),
        h("a", { href: "/legal/privacy" }, "隐私政策"),
        h("a", { href: "/legal/content-policy" }, "内容规范"),
        h("a", { href: "/pricing" }, "价格")),
      h("div.footer-meta",
        site.supportContact ? h("p", `联系客服：${site.supportContact}`) : null,
        site.icp ? h("p", h("a", { href: "https://beian.miit.gov.cn/", target: "_blank", rel: "noopener noreferrer" }, site.icp)) : null,
        site.publicSecurityRecord ? h("p", site.publicSecurityRecord) : null,
        h("p", `Copyright © ${new Date().getFullYear()} ${site.name || ""}`))));
}

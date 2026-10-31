import { h, icon } from "../core/dom.js";
import { api } from "../core/api.js";

// Shared pieces of the 婚纱影楼 pages: the catalog (cached for the visit),
// scene covers, package cards and the draft order kept across navigation.

let catalogPromise = null;
export function loadCatalog({ fresh = false } = {}) {
  if (fresh || !catalogPromise) catalogPromise = api.get("/api/wedding/catalog").catch((err) => { catalogPromise = null; throw err; });
  return catalogPromise;
}

export const CATEGORY_ORDER = ["studio", "outdoor", "chinese"];

// A scene's picture: its first sample photo, else the empty location plate,
// else a soft gradient in the category's colours with the scene's name.
export function sceneCover(scene, { size = "thumb", label = true } = {}) {
  const sample = scene.samples?.[0];
  const src = sample ? (size === "full" ? sample.url : sample.thumb) : scene.plate ? (size === "full" ? scene.plate.preview : scene.plate.thumb) : null;
  return h("div.wd-cover", { dataset: { cat: scene.category } },
    src ? h("img", { src, alt: "", loading: "lazy", decoding: "async" }) : h("span.wd-cover-mark", icon("camera", 26)),
    label ? h("div.wd-cover-label", h("strong", scene.name), h("span", scene.categoryText)) : null);
}

export function packageCard(pkg, { selected = false, onSelect, action } = {}) {
  return h(`article.wd-pkg${selected ? ".is-selected" : ""}${pkg.badge ? ".has-badge" : ""}`,
    { tabIndex: onSelect ? 0 : undefined, role: onSelect ? "radio" : undefined, "aria-checked": onSelect ? String(selected) : undefined,
      onclick: onSelect ? () => onSelect(pkg) : undefined,
      onkeydown: onSelect ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(pkg); } } : undefined },
    pkg.badge ? h("span.wd-pkg-badge", pkg.badge) : null,
    h("div.wd-pkg-name", pkg.name),
    h("div.wd-pkg-price", h("strong.num", pkg.price), h("span", "点")),
    h("div.wd-pkg-count", h("strong.num", pkg.photos), " 张精修婚纱照"),
    h("ul.wd-pkg-list",
      h("li", icon("check", 15), `${pkg.looks} 套造型，每套 ${pkg.shots} 个镜头`),
      h("li", icon("check", 15), `含 ${pkg.retakes} 次免费重拍`),
      h("li", icon("check", 15), "2K 高清原图，整册打包下载")),
    pkg.description ? h("p.wd-pkg-desc", pkg.description) : null,
    action || null);
}

// The order being put together; kept in sessionStorage so the couple can
// leave the page (e.g. to top up) and come back.
const DRAFT_KEY = "pw-wedding-draft";
export const weddingDraft = {
  read() {
    try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || "null"); } catch { return null; }
  },
  write(value) {
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(value)); } catch { /* private mode */ }
  },
  clear() {
    try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* private mode */ }
  }
};

export const STATUS = {
  shooting: ["拍摄中", "blue"], attention: ["有照片需要处理", "orange"], done: ["已完成", "green"]
};

export function statusPill(status) {
  const [text, color] = STATUS[status] || STATUS.done;
  return h(`span.wd-status.is-${color}`, h("i"), text);
}

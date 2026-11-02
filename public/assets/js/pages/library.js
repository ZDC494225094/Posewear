import { h, cicon } from "../core/dom.js";
import { api } from "../core/api.js";
import { store } from "../core/store.js";
import { lightbox, toast } from "../core/ui.js";
import { label, number } from "../core/format.js";
import { libraryBrowser, libraryMeta, assetFee, useInStudio, unlockPrompt, TYPE_TEXT } from "../components/library-browser.js";
import { assetGenerationInfo } from "../components/asset-generation-info.js";

const LICENSE_TEXT = {
  commercial: "可商用：用它生成的作品可用于商业用途。",
  noncommercial: "非商用：仅限个人学习和非商业用途。"
};
const TYPES = [["pose", "pose", "purple"], ["outfit", "shirt", "pink"], ["scene", "mountain", "green"], ["item", "bag", "orange"],
  ["face", "person", "teal"], ["hair", "sparkle", "indigo"]];
const USE_TEXT = { pose: "用这个姿势创作", outfit: "用这套服装创作", scene: "用这个场景创作", item: "用这件物品创作",
  face: "用这张人像作人物", hair: "用这个发型创作" };
// Imported libraries, not made by the asset generator.
const GENERATED = new Set(["pose", "outfit", "scene", "item"]);

export async function render(ctx) {
  const type = TYPES.some(([t]) => t === ctx.query.type) ? ctx.query.type : "pose";
  const filters = { series: ctx.query.series || "", category: ctx.query.category || "", angle: ctx.query.angle || "",
    q: ctx.query.q || "", view: ctx.query.view === "image" ? "image" : "group",
    origin: ["platform", "user", "mine"].includes(ctx.query.origin) ? ctx.query.origin : "",
    license: ["commercial", "noncommercial"].includes(ctx.query.license) ? ctx.query.license : "" };
  let meta = null;
  try { meta = await libraryMeta({ fresh: true }); } catch { /* browser shows its own error */ }

  // Keep the URL in sync so filtered views can be shared and survive reloads.
  function syncUrl(f) {
    const params = new URLSearchParams();
    if (f.type !== "pose") params.set("type", f.type);
    for (const key of ["series", "category", "angle", "q", "origin", "license"]) if (f[key]) params.set(key, f[key]);
    if (f.type === "pose" && f.view === "image") params.set("view", "image");
    const qs = params.toString();
    history.replaceState({}, "", `/library${qs ? `?${qs}` : ""}`);
  }

  async function open(asset, group) {
    if (asset.locked) { unlockPrompt(); return; }
    let images = group;
    if (asset.type === "pose" && group.length === 1) {
      try { images = (await api.get(`/api/library/assets/${encodeURIComponent(asset.id)}`)).angles; } catch { images = group; }
    }
    images = images.filter((img) => !img.locked);
    const start = Math.max(0, images.findIndex((x) => x.id === asset.id));
    const loginHref = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
    // Guests get thumbnails only; the large preview needs an account.
    lightbox(images.map((img) => ({ src: img.preview || img.thumb, alt: label(img.name), asset: img })), start, {
      renderAside: (item, { close }) => {
        const a = item.asset;
        const policy = store.config.library.originalDownload;
        const fee = assetFee(a);
        const named = a.named;
        return h("div.viewer-aside",
          h("p.viewer-code.num", a.type === "pose" ? `${a.code} · ${a.id}` : a.id),
          h("h2.viewer-title", named ? label(a.name) || a.id : `${label(a.category)}服装`),
          h("div.pills",
            label(a.series) ? h("span.pill", label(a.series)) : null,
            h("span.pill", label(a.category)),
            a.type === "pose" ? h("span.pill", label(a.angle)) : null,
            a.license === "commercial" ? h("span.pill.pill-mat", "可商用") : h("span.pill", "非商用"),
            a.generated ? h("span.pill", "AI 生成") : null),
          a.keywords ? h("p.small.muted", a.keywords) : null,
          a.depthThumb ? h("figure.viewer-depth", h("img", { src: a.depthThumb, alt: "这个姿势的深度图", loading: "lazy" }),
            h("figcaption.small.muted", "深度图：越亮离镜头越近。创作时勾选“深度图辅助”，会和线稿一起发给模型，姿势的前后关系更准。")) : null,
          a.type === "face" ? h("p.small.muted", "AI 生成的虚构人物，不是真实存在的人。用作人物时按虚拟人处理，可以搭配任意素材，作品可以公开。") : null,
          h("p.small.muted", LICENSE_TEXT[a.license]),
          a.owner ? h("p.small.muted", `由 @${a.owner.name} 分享${fee ? `，每次使用另付 ${fee} 点，作者获得 ${store.config.assets.rebatePercent}%` : a.price ? "（你的素材，自己使用免费）" : "，免费使用"}。`) : null,
          !a.ai ? h("p.small.pill.pill-pin", "仅供浏览，不能用于 AI 生成") : !a.aiWithPerson ? h("p.small.muted", "不能与真人照片同时使用") : null,
          store.user ? null : h("p.viewer-login.small", "登录后可以查看大图，并用于创作。"),
          a.generated && store.user && (a.owner?.id === store.user.id || store.user.role === "admin")
            ? assetGenerationInfo(a, { admin: store.user.role === "admin" }) : null,
          h("div.viewer-actions",
            a.ai ? h("button.btn.btn-primary.btn-block", { type: "button", onclick: () => { close(); useInStudio(a); } },
              cicon("sparkle", "yellow"), USE_TEXT[a.type]) : null,
            a.original ? h("a.btn.btn-block", { href: `${a.original}&download=1`, "data-native": "" }, cicon("download", "green"), "下载原图")
              : !store.user && policy !== "disabled" && a.downloadable ? h("a.btn.btn-block", { href: loginHref, onclick: close }, "登录后查看大图和下载") : null),
          images.length > 1 ? h("p.small.faint", "← → 切换角度") : null);
      }
    });
  }

  const browser = libraryBrowser({ type, mode: "page", filters, onOpen: open, onFiltersChange: syncUrl });
  const count = (t) => (t === "pose" ? meta?.pose?.groups : meta?.[t]?.total);

  const tabs = h("div.seg.lib-tabs", { role: "tablist", "aria-label": "素材类型" },
    TYPES.map(([value, iconName, color]) =>
      h("button", { type: "button", role: "tab", "aria-selected": String(value === type), "aria-pressed": String(value === type), onclick: (e) => {
        e.currentTarget.parentElement.querySelectorAll("button").forEach((t) => {
          t.setAttribute("aria-selected", String(t === e.currentTarget));
          t.setAttribute("aria-pressed", String(t === e.currentTarget));
        });
        browser.setType(value);
        syncUrl({ type: value });
        if (generateLink) {
          const target = `/my-assets?generate=${value}`;
          generateLink.href = store.user ? target : `/login?next=${encodeURIComponent(target)}`;
          generateLink.hidden = !GENERATED.has(value);
        }
      } }, cicon(iconName, color, 15), TYPE_TEXT[value], count(value) ? h("span.chip-note.num", number(count(value))) : null)));

  if (ctx.query.welcome) toast("挑一个喜欢的素材，点“用于创作”即可放上创作台");

  const generateLink = store.config.assets.generation
    ? h("a.btn.btn-white", { hidden: !GENERATED.has(type), href: store.user ? `/my-assets?generate=${type}` : `/login?next=${encodeURIComponent(`/my-assets?generate=${type}`)}` },
      cicon("wand", "purple"), "生成素材")
    : null;

  return h("div.library.wrap",
    h("header.page-head",
      h("div", h("h1", "素材库"), h("p", "线稿姿势带多个拍摄角度和深度图；服装按大类和小类整理，从四季日常到历代古装、职业制服和二次元服装；还有做背景的场景、人物可以佩戴手持的物品、可以直接当模特的 AI 人像，和二次元发型。点开可以放大查看，或直接送到创作台。")),
      h("div.lib-head-actions", generateLink, tabs)),
    browser.node);
}

import { h, icon, cicon } from "../core/dom.js";
import { api } from "../core/api.js";
import { store, draft } from "../core/store.js";
import { lightbox, toast } from "../core/ui.js";
import { label, number } from "../core/format.js";
import { navigate } from "../core/nav.js";
import { libraryBrowser, libraryMeta } from "../components/library-browser.js";

export async function render(ctx) {
  const type = ctx.query.type === "outfit" ? "outfit" : "pose";
  const filters = { series: ctx.query.series || "", category: ctx.query.category || "", angle: ctx.query.angle || "",
    q: ctx.query.q || "", view: ctx.query.view === "image" ? "image" : "group" };
  let meta = null;
  try { meta = await libraryMeta(); } catch { /* browser shows its own error */ }

  // Keep the URL in sync so filtered views can be shared and survive reloads.
  function syncUrl(f) {
    const params = new URLSearchParams();
    if (f.type === "outfit") params.set("type", "outfit");
    for (const key of ["series", "category", "angle", "q"]) if (f[key]) params.set(key, f[key]);
    if (f.type === "pose" && f.view === "image") params.set("view", "image");
    const qs = params.toString();
    history.replaceState({}, "", `/library${qs ? `?${qs}` : ""}`);
  }

  function useInStudio(asset) {
    if (asset.type === "pose") draft.patch({ pose: asset });
    else draft.patch({ outfit: asset, outfitUpload: null });
    navigate("/studio");
  }

  async function open(asset, group) {
    let images = group;
    if (asset.type === "pose" && group.length === 1) {
      try { images = (await api.get(`/api/library/assets/${encodeURIComponent(asset.id)}`)).angles; } catch { images = group; }
    }
    const start = Math.max(0, images.findIndex((x) => x.id === asset.id));
    lightbox(images.map((img) => ({ src: img.preview, alt: label(img.name), asset: img })), start, {
      renderAside: (item) => {
        const a = item.asset;
        const policy = store.config.library.originalDownload;
        const canDownload = policy === "public" || (policy === "login" && store.user);
        return h("div.viewer-aside",
          h("p.viewer-code.num", a.type === "pose" ? `${a.code} · ${a.id}` : a.id),
          h("h2.viewer-title", a.type === "pose" ? label(a.name) : `${label(a.category)}服装`),
          h("div.pills", a.type === "pose"
            ? [h("span.pill", label(a.series)), h("span.pill", label(a.category)), h("span.pill", label(a.angle))]
            : [h("span.pill", label(a.category))]),
          a.keywords ? h("p.small.muted", a.keywords) : null,
          !a.ai ? h("p.small.pill.pill-pin", "仅供浏览，不能用于 AI 生成") : !a.aiWithPerson ? h("p.small.muted", "不能与人物照片同时使用") : null,
          h("div.viewer-actions",
            a.ai ? h("button.btn.btn-primary.btn-block", { type: "button", onclick: () => useInStudio(a) },
              cicon("sparkle", "yellow"), a.type === "pose" ? "用这个姿势创作" : "用这套服装创作") : null,
            canDownload ? h("a.btn.btn-block", { href: `/media/library/${encodeURIComponent(a.id)}/original?download=1`, "data-native": "" }, cicon("download", "green"), "下载原图")
              : policy === "login" ? h("a.btn.btn-block", { href: `/login?next=${encodeURIComponent(location.pathname + location.search)}` }, "登录后下载原图") : null),
          images.length > 1 ? h("p.small.faint", "← → 切换角度") : null);
      }
    });
  }

  const browser = libraryBrowser({ type, mode: "page", filters, onOpen: open, onFiltersChange: syncUrl });

  const tabs = h("div.seg.lib-tabs", { role: "tablist", "aria-label": "素材类型" },
    [["pose", "姿势", "pose", "purple", meta?.pose?.groups], ["outfit", "服装", "shirt", "pink", meta?.outfit?.total]].map(([value, text, iconName, color, count]) =>
      h("button", { type: "button", role: "tab", "aria-selected": String(value === type), "aria-pressed": String(value === type), onclick: (e) => {
        e.currentTarget.parentElement.querySelectorAll("button").forEach((t) => {
          t.setAttribute("aria-selected", String(t === e.currentTarget));
          t.setAttribute("aria-pressed", String(t === e.currentTarget));
        });
        browser.setType(value);
        syncUrl({ type: value });
      } }, cicon(iconName, color, 15), text, count ? h("span.chip-note.num", number(count)) : null)));

  if (ctx.query.welcome) toast("挑一个喜欢的素材，点“用于创作”即可放上创作台");

  return h("div.library.wrap",
    h("header.page-head",
      h("div", h("h1", "素材库"), h("p", "线稿姿势带多个拍摄角度，服装按季节和风格整理。点开可以放大查看，或直接送到创作台。")),
      tabs),
    browser.node);
}

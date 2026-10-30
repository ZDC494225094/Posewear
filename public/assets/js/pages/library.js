import { h, icon, cicon } from "../core/dom.js";
import { api } from "../core/api.js";
import { store, draft } from "../core/store.js";
import { lightbox, toast } from "../core/ui.js";
import { label, number } from "../core/format.js";
import { navigate } from "../core/nav.js";
import { libraryBrowser, libraryMeta, assetFee } from "../components/library-browser.js";

const LICENSE_TEXT = {
  commercial: "可商用：用它生成的作品可用于商业用途。",
  noncommercial: "非商用：仅限个人学习和非商业用途。"
};

export async function render(ctx) {
  const type = ctx.query.type === "outfit" ? "outfit" : "pose";
  const filters = { series: ctx.query.series || "", category: ctx.query.category || "", angle: ctx.query.angle || "",
    q: ctx.query.q || "", view: ctx.query.view === "image" ? "image" : "group",
    origin: ["platform", "user", "mine"].includes(ctx.query.origin) ? ctx.query.origin : "",
    license: ["commercial", "noncommercial"].includes(ctx.query.license) ? ctx.query.license : "" };
  let meta = null;
  try { meta = await libraryMeta({ fresh: true }); } catch { /* browser shows its own error */ }

  // Keep the URL in sync so filtered views can be shared and survive reloads.
  function syncUrl(f) {
    const params = new URLSearchParams();
    if (f.type === "outfit") params.set("type", "outfit");
    for (const key of ["series", "category", "angle", "q", "origin", "license"]) if (f[key]) params.set(key, f[key]);
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
        const fee = assetFee(a);
        return h("div.viewer-aside",
          h("p.viewer-code.num", a.type === "pose" ? `${a.code} · ${a.id}` : a.id),
          h("h2.viewer-title", a.type === "pose" || a.generated ? label(a.name) : `${label(a.category)}服装`),
          h("div.pills",
            label(a.series) ? h("span.pill", label(a.series)) : null,
            h("span.pill", label(a.category)),
            a.type === "pose" ? h("span.pill", label(a.angle)) : null,
            a.license === "commercial" ? h("span.pill.pill-mat", "可商用") : h("span.pill", "非商用"),
            a.generated ? h("span.pill", "AI 生成") : null),
          a.keywords ? h("p.small.muted", a.keywords) : null,
          h("p.small.muted", LICENSE_TEXT[a.license]),
          a.owner ? h("p.small.muted", `由 @${a.owner.name} 分享${fee ? `，每次使用另付 ${fee} 点，作者获得 ${store.config.assets.rebatePercent}%` : a.price ? "（你的素材，自己使用免费）" : "，免费使用"}。`) : null,
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
        if (generateLink) {
          const target = `/my-assets?generate=${value}`;
          generateLink.href = store.user ? target : `/login?next=${encodeURIComponent(target)}`;
        }
      } }, cicon(iconName, color, 15), text, count ? h("span.chip-note.num", number(count)) : null)));

  if (ctx.query.welcome) toast("挑一个喜欢的素材，点“用于创作”即可放上创作台");

  const generateLink = store.config.assets.generation
    ? h("a.btn.btn-white", { href: store.user ? `/my-assets?generate=${type}` : `/login?next=${encodeURIComponent(`/my-assets?generate=${type}`)}` },
      cicon("wand", "purple"), "生成素材")
    : null;

  return h("div.library.wrap",
    h("header.page-head",
      h("div", h("h1", "素材库"), h("p", "线稿姿势带多个拍摄角度，服装按大类和小类整理，从四季日常到历代古装和职业制服。点开可以放大查看，或直接送到创作台。")),
      h("div.lib-head-actions", generateLink, tabs)),
    browser.node);
}

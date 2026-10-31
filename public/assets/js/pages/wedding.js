import { h, icon, cicon } from "../core/dom.js";
import { api } from "../core/api.js";
import { store } from "../core/store.js";
import { toastError, emptyState, lightbox } from "../core/ui.js";
import { relative } from "../core/format.js";
import { loadCatalog, sceneCover, packageCard, statusPill, CATEGORY_ORDER } from "../components/wedding-kit.js";

// 婚纱影楼 landing: the promise, the packages, the scenes with their sample
// photos, how a shoot works, and the couple's albums.
export async function render() {
  let catalog;
  try { catalog = await loadCatalog({ fresh: true }); } catch (err) {
    toastError(err);
    return h("div.wrap", emptyState({ title: "暂时无法打开婚纱影楼", text: "请稍后刷新页面重试。", icon: "alert", color: "orange" }));
  }
  if (!catalog.enabled) {
    return h("div.wrap", emptyState({ title: "婚纱影楼暂未开放", text: "敬请期待。", icon: "camera", color: "pink" }));
  }
  const start = (pkg) => `/wedding/new${pkg ? `?package=${encodeURIComponent(pkg.key)}` : ""}`;
  const loginFirst = (to) => (store.user ? to : `/login?next=${encodeURIComponent(to)}`);

  // Hero: a collage of the best sample photos.
  const samples = catalog.scenes.filter((s) => s.samples.length || s.plate).slice(0, 5);
  const hero = h("section.wd-hero",
    h("div.wrap.wd-hero-inner",
      h("div.wd-hero-copy",
        h("span.wd-eyebrow", cicon("heart", "pink", 15), "姿衣婚纱影楼"),
        h("h1", "不用去影楼，", h("br"), "也能拍一套婚纱照"),
        h("p", "上传两个人的日常照片，选好场景、礼服和造型，就能拿到一整套真实质感的婚纱照。影棚、外景、中式，一次拍全。"),
        h("div.wd-hero-actions",
          h("a.btn.btn-primary.btn-lg", { href: loginFirst(start()) }, "开始拍摄"),
          h("a.btn.btn-white.btn-lg", { href: "#scenes" }, "看看场景")),
        h("ul.wd-hero-points",
          h("li", icon("checkCircle", 16), "保留两个人本来的样子"),
          h("li", icon("checkCircle", 16), "不满意可以重拍"),
          h("li", icon("checkCircle", 16), "照片只有你们自己能看到"))),
      h("div.wd-hero-art", { "aria-hidden": "true" },
        samples.length
          ? samples.map((s, i) => h(`div.wd-hero-tile.t${i + 1}`, sceneCover(s, { label: false })))
          : CATEGORY_ORDER.map((cat, i) => h(`div.wd-hero-tile.t${i + 1}`, h("div.wd-cover", { dataset: { cat } }, h("span.wd-cover-mark", icon("heart", 28))))))));

  const packages = h("section.wrap.wd-section",
    h("header.wd-section-head", h("h2", "选择套系"), h("p", "按张数计价，点数一次付清。拍完不满意的可以重拍，没拍成的照片会把点数退给你。")),
    h("div.wd-pkgs", catalog.packages.map((pkg) => packageCard(pkg, {
      selected: !!pkg.badge,
      action: h(`a.btn.btn-block.${pkg.badge ? "btn-primary" : "btn-white"}`, { href: loginFirst(start(pkg)) }, `选择${pkg.name}`)
    }))),
    h("p.wd-note", `每套造型可以加拍，每张 ${catalog.extraPhotoPrice} 点；免费次数用完后，重拍每张 ${catalog.retakePrice} 点。`));

  // Scenes, filterable by category; a click shows the samples large.
  let cat = "";
  const grid = h("div.wd-scenes");
  const tabs = h("div.seg.wd-tabs", { role: "group", "aria-label": "场景分类" },
    [["", "全部"], ...CATEGORY_ORDER.map((k) => [k, catalog.categories[k]])].map(([value, text]) =>
      h("button", { type: "button", "aria-pressed": String(value === cat), onclick: (e) => {
        cat = value;
        tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget)));
        drawScenes();
      } }, text)));
  function drawScenes() {
    grid.replaceChildren(...catalog.scenes.filter((s) => !cat || s.category === cat).map((scene) =>
      h("button.wd-scene", { type: "button", onclick: () => showScene(scene) },
        sceneCover(scene),
        h("p.wd-scene-desc", scene.description))));
  }
  function showScene(scene) {
    const items = scene.samples.length
      ? scene.samples.map((s) => ({ src: s.url, alt: scene.name }))
      : scene.plate ? [{ src: scene.plate.preview, alt: scene.name }] : [];
    if (!items.length) return;
    lightbox(items, 0, { renderAside: () => h("div.wd-scene-aside",
      h("span.faint.small", scene.categoryText), h("h3", scene.name), h("p.muted", scene.description),
      h("p.faint.small", scene.samples.length ? "示例由虚拟新人拍摄，你们的照片会是你们自己的样子。" : "场景底图，拍摄时两位会站在这里。"),
      h("a.btn.btn-primary.btn-block", { href: loginFirst(`/wedding/new?scene=${scene.id}`) }, "用这个场景拍")) });
  }
  drawScenes();
  const scenes = h("section.wrap.wd-section#scenes",
    h("header.wd-section-head.row", h("div", h("h2", "场景"), h("p", `${catalog.scenes.length} 个场景，每套造型选一个。`)), tabs),
    grid);

  const steps = h("section.wrap.wd-section",
    h("header.wd-section-head", h("h2", "怎么拍")),
    h("ol.wd-steps",
      [["bag", "选套系", "一套造型 6 张起，造型越多越划算。"],
        ["person", "上传照片", "两个人各传 1–5 张清晰的照片，正脸最重要，多一张侧脸更像。"],
        ["hanger", "定造型", "每套选场景、礼服、发型和头饰，我们按场景给好了推荐。"],
        ["photos", "看相册", "照片一张张出来，挑满意的版本、重拍不满意的，最后整册下载。"]]
        .map(([ic, title, text], i) => h("li", h("span.wd-step-no.num", i + 1), icon(ic, 22), h("strong", title), h("p", text)))));

  const albums = h("section.wrap.wd-section", { hidden: true });
  if (store.user) {
    api.get("/api/wedding/shoots", { size: 12 }).then((data) => {
      if (!data.total) return;
      albums.hidden = false;
      albums.append(
        h("header.wd-section-head.row", h("div", h("h2", "我的相册"), h("p", `共 ${data.total} 套`)),
          h("a.btn.btn-white", { href: "/wedding/albums" }, "全部相册")),
        h("div.wd-albums", data.items.slice(0, 4).map(albumCard)));
    }).catch(() => {});
  }

  return h("div.wd-page", hero, albums, packages, scenes, steps,
    h("section.wrap.wd-section.wd-privacy",
      h("div", icon("lock", 22)),
      h("div", h("strong", "两个人的照片只用于这次拍摄"),
        h("p", `上传前需要两位都同意，并且都已年满 18 周岁。照片和成片只有你们自己能看到，不会公开到灵感广场；上传的照片 ${catalog.retentionDays} 天后自动删除，删除相册会一并删除。`))));
}

export function albumCard(shoot) {
  const status = shoot.active ? "shooting" : shoot.failed ? "attention" : "done";
  return h("a.wd-album", { href: `/wedding/albums/${shoot.id}` },
    h("div.wd-album-cover", shoot.cover ? h("img", { src: shoot.cover, alt: "", loading: "lazy" }) : h("span.wd-cover-mark", icon("heart", 26))),
    h("div.wd-album-body",
      h("strong", shoot.title || `${shoot.packageName}套系`),
      h("span.faint.small", `${shoot.packageName} · ${shoot.done}/${shoot.photos} 张 · ${relative(shoot.createdAt)}`),
      statusPill(status)));
}

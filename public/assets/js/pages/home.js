import { h, icon, tile, cicon } from "../core/dom.js";
import { api } from "../core/api.js";
import { store, draft } from "../core/store.js";
import { label, number, yuan } from "../core/format.js";
import { navigate } from "../core/nav.js";

// Hero visual: pose + outfit = finished image, laid out as three cards on a
// frosted panel. The pair can be reshuffled or sent straight to the studio.
function heroStage(pairs, featured) {
  let index = 0;
  const poseImg = h("img", { alt: "姿势参考", decoding: "async" });
  const outfitImg = h("img", { alt: "服装参考", decoding: "async" });
  const poseCap = h("span");
  const outfitCap = h("span");
  const result = featured?.images?.[0];
  function show() {
    const pair = pairs[index % pairs.length];
    if (!pair) return;
    poseImg.src = pair.pose.preview;
    outfitImg.src = pair.outfit.preview;
    poseCap.textContent = `姿势 · ${label(pair.pose.category)}`;
    outfitCap.textContent = `服装 · ${label(pair.outfit.category)}`;
  }
  show();
  const useIt = () => {
    const pair = pairs[index % pairs.length];
    if (pair) draft.patch({ pose: pair.pose, outfit: pair.outfit, outfitUpload: null });
    navigate("/studio");
  };
  return h("div.hero-stage.glass",
    h("div.formula",
      h("figure.formula-card.is-pose", h("div.formula-frame", poseImg), h("figcaption", tile("pose", "purple"), poseCap)),
      h("span.formula-op", { "aria-hidden": "true" }, "+"),
      h("figure.formula-card.is-outfit", h("div.formula-frame", outfitImg), h("figcaption", tile("shirt", "pink"), outfitCap)),
      h("span.formula-op", { "aria-hidden": "true" }, "="),
      h("figure.formula-card.is-result",
        h("div.formula-frame", result
          ? h("img", { src: result.thumb, alt: "AI 成片示例" })
          : h("div.result-placeholder", tile("sparkle", "orange", "lg"), h("span", "AI 成片"))),
        h("figcaption", tile("sparkle", "orange"), h("span", "AI 成片")))),
    pairs.length ? h("div.hero-stage-foot",
      pairs.length > 1 ? h("button.btn.btn-white", { type: "button", onclick: () => { index += 1; show(); } }, cicon("shuffle", "purple"), "换一组") : null,
      h("button.btn.btn-primary", { type: "button", onclick: useIt }, cicon("sparkle", "yellow"), "用这组开始")) : null);
}

function bento(counts, cfg) {
  return h("div.bento",
    h("article.bento-card.is-wide",
      tile("pose", "purple", "lg"),
      h("p.bento-num.num", number(counts.poseGroups)),
      h("h3", "组线稿姿势"),
      h("p", "站姿、坐姿、跪姿、躺卧、上半身……每组最多 5 个拍摄角度，镜头按你选的角度构图。")),
    h("article.bento-card",
      tile("shirt", "pink", "lg"),
      h("p.bento-num.num", number(counts.outfits)),
      h("h3", "套服装"),
      h("p", "按春夏秋冬和风格整理，也能上传自己的衣服。")),
    h("article.bento-card.is-dark",
      tile("person", "green", "lg"),
      h("h3", "保持同一张脸"),
      h("p", "上传本人或已授权的照片，成片保留五官和发型。")),
    h("article.bento-card",
      tile("expand", "blue", "lg"),
      h("h3", "最高 2K 高清"),
      h("p", `支持 ${cfg.generation.ratios.length} 种画幅，竖版、方图、横版随意切换。`)),
    h("article.bento-card",
      tile("redo", "teal", "lg"),
      h("h3", "失败自动退点"),
      h("p", "被安全审核拦截或模型繁忙时，点数原路退回。")),
    h("article.bento-card.is-wide",
      tile("shield", "indigo", "lg"),
      h("h3", "合规与隐私"),
      h("p", "人物照片到期自动删除，带人物的作品仅自己可见；每张图都带 AI 生成标识。")));
}

function steps() {
  const items = [
    ["挑一个姿势", "在姿势库里选，或者随机抽一个。"],
    ["选一套衣服", "从服装库挑，或上传自己的衣服照片。"],
    ["加上人物（可选）", "上传照片，让成片保留这张脸。"],
    ["点击生成", "选好画幅和画质，几十秒出图。"]
  ];
  return h("ol.steps", items.map(([title, text], i) =>
    h("li.step", h("span.step-no", String(i + 1)), h("h3", title), h("p", text))));
}

function showcase(items) {
  if (!items.length) return null;
  return h("section.section.wrap", { "aria-labelledby": "home-showcase" },
    h("div.section-head", h("div", h("h2#home-showcase", "大家的作品")), h("a.link.link-arrow", { href: "/explore" }, "去灵感广场")),
    h("div.masonry", { dataset: { cols: String(Math.min(4, items.length)) } }, items.slice(0, 8).map((g) => h("a.masonry-item", { href: "/explore" },
      h("img", { src: g.images[0]?.thumb, alt: "用户作品", loading: "lazy", style: { aspectRatio: `${g.images[0]?.width} / ${g.images[0]?.height}` } })))));
}

// Pricing card shared with the pricing page.
export function priceCard(pkg, { action, perks = [] } = {}) {
  const [int, dec] = (pkg.priceCents / 100).toFixed(2).split(".");
  return h("article.price-card", { class: pkg.badge ? "is-featured" : "" },
    h("div.price-top", h("span.price-name", pkg.name), pkg.badge ? h("span.price-badge", pkg.badge) : null),
    h("p.price-amount.num", h("small", "¥"), int, dec !== "00" ? h("small", `.${dec}`) : null),
    h("p.price-credits", h("strong.num", number(pkg.totalCredits)), " 点", pkg.bonusCredits ? `（含赠送 ${number(pkg.bonusCredits)}）` : ""),
    pkg.description ? h("p.price-desc", pkg.description) : null,
    perks.length ? h("ul.price-list", perks.map((p) => h("li", icon("checkCircle", 17), p))) : null,
    action || null);
}

// Kept for older imports.
export const hangTag = priceCard;

// Selling points under a package price, from the live pricing config.
export function packagePerks(pkg, cfg) {
  const standard = cfg.generation.qualities.find((q) => q.id === "medium") || cfg.generation.qualities[0];
  return [
    standard ? `约 ${Math.floor(pkg.totalCredits / Math.max(1, standard.credits))} 张${standard.label}画质` : null,
    "点数长期有效",
    "失败自动退回"
  ].filter(Boolean);
}

function faq(cfg) {
  const q = cfg.generation.qualities;
  const cost = q.map((x) => `${x.label} ${x.credits} 点`).join("、");
  const items = [
    ["生成一张要多少点数？", `按画质计费：${cost}；选 2K 等更高清晰度时按倍率增加。生成前按钮上会显示本次消耗。`],
    ["生成失败会扣点数吗？", "不会。被安全审核拦截、模型繁忙或任何原因失败，扣除的点数都会自动退回。"],
    ["人物照片安全吗？", `照片只用于你发起的任务，${cfg.generation.personRetentionDays} 天后自动删除。用了人物照片的作品只有你自己能看到，不能公开发布。`],
    ["生成的图片可以商用吗？", "可以用于个人或商业用途，但需自行确保不侵犯他人肖像权、著作权等权益，并保留图片上的“AI生成”标识。"],
    ["支持哪些尺寸？", "支持 2:3、3:4、1:1、9:16、16:9 等常用画幅，标准和 2K 高清两档清晰度。"]
  ];
  return h("section.section.wrap", { "aria-labelledby": "home-faq" },
    h("div.section-head", h("h2#home-faq", "常见问题")),
    h("div.faq-list", items.map(([qq, a]) => h("details.faq-item", h("summary", qq), h("p", a)))));
}

export async function render() {
  const cfg = store.config;
  let data = { featured: [], recent: [], pairs: [], packages: [] };
  try { data = await api.get("/api/public/home"); } catch { /* render without samples */ }
  const counts = cfg.library;
  const bonus = cfg.auth.signupBonus;

  const hero = h("section.hero.ambient",
    h("div.wrap",
      h("div.hero-inner",
        h("h1.hero-title", h("span", "选个姿势，"), h("span", "挑套衣服。"), h("br"), h("span", "AI 帮你拍出来。")),
        h("p.hero-lead", cfg.site.description),
        h("div.hero-cta",
          h("a.btn.btn-primary.btn-lg", { href: "/studio" }, cicon("sparkle", "yellow", 18), "开始创作"),
          h("a.link.link-arrow", { href: "/library" }, "浏览素材库")),
        h("p.hero-note", store.user ? `你还有 ${number(store.user.credits)} 点可用` : bonus ? `新用户注册送 ${bonus} 点 · 失败自动退点` : "注册即可开始创作")),
      heroStage(data.pairs, data.featured[0])));

  const pricing = data.packages.length ? h("section.section.wrap", { "aria-labelledby": "home-pricing" },
    h("div.section-head", h("div", h("h2#home-pricing", "按需充值"), h("p", "点数长期有效，用多少买多少。")),
      h("a.link.link-arrow", { href: "/pricing" }, "查看全部套餐")),
    h("div.price-grid", data.packages.map((p) => priceCard(p, { perks: packagePerks(p, cfg),
      action: h("a.btn.btn-primary.btn-block", { href: "/pricing" }, "购买")
    })))) : null;

  return h("div.home",
    hero,
    h("section.section.wrap", { "aria-labelledby": "home-features" },
      h("div.section-head", h("div", h("h2#home-features", "从参考图到成片，一站搞定"), h("p", "素材库、AI 生成、作品管理都在这里。"))),
      bento(counts, cfg)),
    h("section.section.wrap", { "aria-labelledby": "home-steps" },
      h("div.section-head", h("h2#home-steps", "四步出图")),
      steps()),
    showcase(data.featured.length ? data.featured : data.recent),
    pricing,
    faq(cfg),
    h("div.wrap", h("section.cta-band",
      h("div", h("h2", "现在就做一张。"), h("p", bonus ? `注册送 ${bonus} 点，够生成好几张。` : "挑好参考图，几十秒出图。")),
      h("a.btn.btn-primary.btn-lg", { href: "/studio" }, "开始创作"))));
}

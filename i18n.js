"use strict";
// Interface strings and catalog labels. Original Japanese identifiers are preserved.
window.ReferenceGalleryI18n = (() => {
  const texts = {
    "zh-CN": {
      eyebrow: "AI 创作参考图库 · 开源浏览器", tagline: "AI 素材参考图鉴",
      description: "一站式浏览姿势与服装参考素材，按类别快速查找。",
      typePose: "姿势素材", typeCostume: "服装素材",
      costumeDescription: "按季节、风格和服装关键词浏览穿搭参考。",
      costumeSearchLabel: "搜索服装编号、季节或关键词", costumeSearchPlaceholder: "如 SPR-0001、春季、denim",
      costumeName: (category, id) => `${category}穿搭 · ${id}`,
      costumeResults: (total, showing) => `找到 ${total} 套服装，已展示 ${showing} 套`,
      costumeEmpty: "没有符合条件的服装，尝试其他关键词。",
      costumeHint: "← → / ↑ ↓ 切换服装，Esc 关闭",
      loadMore: "加载更多",
      searchLabel: "搜索编号、姿势名、分类", searchPlaceholder: "如 P001、站姿、侧卧",
      categoryLabel: "分类", angleLabel: "角度", viewLabel: "展示",
      viewPose: "按姿势组", viewImage: "逐张图片", allCategories: "全部分类",
      allAngles: "全部角度", allSeries: "全部系列", reset: "重置筛选",
      loadingCounts: "加载中…",
      counts: (poses, costumes) => `${poses} 张姿势图 · ${costumes} 套服装 · 共 ${poses + costumes} 项素材`,
      results: (images, poses, cards) => `${images} 张图 / ${poses} 组姿势，当前展示 ${cards} 项`,
      angles: (n) => `${n} 个视角`, empty: "没有符合条件的姿势，尝试调整筛选条件。",
      loadError: (msg) => `图库加载失败：${msg}。请检查图库索引文件。`,
      footer: "本站仅提供图库浏览工具；请仅加载你有权使用的素材。",
      source: "原始素材来源及使用条款", download: "下载图片",
      hint: "← → 切换角度，↑ ↓ 切换姿势，Esc 关闭",
      close: "关闭", previous: "上一组", next: "下一组", dialog: "姿势图片预览"
    },
    en: {
      eyebrow: "AI reference library · Open-source viewer", tagline: "Creative reference collection",
      description: "Browse pose and costume references in one searchable collection.",
      typePose: "Poses", typeCostume: "Costumes",
      costumeDescription: "Browse outfits by season, style, and clothing keywords.",
      costumeSearchLabel: "Search outfit ID, season or keywords", costumeSearchPlaceholder: "e.g. SPR-0001, spring, denim",
      costumeName: (category, id) => `${category} outfit · ${id}`,
      costumeResults: (total, showing) => `${total} outfits found · ${showing} displayed`,
      costumeEmpty: "No matching outfits. Try another search.",
      costumeHint: "← → / ↑ ↓ change outfit · Esc close",
      loadMore: "Load more",
      searchLabel: "Search ID, pose, or category", searchPlaceholder: "e.g. P001, standing, side",
      categoryLabel: "Category", angleLabel: "Angle", viewLabel: "View",
      viewPose: "Pose groups", viewImage: "Individual images", allCategories: "All categories",
      allAngles: "All angles", allSeries: "All series", reset: "Reset filters",
      loadingCounts: "Loading…",
      counts: (poses, costumes) => `${poses} pose images · ${costumes} outfits · ${poses + costumes} total`,
      results: (images, poses, cards) => `${images} images / ${poses} poses · Showing ${cards} items`,
      angles: (n) => `${n} angles`, empty: "No matching poses. Try adjusting the filters.",
      loadError: (msg) => `Could not load gallery: ${msg}. Check the catalog scripts.`,
      footer: "This is a gallery browser. Only load images you have the right to use.",
      source: "Original reference site & usage terms", download: "Download image",
      hint: "← → change angle · ↑ ↓ change pose · Esc close",
      close: "Close", previous: "Previous group", next: "Next group", dialog: "Pose image preview"
    },
    ja: {
      eyebrow: "AI 参考ギャラリー · オープンソース", tagline: "創作資料集",
      description: "ポーズと衣装の参考素材をまとめて探せます。",
      typePose: "ポーズ素材", typeCostume: "衣装素材",
      costumeDescription: "季節、スタイル、キーワードから衣装を探せます。",
      costumeSearchLabel: "衣装ID・季節・キーワードを検索", costumeSearchPlaceholder: "例：SPR-0001、春、denim",
      costumeName: (category, id) => `${category}コーデ · ${id}`,
      costumeResults: (total, showing) => `${total} 着の衣装 · ${showing} 件を表示`,
      costumeEmpty: "該当する衣装がありません。検索条件を変更してください。",
      costumeHint: "← → / ↑ ↓ 衣装切替 · Esc で閉じる",
      loadMore: "もっと見る",
      searchLabel: "ID・ポーズ名・カテゴリーを検索", searchPlaceholder: "例：P001、立ち、横",
      categoryLabel: "カテゴリー", angleLabel: "アングル", viewLabel: "表示方法",
      viewPose: "ポーズ別", viewImage: "画像別", allCategories: "すべてのカテゴリー",
      allAngles: "すべてのアングル", allSeries: "すべてのシリーズ", reset: "絞り込みをリセット",
      loadingCounts: "読み込み中…",
      counts: (poses, costumes) => `ポーズ ${poses} 枚 · 衣装 ${costumes} 着 · 合計 ${poses + costumes} 件`,
      results: (images, poses, cards) => `${images} 枚 / ${poses} ポーズ · ${cards} 件を表示`,
      angles: (n) => `${n} アングル`, empty: "該当するポーズがありません。絞り込み条件を変更してください。",
      loadError: (msg) => `ギャラリーを読み込めませんでした：${msg}。カタログを確認してください。`,
      footer: "このサイトはギャラリー閲覧ツールです。使用権限のある画像のみ読み込んでください。",
      source: "元の素材サイトと利用規約", download: "画像をダウンロード",
      hint: "← → アングル切替 · ↑ ↓ ポーズ切替 · Esc で閉じる",
      close: "閉じる", previous: "前のポーズ", next: "次のポーズ", dialog: "ポーズ画像プレビュー"
    }
  };
  let locale = "zh-CN";
  const storageKey = "ai-reference-gallery-language";
  try {
    const stored = localStorage.getItem(storageKey) || localStorage.getItem("ai-pose-gallery-language") || localStorage.getItem("pose-gallery-language");
    if (Object.hasOwn(texts, stored)) locale = stored;
  } catch (_) { /* Storage can be disabled. */ }
  function setLocale(next) {
    if (!(next in texts)) return;
    locale = next;
    try { localStorage.setItem(storageKey, next); } catch (_) { /* Private mode. */ }
  }
  function t(key, ...args) {
    const value = texts[locale][key];
    return typeof value === "function" ? value(...args) : value;
  }
  function englishLabel(item, field) {
    // Never pass off untranslated names as English translations.
    if (field === "pose_name") return item.pose_name_en || `${englishLabel(item, "category")} · ${item.pose_number}`;
    return item[`${field}_en`] || item[field] || "";
  }
  function label(item, field) {
    if (locale === "zh-CN") return item[`${field}_zh`] || item[field] || "";
    // Use explicit translations, otherwise preserve the original catalog value.
    if (locale === "ja") return item[`${field}_ja`] || item[field] || "";
    return englishLabel(item, field);
  }
  function searchable(item) {
    return ["series", "category", "angle", "pose_name", "keywords"].flatMap((field) => [
      item[field], item[`${field}_zh`], item[`${field}_en`], item[`${field}_ja`], englishLabel(item, field)
    ]).filter(Boolean);
  }
  return { t, label, searchable, setLocale, get locale() { return locale; } };
})();

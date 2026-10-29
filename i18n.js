"use strict";
// Interface strings and catalog labels. Original Japanese identifiers are preserved.
window.ReferenceGalleryI18n = (() => {
  const texts = {
    "zh-CN": {
      eyebrow: "AI 创作参考图库", tagline: "灵感，从这里开始。",
      collectionPose: "探索姿势素材", collectionCostume: "探索服装素材",
      collectionCompose: "组合工作台", typeCompose: "组合制作",
      composeDescription: "挑选姿势与服装，拼成一张专属参考图。",
      addPose: "使用这张姿势", addCostume: "加入组合",
      composePose: "01 · 姿势", composeSecond: "02 · 服装或图片",
      composeEmptyPose: "尚未选择姿势", composeEmptySecond: "尚未选择图片",
      choosePose: "选择姿势", chooseCostume: "选择服装", uploadImage: "上传图片",
      composeEyebrow: "实时预览", composePreview: "组合预览",
      composeLayout: "排列方式", composeHorizontal: "左右拼图", composeVertical: "上下拼图",
      composeBg: "画布背景", composeWhite: "白色", composeSoft: "浅灰",
      composeLabels: "显示图片编号", composeSwap: "交换位置",
      composeHelp: "保留原图比例，不裁切。图片仅在你的浏览器中处理。",
      composePlaceholder: "选择姿势和第二张图片后即可预览",
      composeDownload: "下载 PNG", composeFolder: "选择本项目的 img 文件夹",
      composeSelectFolder: "请在弹出的窗口选择项目的 img 文件夹；授权一次即可导出。",
      composeFolderReady: "本地文件夹已授权，可以再次点击下载。",
      composeExporting: "正在生成高清 PNG…", composeSaved: "PNG 已生成并开始下载。",
      composeMissingFile: "找不到原图，请重新选择正确的 img 文件夹。",
      composeExportError: "导出失败，请检查图片文件或重新授权文件夹。",
      composePreviewError: "预览失败，请检查所选图片。",
      composeInvalidUpload: "请选择不超过 50MB 的 PNG、JPG 或 WebP 图片。",
      collectionEyebrow: "精选素材库", typeNav: "素材类型", filterNav: "素材筛选",
      socialNav: "项目与社交账号",
      galleryNav: "素材列表", pageTitle: "Reference Gallery — AI 创作参考素材库",
      composeOnlineImageError: "线上原图读取失败。请检查图片是否已部署，以及图片服务器的跨域设置。",
      composeLocalTitle: "本地下载：请选择当前项目的 img 文件夹",
      composeLocalStep: "在文件选择窗口中，打开 ai-reference-gallery 项目目录，选中其中的 img 文件夹。里面必须有 pose 和 costume 两个子文件夹；不要选择单独的 pose、costume 或其他同名文件夹。",
      composeLocalPublic: "此授权仅用于双击本地 index.html 时的离线导出。网站上线后直接下载，无需选择文件夹。",
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
      footer: "ai-reference-gallery · 图片与原始数据版权归原作者ギア所有 · 该版本由 vculjp 整理维护",
      download: "下载图片",
      hint: "← → 切换角度，↑ ↓ 切换姿势，Esc 关闭",
      close: "关闭", previous: "上一组", next: "下一组", dialog: "姿势图片预览",
      costumeDialog: "服装图片预览"
    },
    en: {
      eyebrow: "AI REFERENCE LIBRARY", tagline: "Inspiration starts here.",
      collectionPose: "Explore poses", collectionCostume: "Explore outfits",
      collectionCompose: "Composition studio", typeCompose: "Compose",
      composeDescription: "Pair a pose with an outfit and export one reference sheet.",
      addPose: "Use this pose", addCostume: "Add to composition",
      composePose: "01 · Pose", composeSecond: "02 · Outfit or image",
      composeEmptyPose: "No pose selected", composeEmptySecond: "No image selected",
      choosePose: "Choose pose", chooseCostume: "Choose outfit", uploadImage: "Upload image",
      composeEyebrow: "LIVE PREVIEW", composePreview: "Your composition",
      composeLayout: "Layout", composeHorizontal: "Side by side", composeVertical: "Stacked",
      composeBg: "Background", composeWhite: "White", composeSoft: "Light gray",
      composeLabels: "Show image IDs", composeSwap: "Swap positions",
      composeHelp: "Original proportions, no cropping. Images stay in your browser.",
      composePlaceholder: "Choose a pose and a second image to preview",
      composeDownload: "Download PNG", composeFolder: "Choose this project's img folder",
      composeSelectFolder: "Select this project's img folder in the dialog to enable offline export.",
      composeFolderReady: "Local folder granted. You can download the PNG.",
      composeExporting: "Rendering high-resolution PNG…", composeSaved: "PNG created. Download started.",
      composeMissingFile: "Original not found. Select the correct img folder again.",
      composeExportError: "Export failed. Check the files or grant folder access again.",
      composePreviewError: "Could not preview the selected images.",
      composeInvalidUpload: "Upload a PNG, JPG or WebP image smaller than 50 MB.",
      collectionEyebrow: "CURATED LIBRARY", typeNav: "Reference type", filterNav: "Filter references",
      socialNav: "Project and social profiles",
      galleryNav: "Reference results", pageTitle: "Reference Gallery — Creative references",
      composeOnlineImageError: "Could not load the original online image. Verify deployed assets and image CORS settings.",
      composeLocalTitle: "Offline download: select this project's img folder",
      composeLocalStep: "In the file picker, open the ai-reference-gallery project and select its img folder. It must contain both pose and costume folders. Do not select pose, costume, or a different img folder.",
      composeLocalPublic: "Only required when opening index.html directly from your computer. Published sites download without folder access.",
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
      footer: "ai-reference-gallery · Images and original data © original creator ギア · This edition is maintained by vculjp",
      download: "Download image",
      hint: "← → change angle · ↑ ↓ change pose · Esc close",
      close: "Close", previous: "Previous group", next: "Next group", dialog: "Pose image preview",
      costumeDialog: "Costume image preview"
    },
    ja: {
      eyebrow: "AI 参考ギャラリー", tagline: "創作のひらめきを、ここから。",
      collectionPose: "ポーズを探す", collectionCostume: "衣装を探す",
      collectionCompose: "画像組み合わせ", typeCompose: "組み合わせ",
      composeDescription: "ポーズと衣装を組み合わせて、1枚の参考画像にまとめます。",
      addPose: "このポーズを使う", addCostume: "組み合わせに追加",
      composePose: "01 · ポーズ", composeSecond: "02 · 衣装または画像",
      composeEmptyPose: "ポーズ未選択", composeEmptySecond: "画像未選択",
      choosePose: "ポーズを選ぶ", chooseCostume: "衣装を選ぶ", uploadImage: "画像をアップロード",
      composeEyebrow: "プレビュー", composePreview: "組み合わせプレビュー",
      composeLayout: "配置", composeHorizontal: "左右に配置", composeVertical: "上下に配置",
      composeBg: "背景", composeWhite: "白", composeSoft: "薄いグレー",
      composeLabels: "画像IDを表示", composeSwap: "配置を入れ替え",
      composeHelp: "元画像の比率を保持し、トリミングしません。処理はブラウザー内で行います。",
      composePlaceholder: "ポーズともう1枚の画像を選ぶとプレビューできます",
      composeDownload: "PNGをダウンロード", composeFolder: "このプロジェクトの img を選択",
      composeSelectFolder: "オフライン書き出しのため、プロジェクトのimgフォルダーを選択してください。",
      composeFolderReady: "フォルダーへのアクセスを許可しました。ダウンロードできます。",
      composeExporting: "高解像度PNGを生成中…", composeSaved: "PNGを生成し、ダウンロードを開始しました。",
      composeMissingFile: "元画像が見つかりません。正しいimgフォルダーを選び直してください。",
      composeExportError: "書き出しに失敗しました。画像またはフォルダー権限を確認してください。",
      composePreviewError: "選択した画像をプレビューできません。",
      composeInvalidUpload: "50MB以下のPNG・JPG・WebP画像を選んでください。",
      collectionEyebrow: "参考資料ライブラリー", typeNav: "素材の種類", filterNav: "素材を絞り込む",
      socialNav: "プロジェクトとSNS",
      galleryNav: "素材一覧", pageTitle: "Reference Gallery — 創作資料",
      composeOnlineImageError: "公開サイトの元画像を読み込めません。画像の配置とCORS設定を確認してください。",
      composeLocalTitle: "オフライン保存：このプロジェクトの img フォルダーを選択",
      composeLocalStep: "ファイル選択画面で ai-reference-gallery の中にある img フォルダーを選んでください。中に pose と costume の両方が必要です。別の img や pose / costume 単体は選択しないでください。",
      composeLocalPublic: "index.html をローカルで直接開いた場合のみ必要です。公開サイトではフォルダーの許可なしでダウンロードできます。",
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
      footer: "ai-reference-gallery · 画像と元データの著作権は原作者ギアに帰属します · この版は vculjp が整理・管理しています",
      download: "画像をダウンロード",
      hint: "← → アングル切替 · ↑ ↓ ポーズ切替 · Esc で閉じる",
      close: "閉じる", previous: "前のポーズ", next: "次のポーズ", dialog: "ポーズ画像プレビュー",
      costumeDialog: "衣装画像プレビュー"
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

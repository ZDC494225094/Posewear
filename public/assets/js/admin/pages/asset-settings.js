import { h, cicon } from "../../core/dom.js";
import { pageHead, settingsForm } from "../kit.js";

// Settings group "assets": user generation, sharing and revenue split, and
// the prompt templates for generating library assets.

const PLACEHOLDERS = "可用占位符：{category} 分类名称，{hint} 分类的生成提示，{description} 用户描述（含季节、时段等细分），{angle} 拍摄角度，{figure} 人物性别（female / male），{wearer} 服装款式（women's / men's）。占位符没有内容的那一行会整行省略。";

export async function render() {
  const fields = [
    { heading: "用户生成素材" },
    { key: "userGeneration", label: "开放用户生成素材", type: "switch", help: "关闭后只有管理员可以生成。" },
    { key: "poseCredits", label: "姿势每张消耗", type: "number", min: 0, suffix: "点" },
    { key: "outfitCredits", label: "服装每张消耗", type: "number", min: 0, suffix: "点" },
    { key: "sceneCredits", label: "场景每张消耗", type: "number", min: 0, suffix: "点" },
    { key: "itemCredits", label: "物品每张消耗", type: "number", min: 0, suffix: "点" },
    { key: "maxPerJob", label: "每次最多生成", type: "number", min: 1, max: 4, suffix: "张" },
    { key: "dailyLimitPerUser", label: "每人每天最多", type: "number", min: 0, suffix: "次", help: "0 表示不限。补全角度时每个角度算一次。" },
    { heading: "公开与分成" },
    { key: "publicReview", label: "公开前需要审核", type: "switch", help: "开启后，用户公开的素材要在「素材库 → 待审核」里通过才会出现。" },
    { key: "maxPrice", label: "使用点数上限", type: "number", min: 0, suffix: "点 / 次" },
    { key: "rebatePercent", label: "作者分成比例", type: "number", min: 0, max: 100, suffix: "%", help: "其他用户每次使用付费素材，作者获得的比例；其余归平台。生成失败时全额退回，作者不得分成。" },
    { heading: "授权" },
    { key: "commercialOnly", label: "只向用户展示可商用素材", type: "switch", help: "开启后，非商用素材（如导入的原项目素材）对用户隐藏，也不能用于生成。" },
    { heading: "生成参数" },
    { key: "quality", label: "画质", type: "select", options: [["low", "low（草稿）"], ["medium", "medium（标准）"], ["high", "high（精细）"]] },
    { key: "tier", label: "清晰度", type: "select", options: [["standard", "标准"], ["hd", "2K"]],
      help: "生成后统一缩放到素材规格：姿势 900×1200，服装 1366×2048，场景 1536×1024，物品 1024×1024。" },
    { heading: "生成模板" },
    { key: "posePrompt", label: "姿势（文字生成）", type: "textarea", rows: 8, wide: true, help: PLACEHOLDERS },
    { key: "poseRefPrompt", label: "姿势（从参考图提取）", type: "textarea", rows: 8, wide: true },
    { key: "poseAnglePrompt", label: "姿势（补全角度）", type: "textarea", rows: 4, wide: true },
    { key: "outfitPrompt", label: "服装（文字生成）", type: "textarea", rows: 8, wide: true },
    { key: "outfitRefPrompt", label: "服装（参考图还原）", type: "textarea", rows: 7, wide: true },
    { key: "scenePrompt", label: "场景（文字生成）", type: "textarea", rows: 7, wide: true, help: PLACEHOLDERS },
    { key: "sceneRefPrompt", label: "场景（参考图还原）", type: "textarea", rows: 7, wide: true },
    { key: "itemPrompt", label: "物品（文字生成）", type: "textarea", rows: 7, wide: true, help: PLACEHOLDERS },
    { key: "itemRefPrompt", label: "物品（参考图还原）", type: "textarea", rows: 7, wide: true },
    { heading: "拍摄角度描述（{angle}）" },
    { key: "angles.正面", label: "正面" },
    { key: "angles.斜め", label: "斜侧" },
    { key: "angles.横", label: "侧面" },
    { key: "angles.上から", label: "俯视" },
    { key: "angles.下から", label: "仰视" }
  ];
  return h("div",
    pageHead("素材生成与分成", "用户生成素材的价格、公开审核、作者分成，以及生成素材时使用的提示词模板。", [
      h("a.btn", { href: "/admin/asset-categories" }, cicon("folder", "blue"), "分类管理"),
      h("a.btn", { href: "/admin/assets" }, cicon("hanger", "teal"), "素材库")
    ]),
    await settingsForm("assets", fields, { title: null }));
}

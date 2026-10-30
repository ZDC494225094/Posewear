import { h } from "../../core/dom.js";
import { pageHead, settingsForm, section } from "../kit.js";

export async function render() {
  const preview = h("img.wm-preview", { alt: "水印预览", src: `/api/admin/watermark-preview.png?t=${Date.now()}` });
  const refreshPreview = () => { preview.src = `/api/admin/watermark-preview.png?t=${Date.now()}`; };
  const safety = await settingsForm("safety", [
    { heading: "素材分级" },
    { key: "showSuggestive", label: "素材库显示“敏感”级素材", type: "switch", help: "敏感级：性感姿势、内衣、泳装等。" },
    { key: "suggestiveForAI", label: "允许敏感级素材用于 AI 生成", type: "switch", help: "无论如何设置，敏感级素材都不能与人物照片同时使用。" },
    { key: "showExplicit", label: "向已登录用户显示“限制”级素材", type: "switch", help: "限制级素材（双人亲密体位等）只能浏览，永远不会发送给模型。运营地区法律不允许时请保持关闭。" },
    { heading: "人物照片" },
    { key: "personRetentionDays", label: "人物照片保留天数", type: "number", min: 1, max: 365, help: "到期自动删除文件。" },
    { key: "outfitRetentionDays", label: "上传服装图保留天数", type: "number", min: 1, max: 3650 },
    { heading: "提示词过滤" },
    { key: "bannedWords", label: "违禁词", type: "tags", rows: 4, wide: true,
      help: "用户描述包含这些词时直接拒绝，不扣点数。中文按包含匹配，英文按整词匹配（sex 不会误伤 sexy）。" },
    { heading: "AI 生成内容标识" },
    { key: "watermark.enabled", label: "添加显式标识（图片角标）", type: "switch", help: "依据《人工智能生成合成内容标识办法》，建议保持开启。" },
    { key: "watermark.text", label: "角标文字" },
    { key: "watermark.position", label: "位置", type: "select", options: [["bottom-right", "右下"], ["bottom-left", "左下"], ["top-right", "右上"], ["top-left", "左上"]] },
    { key: "watermark.opacity", label: "不透明度", type: "number", min: 0.2, max: 1, step: 0.05 },
    { key: "aigcMetadata", label: "写入隐式标识（文件元数据 AIGC 字段）", type: "switch", help: "PNG 写入 iTXt，WebP/JPEG 写入 XMP，字段按 GB 45438-2025 组织。" },
    { heading: "灵感广场" },
    { key: "showcaseEnabled", label: "开放灵感广场", type: "switch" },
    { key: "showcaseReview", label: "发布需审核", type: "switch", help: "开启后，用户发布的作品要在「举报与审核」里通过后才会公开。" }
  ], { title: "内容安全", after: refreshPreview });
  return h("div",
    pageHead("内容安全", "素材分级、人物照片、违禁词、AI 生成标识和广场审核。"),
    h("p.a-callout.small", "以下规则写在代码里，不能关闭：限制级素材不会发给模型；使用人物照片时只能搭配普通级姿势和服装，且不能搭配双人姿势；使用人物照片的作品不能公开或推荐；上传人物照片必须勾选授权声明。"),
    safety,
    section("水印预览", "保存后刷新。如果文字显示为方框，说明服务器缺少中文字体（Docker 镜像已内置；Linux 主机请安装 fonts-noto-cjk）。", preview));
}

import { h } from "../../core/dom.js";
import { api } from "../../core/api.js";
import { toastError, confirmDialog, lightbox } from "../../core/ui.js";
import { dateTime, STATUS_TEXT, QUALITY_TEXT } from "../../core/format.js";
import { pageHead, listView, table, statusPill, drawer, kv, section } from "../kit.js";

const ANGLE_TEXT = { 正面: "正面", 斜め: "斜侧", 横: "侧面", 上から: "俯视", 下から: "仰视" };

// Asset jobs keep their results as library assets, not generation images.
function imagesOf(g) {
  if (g.kind !== "asset") return g.images;
  return (g.assetJob?.assetIds || []).map((id) => ({
    thumb: `/media/library/${encodeURIComponent(id)}/thumb`, url: `/media/library/${encodeURIComponent(id)}/preview`
  }));
}

function assetJobText(g) {
  const p = g.assetJob || {};
  return [p.type === "pose" ? "姿势" : "服装", p.categoryLabel, p.type === "pose" && p.angle ? ANGLE_TEXT[p.angle] || p.angle : null].filter(Boolean).join(" · ");
}

function openDetail(g, refresh) {
  const isAsset = g.kind === "asset";
  const p = g.assetJob || {};
  const images = imagesOf(g);
  drawer(`${isAsset ? "素材生成" : "生成记录"} ${g.id}`, h("div.stack",
    images.length ? h("div.a-gen-images", images.map((img, i) => h("button", { type: "button", onclick: () => lightbox(images.map((x) => ({ src: x.url })), i) },
      h("img", { src: img.thumb, alt: "" })))) : null,
    kv([
      ["用户", `${g.userEmail}（#${g.userId}）`], ["状态", STATUS_TEXT[g.status]],
      isAsset ? ["素材", `${assetJobText(g)}${p.platform ? " · 平台素材" : " · 用户素材"}`] : null,
      ["参数", `${g.ratio} · ${g.size} · ${QUALITY_TEXT[g.quality] || g.quality} · ${g.n} 张`],
      isAsset ? null : ["风格 / 场景", [g.style, g.scene].filter(Boolean).join(" / ") || "—"],
      isAsset
        ? ["参考", g.sourceAssetId ? `补全角度，源素材 ${g.sourceAssetId}${p.sourceName ? `（${p.sourceName}）` : ""}` : g.refUploadId ? "参考图" : "纯文字"]
        : ["参考", [g.refs.pose ? `姿势 ${g.refs.pose.id}` : "", g.refs.outfit?.id ? `服装 ${g.refs.outfit.id}` : g.refs.outfit?.upload ? "上传的服装" : "",
          g.hasPerson ? "人物照片" : ""].filter(Boolean).join(" · ") || "纯文字"],
      ["点数", `扣 ${g.cost}，退 ${g.refunded}${g.assetFee ? `（含素材使用费 ${g.assetFee}）` : ""}`],
      ["渠道 / 模型", `${g.channelName || "—"} / ${g.model || "—"}`],
      ["尝试次数", g.attempts],
      ["用量", g.usage ? `输入 ${g.usage.input_tokens ?? "—"} · 输出 ${g.usage.output_tokens ?? "—"} tokens` : "—"],
      ["估算成本", g.apiCostUsd != null ? `$${g.apiCostUsd.toFixed(4)}` : "—"],
      ["时间", `创建 ${dateTime(g.createdAt)} · 完成 ${dateTime(g.finishedAt)}`],
      ["IP", g.clientIp || "—"],
      isAsset ? null : ["公开", g.isPublic ? (g.hidden ? "已公开（被隐藏）" : g.approved ? "已公开" : "已公开（待审核）") : "否"]
    ].filter(Boolean)),
    isAsset && p.description ? section("用户描述", null, h("p", p.description)) : null,
    !isAsset && g.prompt ? section("用户描述", null, h("p", g.prompt)) : null,
    section("发送给模型的提示词", null, h("pre.prompt-preview", g.promptFinal)),
    g.errorCode ? section("错误", null, h("p", h("code", g.errorCode), " ", g.errorMessage), g.errorDetail ? h("pre.prompt-preview", g.errorDetail) : null) : null,
    isAsset ? h("p.small.muted", "生成的素材在「素材库」中管理，删除、上下架和审核都在那里操作。") : h("div.a-row-actions",
      g.isPublic ? h("button.btn", { type: "button", onclick: () => update(g, { hidden: !g.hidden }, refresh) }, g.hidden ? "取消隐藏" : "从广场隐藏") : null,
      g.isPublic && !g.approved ? h("button.btn.btn-primary", { type: "button", onclick: () => update(g, { approved: true }, refresh) }, "审核通过") : null,
      g.status === "succeeded" && !g.hasPerson ? h("button.btn", { type: "button", onclick: () => update(g, { featured: !g.featured }, refresh) }, g.featured ? "取消推荐" : "推荐到首页") : null,
      g.status !== "queued" && g.status !== "running" && !g.deleted ? h("button.btn.btn-danger", { type: "button", onclick: async () => {
        if (!(await confirmDialog({ title: "删除这条生成记录的图片？", message: "图片文件会被删除，记录保留用于对账。", confirmText: "删除", danger: true }))) return;
        try { await api.del(`/api/admin/generations/${g.id}`); refresh(); } catch (err) { toastError(err); }
      } }, "删除图片") : null)), { width: 820 });
}

async function update(g, patch, refresh) {
  try { await api.patch(`/api/admin/generations/${g.id}`, patch); Object.assign(g, patch); refresh(); }
  catch (err) { toastError(err); }
}

const TONE = { succeeded: "mat", failed: "pin", queued: "tape", running: "tape" };

export async function render(ctx) {
  const view = listView({
    size: 24,
    filters: [
      { key: "q", label: "搜索", placeholder: "记录 ID / 用户邮箱 / 描述", value: ctx.query.q || "" },
      { key: "kind", type: "select", label: "类型", options: [["", "全部类型"], ["work", "作品"], ["asset", "素材生成"]], value: ctx.query.kind || "" },
      { key: "status", type: "select", label: "状态", options: [["", "全部状态"], ["queued", "排队中"], ["running", "生成中"], ["succeeded", "已完成"], ["failed", "失败"]] },
      { key: "public", type: "select", label: "公开", options: [["", "全部"], ["1", "已公开"], ["pending", "待审核"]], value: ctx.query.public || "" }
    ],
    load: (q) => api.get("/api/admin/generations", q),
    render: (items, data, refresh) => table([
      { label: "", render: (g) => { const img = imagesOf(g)[0]; return img ? h("img.a-thumb", { src: img.thumb, alt: "" }) : h("span.a-thumb.is-empty"); }, width: "56px" },
      { label: "记录", render: (g) => h("button.link.num", { type: "button", onclick: () => openDetail(g, refresh) }, g.id) },
      { label: "用户", render: (g) => g.userEmail },
      { label: "状态", render: (g) => [statusPill(STATUS_TEXT[g.status], TONE[g.status]),
        g.kind === "asset" ? statusPill("素材生成", "blue") : null,
        g.isPublic ? statusPill(g.approved ? "公开" : "待审", g.approved ? "" : "tape") : null,
        g.hidden ? statusPill("已隐藏", "pin") : null, g.featured ? statusPill("推荐", "tape") : null, g.hasPerson ? statusPill("人物照片") : null] },
      { label: "参数", render: (g) => (g.kind === "asset" ? `${assetJobText(g)} · ${g.n} 张` : `${g.ratio} · ${QUALITY_TEXT[g.quality] || g.quality} · ${g.n} 张`) },
      { label: "点数", render: (g) => (g.refunded ? `${g.cost}（退 ${g.refunded}）` : g.cost), className: "right num" },
      { label: "成本", render: (g) => (g.apiCostUsd != null ? `$${g.apiCostUsd.toFixed(3)}` : "—"), className: "right num" },
      { label: "错误", render: (g) => (g.errorCode ? h("code", g.errorCode) : "") },
      { label: "时间", render: (g) => dateTime(g.createdAt), className: "num" }
    ], items, { empty: "没有匹配的记录" })
  });
  return h("div", pageHead("生成记录", "所有用户的作品生成和素材生成任务。点开记录可以看到实际发送的提示词、错误详情和用量。"), view.node);
}

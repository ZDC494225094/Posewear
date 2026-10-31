import { h, cicon, replace } from "../../core/dom.js";
import { toast } from "../../core/ui.js";
import { pageHead } from "../kit.js";
import { assetJobList } from "../../components/asset-jobs.js";
import { openAssetGenerator } from "../../components/asset-generator.js";
import { TYPE_TEXT } from "../../components/library-browser.js";
import { editAsset } from "./assets.js";

const FILTERS = {
  status: [["", "全部状态"], ["active", "进行中"], ["succeeded", "已完成"], ["failed", "失败"]],
  type: [["", "全部类型"], ...Object.entries(TYPE_TEXT)],
  scope: [["", "全部归属"], ["platform", "平台素材"], ["user", "用户素材"]]
};

export async function render(ctx) {
  const filters = Object.fromEntries(Object.entries(FILTERS).map(([key, options]) => [key, options.some(([value]) => value === ctx.query[key]) ? ctx.query[key] : ""]));
  const jobs = assetJobList({
    endpoint: "/api/admin/asset-jobs", admin: true,
    onFinished: (job) => { if (job.status === "failed") toast(job.errorMessage || "素材生成失败", { type: "error" }); },
    onOpenAsset: (asset) => editAsset(asset, () => jobs.load(filters), { onGenerated: () => jobs.load(filters) })
  });
  const bar = h("div.ajobs-filters");
  function renderFilters() {
    replace(bar, Object.entries(FILTERS).map(([key, options]) => h("div.seg", { role: "radiogroup", "aria-label": { status: "状态", type: "素材类型", scope: "素材归属" }[key] },
      options.map(([value, text]) => h("button", { type: "button", role: "radio", "aria-checked": String(filters[key] === value), "aria-pressed": String(filters[key] === value), onclick: () => {
        filters[key] = value;
        const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
        history.replaceState({}, "", `/admin/asset-jobs${params.size ? `?${params}` : ""}`);
        renderFilters();
        jobs.load(filters);
      } }, text)))));
  }
  renderFilters();
  jobs.load(filters);
  return {
    node: h("div", pageHead("素材生成记录", "平台与用户的素材任务、进度、点数及生成结果。点击结果可查看生成信息、管理素材或补全姿势角度。", [
      h("a.btn", { href: "/admin/assets" }, cicon("hanger", "teal"), "素材库"),
      h("button.btn.btn-primary", { type: "button", onclick: () => openAssetGenerator({ admin: true, type: filters.type || "pose", onCreated: () => jobs.load(filters) }) }, cicon("wand", "purple"), "AI 生成素材")
    ]), bar, jobs.node),
    cleanup() { jobs.stop(); }
  };
}

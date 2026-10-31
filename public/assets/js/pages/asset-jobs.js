import { h, cicon, replace } from "../core/dom.js";
import { store } from "../core/store.js";
import { toast } from "../core/ui.js";
import { openAssetGenerator } from "../components/asset-generator.js";
import { assetJobList } from "../components/asset-jobs.js";
import { openMyAsset } from "../components/my-asset-detail.js";

// 素材生成记录: every asset-generation job of the user, with live progress.
const STATUS = [["", "全部"], ["active", "进行中"], ["succeeded", "已完成"], ["failed", "失败"]];
const TYPES = [["", "全部类型"], ["pose", "姿势"], ["outfit", "服装"], ["scene", "场景"], ["item", "物品"]];

export async function render(ctx) {
  const cfg = store.config.assets;
  const filters = {
    status: STATUS.some(([v]) => v === ctx.query.status) ? ctx.query.status : "",
    type: TYPES.some(([v]) => v === ctx.query.type) ? ctx.query.type : ""
  };
  const jobs = assetJobList({
    endpoint: "/api/my/asset-jobs",
    emptyText: "还没有生成记录",
    onFinished: (job) => {
      store.refreshUser();
      if (job.status === "failed") toast(job.errorMessage || "生成失败，点数已退回", { type: "error" });
    },
    onOpenAsset: (a) => openMyAsset(a, { onChanged: () => jobs.load(filters), onCreated: (items) => jobs.add(items) })
  });

  const bar = h("div.ajobs-filters");
  function seg(key, options, name) {
    return h("div.seg", { role: "radiogroup", "aria-label": name }, options.map(([value, text]) =>
      h("button", { type: "button", role: "radio", "aria-checked": String(filters[key] === value), "aria-pressed": String(filters[key] === value),
        onclick: () => {
          filters[key] = value;
          const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
          history.replaceState({}, "", `/my-assets/jobs${params.size ? `?${params}` : ""}`);
          renderBar();
          jobs.load(filters);
        } }, text)));
  }
  function renderBar() {
    replace(bar, seg("status", STATUS, "状态"), seg("type", TYPES, "素材类型"));
  }
  renderBar();
  jobs.load(filters);

  return {
    node: h("div.asset-jobs.wrap",
      h("header.page-head",
        h("div", h("h1", "素材生成记录"), h("p", "每次生成素材的任务都记在这里：进度、用了什么分类和描述、生成结果和点数。点开结果可以设置公开、补全角度或带入创作台。")),
        h("div.lib-head-actions",
          h("a.btn", { href: "/my-assets" }, cicon("wand", "purple"), "我的素材"),
          cfg.generation ? h("button.btn.btn-primary", { type: "button", onclick: () => openAssetGenerator({ type: filters.type || "pose",
            onCreated: (items) => jobs.add(items) }) }, cicon("wand", "purple"), "生成素材") : null)),
      bar,
      jobs.node),
    cleanup() { jobs.stop(); }
  };
}

import { h, tile, replace } from "../core/dom.js";
import { api } from "../core/api.js";
import { relative, number, STATUS_TEXT } from "../core/format.js";

// Recent asset-generation jobs with live status. Polls while any job is
// queued or running and reports each job that finishes.
//   const jobs = assetJobList({ endpoint: "/api/my/asset-jobs", onFinished });
//   jobs.add(newJobs); jobs.load(); jobs.stop();
export function assetJobList({ endpoint, admin = false, limit = 6, onFinished, onOpenAsset } = {}) {
  const node = h("section.ajobs", { hidden: true, "aria-label": "生成任务" });
  const jobs = new Map();
  let timer = null;
  let stopped = false;

  const active = (j) => j.status === "queued" || j.status === "running";

  function row(job) {
    const what = [job.type === "pose" ? "姿势" : "服装", job.category, job.angle && !job.sourceAssetId ? job.angle.zh : null,
      job.sourceAssetId ? `补全${job.angle?.zh || ""}角度` : null, `${job.n} 张`].filter(Boolean).join(" · ");
    const visual = job.status === "succeeded" && job.assets.length
      ? h("div.ajob-thumbs", job.assets.slice(0, 4).map((a) => h("button", { type: "button", "aria-label": `查看 ${a.name.zh}`,
        onclick: () => onOpenAsset?.(a) }, h("img", { src: a.thumb, alt: "" }))))
      : job.status === "failed" ? tile("alert", "red") : h("div.spinner", { "aria-hidden": "true" });
    return h("article.ajob", { class: `is-${job.status}` },
      visual,
      h("div.ajob-body",
        h("p.ajob-title", h("span.gen-status", STATUS_TEXT[job.status]), what),
        job.description ? h("p.ajob-desc", job.description) : null,
        job.status === "failed" ? h("p.ajob-error", job.errorMessage || "生成失败") : null,
        h("p.ajob-meta",
          relative(job.createdAt),
          admin ? ` · ${job.platform ? "平台" : job.userEmail}` : "",
          job.cost ? ` · ${number(job.cost)} 点` : "",
          job.refunded ? ` · 已退回 ${number(job.refunded)} 点` : "",
          job.reference ? " · 参考图" : "")));
  }

  function render() {
    const list = [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
    node.hidden = !list.length;
    replace(node, h("div.ajobs-head", h("h2", "生成任务"),
      list.some(active) ? h("span.small.muted", "生成中，完成后自动出现在下方") : null),
    h("div.ajobs-list", list.map(row)));
  }

  async function poll() {
    timer = null;
    const ids = [...jobs.values()].filter(active).map((j) => j.id);
    if (stopped || !ids.length) return;
    try {
      const { items } = await api.get(endpoint, { ids: ids.join(",") });
      for (const job of items) {
        const before = jobs.get(job.id);
        jobs.set(job.id, job);
        if (before && active(before) && !active(job)) onFinished?.(job);
      }
      render();
    } catch { /* try again next tick */ }
    schedule();
  }
  function schedule() {
    if (!stopped && !timer && [...jobs.values()].some(active)) timer = setTimeout(poll, document.hidden ? 8000 : 3000);
  }

  return {
    node,
    add(list) { for (const job of list) jobs.set(job.id, job); render(); schedule(); },
    async load() {
      try {
        const data = await api.get(endpoint, { size: limit });
        for (const job of data.items) jobs.set(job.id, job);
        render();
        schedule();
      } catch { /* the list is optional */ }
    },
    stop() { stopped = true; clearTimeout(timer); }
  };
}

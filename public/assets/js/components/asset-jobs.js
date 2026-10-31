import { h, tile, replace } from "../core/dom.js";
import { api } from "../core/api.js";
import { relative, number, STATUS_TEXT } from "../core/format.js";
import { toastError } from "../core/ui.js";

// Asset-generation jobs: the records list on the 素材生成 pages, and a small
// indicator of running jobs for the pages that start them.

const TYPE_TEXT = { pose: "姿势", outfit: "服装", scene: "场景", item: "物品" };
const active = (j) => j.status === "queued" || j.status === "running";

export function jobTitle(job) {
  return [TYPE_TEXT[job.type], job.category, job.type === "pose" && job.angle && !job.sourceAssetId ? job.angle.zh : null,
    job.sourceAssetId ? `补全${job.angle?.zh || ""}角度` : null, job.variant || null, job.n > 1 ? `${job.n} 张` : null].filter(Boolean).join(" · ");
}

function jobCard(job, { admin, onOpenAsset }) {
  const results = job.status === "succeeded" && job.assets.length
    ? h("div.ajob-results", { class: `is-${job.type}` }, job.assets.map((a) => h("button", { type: "button", "aria-label": `查看 ${a.name.zh}`,
      onclick: () => onOpenAsset?.(a) }, h("img", { src: a.thumb, alt: "", loading: "lazy" }))))
    : h("div.ajob-state", job.status === "failed" ? tile("alert", "red", "lg")
      : job.status === "succeeded" ? h("span.small.muted", "素材已删除") : h("div.spinner", { "aria-hidden": "true" }));
  return h("article.ajob", { class: `is-${job.status}` },
    results,
    h("div.ajob-body",
      h("p.ajob-title", h("span.gen-status", STATUS_TEXT[job.status]), jobTitle(job)),
      job.description ? h("p.ajob-desc", { title: job.description }, job.description) : null,
      job.status === "failed" ? h("p.ajob-error", job.errorMessage || "生成失败") : null,
      h("p.ajob-meta",
        relative(job.createdAt),
        admin ? ` · ${job.platform ? "平台素材" : job.userEmail}` : "",
        job.cost ? ` · ${number(job.cost)} 点` : "",
        job.refunded ? ` · 已退回 ${number(job.refunded)} 点` : "",
        job.reference ? " · 用了参考图" : "",
        job.sourceName ? ` · 来自「${job.sourceName}」` : "")));
}

// A page of jobs with live status: newest first, "加载更多" for older ones.
// Polls while any job is queued or running and reports each job that finishes.
//   const list = assetJobList({ endpoint: "/api/my/asset-jobs", onFinished, onOpenAsset });
//   list.load({ status, type }); list.add(newJobs); list.stop();
export function assetJobList({ endpoint, admin = false, size = 20, onFinished, onOpenAsset, emptyText = "还没有生成记录" } = {}) {
  const jobs = new Map();
  const list = h("div.ajobs-list");
  const more = h("button.btn", { type: "button", hidden: true, onclick: () => fetchPage(false) }, "加载更多");
  const summary = h("p.small.muted.ajobs-summary");
  let page = 1, total = 0, query = {}, timer = null, stopped = false, token = 0;
  const matches = (job) => (!query.type || job.type === query.type)
    && (!query.status || (query.status === "active" ? active(job) : job.status === query.status))
    && (!query.scope || (query.scope === "platform" ? job.platform : !job.platform));

  function render() {
    const rows = [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
    replace(list, rows.length ? rows.map((j) => jobCard(j, { admin, onOpenAsset })) : h("div.empty.small", h("div.empty-title", emptyText)));
    summary.textContent = total ? `共 ${number(total)} 条${rows.some(active) ? "，生成中的任务完成后会自动刷新" : ""}` : "";
    more.hidden = jobs.size >= total;
  }

  async function fetchPage(reset) {
    const mine = ++token;
    const nextPage = reset ? 1 : page + 1;
    more.disabled = true;
    try {
      const data = await api.get(endpoint, { ...query, page: nextPage, size });
      if (stopped || mine !== token) return;
      page = nextPage;
      if (reset) jobs.clear();
      total = data.total;
      for (const job of data.items) jobs.set(job.id, job);
      render();
      schedule();
    } catch (err) { if (!stopped && mine === token) toastError(err); }
    finally { if (mine === token) more.disabled = false; }
  }

  async function poll() {
    timer = null;
    const ids = [...jobs.values()].filter(active).map((j) => j.id);
    if (stopped || !ids.length) return;
    const mine = token;
    try {
      const pages = [];
      for (let i = 0; i < ids.length; i += 50) pages.push(api.get(endpoint, { ids: ids.slice(i, i + 50).join(",") }));
      const items = (await Promise.all(pages)).flatMap((p) => p.items);
      if (stopped || mine !== token) return;
      for (const job of items) {
        const before = jobs.get(job.id);
        if (matches(job)) jobs.set(job.id, job);
        else { jobs.delete(job.id); total = Math.max(0, total - 1); }
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
    node: h("div.ajobs", summary, list, h("div.lib-more-wrap", more)),
    load(filters = {}) { query = { ...filters }; clearTimeout(timer); timer = null; return fetchPage(true); },
    add(items) {
      for (const job of items) { if (!matches(job)) continue; if (!jobs.has(job.id)) total += 1; jobs.set(job.id, job); }
      render();
      schedule();
    },
    stop() { stopped = true; clearTimeout(timer); }
  };
}

// "N 个素材生成中 · 查看": shown while the user (or, for admins, anyone) has
// jobs running. Calls onSettled when some of them finish.
export function activeJobsChip({ endpoint, href, onSettled } = {}) {
  const node = h("a.ajobs-chip", { href, hidden: true });
  let timer = null, stopped = false, last = 0;
  async function poll() {
    timer = null;
    try {
      const { total } = await api.get(endpoint, { status: "active", size: 1 });
      if (total < last) onSettled?.();
      last = total;
      node.hidden = !total;
      replace(node, h("span.spinner", { "aria-hidden": "true" }), `${total} 个素材生成中`, h("span.ajobs-chip-link", "查看"));
    } catch { /* optional */ }
    if (!stopped && last) timer = setTimeout(poll, document.hidden ? 10000 : 4000);
  }
  poll();
  return {
    node,
    refresh() { clearTimeout(timer); poll(); },
    stop() { stopped = true; clearTimeout(timer); }
  };
}

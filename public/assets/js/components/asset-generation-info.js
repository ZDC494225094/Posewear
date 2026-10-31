import { h, replace } from "../core/dom.js";
import { api } from "../core/api.js";
import { lightbox } from "../core/ui.js";
import { dateTime } from "../core/format.js";

// Only the owner and admins may inspect an asset's private generation input.
export function assetGenerationInfo(asset, { admin = false } = {}) {
  const title = () => h("p.viewer-sec-title", "生成信息");
  const box = h("div.viewer-sec", title(), h("p.small.muted", "正在加载…"));
  const prefix = admin ? "/api/admin/assets" : "/api/my/assets";
  function reference(name, thumb, url) {
    return h("figure.ref-block-item",
      thumb ? h("button.ref-preview", { type: "button", "aria-label": `查看${name}`, onclick: () => lightbox([{ src: url || thumb, alt: name }]) },
        h("img", { src: thumb, alt: name })) : h("span.ref-block-empty", "已删除或过期"),
      h("figcaption", name));
  }
  api.get(`${prefix}/${encodeURIComponent(asset.id)}/info`).then(({ job }) => {
    if (!job) { replace(box, title(), h("p.small.muted", "这个素材是上传的，没有生成记录。")); return; }
    replace(box, title(),
      h("dl.kv",
        h("dt", "分类"), h("dd", job.category || "—"),
        job.angle ? [h("dt", "角度"), h("dd", job.angle.zh)] : null,
        h("dt", "描述"), h("dd", job.description || "未填写，按分类设计"),
        h("dt", "时间"), h("dd", dateTime(job.createdAt))),
      job.reference || job.source ? h("div.ref-block",
        job.reference ? reference("参考图", job.reference.thumb, job.reference.url) : null,
        job.source ? reference("原姿势", job.source.thumb, job.source.preview) : null) : null);
  }).catch(() => replace(box, title(), h("p.small.muted", "暂时无法加载生成信息")));
  return box;
}

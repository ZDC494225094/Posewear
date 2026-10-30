import { h, replace } from "../../core/dom.js";
import { api } from "../../core/api.js";
import { toast, toastError, busy } from "../../core/ui.js";
import { pageHead, section, form } from "../kit.js";

const RATIOS = ["2:3", "3:4", "1:1", "4:3", "3:2", "9:16", "16:9"];

// Editable list of { id, label, prompt } presets (styles, scenes).
function presetEditor(title, items, help) {
  const rows = items.map((x) => ({ ...x }));
  const box = h("div.preset-list");
  function draw() {
    replace(box,
      rows.map((row, i) => h("div.preset-row",
        h("input.input", { value: row.id, placeholder: "英文 ID", "aria-label": "ID", maxLength: 32, oninput: (e) => { row.id = e.target.value.trim(); } }),
        h("input.input", { value: row.label, placeholder: "显示名称", "aria-label": "显示名称", maxLength: 24, oninput: (e) => { row.label = e.target.value; } }),
        h("input.input", { value: row.prompt, placeholder: "发给模型的英文描述", "aria-label": "提示词", maxLength: 600, oninput: (e) => { row.prompt = e.target.value; } }),
        h("button.btn.btn-sm.btn-ghost", { type: "button", "aria-label": "删除", onclick: () => { rows.splice(i, 1); draw(); } }, "删除"))),
      h("button.btn.btn-sm", { type: "button", onclick: () => { rows.push({ id: "", label: "", prompt: "" }); draw(); } }, "添加一项"));
  }
  draw();
  return { node: h("div.a-field.is-wide", h("label", title), help ? h("small", help) : null, box), get value() { return rows.filter((r) => r.id); } };
}

export async function render() {
  const root = h("div");
  let value;
  try { value = (await api.get("/api/admin/settings/generation")).value; }
  catch (err) { toastError(err); return root; }

  const ratioOptions = RATIOS.map((r) => [r, r]);
  const main = form([
    { key: "enabled", label: "开放生成", type: "switch", help: "关闭后用户无法提交新任务，会看到下面的维护提示。" },
    { key: "maintenanceMessage", label: "维护提示", wide: true },
    { heading: "画质与计费（每张图消耗的点数）" },
    ...value.qualities.flatMap((q, i) => [
      { key: `qualities.${i}.label`, label: `${q.id} 显示名称` },
      { key: `qualities.${i}.credits`, label: `${q.id} 点数/张`, type: "number", min: 0 },
      { key: `qualities.${i}.enabled`, label: `开放 ${q.id}`, type: "switch" }
    ]),
    { heading: "清晰度（点数倍率）" },
    ...value.tiers.flatMap((t, i) => [
      { key: `tiers.${i}.label`, label: `${t.id} 显示名称` },
      { key: `tiers.${i}.multiplier`, label: `${t.id} 倍率`, type: "number", min: 0.1, step: 0.1 },
      { key: `tiers.${i}.enabled`, label: `开放 ${t.id}`, type: "switch", help: t.id === "uhd" ? "4K 属于 gpt-image-2 的实验性尺寸，效果不稳定。" : t.id === "standard" ? "标准档始终开放。" : "" }
    ]),
    { heading: "画幅与默认值" },
    { key: "ratios", label: "开放的画幅", type: "checks", options: ratioOptions, wide: true },
    { key: "defaultRatio", label: "默认画幅", type: "select", options: ratioOptions },
    { key: "defaultQuality", label: "默认画质", type: "select", options: value.qualities.map((q) => [q.id, q.label]) },
    { key: "defaultTier", label: "默认清晰度", type: "select", options: value.tiers.map((t) => [t.id, t.label]) },
    { key: "maxN", label: "单次最多张数", type: "number", min: 1, max: 10 },
    { heading: "功能开关" },
    { key: "allowTextOnly", label: "允许纯文字生成（不选参考图）", type: "switch" },
    { key: "allowOutfitUpload", label: "允许上传自己的服装图", type: "switch" },
    { key: "allowPersonPhoto", label: "允许上传人物照片", type: "switch", help: "人物照片只能搭配普通级素材，作品不能公开。" },
    { heading: "模型请求" },
    { key: "moderation", label: "内容审核强度（moderation）", type: "select", options: [["auto", "auto（标准，推荐）"], ["low", "low（较宽松）"]] },
    { key: "outputFormat", label: "保存格式", type: "select", options: [["png", "PNG（无损）"], ["webp", "WebP（体积小）"], ["jpeg", "JPEG"]] },
    { key: "outputCompression", label: "WebP/JPEG 质量", type: "number", min: 10, max: 100 },
    { key: "inputMaxEdge", label: "参考图最长边（像素）", type: "number", min: 512, max: 4096, help: "参考图按高保真计费，适当缩小可以降低输入 token 成本。" },
    { key: "requestTimeoutSec", label: "请求超时（秒）", type: "number", min: 30, max: 900, help: "复杂画面可能需要 2 分钟以上。" },
    { key: "maxAttempts", label: "最多尝试次数", type: "number", min: 1, max: 6, help: "限流、超时等临时错误会自动重试。" },
    { key: "workerConcurrency", label: "同时处理的任务数", type: "number", min: 1, max: 32 },
    { heading: "用户限制" },
    { key: "maxActivePerUser", label: "每人同时进行的任务", type: "number", min: 1, max: 50 },
    { key: "dailyLimitPerUser", label: "每人每日生成上限", type: "number", min: 0, help: "0 表示不限制。" },
    { heading: "成本估算（用于数据概览的毛利计算）" },
    { key: "tokenPriceUsd.textInput", label: "文本输入 $/百万 token", type: "number", min: 0, step: 0.01 },
    { key: "tokenPriceUsd.imageInput", label: "图片输入 $/百万 token", type: "number", min: 0, step: 0.01 },
    { key: "tokenPriceUsd.imageOutput", label: "图片输出 $/百万 token", type: "number", min: 0, step: 0.01 },
    { key: "fallbackCostUsd.low", label: "无用量数据时 low 每张 $", type: "number", min: 0, step: 0.001 },
    { key: "fallbackCostUsd.medium", label: "无用量数据时 medium 每张 $", type: "number", min: 0, step: 0.001 },
    { key: "fallbackCostUsd.high", label: "无用量数据时 high 每张 $", type: "number", min: 0, step: 0.001 },
    { key: "usdToCny", label: "美元兑人民币汇率", type: "number", min: 0.01, step: 0.01 }
  ], value);
  const styles = presetEditor("风格预设", value.styles, "ID 用英文小写；描述用英文写给模型看，例如 photorealistic fashion photography。");
  const scenes = presetEditor("场景预设", value.scenes, "例如 seamless light grey studio backdrop。");

  const save = h("button.btn.btn-primary", { type: "button", onclick: (e) => busy(e.currentTarget, async () => {
    try {
      await api.put("/api/admin/settings/generation", { value: { ...main.value, styles: styles.value, scenes: scenes.value } });
      toast("已保存，新设置对之后提交的任务生效", { type: "success" });
    } catch (err) { toastError(err); }
  }) }, "保存设置");

  replace(root,
    pageHead("生成与计费", "定价、画质、尺寸和模型请求参数。改动对之后提交的任务生效。", save),
    section(null, null, main.node),
    section("风格与场景", "显示在创作台的可选项，选中后会把描述拼进提示词。", h("div.a-form", styles.node, scenes.node)),
    h("div.a-form-actions.sticky-actions", save.cloneNode(true)));
  root.querySelector(".sticky-actions button").onclick = () => save.click();
  return root;
}

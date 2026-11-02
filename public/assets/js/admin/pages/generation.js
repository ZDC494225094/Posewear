import { h, replace } from "../../core/dom.js";
import { api } from "../../core/api.js";
import { toast, toastError, busy } from "../../core/ui.js";
import { pageHead, section, form, table, statusPill } from "../kit.js";

const RATIOS = ["2:3", "3:4", "1:1", "4:3", "3:2", "9:16", "16:9"];
const TIER_RANK = { standard: 0, hd: 1, uhd: 2 };

const TIER_HELP = {
  standard: "约 100–180 万像素，如 1024 × 1536。始终开放，所有渠道都支持。",
  hd: "约 300–370 万像素，如 1536 × 2304、2560 × 1440，是官方非实验尺寸里最大的一档。需要 gpt-image-2 / 2.5 或 Nano Banana Pro / 2 / 2.1 的渠道。",
  uhd: "约 800 万像素，如 2336 × 3504、3840 × 2160，接近模型上限 3840 × 2160。官方标为实验性，效果可能不稳定，出图也更慢。"
};

// Editable list of { id, label, prompt } presets (styles, scenes, cameras).
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

// 清晰度一览: every ratio's output size at each tier, the estimated model cost
// of the output and the points charged. Points, token price and exchange rate
// come from the form, so the table follows edits before they are saved.
function sizeOverview(data, getValue) {
  const node = h("div.a-field.is-wide.size-overview");
  let basis = "medium";
  let costBy = "";   // "" for gpt-image-2's official price, else a channel id
  const money = (yuan) => `¥${yuan.toFixed(2)}`;
  function draw() {
    const v = getValue();
    const quality = v.qualities.find((q) => q.id === basis) || v.qualities[0];
    const rate = Number(v.usdToCny) || data.usdToCny;
    const tokenScale = (Number(v.tokenPriceUsd?.imageOutput) || data.imageOutputUsd) / data.imageOutputUsd;
    const channel = (data.channels || []).find((c) => String(c.id) === costBy) || null;
    const perPoint = data.yuanPerPoint;
    const income = (points) => (!perPoint ? "" : perPoint.min === perPoint.max ? ` ≈ ${money(points * perPoint.min)}`
      : ` ≈ ${money(points * perPoint.min)}–${(points * perPoint.max).toFixed(2)}`);
    replace(node,
      h("div.size-overview-head",
        h("label", "清晰度一览"),
        h("div.seg", { role: "radiogroup", "aria-label": "按画质估算" }, v.qualities.map((q) =>
          h("button", { type: "button", role: "radio", "aria-checked": String(q.id === basis), "aria-pressed": String(q.id === basis),
            onclick: () => { basis = q.id; draw(); } }, q.label)))),
      data.channels?.length ? h("div.chips.a-quick", h("span.small.muted", "成本按："),
        [["", "gpt-image-2 官方价"], ...data.channels.map((c) => [String(c.id), c.name])].map(([id, text]) =>
          h("button.chip", { type: "button", "aria-pressed": String(id === costBy), onclick: () => { costBy = id; draw(); } }, text))) : null,
      channel && !channel.qualities.includes(basis)
        ? h("p.a-callout.small", `「${channel.name}」不接「${quality.label}」画质，这一档的作品不会发给它（在「AI 渠道」里设置）。`) : null,
      data.bestTier === "uhd" ? null : h("p.a-callout.small", data.bestTier === "hd"
        ? "现在的渠道最多只能出 2K，用户看不到 4K，也不能超分到 4K。"
        : "现在没有能出 2K 或 4K 的渠道：用户只能选标准清晰度，不能超分，婚纱照按标准尺寸拍。需要 gpt-image-2 / 2.5（尺寸模式选「自定义尺寸」）或 Nano Banana Pro / 2 / 2.1 的渠道，而且中转要真的按尺寸出图（见「AI 渠道」里的尺寸检测）。"),
      table([
        { label: "画幅", render: (r) => (r.enabled ? h("strong.num", r.ratio) : h("span.faint", `${r.ratio}（未开放）`)) },
        ...v.tiers.map((t) => ({ label: t.enabled ? t.label : `${t.label}（未开放）`, render: (r) => {
          const cell = r.tiers[t.id];
          const usd = channel ? channel.usd[r.ratio][t.id][basis] : cell.usd[basis] * tokenScale;
          const beyond = channel && TIER_RANK[t.id] > TIER_RANK[channel.maxTier];
          const points = Math.ceil((Number(quality.credits) || 0) * (Number(t.multiplier) || 1));
          return h("div.size-cell",
            h("span.size-cell-size.num", cell.size.replace("x", " × "), cell.experimental ? statusPill("实验", "tape") : null),
            h("span.small.muted.num", beyond ? "这个渠道出不了" : `成本 ${money(usd * rate)}（$${usd.toFixed(3)}）`),
            h("span.small.muted.num", `收 ${points} 点${income(points)}`));
        } }))
      ], data.rows),
      h("small", channel
        ? `成本按「${channel.name}」的成本单价算${channel.pricing === "auto" ? "（按官方价）" : ""}，只算生成的这张图。Nano Banana 的实际尺寸和表里的略有不同，按同一档清晰度计价。`
        : "成本按 OpenAI 公布的 gpt-image-2 计费方式估算，只算生成的这张图，参考图的输入另计；gpt-image-2.5 的单价相同，同一画质用的 token 数会有出入。各渠道自己的成本单价在「AI 渠道」里设置，上面可以切换。",
        perPoint ? `点数折合人民币按现有充值套餐算，1 点 ≈ ${money(perPoint.min)}${perPoint.max !== perPoint.min ? `–${perPoint.max.toFixed(2)}` : ""}。` : "",
        "超过 2560 × 1440 像素（约 369 万像素）的尺寸 OpenAI 标为实验性，效果可能不稳定。"));
  }
  draw();
  return { node, draw };
}

export async function render() {
  const root = h("div");
  let value, sizes = null;
  try { value = (await api.get("/api/admin/settings/generation")).value; }
  catch (err) { toastError(err); return root; }
  try { sizes = await api.get("/api/admin/generation/sizes"); } catch { /* the overview is optional */ }

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
      { key: `tiers.${i}.enabled`, label: `开放 ${t.id}`, type: "switch", help: TIER_HELP[t.id] }
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
    { key: "allowPersonPhoto", label: "允许上传人物照片", type: "switch", help: "真人照片不能搭配敏感级服装、场景和物品，也不能用双人姿势，作品不能公开。" },
    { heading: "作品超分（2K / 4K）" },
    { key: "upscale.enabled", label: "开放作品超分", type: "switch", help: "用户在作品大图里把一张图按原构图重绘到 2K 或 4K，结果是一个新作品，原图保留。只用能出 2K / 4K 的渠道（gpt-image-2 / 2.5、Nano Banana Pro / 2 / 2.1）。" },
    { key: "upscale.hdCredits", label: "超分到 2K 点数/张", type: "number", min: 0 },
    { key: "upscale.uhdCredits", label: "超分到 4K 点数/张", type: "number", min: 0, help: "默认和创作台同尺寸、标准画质的价格一样。4K 是实验性尺寸，模型费用约为 2K 的 1.8 倍。" },
    { key: "upscale.quality", label: "超分画质", type: "select", options: value.qualities.map((q) => [q.id, q.label]), help: "建议用标准。精细画质的细节更多，模型费用约为标准的 4 倍。" },
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
    { key: "tokenPriceUsd.textInput", label: "文本输入 $/百万 token", type: "number", min: 0, step: 0.01,
      help: "gpt-image-2 / 2.5 的官方单价。渠道的计价方式是“按官方价”时用这里；每个渠道自己的成本单价在「AI 渠道」里设置。" },
    { key: "tokenPriceUsd.imageInput", label: "图片输入 $/百万 token", type: "number", min: 0, step: 0.01 },
    { key: "tokenPriceUsd.imageOutput", label: "图片输出 $/百万 token", type: "number", min: 0, step: 0.01 },
    { key: "fallbackCostUsd.low", label: "gpt-image-1.x 无用量时 low 每张 $", type: "number", min: 0, step: 0.001, help: "渠道不返回用量时：gpt-image-2 和 2.5 按尺寸和画质计算输出 token；gpt-image-1.5 等旧模型用这里 1024 × 1024 的单价按面积估算。" },
    { key: "fallbackCostUsd.medium", label: "gpt-image-1.x 无用量时 medium 每张 $", type: "number", min: 0, step: 0.001 },
    { key: "fallbackCostUsd.high", label: "gpt-image-1.x 无用量时 high 每张 $", type: "number", min: 0, step: 0.001 },
    { key: "usdToCny", label: "美元兑人民币汇率", type: "number", min: 0.01, step: 0.01 }
  ], value);
  // The overview goes right under the tier fields and follows the form's edits.
  if (sizes) {
    const overview = sizeOverview({ ...sizes, imageOutputUsd: value.tokenPriceUsd.imageOutput }, () => main.value);
    const next = [...main.node.querySelectorAll(".a-form-heading")].find((el) => el.textContent === "画幅与默认值");
    main.node.insertBefore(overview.node, next || null);
    main.node.addEventListener("input", overview.draw);
    main.node.addEventListener("change", overview.draw);
  }
  const styles = presetEditor("风格预设", value.styles, "ID 用英文小写；描述用英文写给模型看，例如 photorealistic fashion photography。");
  const scenes = presetEditor("场景预设", value.scenes, "例如 seamless light grey studio backdrop。");
  const cameras = presetEditor("镜头预设", value.cameras || [], "写清器材和它带来的效果，例如 85mm f/1.4 portrait lens, shallow depth of field。真实的器材描述能让成片更像照片。");

  const save = h("button.btn.btn-primary", { type: "button", onclick: (e) => busy(e.currentTarget, async () => {
    try {
      await api.put("/api/admin/settings/generation", { value: { ...main.value, styles: styles.value, scenes: scenes.value, cameras: cameras.value } });
      toast("已保存，新设置对之后提交的任务生效", { type: "success" });
    } catch (err) { toastError(err); }
  }) }, "保存设置");

  replace(root,
    pageHead("生成与计费", "定价、画质、尺寸和模型请求参数。改动对之后提交的任务生效。", save),
    section(null, null, main.node),
    section("风格、场景与镜头", "显示在创作台的可选项，选中后会把描述拼进提示词。", h("div.a-form", styles.node, scenes.node, cameras.node)),
    h("div.a-form-actions.sticky-actions", save.cloneNode(true)));
  root.querySelector(".sticky-actions button").onclick = () => save.click();
  return root;
}

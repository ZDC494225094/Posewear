import { h, replace } from "../../core/dom.js";
import { api } from "../../core/api.js";
import { toast, toastError, busy, confirmDialog, modal } from "../../core/ui.js";
import { dateTime, number } from "../../core/format.js";
import { pageHead, section, form, drawer, statusPill } from "../kit.js";

const KIND_TEXT = { openai: "OpenAI 兼容", gemini: "Google Gemini", mock: "模拟" };
const SIZE_MODES = [["flexible", "自定义尺寸（gpt-image-2 / 2.5）"], ["fixed", "固定三档（gpt-image-1.5 及更早）"], ["auto", "交给模型决定（auto）"]];
const TIER_TEXT = { standard: "标准", hd: "2K", uhd: "4K" };
const TIER_RANK = { standard: 0, hd: 1, uhd: 2 };
const TIERS = ["standard", "hd", "uhd"];
const MAX_TIERS = [["uhd", "4K"], ["hd", "2K"], ["standard", "标准（1K 级）"]];
const FIDELITY = [["omit", "不发送（gpt-image-2 必须选这个）"], ["high", "high"], ["low", "low"]];
const GEMINI_AUTH = [["goog", "x-goog-api-key（官方）"], ["bearer", "Authorization: Bearer（部分中转站）"]];
const NEW_CHANNEL = {
  openai: { name: "OpenAI 官方", baseUrl: "https://api.openai.com/v1" },
  gemini: { name: "Google 官方", baseUrl: "" },
  mock: { name: "模拟渠道", baseUrl: "" }
};
// A server from before 1.8.0 (public/ is served from the checkout before a
// restart) sends channels without models; read them as the defaults.
const DEFAULT_QUALITIES = [{ id: "low", label: "草稿" }, { id: "medium", label: "标准" }, { id: "high", label: "精细" }];

// The server's rule (server/services/models.js): the exact ID, else the first
// profile with one of its patterns in the ID.
function profileFor(profiles, model) {
  const id = String(model || "").toLowerCase();
  if (!id) return null;
  return profiles.find((p) => p.id === id) || profiles.find((p) => (p.match || []).some((m) => id.includes(m))) || null;
}

const num = (v) => `${+Number(v || 0).toFixed(4)}`;
const capOf = (kind, options) => (kind === "openai" && options.sizeMode !== "flexible" ? "standard" : options.maxTier || "uhd");
const usableModel = (c, m) => c.enabled && m.enabled && (c.kind === "mock" || c.apiKey.set);

// The official price "按官方价" uses: gpt-image-2 and 2.5 (and unknown models)
// at the token prices set in 生成与计费, the others from the built-in table.
function officialText(ctx, profile) {
  const token = (p) => `每百万 token：文本输入 $${num(p.textInput)}、图片输入 $${num(p.imageInput)}、图片输出 $${num(p.imageOutput)}${p.textOutput ? `、文本输出 $${num(p.textOutput)}` : ""}`;
  if (!profile || /^gpt-image-2/.test(profile.id)) return `${token(ctx.tokenPriceUsd)}（「生成与计费」里的设置${profile ? "" : "，按 gpt-image-2 估算"}）`;
  if (!profile.price) return "未知";
  if (profile.price.unit === "token") return token(profile.price);
  return `每张：${TIERS.filter((t) => TIER_RANK[t] <= TIER_RANK[profile.maxTier]).map((t) => `${TIER_TEXT[t]} $${num(profile.price[t])}`).join("、")}`;
}

function pricingText(ctx, kind, model) {
  const p = { mode: "auto", currency: "usd", ...(model.options.pricing || {}) };
  if (p.mode === "auto") return `按官方价，${officialText(ctx, profileFor(ctx.models, model.model))}`;
  const sign = p.currency === "cny" ? "¥" : "$";
  if (p.mode === "image") {
    return `按张：${TIERS.filter((t) => TIER_RANK[t] <= TIER_RANK[capOf(kind, model.options)]).map((t) => `${TIER_TEXT[t]} ${sign}${num(p[t])}`).join("、")}`;
  }
  return `按 token（每百万）：输入 ${sign}${num(p.textInput)} / ${sign}${num(p.imageInput)}，图片输出 ${sign}${num(p.imageOutput)}`;
}

function recognition(ctx, kind, profile) {
  if (!profile) return "没认出这个模型 ID：清晰度和画质按下面的设置，成本按 gpt-image-2 的官方价估算。用“检测尺寸”看它实际出多大的图。";
  const labels = ctx.qualities.map((q) => q.label).join("、");
  const tier = profile.sizeMode === "fixed" ? "只有三种固定尺寸，只出标准清晰度" : `最高出 ${TIER_TEXT[profile.maxTier]}`;
  const quality = profile.quality === false ? `没有画质参数，${labels}出图一样，成本也一样` : `画质分${labels}三档`;
  const where = profile.kind === kind ? ""
    : profile.kind === "gemini" ? "这是 Google 的模型，通常用「Google Gemini」类型的渠道接；中转站用 OpenAI 格式转发时也能用，但尺寸不一定准。"
      : "这是 OpenAI 的模型，要用「OpenAI 兼容」类型的渠道接。";
  return `识别为 ${profile.label}：${tier}；${quality}；官方价${officialText(ctx, profile)}。${profile.note ? `${profile.note}。` : ""}${where}`;
}

function segment(name, options, current, onPick) {
  return h("div.seg", { role: "radiogroup", "aria-label": name }, options.map(([v, text]) =>
    h("button", { type: "button", role: "radio", "aria-checked": String(v === current), "aria-pressed": String(v === current), onclick: () => onPick(v) }, text)));
}

// What a size check found for each tier: ✓ checked, ✗ came back smaller, ? not checked yet.
function sizeCells(kind, m) {
  const cap = m.capTier || capOf(kind, m.options);
  return h("span.size-marks", TIERS.map((tier) => {
    if (tier === "standard") return h("span.size-mark.ok", { title: "所有模型都出标准尺寸" }, "标准 ✓");
    if (TIER_RANK[tier] > TIER_RANK[cap]) return h("span.size-mark.off", { title: "最高清晰度没有设到这一档" }, `${TIER_TEXT[tier]} —`);
    const check = m.sizes?.[tier];
    const limited = m.sizeLimit && TIER_RANK[tier] > TIER_RANK[m.sizeLimit.maxTier];
    if (check && !check.ok || limited) {
      const seen = check && !check.ok ? check : m.sizeLimit;
      return h("span.size-mark.bad", { title: seen?.requested ? `要 ${seen.requested.replace("x", "×")}，只返回了 ${seen.delivered.replace("x", "×")}` : "出不了" }, `${TIER_TEXT[tier]} ✗`);
    }
    if (check?.ok) return h("span.size-mark.ok", { title: check.inferred ? "4K 已通过，2K 不用再测" : `要 ${check.requested.replace("x", "×")}，返回了 ${check.delivered.replace("x", "×")}` }, `${TIER_TEXT[tier]} ✓`);
    return h("span.size-mark.unknown", { title: "还没检测；按模型设置认为能出" }, `${TIER_TEXT[tier]} ?`);
  }));
}

// ---------- drawers

function connectionFields(kind) {
  if (kind === "mock") {
    return [
      { key: "name", label: "名称" },
      { key: "priority", label: "优先级", type: "number", help: "数字越大越先使用。" },
      { key: "options.mockDelayMs", label: "模拟耗时（毫秒）", type: "number", min: 0, max: 60000 },
      { key: "enabled", label: "启用", type: "switch", help: "模拟渠道返回占位图，不调用真实模型，适合演示和测试。正式运营前请关闭。" }
    ];
  }
  const gemini = kind === "gemini";
  return [
    { key: "name", label: "名称", placeholder: gemini ? "例如：Google 官方 / 某中转站" : "例如：OpenAI 官方 / 某中转站" },
    gemini
      ? { key: "baseUrl", label: "Base URL", placeholder: "https://generativelanguage.googleapis.com/v1beta",
        help: "官方接口留空。中转站填它的 Gemini 原生格式地址（/models/…:generateContent 前面的部分）；没写 /v1beta 时会自动补上。" }
      : { key: "baseUrl", label: "Base URL", placeholder: "https://api.openai.com/v1",
        help: "官方接口填 https://api.openai.com/v1；中转站填其提供的 OpenAI 兼容地址。没写 /v1 时会自动补上。" },
    { key: "apiKey", label: "API Key", type: "secret", placeholder: gemini ? "AIza..." : "sk-..." },
    ...(gemini ? [{ key: "options.geminiAuth", label: "API Key 的传法", type: "select", options: GEMINI_AUTH,
      help: "官方接口和多数中转站用 x-goog-api-key；中转站要求 Authorization 头时改这里。" }] : []),
    { key: "priority", label: "优先级", type: "number", help: "清晰度没有指定模型时，按优先级从高到低使用各渠道的模型。" },
    { key: "options.maxConcurrency", label: "最大并发", type: "number", min: 0, max: 100, help: "这个渠道所有模型加起来同时进行的任务数，0 表示不限制。用来避开账号的速率限制。" },
    { key: "options.timeoutSec", label: "超时（秒）", type: "number", min: 0, max: 900, help: "0 表示使用「生成与计费」里的全局设置。" },
    { key: "options.connectTimeoutSec", label: "连接超时（秒）", type: "number", min: 1, max: 120, help: "等待 TCP/TLS 连接建立的时间，默认 30 秒。" },
    ...(gemini ? [] : [
      { key: "options.imageField", label: "参考图字段名", type: "select", options: [["image[]", "image[]（官方）"], ["image", "image（部分中转站）"]] },
      { key: "options.omitParams", label: "不发送的参数", type: "tags", rows: 2, placeholder: "moderation, safety_identifier",
        help: "中转站不支持某些参数时填在这里，可选：moderation、safety_identifier、output_format、output_compression、quality、n。" }]),
    { key: "enabled", label: "启用", type: "switch" }
  ];
}

// Step 1: how to reach the API. A new channel goes on to picking its models.
function editChannel(channel, ctx, reload) {
  const isNew = !channel.id;
  const kind = channel.kind || "openai";
  const value = isNew ? { kind, ...NEW_CHANNEL[kind], priority: 10, enabled: true, apiKey: "",
    options: { geminiAuth: "goog", maxConcurrency: 0, timeoutSec: 0, connectTimeoutSec: 30, imageField: "image[]", omitParams: [], mockDelayMs: 2000 } } : channel;
  const f = form(connectionFields(kind), value);
  const m = drawer(isNew ? `添加${KIND_TEXT[kind]}渠道` : `编辑渠道 · ${channel.name}`, h("div.stack",
    isNew && kind !== "mock" ? h("p.small.muted", "第一步填好接口地址和 API Key，保存后选这个渠道要用的模型，再逐个检测它们能出的尺寸。") : null,
    f.node,
    h("div.a-form-actions",
      h("button.btn", { type: "button", onclick: () => m.close() }, "取消"),
      h("button.btn.btn-primary", { type: "button", onclick: (e) => busy(e.currentTarget, async () => {
        try {
          const payload = { ...f.value, kind };
          const res = isNew ? await api.post("/api/admin/channels", payload) : await api.put(`/api/admin/channels/${channel.id}`, payload);
          toast("已保存", { type: "success" });
          m.close();
          await reload();
          if (isNew && kind !== "mock") addModels(res.channel, ctx, reload);
        } catch (err) { toastError(err); }
      }) }, isNew && kind !== "mock" ? "保存，下一步选模型" : "保存"))));
}

// Step 2: pick models from the endpoint's list (or type an ID).
function addModels(channel, ctx, reload) {
  const have = new Set((channel.models || []).map((m) => m.model));
  const chosen = new Set();
  let fetched = null, showAll = false;
  const listBox = h("div.stack-sm");
  const manual = h("input.input", { placeholder: "也可以直接填模型 ID，例如 gpt-image-2", maxLength: 100, "aria-label": "模型 ID",
    onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); addManual(); } } });
  const count = h("span");
  const addManual = () => {
    const id = manual.value.trim();
    if (!id) return;
    if (!have.has(id)) chosen.add(id);
    manual.value = "";
    draw();
  };
  const toggle = (id) => { if (chosen.has(id)) chosen.delete(id); else chosen.add(id); draw(); };
  function chip(id, label) {
    const added = have.has(id);
    return h("button.chip", { type: "button", disabled: added, "aria-pressed": String(added || chosen.has(id)), title: added ? "已经添加" : id,
      onclick: () => toggle(id) }, id, label && label !== id ? h("span.chip-note", ` ${label}`) : null);
  }
  function draw() {
    const common = ctx.models.filter((p) => p.kind === channel.kind && !p.hidden);
    const extra = [...chosen].filter((id) => !fetched?.models?.some((m) => m.id === id) && !common.some((p) => p.id === id));
    const images = fetched?.ok ? fetched.models.filter((m) => m.image) : [];
    const shown = fetched?.ok ? (showAll || !images.length ? fetched.models : images) : [];
    replace(listBox,
      !fetched ? h("p.small.muted", "正在读取接口的模型列表…")
        : !fetched.ok ? h("p.small.text-pin", fetched.message)
          : h("div.stack-sm",
            h("div.chips", shown.map((m) => chip(m.id, ctx.models.find((p) => p.id === m.profile)?.label))),
            h("small", fetched.message, shown.length < fetched.models.length ? `，这里列出其中 ${shown.length} 个图像模型。` : "。", " ",
              images.length && images.length < fetched.models.length
                ? h("button.btn.btn-sm.btn-ghost", { type: "button", onclick: () => { showAll = !showAll; draw(); } }, showAll ? "只看图像模型" : "显示全部") : null)),
      fetched && !fetched.ok || !fetched?.models?.length ? h("div.chips.a-quick", h("span.small.muted", "常用："), common.map((p) => chip(p.id, p.label))) : null,
      extra.length ? h("div.chips.a-quick", h("span.small.muted", "手动添加："), extra.map((id) => chip(id, ""))) : null);
    count.textContent = chosen.size ? `添加 ${chosen.size} 个模型` : "添加模型";
  }
  const m = drawer(`给「${channel.name}」添加模型`, h("div.stack",
    h("p.small.muted", "从接口返回的模型里选（可以多选），认识的模型会自动填好它能出的清晰度和尺寸设置。读取列表不产生费用。"),
    listBox,
    h("div.secret-row", manual, h("button.btn.btn-sm", { type: "button", onclick: addManual }, "加入")),
    h("div.a-form-actions",
      h("button.btn", { type: "button", onclick: () => m.close() }, "关闭"),
      h("button.btn.btn-primary", { type: "button", onclick: (e) => busy(e.currentTarget, async () => {
        if (!chosen.size) { toast("先选择要添加的模型", { type: "error" }); return; }
        try {
          const res = await api.post(`/api/admin/channels/${channel.id}/models`, { models: [...chosen] });
          toast(`已添加 ${res.added.length} 个模型。点“检测尺寸”看它们实际能出多大的图`, { type: "success" });
          m.close();
          await reload();
        } catch (err) { toastError(err); }
      }) }, count))));
  draw();
  api.post("/api/admin/channels/models", { id: channel.id, kind: channel.kind })
    .then((r) => { fetched = r; draw(); })
    .catch((err) => { fetched = { ok: false, message: err.message || "获取模型列表失败" }; draw(); });
}

// A model's settings: 清晰度, how it takes sizes, 画质, cost.
function editModel(channel, model, ctx, reload) {
  const kind = channel.kind;
  const profile = profileFor(ctx.models, model.model);
  const fields = [
    { key: "options.maxTier", label: "最高清晰度", type: "select", options: MAX_TIERS,
      help: kind === "gemini" ? "Nano Banana Pro、2、2.1 能出 4K；2 Lite 和旧版只出 1K，选「标准」。"
        : "gpt-image-2 / 2.5 能出 4K（官方标为实验性，不想用可以设成 2K）；尺寸模式不是「自定义尺寸」时只出标准。" },
    { key: "options.qualities", label: "接的画质", type: "checks", options: ctx.qualities.map((q) => [q.id, q.label]),
      help: "创作台只把这些画质的作品发给这个模型，比如让贵的模型只接「精细」。婚纱照、超分和素材生成在没有别的模型时也会用它。" },
    ...(kind === "openai" ? [
      { key: "options.sizeMode", label: "尺寸模式", type: "select", options: SIZE_MODES,
        help: "改了尺寸模式，之前的尺寸检测结果会清除。" },
      { key: "options.inputFidelity", label: "input_fidelity 参数", type: "select", options: FIDELITY }] : []),
    { key: "enabled", label: "启用这个模型", type: "switch" },
    { heading: "成本单价" }
  ];
  const value = { ...model, options: { ...model.options, pricing: { mode: "auto", currency: "usd", ...(model.options.pricing || {}) } } };
  const f = form(fields, value);
  const pricing = f.value.options.pricing;
  const priceBox = h("div.a-contents");
  function drawPricing() {
    const sign = pricing.currency === "cny" ? "¥" : "$";
    const field = (key, label, unit) => h("div.a-field", h("label", label), h("div.with-suffix",
      h("input.input", { type: "number", min: 0, step: "any", value: pricing[key] ?? 0, "aria-label": label,
        oninput: (e) => { pricing[key] = e.target.value === "" ? 0 : Number(e.target.value); } }),
      h("span.suffix", unit)));
    // A first switch to a custom price starts from the official one.
    const choose = (mode) => {
      pricing.mode = mode;
      const official = !profile || /^gpt-image-2/.test(profile.id) ? { unit: "token", ...ctx.tokenPriceUsd } : profile.price;
      const keys = mode === "token" ? ["textInput", "imageInput", "imageOutput", "textOutput"] : TIERS;
      if (mode !== "auto" && official?.unit === mode && keys.every((k) => !Number(pricing[k]))) {
        for (const k of keys) pricing[k] = official[k] || 0;
        pricing.currency = "usd";
      }
      drawPricing();
    };
    replace(priceBox,
      h("div.a-field.is-wide", h("label", "计价方式"),
        segment("计价方式", [["auto", "按官方价"], ["token", "按 token 单价"], ["image", "按张单价"]], pricing.mode, choose),
        h("small", pricing.mode === "token" ? "填你付给这个渠道的价格。渠道返回用量时按用量算，没返回时按尺寸和画质估算输出。"
          : pricing.mode === "image" ? "填你付给这个渠道的价格，按返回图片的清晰度算，适合按次收费的中转站。"
            : `官方价${officialText(ctx, profile)}。中转站按次收费或打折时，改成按张或按 token 填实际价格。数据概览的毛利按这里算。`)),
      pricing.mode !== "auto" ? h("div.a-field", h("label", "币种"), segment("币种", [["usd", "美元"], ["cny", "人民币"]], pricing.currency,
        (currency) => { pricing.currency = currency; drawPricing(); }),
      h("small", `人民币按「生成与计费」里的汇率（1 美元 = ${ctx.usdToCny} 元）换算。`)) : null,
      ...(pricing.mode === "token" ? [field("textInput", "文本输入", `${sign}/百万 token`), field("imageInput", "图片输入", `${sign}/百万 token`),
        field("imageOutput", "图片输出", `${sign}/百万 token`), field("textOutput", "文本输出", `${sign}/百万 token`)] : []),
      ...(pricing.mode === "image" ? TIERS.map((t) => field(t, `${TIER_TEXT[t]}每张`, `${sign}/张`)) : []));
  }
  drawPricing();
  f.node.append(priceBox);
  const m = drawer(`模型设置 · ${model.model}`, h("div.stack",
    h("p.small.muted", `${channel.name}（${KIND_TEXT[kind]}）。${recognition(ctx, kind, profile)}`),
    profile ? h("div", h("button.btn.btn-sm", { type: "button", onclick: () => {
      const o = f.value.options;
      o.maxTier = profile.maxTier;
      if (kind === "openai" && profile.kind === "openai") Object.assign(o, { sizeMode: profile.sizeMode, inputFidelity: profile.inputFidelity });
      m.close();
      editModel(channel, { ...model, ...f.value, options: { ...o } }, ctx, reload);
    } }, "按识别结果重新填写")) : null,
    f.node,
    h("div.a-form-actions",
      h("button.btn", { type: "button", onclick: () => m.close() }, "取消"),
      h("button.btn.btn-primary", { type: "button", onclick: (e) => busy(e.currentTarget, async () => {
        try {
          await api.put(`/api/admin/channel-models/${model.id}`, { enabled: f.value.enabled, options: f.value.options });
          toast("已保存", { type: "success" });
          m.close();
          await reload();
        } catch (err) { toastError(err); }
      }) }, "保存"))));
}

// ---------- page

export async function render() {
  const routesBox = h("div");
  const list = h("div");
  const stale = h("p.a-callout.small", { hidden: true },
    "服务器还在运行 1.8.0 之前的版本：重启服务器后，渠道才能挂多个模型、按清晰度分配模型。");
  let ctx = { models: [], qualities: DEFAULT_QUALITIES, usdToCny: 7.2, tokenPriceUsd: { textInput: 5, imageInput: 8, imageOutput: 30 } };
  let data = { items: [], routes: { standard: [], hd: [], uhd: [] } };

  async function load() {
    try {
      const res = await api.get("/api/admin/channels");
      stale.hidden = !!res.routes;
      ctx = { models: res.qualities ? res.models : [], qualities: res.qualities || DEFAULT_QUALITIES, usdToCny: res.usdToCny || ctx.usdToCny,
        tokenPriceUsd: res.tokenPriceUsd || ctx.tokenPriceUsd };
      data = { items: res.items.map((c) => ({ ...c, models: c.models || [] })), routes: res.routes || { standard: [], hd: [], uhd: [] } };
      replace(routesBox, routesSection());
      replace(list, data.items.length ? channelTable() : h("div.a-empty", "还没有渠道。添加一个 OpenAI 或 Gemini 渠道，填入 API Key 并添加模型，用户就可以开始生成。"));
    } catch (err) { toastError(err); }
  }

  const allModels = () => data.items.flatMap((c) => c.models.map((m) => ({ ...m, channel: c })));
  const modelName = (m) => `${m.channel.name} · ${m.model}`;
  const draws = (m, tier) => TIER_RANK[tier] <= TIER_RANK[m.maxTier || "standard"];

  // 清晰度分配: per tier, the models to try in order (the server's routeOrder).
  function routesSection() {
    const models = allModels();
    const byId = new Map(models.map((m) => [m.id, m]));
    const save = async (next) => {
      try {
        const res = await api.put("/api/admin/channel-routes", next);
        data.routes = res.routes;
        replace(routesBox, routesSection());
      } catch (err) { toastError(err); }
    };
    const firstFor = (tier) => {
      const fits = models.filter((m) => usableModel(m.channel, m) && draws(m, tier));
      const routed = (data.routes[tier] || []).map((id) => fits.find((m) => m.id === id)).filter(Boolean);
      return { first: (routed.length ? routed : fits)[0], auto: !routed.length };
    };
    const rows = TIERS.map((tier) => {
      const ids = data.routes[tier] || [];
      const move = (i, d) => { const next = [...ids]; [next[i], next[i + d]] = [next[i + d], next[i]]; save({ ...data.routes, [tier]: next }); };
      const drop = (id) => save({ ...data.routes, [tier]: ids.filter((x) => x !== id) });
      const choices = models.filter((m) => !ids.includes(m.id) && m.channel.kind !== "mock");
      const { first, auto } = firstFor(tier);
      return h("tr",
        h("td", h("strong", TIER_TEXT[tier])),
        h("td", ids.length ? h("div.route-chips", ids.map((id, i) => {
          const m = byId.get(id);
          if (!m) return null;
          const problem = !usableModel(m.channel, m) ? "已停用" : !draws(m, tier) ? "出不了这个尺寸" : "";
          return h("span.route-chip", { class: problem ? "is-off" : "" },
            h("span.num", `${i + 1}`), modelName(m), problem ? h("span.text-pin", `（${problem}，不会用它）`) : null,
            i > 0 ? h("button.btn.btn-sm.btn-ghost", { type: "button", title: "提前", "aria-label": "提前", onclick: () => move(i, -1) }, "↑") : null,
            h("button.btn.btn-sm.btn-ghost", { type: "button", title: "移除", "aria-label": "移除", onclick: () => drop(id) }, "✕"));
        })) : h("span.muted", "自动：按渠道优先级，用所有能出这个尺寸的模型")),
        h("td", choices.length ? h("select.input.route-add", { "aria-label": `给${TIER_TEXT[tier]}添加模型`, onchange: (e) => {
          const id = Number(e.target.value);
          if (id) save({ ...data.routes, [tier]: [...ids, id] });
        } }, h("option", { value: "" }, "添加模型…"), choices.map((m) => h("option", { value: m.id, disabled: !draws(m, tier) },
          `${modelName(m)}${draws(m, tier) ? "" : "（出不了这个尺寸）"}`))) : null),
        h("td.small", first ? [h("span.muted", auto && ids.length ? "指定的都不能用，现在用 " : "现在先用 "), modelName(first)]
          : h("span.text-pin", tier === "standard" ? "没有可用的模型" : "没有能出这个尺寸的模型，用户看不到这一档")));
    });
    return section("清晰度分配", "给每档清晰度指定用哪些模型，按顺序使用，前一个失败或满载时换下一个。没指定时按渠道优先级用所有能出这个尺寸的模型；指定的模型都不能用时（停用、没有 Key、不接作品的画质）也会这样。",
      h("div.table-wrap", h("table.data-table.a-table.route-table",
        h("thead", h("tr", h("th", { style: { width: "64px" } }, "清晰度"), h("th", "使用的模型（按顺序）"), h("th", { style: { width: "240px" } }, ""), h("th", { style: { width: "240px" } }, "状态"))),
        h("tbody", rows))));
  }

  async function testModel(e, m, mode) {
    return busy(e.currentTarget, async () => {
      try {
        const r = await api.post(`/api/admin/channel-models/${m.id}/test`, { mode });
        if (mode === "generate" && r.ok) {
          modal({ title: `试生成 · ${m.model}`, content: h("div.stack", h("p", r.message),
            r.image ? h("img", { src: r.image, alt: "测试生成的图片", width: 240 }) : null,
            r.usage ? h("p.small.muted", `tokens：输入 ${r.usage.input_tokens ?? "—"} / 输出 ${r.usage.output_tokens ?? "—"}`) : null) });
        } else toast(r.message, { type: r.ok ? "success" : "error" });
        await load();
      } catch (err) { toastError(err); }
    });
  }

  function modelRows(c) {
    if (c.kind === "mock") return h("p.small.muted", "返回占位图，不调用模型。");
    if (!c.models.length) return h("p.small", h("span.text-pin", "还没有模型，这个渠道不会接任务。"), " ",
      h("button.btn.btn-sm", { type: "button", onclick: () => addModels(c, ctx, load) }, "添加模型"));
    const qualityText = (m) => {
      const names = ctx.qualities.filter((q) => (m.options.qualities || []).includes(q.id)).map((q) => q.label);
      return names.length === ctx.qualities.length ? "全部画质" : names.join("、");
    };
    return h("table.model-table",
      h("tbody", c.models.map((m) => h("tr", { class: m.enabled ? "" : "is-off" },
        h("td.model-name", h("strong.num", m.model), m.enabled ? null : statusPill("已停用"),
          m.profile && m.profile.label !== m.model ? h("div.small.muted", m.profile.label) : null),
        h("td.model-sizes", sizeCells(c.kind, m)),
        h("td.model-info.small", h("div", "画质：", qualityText(m)), h("div.muted", "成本：", pricingText(ctx, c.kind, m))),
        h("td.model-stats.small.faint", `成功 ${number(m.successCount)} · 失败 ${number(m.failureCount)}`,
          m.lastError && m.lastErrorAt > (m.lastOkAt || 0) ? h("div.channel-error", { title: m.lastError }, `最近出错：${m.lastError.slice(0, 40)}`) : null),
        h("td.model-actions",
          capOf(c.kind, m.options) !== "standard" ? h("button.btn.btn-sm", { type: "button",
            title: "按最高清晰度生成一张低画质测试图（4K 没通过时再测 2K），看实际返回多大的图，结果会记到模型上。会产生一到两次生成的费用", onclick: (e) => testModel(e, m, "size") }, "检测尺寸") : null,
          h("button.btn.btn-sm", { type: "button", title: "生成一张标准尺寸的低画质测试图，会产生少量费用", onclick: (e) => testModel(e, m, "generate") }, "试生成"),
          h("button.btn.btn-sm", { type: "button", onclick: () => editModel(c, m, ctx, load) }, "设置"),
          h("button.btn.btn-sm.btn-ghost.btn-danger", { type: "button", onclick: async () => {
            if (!(await confirmDialog({ title: `移除模型 ${m.model}？`, message: "清晰度分配里也会去掉它。历史生成记录不受影响。", confirmText: "移除", danger: true }))) return;
            try { await api.del(`/api/admin/channel-models/${m.id}`); load(); } catch (err) { toastError(err); }
          } }, "移除"))))));
  }

  function channelTable() {
    return h("div.table-wrap", h("table.data-table.a-table.channel-table",
      h("thead", h("tr", h("th", "渠道"), h("th", "接口与 Key"), h("th", "调用"), h("th", { style: { width: "320px" } }, ""))),
      ...data.items.map((c) => h("tbody", { class: c.enabled ? "" : "is-off" },
        h("tr.channel-row",
          h("td", h("div.channel-title", h("strong", c.name), c.enabled ? statusPill("已启用", "mat") : statusPill("已停用"),
            c.kind === "mock" ? statusPill("模拟", "tape") : statusPill(KIND_TEXT[c.kind])),
          h("span.small.faint", `优先级 ${c.priority}`)),
          h("td.small", c.kind === "mock" ? h("span.muted", "—") : [h("span.num", c.resolvedBaseUrl), h("br"),
            "Key：", c.apiKey.set ? h("code", c.apiKey.hint) : h("strong.text-pin", "未设置")]),
          h("td.small.faint", `成功 ${number(c.successCount)} · 失败 ${number(c.failureCount)}`, c.lastOkAt ? h("br") : null,
            c.lastOkAt ? `最近成功 ${dateTime(c.lastOkAt)}` : null,
            c.lastError ? h("div.channel-error", { class: c.lastOkAt > c.lastErrorAt ? "is-recovered" : "", title: c.lastError },
              `${c.lastOkAt > c.lastErrorAt ? "上次错误（已恢复）" : "最近错误"}：${c.lastError.slice(0, 80)}`) : null),
          h("td.channel-actions",
            h("button.btn.btn-sm", { type: "button", onclick: (e) => busy(e.currentTarget, async () => {
              try {
                const r = await api.post(`/api/admin/channels/${c.id}/test`, { mode: "ping" });
                toast(`${r.message}${r.ms ? `（${r.ms} ms）` : ""}`, { type: r.ok ? "success" : "error" });
              } catch (err) { toastError(err); }
            }) }, "测试连接"),
            c.kind !== "mock" ? h("button.btn.btn-sm", { type: "button", onclick: () => addModels(c, ctx, load) }, "添加模型") : null,
            h("button.btn.btn-sm.btn-primary", { type: "button", onclick: () => editChannel(c, ctx, load) }, "编辑"),
            h("button.btn.btn-sm.btn-ghost", { type: "button", onclick: async () => {
              try { await api.put(`/api/admin/channels/${c.id}`, { enabled: !c.enabled }); load(); } catch (err) { toastError(err); }
            } }, c.enabled ? "停用" : "启用"),
            h("button.btn.btn-sm.btn-ghost.btn-danger", { type: "button", onclick: async () => {
              if (!(await confirmDialog({ title: `删除渠道「${c.name}」？`, message: "它的模型会一起删除，清晰度分配里也会去掉。历史生成记录不受影响。", confirmText: "删除", danger: true }))) return;
              try { await api.del(`/api/admin/channels/${c.id}`); load(); } catch (err) { toastError(err); }
            } }, "删除"))),
        h("tr.channel-models", h("td", { colSpan: 4 }, modelRows(c)))))));
  }

  load();
  return h("div",
    pageHead("AI 渠道", "渠道是接口地址加 API Key，一个渠道可以挂多个模型。先添加渠道和模型，检测每个模型能出的尺寸，再在「清晰度分配」里指定每档清晰度用哪些模型。",
      [h("button.btn", { type: "button", onclick: () => editChannel({ kind: "mock" }, ctx, load) }, "添加模拟渠道"),
        h("button.btn", { type: "button", onclick: () => editChannel({ kind: "gemini" }, ctx, load) }, "添加 Gemini 渠道"),
        h("button.btn.btn-primary", { type: "button", onclick: () => editChannel({ kind: "openai" }, ctx, load) }, "添加 OpenAI 渠道")]),
    stale,
    routesBox,
    section("渠道与模型", "尺寸一栏：✓ 检测通过，✗ 返回的图比要求的小，? 还没检测（按模型设置认为能出），— 最高清晰度没设到这一档。", list),
    section("接入说明", null, h("ul.a-notes.small",
      h("li", "添加渠道时先填接口地址和 API Key，保存后从接口返回的模型列表里选要用的模型，可以多选。认识的模型会自动填好清晰度和尺寸设置；获取列表不产生费用。"),
      h("li", "“检测尺寸”按模型的最高清晰度生成一张低画质图（4K 没通过时再测一张 2K），看实际返回多大的图。不少中转站会忽略尺寸、只返回 1024 级别的图，这样的模型只接标准清晰度。真实任务返回的图偏小时也会自动标记。"),
      h("li", "OpenAI：gpt-image-2，或 gpt-image-2.5-sunburst（画质更好）、gpt-image-2.5-flare（更快）。三者都支持自定义尺寸，超过 2560×1440 的尺寸官方标为实验性；参考图始终按高保真处理，input_fidelity 选“不发送”。"),
      h("li", "Google Gemini（Nano Banana）：Pro 画质最好，2 和 2.1 更快更便宜，三者能出 1K / 2K / 4K；2 Lite 和旧版只出 1K。官方接口 Base URL 留空，国内服务器通常要用支持 Gemini 原生格式的中转站。Nano Banana 没有画质参数，三档画质出图和成本都一样，可以用“接的画质”只让它接某几档。"),
      h("li", "成本单价按模型设置：按官方价时，gpt-image-2 / 2.5 用「生成与计费」里的 token 单价，其他模型用内置的官方价；中转站按次收费或打折时选“按张”或“按 token”填实际价格，可以填人民币。"),
      h("li", "API Key 用 APP_SECRET 加密后保存在数据库，后台只显示首尾几位。"))));
}

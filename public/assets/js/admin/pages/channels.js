import { h, replace } from "../../core/dom.js";
import { api } from "../../core/api.js";
import { toast, toastError, busy, confirmDialog } from "../../core/ui.js";
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
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-image-2" },
  gemini: { baseUrl: "", model: "gemini-3.1-flash-image" },
  mock: { name: "模拟渠道", baseUrl: "", model: "mock" }
};

// The server's rule (server/services/models.js): the exact ID, else the first
// profile with one of its patterns in the ID.
function profileFor(profiles, model) {
  const id = String(model || "").toLowerCase();
  if (!id) return null;
  return profiles.find((p) => p.id === id) || profiles.find((p) => (p.match || []).some((m) => id.includes(m))) || null;
}

const autoName = (kind, profile, model) => (kind === "gemini" ? `Google · ${profile?.label || model}` : `OpenAI · ${model}`);
const num = (v) => `${+Number(v || 0).toFixed(4)}`;
const capOf = (kind, options) => (kind === "openai" && options.sizeMode !== "flexible" ? "standard" : options.maxTier || "uhd");
// A server from before 1.7.0 (public/ is served from the checkout before a
// restart) sends channels without these; read them as the defaults.
const DEFAULT_QUALITIES = [{ id: "low", label: "草稿" }, { id: "medium", label: "标准" }, { id: "high", label: "精细" }];
const pricingOf = (c) => ({ mode: "auto", currency: "usd", ...(c.options.pricing || {}) });

// The official price "按官方价" uses: gpt-image-2 and 2.5 (and unknown models)
// at the token prices set in 生成与计费, the others from the built-in table.
function officialText(ctx, profile) {
  const token = (p) => `每百万 token：文本输入 $${num(p.textInput)}、图片输入 $${num(p.imageInput)}、图片输出 $${num(p.imageOutput)}${p.textOutput ? `、文本输出 $${num(p.textOutput)}` : ""}`;
  if (!profile || /^gpt-image-2/.test(profile.id)) return `${token(ctx.tokenPriceUsd)}（「生成与计费」里的设置${profile ? "" : "，按 gpt-image-2 估算"}）`;
  if (!profile.price) return "未知";
  if (profile.price.unit === "token") return token(profile.price);
  return `每张：${TIERS.filter((t) => TIER_RANK[t] <= TIER_RANK[profile.maxTier]).map((t) => `${TIER_TEXT[t]} $${num(profile.price[t])}`).join("、")}`;
}

function pricingText(ctx, c) {
  const p = pricingOf(c);
  if (p.mode === "auto") return `按官方价，${officialText(ctx, profileFor(ctx.models, c.model))}`;
  const sign = p.currency === "cny" ? "¥" : "$";
  if (p.mode === "image") {
    return `按张：${TIERS.filter((t) => TIER_RANK[t] <= TIER_RANK[capOf(c.kind, c.options)]).map((t) => `${TIER_TEXT[t]} ${sign}${num(p[t])}`).join("、")}`;
  }
  return `按 token（每百万）：文本输入 ${sign}${num(p.textInput)}、图片输入 ${sign}${num(p.imageInput)}、图片输出 ${sign}${num(p.imageOutput)}${p.textOutput ? `、文本输出 ${sign}${num(p.textOutput)}` : ""}`;
}

function recognition(ctx, kind, profile) {
  if (!profile) return "没认出这个模型 ID：清晰度和画质按下面的设置，成本按 gpt-image-2 的官方价估算。保存后可以用“检测 2K / 4K”看它实际出多大的图。";
  const labels = ctx.qualities.map((q) => q.label).join("、");
  const tier = profile.sizeMode === "fixed" ? "只有三种固定尺寸，只出标准清晰度" : `最高出 ${TIER_TEXT[profile.maxTier]}`;
  const quality = profile.quality === false ? `没有画质参数，${labels}出图一样，成本也一样` : `画质分${labels}三档`;
  const where = profile.kind === kind ? ""
    : profile.kind === "gemini" ? "这是 Google 的模型，通常用「Google Gemini」类型的渠道接；中转站用 OpenAI 格式转发时也能用，但尺寸不一定准。"
      : "这是 OpenAI 的模型，要用「OpenAI 兼容」类型的渠道接。";
  return `识别为 ${profile.label}：${tier}；${quality}；官方价${officialText(ctx, profile)}。${profile.note ? `${profile.note}。` : ""}${where}`;
}

// What the model says about a channel: its largest size and how it takes sizes.
// The 画质 a channel takes and its cost are the admin's choice and stay as they are.
function applyProfile(value, profile) {
  if (!profile) return value;
  const options = { ...value.options, ...(profile.maxTier ? { maxTier: profile.maxTier } : {}) };
  if (value.kind === "openai" && profile.kind === "openai") Object.assign(options, { sizeMode: profile.sizeMode, inputFidelity: profile.inputFidelity });
  return { ...value, options };
}

function channelFields(kind, ctx) {
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
    { heading: "清晰度与画质" },
    { key: "options.maxTier", label: "最高清晰度", type: "select", options: MAX_TIERS,
      help: gemini ? "Nano Banana Pro、2、2.1 能出 4K；2 Lite 和旧版 Nano Banana 只出 1K，选「标准」。2K、4K 作品、婚纱照和超分只发给能出这个尺寸的渠道。"
        : "2K、4K 作品、婚纱照和超分只发给能出这个尺寸的渠道。gpt-image-2 / 2.5 能出 4K（官方标为实验性，不想用可以设成 2K）；尺寸模式不是「自定义尺寸」时只出标准。" },
    { key: "options.qualities", label: "接的画质", type: "checks", options: ctx.qualities.map((q) => [q.id, q.label]),
      help: "创作台只把这些画质的作品发给这个渠道，比如让贵的模型只接「精细」。婚纱照、超分和素材生成在没有别的渠道时也会用它。" },
    ...(gemini ? [] : [
      { key: "options.sizeMode", label: "尺寸模式", type: "select", options: SIZE_MODES,
        help: "中转返回的图比要求的小时，会自动标记这个渠道；作品按实际清晰度收费并退回差价（婚纱照按套系计价，不退差价）。" },
      { key: "options.inputFidelity", label: "input_fidelity 参数", type: "select", options: FIDELITY }]),
    { heading: "成本单价" },
    { heading: "并发与超时" },
    { key: "priority", label: "优先级", type: "number", help: "数字越大越先使用。失败时自动切到下一个渠道。" },
    { key: "options.maxConcurrency", label: "最大并发", type: "number", min: 0, max: 100, help: "0 表示不限制。用来避开账号的速率限制（每分钟图片数）。" },
    { key: "options.timeoutSec", label: "超时（秒）", type: "number", min: 0, max: 900, help: "0 表示使用「生成与计费」里的全局设置。" },
    { key: "options.connectTimeoutSec", label: "连接超时（秒）", type: "number", min: 1, max: 120,
      help: "等待 TCP/TLS 连接建立的时间，默认 30 秒；与上面的完整请求超时分别设置，且不会超过完整请求时限。" },
    ...(gemini ? [] : [
      { key: "options.imageField", label: "参考图字段名", type: "select", options: [["image[]", "image[]（官方）"], ["image", "image（部分中转站）"]] },
      { key: "options.omitParams", label: "不发送的参数", type: "tags", rows: 2, placeholder: "moderation, safety_identifier",
        help: "中转站不支持某些参数时填在这里，可选：moderation、safety_identifier、output_format、output_compression、quality、n。" }]),
    { key: "enabled", label: "启用", type: "switch" }
  ];
}

function segment(name, options, current, onPick) {
  return h("div.seg", { role: "radiogroup", "aria-label": name }, options.map(([v, text]) =>
    h("button", { type: "button", role: "radio", "aria-checked": String(v === current), "aria-pressed": String(v === current), onclick: () => onPick(v) }, text)));
}

function editChannel(channel, ctx, onSaved) {
  const isNew = !channel.id;
  const kind = channel.kind || "openai";
  const start = NEW_CHANNEL[kind];
  let value = isNew ? applyProfile({
    kind, name: start.name || autoName(kind, profileFor(ctx.models, start.model), start.model), baseUrl: start.baseUrl, model: start.model,
    priority: 10, enabled: true, apiKey: "",
    options: { sizeMode: "flexible", inputFidelity: "omit", maxTier: "uhd", qualities: ctx.qualities.map((q) => q.id), geminiAuth: "goog",
      pricing: { mode: "auto", currency: "usd" }, maxConcurrency: 0, timeoutSec: 0, connectTimeoutSec: 30, imageField: "image[]", omitParams: [], mockDelayMs: 2000 }
  }, kind === "mock" ? null : profileFor(ctx.models, start.model)) : channel;
  let fetched = null;   // the last model list, kept across redraws
  let showAll = false;
  let f;
  const box = h("div");

  // Picking a model fills in what it can do; a channel still named after its
  // old model is renamed.
  function pick(id) {
    const before = profileFor(ctx.models, value.model);
    const profile = profileFor(ctx.models, id);
    const renamed = isNew && value.name === autoName(kind, before, value.model);
    value = applyProfile({ ...value, model: id }, profile);
    if (renamed) value.name = autoName(kind, profile, id);
    draw();
  }

  function modelBlock() {
    const status = h("small");
    const list = h("div.stack-sm");
    const describe = () => {
      const profile = profileFor(ctx.models, value.model);
      replace(status, recognition(ctx, kind, profile), " ",
        profile ? h("button.btn.btn-sm.btn-ghost", { type: "button", onclick: () => { value = applyProfile(value, profile); draw(); } }, "按这个模型设置") : null);
    };
    const input = h("input.input", { value: value.model || "", placeholder: start.model, maxLength: 100, "aria-label": "模型 ID",
      oninput: (e) => { value.model = e.target.value.trim(); describe(); } });
    const drawList = () => {
      if (!fetched) {
        const common = ctx.models.filter((p) => p.kind === kind && !p.hidden);
        return replace(list, h("div.chips.a-quick", h("span.small.muted", "常用："), common.map((p) =>
          h("button.chip", { type: "button", "aria-pressed": String(p.id === value.model), onclick: () => pick(p.id) }, p.label))));
      }
      if (!fetched.ok) return replace(list, h("p.small.text-pin", fetched.message));
      const images = fetched.models.filter((m) => m.image);
      const shown = showAll || !images.length ? fetched.models : images;
      replace(list,
        h("div.chips", shown.map((m) => {
          const profile = m.profile && ctx.models.find((p) => p.id === m.profile);
          return h("button.chip", { type: "button", "aria-pressed": String(m.id === value.model), title: m.name || m.id, onclick: () => pick(m.id) },
            m.id, profile && profile.label !== m.id ? h("span.chip-note", ` ${profile.label}`) : null);
        })),
        h("small", fetched.message, shown.length < fetched.models.length ? `，这里列出其中 ${shown.length} 个图像模型。` : "。", " ",
          images.length && images.length < fetched.models.length
            ? h("button.btn.btn-sm.btn-ghost", { type: "button", onclick: () => { showAll = !showAll; drawList(); } }, showAll ? "只看图像模型" : "显示全部") : null));
    };
    const load = (e) => busy(e.currentTarget, async () => {
      try {
        fetched = await api.post("/api/admin/channels/models", { id: channel.id || undefined, kind, baseUrl: value.baseUrl,
          apiKey: value.apiKey, model: value.model, options: value.options });
        showAll = false;
        drawList();
      } catch (err) { toastError(err); }
    });
    describe();
    drawList();
    return h("div.a-field.is-wide", h("label", "模型 ID"),
      h("div.secret-row", input, h("button.btn.btn-sm", { type: "button", title: "调用接口的模型列表，不产生费用", onclick: load }, "获取模型列表")),
      status, list);
  }

  function pricingBlock() {
    const node = h("div.a-contents");
    const drawPricing = () => {
      const pricing = value.options.pricing;
      const profile = profileFor(ctx.models, value.model);
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
        if (mode !== "auto" && official.unit === mode && keys.every((k) => !Number(pricing[k]))) {
          for (const k of keys) pricing[k] = official[k] || 0;
          pricing.currency = "usd";
        }
        drawPricing();
      };
      replace(node,
        h("div.a-field.is-wide", h("label", "计价方式"),
          segment("计价方式", [["auto", "按官方价"], ["token", "按 token 单价"], ["image", "按张单价"]], pricing.mode || "auto", choose),
          h("small", pricing.mode === "token" ? "填你付给这个渠道的价格。渠道返回用量时按用量算，没返回时按尺寸和画质估算输出。"
            : pricing.mode === "image" ? "填你付给这个渠道的价格，按返回图片的清晰度算，适合按次收费的中转站。"
              : `官方价${officialText(ctx, profile)}。中转站按次收费或打折时，改成按张或按 token 填实际价格。数据概览的毛利按这里算。`)),
        pricing.mode === "token" || pricing.mode === "image"
          ? h("div.a-field", h("label", "币种"), segment("币种", [["usd", "美元"], ["cny", "人民币"]], pricing.currency || "usd",
            (currency) => { pricing.currency = currency; drawPricing(); }),
          h("small", `人民币按「生成与计费」里的汇率（1 美元 = ${ctx.usdToCny} 元）换算。`)) : null,
        ...(pricing.mode === "token" ? [field("textInput", "文本输入", `${sign}/百万 token`), field("imageInput", "图片输入", `${sign}/百万 token`),
          field("imageOutput", "图片输出", `${sign}/百万 token`), field("textOutput", "文本输出", `${sign}/百万 token`)] : []),
        ...(pricing.mode === "image" ? TIERS.map((t) => field(t, `${TIER_TEXT[t]}每张`, `${sign}/张`)) : []));
    };
    drawPricing();
    return node;
  }

  function insertBefore(heading, node) {
    const next = [...f.node.querySelectorAll(".a-form-heading")].find((el) => el.textContent === heading);
    f.node.insertBefore(node, next || null);
  }

  function draw() {
    f = form(channelFields(kind, ctx), value);
    value = f.value;   // the form's live copy; the model and price blocks edit it too
    if (kind !== "mock") {
      value.options.pricing = { mode: "auto", currency: "usd", ...value.options.pricing };
      insertBefore("清晰度与画质", modelBlock());
      insertBefore("并发与超时", pricingBlock());
    }
    replace(box, f.node);
  }
  draw();

  const m = drawer(isNew ? `添加${KIND_TEXT[kind]}渠道` : `编辑渠道 · ${channel.name}`, h("div.stack", box,
    h("div.a-form-actions",
      h("button.btn", { type: "button", onclick: () => m.close() }, "取消"),
      h("button.btn.btn-primary", { type: "button", onclick: (e) => busy(e.currentTarget, async () => {
        try {
          const payload = { ...value, kind };
          const res = isNew ? await api.post("/api/admin/channels", payload) : await api.put(`/api/admin/channels/${channel.id}`, payload);
          toast("已保存", { type: "success" });
          m.close();
          onSaved(res.channel);
        } catch (err) { toastError(err); }
      }) }, "保存"))));
}

export async function render() {
  const list = h("div.channel-list");
  const stale = h("p.a-callout.small", { hidden: true },
    "服务器还在运行 1.7.0 之前的版本：重启服务器后才能获取模型列表、添加 Gemini 渠道和设置成本单价。");
  let ctx = { models: [], qualities: [], usdToCny: 7.2, tokenPriceUsd: { textInput: 5, imageInput: 8, imageOutput: 30 } };

  async function load() {
    try {
      const data = await api.get("/api/admin/channels");
      // A server from before 1.7.0 sends no 画质 list and profiles without patterns.
      stale.hidden = !!data.qualities;
      ctx = { models: data.qualities ? data.models : [], qualities: data.qualities || DEFAULT_QUALITIES, usdToCny: data.usdToCny || ctx.usdToCny,
        tokenPriceUsd: data.tokenPriceUsd || ctx.tokenPriceUsd };
      replace(list, data.items.length ? data.items.map(card) : h("div.a-empty", "还没有渠道。添加一个 OpenAI 或 Gemini 渠道并填入 API Key，用户就可以开始生成。"));
    } catch (err) { toastError(err); }
  }

  function card(c) {
    const real = c.kind !== "mock";
    const result = h("div.channel-test", { hidden: true });
    const test = (mode) => async (e) => busy(e.currentTarget, async () => {
      try {
        const r = await api.post(`/api/admin/channels/${c.id}/test`, { mode });
        result.hidden = false;
        replace(result,
          h("p", { class: r.ok ? "ok" : "bad" }, r.ok ? "✓ " : "✕ ", r.message, r.ms ? h("span.faint", ` · ${r.ms} ms`) : null),
          r.image ? h("img", { src: r.image, alt: "测试生成的图片", width: 160 }) : null,
          r.usage ? h("p.small.muted", `tokens：输入 ${r.usage.input_tokens ?? "—"} / 输出 ${r.usage.output_tokens ?? "—"}`) : null);
        if (mode === "generate") load();
      } catch (err) { toastError(err); }
    });
    // The result changes what the card says about the channel, so reload after it.
    const sizeCheck = (e) => busy(e.currentTarget, async () => {
      try {
        const r = await api.post(`/api/admin/channels/${c.id}/test`, { mode: "size" });
        toast(r.message, { type: r.ok ? "success" : "error" });
        await load();
      } catch (err) { toastError(err); }
    });
    const cap = capOf(c.kind, c.options);
    const qualities = ctx.qualities.filter((q) => (c.options.qualities || ctx.qualities.map((x) => x.id)).includes(q.id)).map((q) => q.label);
    return h("article.channel-card", { class: c.enabled ? "" : "is-off" },
      h("div.channel-main",
        h("div.channel-title", h("h3", c.name), c.enabled ? statusPill("已启用", "mat") : statusPill("已停用"),
          c.kind === "mock" ? statusPill("模拟", "tape") : c.kind === "gemini" ? statusPill("Gemini") : null),
        h("p.small.muted.num", real ? `${c.profile && c.profile.label !== c.model ? `${c.profile.label} · ` : ""}${c.model} · ${c.resolvedBaseUrl}` : "返回占位图，不调用模型"),
        real ? h("p.small", "API Key：", c.apiKey.set ? h("code", c.apiKey.hint) : h("strong.text-pin", "未设置")) : null,
        h("p.small.faint", `优先级 ${c.priority} · 成功 ${number(c.successCount)} 次 · 失败 ${number(c.failureCount)} 次`,
          c.lastOkAt ? ` · 最近成功 ${dateTime(c.lastOkAt)}` : ""),
        real ? h("p.small", "最高清晰度：", h("strong", TIER_TEXT[c.maxTier] || "—"),
          c.sizeLimit ? h("span.text-pin", `（尺寸检测：要 ${c.sizeLimit.requested.replace("x", "×")} 时只返回了 ${c.sizeLimit.delivered.replace("x", "×")}，${dateTime(c.sizeLimit.at)}。换了中转或模型后保存一次渠道，会重新检测）`)
            : c.kind === "openai" && c.options.sizeMode !== "flexible" ? h("span.faint", "（尺寸模式不是「自定义尺寸」）") : null,
          " · 接的画质：", h("strong", qualities.length === ctx.qualities.length ? "全部" : qualities.join("、"))) : null,
        real ? h("p.small.muted", "成本：", pricingText(ctx, c)) : null,
        c.lastError ? h("p.small.channel-error", { class: c.lastOkAt > c.lastErrorAt ? "is-recovered" : "" },
          `${c.lastOkAt > c.lastErrorAt ? "上次错误（之后已恢复）" : "最近错误"}（${dateTime(c.lastErrorAt)}）：${c.lastError}`) : null,
        result),
      h("div.channel-actions",
        h("button.btn.btn-sm", { type: "button", onclick: test("ping") }, "测试连接"),
        real ? h("button.btn.btn-sm", { type: "button", title: "生成一张低画质测试图，会产生少量费用", onclick: test("generate") }, "试生成一张") : null,
        real && cap !== "standard" ? h("button.btn.btn-sm", { type: "button",
          title: `按 ${TIER_TEXT[cap]} 尺寸生成一张低画质测试图，看渠道实际返回多大的图，结果会记到渠道上。会产生一次生成的费用`, onclick: sizeCheck }, `检测 ${TIER_TEXT[cap]}`) : null,
        h("button.btn.btn-sm.btn-primary", { type: "button", onclick: () => editChannel(c, ctx, load) }, "编辑"),
        h("button.btn.btn-sm.btn-ghost", { type: "button", onclick: async () => {
          try { await api.put(`/api/admin/channels/${c.id}`, { enabled: !c.enabled }); load(); } catch (err) { toastError(err); }
        } }, c.enabled ? "停用" : "启用"),
        h("button.btn.btn-sm.btn-ghost.btn-danger", { type: "button", onclick: async () => {
          if (!(await confirmDialog({ title: `删除渠道「${c.name}」？`, message: "删除后无法恢复。历史生成记录不受影响。", confirmText: "删除", danger: true }))) return;
          try { await api.del(`/api/admin/channels/${c.id}`); load(); } catch (err) { toastError(err); }
        } }, "删除")));
  }

  load();
  return h("div",
    pageHead("AI 渠道", "生成请求按优先级发往已启用的渠道。某个渠道报错、额度用尽或超时，会自动换下一个；全部失败时任务退点。",
      [h("button.btn", { type: "button", onclick: () => editChannel({ kind: "mock" }, ctx, load) }, "添加模拟渠道"),
        h("button.btn", { type: "button", onclick: () => editChannel({ kind: "gemini" }, ctx, load) }, "添加 Gemini 渠道"),
        h("button.btn.btn-primary", { type: "button", onclick: () => editChannel({ kind: "openai" }, ctx, load) }, "添加 OpenAI 渠道")]),
    stale,
    list,
    section("接入说明", null, h("ul.a-notes.small",
      h("li", "编辑渠道时点“获取模型列表”，从接口返回的模型里选一个，清晰度和尺寸设置会按这个模型自动填好；认不出的模型可以手动设置。获取列表不产生费用。"),
      h("li", "OpenAI：gpt-image-2，或 gpt-image-2.5-sunburst（画质更好）、gpt-image-2.5-flare（更快，画质接近 gpt-image-2）。三者都支持自定义尺寸：宽高是 16 的倍数，长宽比在 1:3 到 3:1 之间，最长边 3840 像素，总像素 65.5 万到 829 万；超过 2560×1440 的尺寸官方标为实验性。参考图始终按高保真处理，input_fidelity 选“不发送”。使用官方接口前，组织可能需要先完成 Organization Verification。"),
      h("li", "Google Gemini（Nano Banana）：Pro 画质最好，2 和 2.1 更快更便宜，三者能出 1K / 2K / 4K；2 Lite 和旧版只出 1K。官方接口 Base URL 留空，API Key 在 Google AI Studio 创建；国内服务器通常连不上 Google，需要用支持 Gemini 原生格式（…/models/模型:generateContent）的中转站。"),
      h("li", "Nano Banana 没有画质参数，草稿、标准、精细出图一样、成本也一样，可以用“接的画质”只让它接某几档。它按画幅和 1K / 2K / 4K 出图，尺寸和 gpt-image-2 略有不同，例如 2:3 的 2K 是 1696 × 2528；每张图还带 Google 的 SynthID 隐形水印。"),
      h("li", "成本单价：按官方价时，gpt-image-2 / 2.5 用「生成与计费」里的 token 单价，其他模型用内置的官方价。中转站按次收费或打折时，选“按张”或“按 token”填实际价格，可以填人民币。数据概览的毛利和「生成与计费」的清晰度一览都按这里算。"),
      h("li", "“测试连接”只读取模型列表，不产生费用；“试生成一张”生成一张标准尺寸的低画质图片（gpt-image-2 官方价约 0.006 美元，Nano Banana 按张计价）；“检测 2K / 4K”按最高清晰度生成一张低画质图片，看渠道实际返回多大的图。不少中转站会忽略尺寸、只返回 1024 级别的图，这样的渠道只接标准清晰度。"),
      h("li", "API Key 用 APP_SECRET 加密后保存在数据库，后台只显示首尾几位。"))));
}

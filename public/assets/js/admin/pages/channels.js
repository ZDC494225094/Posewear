import { h, replace } from "../../core/dom.js";
import { api } from "../../core/api.js";
import { toast, toastError, busy, confirmDialog } from "../../core/ui.js";
import { dateTime, number } from "../../core/format.js";
import { pageHead, section, form, drawer, statusPill } from "../kit.js";

const SIZE_MODES = [["flexible", "自定义尺寸（gpt-image-2 / 2.5）"], ["fixed", "固定三档（gpt-image-1.5 及更早）"], ["auto", "交给模型决定（auto）"]];
const FIDELITY = [["omit", "不发送（gpt-image-2 必须选这个）"], ["high", "high"], ["low", "low"]];

function channelFields(kind, models) {
  if (kind === "mock") {
    return [
      { key: "name", label: "名称" },
      { key: "priority", label: "优先级", type: "number", help: "数字越大越先使用。" },
      { key: "options.mockDelayMs", label: "模拟耗时（毫秒）", type: "number", min: 0, max: 60000 },
      { key: "enabled", label: "启用", type: "switch", help: "模拟渠道返回占位图，不调用真实模型，适合演示和测试。正式运营前请关闭。" }
    ];
  }
  return [
    { key: "name", label: "名称", placeholder: "例如：OpenAI 官方 / 某中转站" },
    { key: "baseUrl", label: "Base URL", placeholder: "https://api.openai.com/v1",
      help: "官方接口填 https://api.openai.com/v1；中转站填其提供的 OpenAI 兼容地址。没写 /v1 时会自动补上。" },
    { key: "apiKey", label: "API Key", type: "secret", placeholder: "sk-..." },
    { key: "model", label: "模型 ID", placeholder: "gpt-image-2",
      help: `常用：${models.map((m) => m.id).join("、")}。也可以填中转站自定义的模型名。` },
    { key: "options.sizeMode", label: "尺寸模式", type: "select", options: SIZE_MODES },
    { key: "options.inputFidelity", label: "input_fidelity 参数", type: "select", options: FIDELITY },
    { key: "priority", label: "优先级", type: "number", help: "数字越大越先使用。失败时自动切到下一个渠道。" },
    { key: "options.maxConcurrency", label: "最大并发", type: "number", min: 0, max: 100, help: "0 表示不限制。用来避开账号的速率限制（每分钟图片数）。" },
    { key: "options.timeoutSec", label: "超时（秒）", type: "number", min: 0, max: 900, help: "0 表示使用「生成与计费」里的全局设置。" },
    { key: "options.imageField", label: "参考图字段名", type: "select", options: [["image[]", "image[]（官方）"], ["image", "image（部分中转站）"]] },
    { key: "options.omitParams", label: "不发送的参数", type: "tags", rows: 2, placeholder: "moderation, safety_identifier",
      help: "中转站不支持某些参数时填在这里，可选：moderation、safety_identifier、output_format、output_compression、quality、n。" },
    { key: "enabled", label: "启用", type: "switch" }
  ];
}

function editChannel(channel, models, onSaved) {
  const isNew = !channel.id;
  const kind = channel.kind || "openai";
  const value = isNew ? {
    kind, name: kind === "mock" ? "模拟渠道" : "OpenAI · gpt-image-2", baseUrl: "https://api.openai.com/v1", model: kind === "mock" ? "mock" : "gpt-image-2",
    priority: 10, enabled: true, apiKey: "", options: { sizeMode: "flexible", inputFidelity: "omit", maxConcurrency: 0, timeoutSec: 0,
      imageField: "image[]", omitParams: [], mockDelayMs: 2000 }
  } : channel;
  const fields = channelFields(kind, models);
  let f = form(fields, value);
  const formBox = h("div", f.node);
  const quick = kind === "openai" ? h("div.chips.a-quick", h("span.small.muted", "选择模型："), models.map((model) => h("button.chip", { type: "button", onclick: () => {
    const v = f.value;
    v.model = model.id;
    v.options = { ...v.options, sizeMode: model.sizeMode, inputFidelity: model.inputFidelity };
    f = form(fields, v);
    replace(formBox, f.node);
  } }, model.label))) : null;
  const m = drawer(isNew ? "添加渠道" : `编辑渠道 · ${channel.name}`, h("div.stack", quick, formBox,
    h("div.a-form-actions",
      h("button.btn", { type: "button", onclick: () => m.close() }, "取消"),
      h("button.btn.btn-primary", { type: "button", onclick: (e) => busy(e.currentTarget, async () => {
        try {
          const payload = { ...f.value, kind };
          const res = isNew ? await api.post("/api/admin/channels", payload) : await api.put(`/api/admin/channels/${channel.id}`, payload);
          toast("已保存", { type: "success" });
          m.close();
          onSaved(res.channel);
        } catch (err) { toastError(err); }
      }) }, "保存"))));
}

export async function render() {
  const list = h("div.channel-list");
  let models = [];

  async function load() {
    try {
      const data = await api.get("/api/admin/channels");
      models = data.models;
      replace(list, data.items.length ? data.items.map(card) : h("div.a-empty", "还没有渠道。添加一个 OpenAI 渠道并填入 API Key，用户就可以开始生成。"));
    } catch (err) { toastError(err); }
  }

  function card(c) {
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
    return h("article.channel-card", { class: c.enabled ? "" : "is-off" },
      h("div.channel-main",
        h("div.channel-title", h("h3", c.name), c.enabled ? statusPill("已启用", "mat") : statusPill("已停用"), c.kind === "mock" ? statusPill("模拟", "tape") : null),
        h("p.small.muted.num", c.kind === "mock" ? "返回占位图，不调用模型" : `${c.model} · ${c.resolvedBaseUrl}`),
        c.kind === "openai" ? h("p.small", "API Key：", c.apiKey.set ? h("code", c.apiKey.hint) : h("strong.text-pin", "未设置")) : null,
        h("p.small.faint", `优先级 ${c.priority} · 成功 ${number(c.successCount)} 次 · 失败 ${number(c.failureCount)} 次`,
          c.lastOkAt ? ` · 最近成功 ${dateTime(c.lastOkAt)}` : ""),
        c.lastError ? h("p.small.channel-error", { class: c.lastOkAt > c.lastErrorAt ? "is-recovered" : "" },
          `${c.lastOkAt > c.lastErrorAt ? "上次错误（之后已恢复）" : "最近错误"}（${dateTime(c.lastErrorAt)}）：${c.lastError}`) : null,
        result),
      h("div.channel-actions",
        h("button.btn.btn-sm", { type: "button", onclick: test("ping") }, "测试连接"),
        c.kind === "openai" ? h("button.btn.btn-sm", { type: "button", title: "生成一张低画质测试图，会产生少量费用", onclick: test("generate") }, "试生成一张") : null,
        h("button.btn.btn-sm.btn-primary", { type: "button", onclick: () => editChannel(c, models, load) }, "编辑"),
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
      [h("button.btn", { type: "button", onclick: () => editChannel({ kind: "mock" }, models, load) }, "添加模拟渠道"),
        h("button.btn.btn-primary", { type: "button", onclick: () => editChannel({ kind: "openai" }, models, load) }, "添加 OpenAI 渠道")]),
    list,
    section("接入说明", null, h("ul.a-notes.small",
      h("li", "推荐模型 gpt-image-2：支持自定义尺寸（边长为 16 的倍数，最长 3840 像素），参考图默认按高保真处理，因此 input_fidelity 必须选“不发送”。"),
      h("li", "使用 OpenAI 官方接口前，组织可能需要先在开发者后台完成 Organization Verification。"),
      h("li", "“测试连接”调用 /v1/models，不产生费用；“试生成一张”会生成一张 1024×1024 低画质图片，费用约 0.006 美元。"),
      h("li", "API Key 用 APP_SECRET 加密后保存在数据库，后台只显示首尾几位。"))));
}

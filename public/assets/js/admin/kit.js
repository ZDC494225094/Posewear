import { h, icon, replace } from "../core/dom.js";
import { api } from "../core/api.js";
import { toast, toastError, busy, modal } from "../core/ui.js";

// Building blocks for admin pages: page header, sections, a schema-driven
// form bound to a settings group, data tables with paging, and drawers.

export function pageHead(title, description, actions) {
  return h("header.a-head",
    h("div", h("h1", title), description ? h("p.muted", description) : null),
    actions ? h("div.a-head-actions", actions) : null);
}

export function section(title, description, ...content) {
  return h("section.a-section",
    title ? h("div.a-section-head", h("h2", title), description ? h("p.small.muted", description) : null) : null,
    ...content);
}

// ---------- schema-driven forms
// field: { key: "a.b", label, type, help, options, min, max, step, rows, placeholder, suffix, wide }
// types: text, textarea, number, switch, select, secret, tags, list (array of objects), readonly

const getPath = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
function setPath(obj, path, value) {
  const keys = path.split(".");
  let cur = obj;
  keys.slice(0, -1).forEach((k) => { if (cur[k] == null || typeof cur[k] !== "object") cur[k] = {}; cur = cur[k]; });
  cur[keys.at(-1)] = value;
}

function control(field, value, onChange) {
  const id = `f-${field.key.replace(/\W/g, "-")}-${Math.random().toString(36).slice(2, 7)}`;
  let input;
  switch (field.type) {
    case "switch":
      input = h("label.switch", h("input", { type: "checkbox", id, checked: !!value, onchange: (e) => onChange(e.target.checked) }),
        h("span.switch-ui", { "aria-hidden": "true" }), h("span.switch-text", field.label));
      return h("div.a-field.is-switch", input, field.help ? h("small", field.help) : null);
    case "select":
      input = h("select.select", { id, onchange: (e) => onChange(field.number ? Number(e.target.value) : e.target.value) },
        field.options.map(([v, text]) => h("option", { value: v, selected: String(v) === String(value) }, text)));
      break;
    case "textarea":
      input = h("textarea.textarea", { id, rows: field.rows || 4, value: value ?? "", placeholder: field.placeholder || "",
        oninput: (e) => onChange(e.target.value) });
      break;
    case "number":
      input = h("input.input", { id, type: "number", value: value ?? "", min: field.min, max: field.max, step: field.step || "any",
        oninput: (e) => onChange(e.target.value === "" ? "" : Number(e.target.value)) });
      break;
    case "tags":
      input = h("textarea.textarea", { id, rows: field.rows || 3, value: (value || []).join("，"), placeholder: field.placeholder || "用逗号或换行分隔",
        oninput: (e) => onChange(e.target.value.split(/[,，\n]+/).map((s) => s.trim()).filter(Boolean)) });
      break;
    case "secret": {
      const isSet = value && value.__secret && value.set;
      const box = h("input.input", { id, type: "password", autocomplete: "new-password",
        placeholder: isSet ? `已设置（${value.hint}），留空则不修改` : field.placeholder || "未设置",
        oninput: (e) => onChange(e.target.value ? e.target.value : value) });
      const clear = isSet ? h("button.btn.btn-sm.btn-ghost", { type: "button", onclick: (e) => {
        onChange("");
        box.value = "";
        box.placeholder = "将在保存时清除";
        e.currentTarget.remove();
      } }, "清除") : null;
      input = h("div.secret-row", box, clear);
      break;
    }
    case "readonly":
      input = h("input.input", { id, value: value ?? "", readOnly: true });
      break;
    case "checks": {
      const selected = new Set(value || []);
      input = h("div.chips", { id, role: "group" }, field.options.map(([v, text]) =>
        h("button.chip", { type: "button", "aria-pressed": String(selected.has(v)), onclick: (e) => {
          if (selected.has(v)) selected.delete(v); else selected.add(v);
          e.currentTarget.setAttribute("aria-pressed", String(selected.has(v)));
          onChange(field.options.map(([o]) => o).filter((o) => selected.has(o)));
        } }, text)));
      break;
    }
    default:
      input = h("input.input", { id, type: "text", value: value ?? "", placeholder: field.placeholder || "", maxLength: field.max || 500,
        oninput: (e) => onChange(e.target.value) });
  }
  return h("div.a-field", { class: field.wide ? "is-wide" : "" },
    h("label", { for: id }, field.label),
    field.suffix ? h("div.with-suffix", input, h("span.suffix", field.suffix)) : input,
    field.help ? h("small", field.help) : null);
}

export function form(fields, value, { onChange } = {}) {
  const data = JSON.parse(JSON.stringify(value || {}));
  const node = h("div.a-form");
  for (const field of fields) {
    if (field.heading) { node.append(h("h3.a-form-heading", field.heading)); continue; }
    node.append(control(field, getPath(data, field.key), (v) => { setPath(data, field.key, v); onChange?.(data); }));
  }
  return { node, get value() { return data; } };
}

// A settings page section bound to one settings group (GET/PUT /api/admin/settings/:group).
export async function settingsForm(group, fields, { title, description, after, transform } = {}) {
  const wrap = h("div");
  let current;
  try { current = (await api.get(`/api/admin/settings/${group}`)).value; }
  catch (err) { toastError(err); return wrap; }
  let f = form(fields, current);
  const save = h("button.btn.btn-primary", { type: "button", onclick: (e) => busy(e.currentTarget, async () => {
    try {
      const value = transform ? transform(f.value) : f.value;
      current = (await api.put(`/api/admin/settings/${group}`, { value })).value;
      f = form(fields, current);
      replace(body, f.node);
      toast("已保存", { type: "success" });
      after?.(current);
    } catch (err) { toastError(err); }
  }) }, "保存");
  const body = h("div", f.node);
  replace(wrap, section(title, description, body, h("div.a-form-actions", save)));
  return wrap;
}

// ---------- tables

// columns: [{ label, render(row) -> node|string, className, width }]
export function table(columns, rows, { empty = "暂无数据", rowClass } = {}) {
  if (!rows.length) return h("div.a-empty.muted", empty);
  return h("div.table-wrap", h("table.data-table.a-table",
    h("thead", h("tr", columns.map((c) => h("th", { class: c.className || "", style: c.width ? { width: c.width } : null }, c.label)))),
    h("tbody", rows.map((row) => h("tr", { class: rowClass ? rowClass(row) : "" },
      columns.map((c) => h("td", { class: c.className || "" }, c.render(row))))))));
}

export function pager(total, page, size, onPage) {
  const pages = Math.max(1, Math.ceil(total / size));
  return h("div.pager",
    h("span.small.muted", `共 ${total} 条`),
    h("button.btn.btn-sm", { type: "button", disabled: page <= 1, onclick: () => onPage(page - 1) }, "上一页"),
    h("span.small.muted.num", `${page} / ${pages}`),
    h("button.btn.btn-sm", { type: "button", disabled: page >= pages, onclick: () => onPage(page + 1) }, "下一页"));
}

// A list page with a filter bar and paging. load(query) -> { total, items }.
export function listView({ filters = [], load, render, size = 30 }) {
  const state = { page: 1, query: {} };
  for (const f of filters) state.query[f.key] = f.value ?? "";
  const bar = h("div.a-filters");
  const body = h("div.a-list-body");
  const foot = h("div.a-list-foot");
  let timer = null;
  for (const f of filters) {
    let el;
    if (f.type === "select") {
      el = h("select.select", { "aria-label": f.label, onchange: (e) => { state.query[f.key] = e.target.value; state.page = 1; refresh(); } },
        f.options.map(([v, t]) => h("option", { value: v, selected: v === state.query[f.key] }, t)));
    } else {
      el = h("input.input", { type: "search", placeholder: f.placeholder || f.label, "aria-label": f.label, value: state.query[f.key],
        oninput: (e) => { clearTimeout(timer); timer = setTimeout(() => { state.query[f.key] = e.target.value.trim(); state.page = 1; refresh(); }, 300); } });
    }
    bar.append(el);
  }
  async function refresh() {
    body.classList.add("is-loading");
    try {
      const data = await load({ ...state.query, page: state.page, size });
      replace(body, render(data.items, data, refresh));
      replace(foot, pager(data.total, state.page, size, (p) => { state.page = p; refresh(); }));
    } catch (err) { toastError(err); }
    body.classList.remove("is-loading");
  }
  refresh();
  return { node: h("div.a-list", filters.length ? bar : null, body, foot), refresh, state };
}

export function statusPill(text, tone = "") {
  return h("span.pill", { class: tone ? `pill-${tone}` : "" }, text);
}

export function drawer(title, content, { width = 640 } = {}) {
  const m = modal({ title, content });
  m.el.classList.add("a-drawer");
  m.el.style.width = `min(${width}px, 100%)`;
  m.el.parentElement.classList.add("a-drawer-backdrop");
  return m;
}

export function kv(pairs) {
  return h("dl.kv.a-kv", pairs.filter(Boolean).flatMap(([k, v]) => [h("dt", k), h("dd", v ?? "—")]));
}

export { icon };

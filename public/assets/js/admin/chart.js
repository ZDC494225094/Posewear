import { h, tile } from "../core/dom.js";

// Single-series column chart for daily metrics, drawn in SVG. Bars are capped
// at 24px, rounded at the data end and square at the baseline; each bar is its
// own hover/focus target with a tooltip; a data table sits behind <details>.
const SVG = "http://www.w3.org/2000/svg";
const el = (tag, attrs = {}) => {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

function niceMax(value) {
  if (value <= 0) return 4;
  const exp = 10 ** Math.floor(Math.log10(value));
  const n = value / exp;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * exp;
}

const compact = (n) => (n >= 10000 ? `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}万` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(Math.round(n * 100) / 100));

// points: [{ label, value, detail?: [[name, text]] }]
export function columnChart({ title, points, format = (v) => String(v), height = 200, iconName, color }) {
  const width = 640;
  const pad = { top: 14, right: 8, bottom: 26, left: 40 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(...points.map((p) => p.value), 0));
  const band = innerW / Math.max(points.length, 1);
  const barW = Math.min(24, Math.max(3, band - 2));
  const y = (v) => pad.top + innerH - (v / max) * innerH;

  const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, role: "group", "aria-label": title, class: "chart-svg" });
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    const yy = y(v);
    svg.append(el("line", { x1: pad.left, x2: width - pad.right, y1: yy, y2: yy, class: i === 0 ? "chart-base" : "chart-gridline" }));
    const t = el("text", { x: pad.left - 8, y: yy + 4, "text-anchor": "end", class: "chart-tick" });
    t.textContent = compact(v);
    svg.append(t);
  }
  const tip = h("div.chart-tip", { role: "status", hidden: true });
  // About 8 evenly spaced date labels; the last day is always labeled, and the
  // regular label just before it is dropped when the two would collide.
  const labelEvery = Math.ceil(points.length / 8);
  const labeled = new Set();
  for (let i = 0; i < points.length; i += labelEvery) labeled.add(i);
  const last = points.length - 1;
  if (last > 0 && !labeled.has(last)) {
    const prev = Math.floor(last / labelEvery) * labelEvery;
    if (last - prev < labelEvery * 0.6) labeled.delete(prev);
    labeled.add(last);
  }
  points.forEach((p, i) => {
    const cx = pad.left + band * i + band / 2;
    if (labeled.has(i)) {
      const t = el("text", { x: cx, y: height - 8, "text-anchor": "middle", class: "chart-tick" });
      t.textContent = p.label;
      svg.append(t);
    }
    const top = y(p.value);
    const hBar = pad.top + innerH - top;
    if (p.value > 0) {
      const r = Math.min(4, barW / 2, hBar);
      const x0 = cx - barW / 2, x1 = cx + barW / 2, base = pad.top + innerH;
      svg.append(el("path", { class: "chart-bar", d:
        `M${x0},${base}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x1 - r}Q${x1},${top} ${x1},${top + r}V${base}Z` }));
    }
    const hit = el("rect", { x: pad.left + band * i, y: pad.top, width: band, height: innerH, class: "chart-hit", tabindex: 0,
      "aria-label": `${p.label}：${format(p.value)}` });
    const show = () => {
      tip.replaceChildren(h("strong", format(p.value)), h("span", p.label),
        ...(p.detail || []).map(([k, v]) => h("span.small", `${k} ${v}`)));
      tip.hidden = false;
      const pct = (cx / width) * 100;
      tip.style.left = `${Math.min(86, Math.max(14, pct))}%`;
      hit.classList.add("is-hover");
    };
    const hide = () => { tip.hidden = true; hit.classList.remove("is-hover"); };
    hit.addEventListener("pointerenter", show);
    hit.addEventListener("pointerleave", hide);
    hit.addEventListener("focus", show);
    hit.addEventListener("blur", hide);
    svg.append(hit);
  });

  const tableView = h("details.chart-table",
    h("summary.small", "查看数据"),
    h("div.table-wrap", h("table.data-table",
      h("thead", h("tr", h("th", "日期"), h("th.right", title))),
      h("tbody", points.map((p) => h("tr", h("td.num", p.label), h("td.right.num", format(p.value))))))));
  return h("figure.chart", h("figcaption.chart-title", iconName ? tile(iconName, color) : null, title), h("div.chart-plot", svg, tip), tableView);
}

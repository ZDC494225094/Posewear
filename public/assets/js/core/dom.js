// Tiny DOM builder. Text is always set via text nodes, never innerHTML, so
// user-supplied strings cannot inject markup.
//   h("button.btn.btn-primary", { onclick, type: "button" }, "保存")
export function h(spec, props, ...children) {
  if (props === null || typeof props !== "object" || props instanceof Node || Array.isArray(props)) {
    children.unshift(props);
    props = {};
  }
  // "tag#id.class.class" in any order after the tag name.
  const text = String(spec);
  const tag = /^[a-zA-Z][\w-]*/.exec(text)?.[0] || "div";
  const tokens = text.slice(tag.length).match(/[.#][^.#]+/g) || [];
  const id = tokens.find((t) => t[0] === "#")?.slice(1);
  const classes = tokens.filter((t) => t[0] === ".").map((t) => t.slice(1));
  const el = tag === "svg" || props.__svg
    ? document.createElementNS("http://www.w3.org/2000/svg", tag || "svg")
    : document.createElement(tag || "div");
  if (id) el.id = id;
  if (classes.length) el.classList.add(...classes.filter(Boolean));
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false || key === "__svg") continue;
    if (key === "class") String(value).split(/\s+/).filter(Boolean).forEach((c) => el.classList.add(c));
    else if (key === "style" && typeof value === "object") Object.assign(el.style, value);
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (key === "ref") value(el);
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key in el && !(el instanceof SVGElement) && key !== "list" && key !== "form") {
      try { el[key] = value; } catch { el.setAttribute(key, value === true ? "" : value); }
    } else el.setAttribute(key, value === true ? "" : value);
  }
  append(el, children);
  return el;
}

export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === true) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function replace(el, ...children) {
  clear(el);
  return append(el, children);
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

// Inline SVG icons drawn on a 24px grid with a 1.8px stroke.
const ICONS = {
  shuffle: "M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5",
  upload: "M12 16V4M7 9l5-5 5 5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3",
  download: "M12 4v12M7 11l5 5 5-5M4 20h16",
  close: "M6 6l12 12M18 6 6 18",
  plus: "M12 5v14M5 12h14",
  check: "M5 12.5l4.5 4.5L19 7",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  share: "M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13",
  redo: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4",
  image: "M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4M15.5 9.5h.01",
  flag: "M5 21V4M5 4h11l-2 4 2 4H5",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  menu: "M4 7h16M4 12h16M4 17h16",
  arrowLeft: "M15 6l-6 6 6 6",
  arrowRight: "M9 6l6 6-6 6",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  board: "M4 5h16v14H4zM9.5 5v14M14.5 5v14",
  chart: "M4 20V4M4 20h16M8 16v-3M12 16V9M16 16v-6M20 16V6",
  users: "M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.2a3.5 3.5 0 0 1 0 6.6",
  receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3",
  bag: "M5 8h14l-1 12H6zM9 8V6.5a3 3 0 0 1 6 0V8",
  ticket: "M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4zM14.5 7v10",
  photos: "M7 3h14v14H7zM3 7v14h14M7 13l3.5-3.5 3 3L16 10l5 5",
  shield: "M12 3l8 3v6c0 4.8-3.4 7.9-8 9-4.6-1.1-8-4.2-8-9V6zM9 12l2 2 4-4",
  bolt: "M13 2 4.5 13.5h6.5L10 22l9.5-12H13z",
  sliders: "M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4",
  text: "M5 5h14M12 5v14M9 19h6",
  card: "M3 6h18v12H3zM3 10h18M7 15h4",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3.5 9h17M3.5 15h17M12 3c2.4 2.6 3.5 5.6 3.5 9s-1.1 6.4-3.5 9c-2.4-2.6-3.5-5.6-3.5-9S9.6 5.6 12 3Z",
  list: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
  gem: "M6.5 4h11L21 9l-9 11L3 9zM3 9h18M9.5 4 8 9l4 11 4-11-1.5-5",
  hanger: "M10 6.5a2 2 0 1 1 2.7 1.9c-.5.2-.7.5-.7 1V11L3.5 17.4c-.6.5-.3 1.6.6 1.6h15.8c.9 0 1.2-1.1.6-1.6L12 11",
  pose: "M12 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM6 9.5l6-1.5 6 1.5M12 8v6M12 14l-3.5 7M12 14l3.5 7",
  shirt: "M8 3 4 5.5 2.5 10l3.5 1.5V21h12v-9.5L21.5 10 20 5.5 16 3c0 2.2-1.8 3.5-4 3.5S8 5.2 8 3Z",
  person: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM5 21v-1a7 7 0 0 1 14 0v1",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7.5V12l3 2",
  expand: "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7",
  gift: "M4 11h16v10H4zM2.5 7h19v4h-19zM12 7v14M12 7H8.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7Zm0 0h3.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7Z",
  calendar: "M4 5h16v16H4zM16 3v4M8 3v4M4 10h16",
  lock: "M5 11h14v10H5zM8 11V7.5a4 4 0 0 1 8 0V11",
  mail: "M3 5h18v14H3zM3.5 6l8.5 7 8.5-7",
  palette: "M12 21a9 9 0 1 1 9-9c0 2.2-1.7 3-3.2 3h-1.6a1.8 1.8 0 0 0-1.3 3A1.8 1.8 0 0 1 12 21ZM7.5 11h.01M10.5 7.5h.01M15 7.5h.01",
  mountain: "M3 20 9.5 8l4 7 2.5-4L21 20zM16.5 5.5h.01",
  ratio: "M4 6h16v12H4zM8 9.5v5M16 9.5v5",
  stack: "M12 3 2.5 8 12 13l9.5-5zM2.5 12.5 12 17.5l9.5-5M2.5 16.5 12 21.5l9.5-5",
  checkCircle: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM8 12.5l2.7 2.7L16 9.8",
  alert: "M12 3 2 20h20zM12 10v4.5M12 17.5h.01",
  heart: "M12 20.5S3.5 15.6 3.5 9.6A4.6 4.6 0 0 1 12 7a4.6 4.6 0 0 1 8.5 2.6c0 6-8.5 10.9-8.5 10.9Z",
  home: "M3.5 11 12 4l8.5 7M6 9.5V20h12V9.5"
};

// iOS-style coloured icon tile, e.g. tile("bolt", "orange").
export function tile(name, color = "gray", size = "") {
  const span = document.createElement("span");
  span.className = `tile t-${color}${size ? ` tile-${size}` : ""}`;
  span.setAttribute("aria-hidden", "true");
  span.append(icon(name, size === "xl" ? 34 : size === "lg" ? 24 : 17));
  return span;
}

// Inline icon tinted with a system colour; used to accent button icons.
export function cicon(name, color, size = 17) {
  const svg = icon(name, size);
  svg.classList.add(`i-${color}`);
  return svg;
}

export function icon(name, size = 18) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", ICONS[name] || "");
  svg.append(path);
  return svg;
}

import { h, icon, tile } from "./dom.js";
import { menuOpen } from "./select.js";

// ---------- toast

let toastRoot = null;
export function toast(message, { type = "info", timeout = 3600 } = {}) {
  if (!toastRoot) {
    toastRoot = h("div.toasts", { role: "status", "aria-live": "polite" });
    document.body.append(toastRoot);
  }
  const el = h(`div.toast.toast-${type}`, message);
  toastRoot.append(el);
  setTimeout(() => el.remove(), timeout);
}
export const toastError = (err) => toast(err?.message || String(err), { type: "error", timeout: 5200 });

// ---------- modal

// Returns { el, close, body }. Closes on Esc, backdrop click and the × button;
// focus moves into the dialog and returns to the opener afterwards.
export function modal({ title, content, footer, wide = false, onClose, label } = {}) {
  const opener = document.activeElement;
  const body = h("div.modal-body", content);
  const titleId = `m-${Math.random().toString(36).slice(2)}`;
  const dialog = h(`div.modal${wide ? ".modal-wide" : ""}`, { role: "dialog", "aria-modal": "true", tabIndex: -1,
    ...(title ? { "aria-labelledby": titleId } : { "aria-label": label || "对话框" }) },
    title ? h("div.modal-head", h("h2", { id: titleId }, title),
      h("button.modal-close", { type: "button", "aria-label": "关闭", onclick: () => close() }, "×")) : null,
    body,
    footer ? h("div.modal-foot", footer) : null);
  const backdrop = h("div.modal-backdrop", dialog);
  backdrop.addEventListener("mousedown", (e) => { if (e.target === backdrop) close(); });
  const onKey = (e) => {
    if (menuOpen() || zoomOpen) return; // an open drop-down or zoom view handles its own keys
    if (e.key === "Escape") { e.stopPropagation(); close(); }
    if (e.key === "Tab") {
      const focusables = [...dialog.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")]
        .filter((el) => !el.disabled && el.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0], last = focusables.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  document.addEventListener("keydown", onKey, true);
  document.body.append(backdrop);
  document.body.style.overflow = "hidden";
  requestAnimationFrame(() => (dialog.querySelector("[autofocus]") || dialog).focus());
  let closed = false;
  function close(result) {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey, true);
    backdrop.remove();
    if (!document.querySelector(".modal-backdrop")) document.body.style.overflow = "";
    opener?.focus?.();
    onClose?.(result);
  }
  return { el: dialog, body, close };
}

export function confirmDialog({ title, message, confirmText = "确定", danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    const m = modal({
      title, content: h("p.muted", message),
      footer: [
        h("button.btn", { type: "button", onclick: () => m.close() }, "取消"),
        h(`button.btn.${danger ? "btn-danger" : "btn-primary"}`, { type: "button", autofocus: true,
          onclick: () => { result = true; m.close(); } }, confirmText)
      ],
      onClose: () => resolve(result)
    });
  });
}

// Disable a button and show a spinner while an async action runs.
export async function busy(button, fn) {
  if (!button || button.disabled) return;
  const original = [...button.childNodes];
  button.disabled = true;
  button.replaceChildren(h("span.spinner", { "aria-hidden": "true" }), ...original.map((n) => n.cloneNode(true)));
  try { return await fn(); }
  finally {
    button.disabled = false;
    button.replaceChildren(...original);
  }
}

export function emptyState({ title, text, action, icon: iconName, color = "gray" }) {
  return h("div.empty", iconName ? tile(iconName, color, "xl") : null, h("div.empty-title", title), text ? h("p", text) : null, action || null);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("已复制", { type: "success" });
    return true;
  } catch {
    toast("复制失败，请手动选择文本复制", { type: "error" });
    return false;
  }
}

// ---------- zoom: one image at full resolution, full screen
// Wheel or pinch zooms around the pointer, dragging pans, double-click
// switches between "fit" and 100%. Keys: + / - zoom, 0 fits, Esc closes.

let zoomOpen = false;

export function zoomImage(src, { alt = "" } = {}) {
  const opener = document.activeElement;
  const img = h("img.zoom-img", { src, alt, draggable: false });
  const stage = h("div.zoom-stage", img);
  const level = h("span.zoom-level.num", "—");
  const tool = (text, label, onclick) => h("button.zoom-btn", { type: "button", "aria-label": label, title: label, onclick }, text);
  const root = h("div.zoom-root", { role: "dialog", "aria-modal": "true", "aria-label": "查看原图", tabIndex: -1 },
    stage,
    h("div.zoom-bar",
      tool("−", "缩小", () => zoomBy(1 / 1.25)), level, tool("+", "放大", () => zoomBy(1.25)),
      tool("1:1", "原始大小", () => zoomTo(1)), tool("适应", "适应屏幕", fit),
      h("a.zoom-btn", { href: src, target: "_blank", rel: "noopener", "data-native": "", title: "新窗口打开" }, "↗"),
      tool("×", "关闭", () => close())),
    h("p.zoom-hint", "滚轮或双指缩放，拖动查看细节，双击切换适应 / 原始大小"));
  let scale = 1, x = 0, y = 0, fitScale = 1, fitted = true;
  const pointers = new Map();
  let pinch = null;

  const box = () => stage.getBoundingClientRect();
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  function apply() {
    img.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    level.textContent = `${Math.round(scale * 100)}%`;
  }
  function fit() {
    if (!img.naturalWidth) return;
    const r = box();
    fitScale = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight, 1);
    scale = fitScale;
    x = (r.width - img.naturalWidth * scale) / 2;
    y = (r.height - img.naturalHeight * scale) / 2;
    fitted = true;
    apply();
  }
  // Zoom so the image point under (px, py) stays put.
  function zoomAt(next, px, py) {
    next = clamp(next, Math.min(fitScale, 0.05), 8);
    const k = next / scale;
    x = px - (px - x) * k;
    y = py - (py - y) * k;
    scale = next;
    fitted = false;
    apply();
  }
  const center = () => { const r = box(); return [r.width / 2, r.height / 2]; };
  const zoomBy = (factor) => zoomAt(scale * factor, ...center());
  const zoomTo = (value) => zoomAt(value, ...center());

  img.addEventListener("load", fit);
  if (img.complete) requestAnimationFrame(fit);
  stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = box();
    zoomAt(scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  stage.addEventListener("dblclick", (e) => {
    const r = box();
    if (fitted || scale < 0.99) zoomAt(1, e.clientX - r.left, e.clientY - r.top);
    else fit();
  });
  stage.addEventListener("pointerdown", (e) => {
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale };
    }
    stage.classList.add("is-dragging");
  });
  stage.addEventListener("pointermove", (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const r = box();
      zoomAt(pinch.scale * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.dist), (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      return;
    }
    x += e.clientX - prev.x;
    y += e.clientY - prev.y;
    fitted = false;
    apply();
  });
  const release = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!pointers.size) stage.classList.remove("is-dragging");
  };
  stage.addEventListener("pointerup", release);
  stage.addEventListener("pointercancel", release);

  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === "+" || e.key === "=") zoomBy(1.25);
    else if (e.key === "-" || e.key === "_") zoomBy(1 / 1.25);
    else if (e.key === "0") fit();
    else if (e.key === "Tab") {
      const focusables = [...root.querySelectorAll("button, [href]")];
      const first = focusables[0], last = focusables.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    else return;
    e.stopPropagation();
  };
  const onResize = () => { if (fitted) fit(); };
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", onResize);
  document.body.append(root);
  zoomOpen = true;
  requestAnimationFrame(() => root.focus());
  function close() {
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", onResize);
    root.remove();
    zoomOpen = false;
    opener?.focus?.();
  }
  return { close };
}

// ---------- lightbox: one image at a time with prev/next
// Clicking the image opens it full screen with zoom (item.zoomSrc, else src).

export function lightbox(items, start = 0, { renderAside } = {}) {
  let index = start;
  const img = h("img.lightbox-img", { alt: "", title: "点击查看原图，可缩放",
    onclick: () => { const item = items[index]; zoomImage(item.zoomSrc || item.src, { alt: item.alt }); } });
  const aside = h("div.lightbox-aside");
  const counter = h("span.faint.small.num");
  const prev = h("button.lightbox-nav.prev", { type: "button", "aria-label": "上一张", onclick: () => go(-1) }, icon("arrowLeft", 22));
  const next = h("button.lightbox-nav.next", { type: "button", "aria-label": "下一张", onclick: () => go(1) }, icon("arrowRight", 22));
  const stage = h("div.lightbox-stage", img, items.length > 1 ? [prev, next] : null);
  const m = modal({ wide: true, label: "图片预览", content: h("div.lightbox", stage, h("div.lightbox-side", counter, aside)) });
  m.el.classList.add("modal-lightbox");
  m.el.prepend(h("button.modal-close.lightbox-close", { type: "button", "aria-label": "关闭", onclick: () => m.close() }, "×"));
  const onKey = (e) => {
    if (e.key === "ArrowLeft") go(-1);
    if (e.key === "ArrowRight") go(1);
  };
  m.el.addEventListener("keydown", onKey);
  function go(step) {
    if (items.length < 2) return;
    index = (index + step + items.length) % items.length;
    show();
  }
  function show() {
    const item = items[index];
    img.src = item.src;
    img.alt = item.alt || "";
    counter.textContent = items.length > 1 ? `${index + 1} / ${items.length}` : "";
    aside.replaceChildren(renderAside ? renderAside(item, { close: m.close }) : "");
  }
  show();
  return m;
}

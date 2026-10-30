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
    if (menuOpen()) return; // an open drop-down handles Esc and Tab itself
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

// ---------- lightbox: one image at a time with prev/next

export function lightbox(items, start = 0, { renderAside } = {}) {
  let index = start;
  const img = h("img.lightbox-img", { alt: "" });
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

import { h, icon } from "./dom.js";

// Drop-down picker replacing the native <select>: a button that opens a
// frosted list. Keyboard: ↑/↓/Home/End move, Enter/Space pick, Esc closes,
// typing filters long lists. Options: [value, text] tuples or
// { value, text, note, disabled }, plus { group } headings.
//   const s = selectMenu({ options, value, onChange, label: "分类" });
//   container.append(s.node); s.value = "x"; s.setOptions(next);
let openMenu = null;
let uid = 0;

const normalize = (options) => (options || []).map((o) => (Array.isArray(o)
  ? { value: o[0], text: String(o[1] ?? o[0]) }
  : o.group !== undefined ? { group: String(o.group) } : { ...o, text: String(o.text ?? o.value) }));

export function selectMenu({ options = [], value = "", onChange, label = "", placeholder = "请选择", id,
  className = "", filled = false, disabled = false, searchable } = {}) {
  let items = normalize(options);
  let current = value;
  const valueEl = h("span.select-value");
  const button = h("button.select-btn", { type: "button", id, disabled, "aria-haspopup": "listbox", "aria-expanded": "false",
    class: [filled ? "is-filled" : "", className].filter(Boolean).join(" "),
    onclick: () => (openMenu?.owner === api ? close() : open()),
    onkeydown: (e) => {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); open(); }
    } }, valueEl, icon("chevron", 14));
  if (label) button.setAttribute("aria-label", label);

  function selected() {
    return items.find((o) => o.group === undefined && String(o.value) === String(current));
  }
  function paint() {
    const item = selected();
    valueEl.textContent = item ? item.text : placeholder;
    valueEl.classList.toggle("is-placeholder", !item);
    button.title = item ? item.text : "";
  }

  function open() {
    if (button.disabled) return;
    openMenu?.close();
    const listId = `sel-${++uid}`;
    const pop = h("div.select-pop", { role: "listbox", id: listId, tabIndex: -1, "aria-label": label || undefined });
    const list = h("div.select-list");
    const choices = items.filter((o) => o.group === undefined);
    const withSearch = searchable ?? choices.length > 14;
    let query = "";
    let active = -1;
    let visible = [];

    function render() {
      list.replaceChildren();
      visible = [];
      let heading = null;
      for (const o of items) {
        if (o.group !== undefined) { heading = h("div.select-group", o.group); continue; }
        if (query && !o.text.toLowerCase().includes(query) && !String(o.value).toLowerCase().includes(query)) continue;
        if (heading) { list.append(heading); heading = null; }
        const index = visible.length;
        const isSelected = String(o.value) === String(current);
        const el = h("div.select-opt", { role: "option", id: `${listId}-${index}`, "aria-selected": String(isSelected),
          "aria-disabled": o.disabled ? "true" : undefined,
          onpointermove: () => setActive(index, false),
          onclick: () => pick(o) },
          icon("check", 15), h("span.select-text", o.text), o.note !== undefined && o.note !== "" ? h("span.select-note", String(o.note)) : null);
        visible.push({ option: o, el });
        list.append(el);
      }
      if (!visible.length) list.append(h("div.select-empty", "没有匹配的选项"));
    }
    function setActive(index, scroll = true) {
      if (visible[active]) visible[active].el.classList.remove("is-active");
      active = index;
      const item = visible[active];
      if (!item) { pop.removeAttribute("aria-activedescendant"); return; }
      item.el.classList.add("is-active");
      pop.setAttribute("aria-activedescendant", item.el.id);
      if (scroll) item.el.scrollIntoView({ block: "nearest" });
    }
    function move(step) {
      if (!visible.length) return;
      let i = active;
      for (let n = 0; n < visible.length; n++) {
        i = (i + step + visible.length) % visible.length;
        if (!visible[i].option.disabled) { setActive(i); return; }
      }
    }
    function pick(o) {
      if (!o || o.disabled) return;
      const changed = String(o.value) !== String(current);
      current = o.value;
      paint();
      close();
      if (changed) onChange?.(o.value, o);
    }
    function onKey(e) {
      if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
      else if (e.key === "Home") { e.preventDefault(); setActive(visible.findIndex((v) => !v.option.disabled)); }
      else if (e.key === "End") { e.preventDefault(); for (let i = visible.length - 1; i >= 0; i--) if (!visible[i].option.disabled) { setActive(i); break; } }
      else if (e.key === "Enter" || (e.key === " " && e.target !== search)) { e.preventDefault(); pick(visible[active]?.option); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === "Tab") { e.preventDefault(); close(); }
    }

    const search = withSearch ? h("input.select-search", { type: "search", placeholder: "搜索", "aria-label": "搜索选项",
      oninput: (e) => { query = e.target.value.trim().toLowerCase(); render(); setActive(visible.findIndex((v) => !v.option.disabled)); } }) : null;
    pop.append(search || "", list);
    pop.addEventListener("keydown", onKey);
    render();
    document.body.append(pop);
    place(pop);
    setActive(Math.max(0, visible.findIndex((v) => String(v.option.value) === String(current))));
    (search || pop).focus({ preventScroll: true });
    button.setAttribute("aria-expanded", "true");
    button.setAttribute("aria-controls", listId);

    const onDown = (e) => { if (!pop.contains(e.target) && !button.contains(e.target)) close(); };
    const onScroll = (e) => { if (!pop.contains(e.target)) close(); };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    openMenu = {
      owner: api,
      close() {
        document.removeEventListener("pointerdown", onDown, true);
        window.removeEventListener("scroll", onScroll, true);
        window.removeEventListener("resize", close);
        pop.remove();
        button.setAttribute("aria-expanded", "false");
        button.removeAttribute("aria-controls");
        openMenu = null;
      }
    };
  }

  // Below the button when it fits, otherwise above; never off-screen.
  function place(pop) {
    const r = button.getBoundingClientRect();
    pop.style.minWidth = `${Math.max(160, r.width)}px`;
    const height = pop.offsetHeight;
    const below = window.innerHeight - r.bottom - 12;
    const top = below >= height || below >= r.top ? r.bottom + 6 : Math.max(8, r.top - 6 - height);
    pop.style.top = `${Math.round(top)}px`;
    pop.style.maxHeight = `${Math.max(160, Math.min(340, below >= height || below >= r.top ? below : r.top - 14))}px`;
    const width = pop.offsetWidth;
    pop.style.left = `${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - width - 8)))}px`;
  }

  function close() {
    if (openMenu?.owner !== api) return;
    openMenu.close();
    button.focus({ preventScroll: true });
  }

  const api = {
    node: button,
    get value() { return current; },
    set value(v) { current = v; paint(); },
    setOptions(next, v = current) {
      items = normalize(next);
      current = v;
      paint();
    },
    set disabled(v) { button.disabled = !!v; },
    close
  };
  paint();
  return api;
}

// True while a menu is open; dialogs check this so Esc closes the menu first.
export const menuOpen = () => !!openMenu;

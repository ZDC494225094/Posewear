import { h } from "./dom.js";

// Minimal Markdown for admin-edited legal pages: #/##/### headings, paragraphs,
// "- " and "1. " lists, **bold**. Builds DOM nodes, so content is never parsed as HTML.
function inline(text) {
  const parts = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(h("strong", m[1]));
    last = re.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function markdown(source) {
  const root = h("div.prose");
  const lines = String(source || "").replace(/\r\n/g, "\n").split("\n");
  let list = null, para = [];
  const flushPara = () => { if (para.length) { root.append(h("p", inline(para.join(" ")))); para = []; } };
  const flushList = () => { if (list) { root.append(list); list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+[.、]\s+(.*)$/.exec(line);
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (heading) { flushPara(); flushList(); root.append(h(`h${heading[1].length}`, inline(heading[2]))); continue; }
    if (bullet || ordered) {
      flushPara();
      const tag = bullet ? "ul" : "ol";
      if (!list || list.tagName.toLowerCase() !== tag) { flushList(); list = h(tag); }
      list.append(h("li", inline((bullet || ordered)[1])));
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return root;
}

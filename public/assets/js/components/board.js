import { h, cicon } from "../core/dom.js";
import { modal, toast, copyText } from "../core/ui.js";

// Reference board export, carried over from the original ai-reference-gallery
// compositor: pose, outfit and the optional person, scene and items side by
// side on one canvas, proportions kept, no cropping. Free, runs entirely in the browser, for
// people who want to take the board to another AI tool.

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片加载失败"));
    img.src = src;
  });
}

function contain(ctx, image, x, y, w, h) {
  const ratio = Math.min(w / image.naturalWidth, h / image.naturalHeight);
  const dw = image.naturalWidth * ratio, dh = image.naturalHeight * ratio;
  ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

// entries: [{ src, code }]; code is printed under catalog images only.
export async function drawBoard(canvas, entries, { background = "white", labels = true, maxSize = [2400, 1600] } = {}) {
  const images = await Promise.all(entries.map((e) => loadImage(e.src)));
  const padding = 14, margin = 24, gap = 26, unit = 1000;
  const codes = entries.map((e) => (labels && e.code ? String(e.code) : ""));
  const labelHeights = codes.map((c) => (c ? 64 : 0));
  const boxWidths = images.map((img) => unit * (img.naturalWidth / img.naturalHeight) + 2 * padding);
  const boxHeights = labelHeights.map((lh) => unit + 2 * padding + lh);
  const rawW = boxWidths.reduce((a, b) => a + b, 0) + gap * (images.length - 1) + 2 * margin;
  const rawH = Math.max(...boxHeights) + 2 * margin;
  const scale = Math.min(maxSize[0] / rawW, maxSize[1] / rawH);
  canvas.width = Math.round(rawW * scale);
  canvas.height = Math.round(rawH * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = background === "soft" ? "#f2f3f6" : "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  let offset = 0;
  images.forEach((img, i) => {
    const x = margin + offset, y = margin, pw = boxWidths[i], ph = boxHeights[i];
    ctx.fillStyle = background === "soft" ? "#ffffff" : "#f7f8fa";
    ctx.fillRect(x, y, pw, ph);
    contain(ctx, img, x + padding, y + padding, pw - padding * 2, ph - padding * 2 - labelHeights[i]);
    if (codes[i]) {
      ctx.fillStyle = "#333d4e";
      ctx.font = "650 35px system-ui, sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText(codes[i].slice(0, 40), x + padding, y + ph - labelHeights[i] / 2, pw - padding * 2);
    }
    offset += pw + gap;
  });
  return canvas;
}

// One line per image, numbered left to right as they sit on the board.
const ROLE_TEXT = {
  pose: (code) => `姿势参考${code ? `（${code}）` : ""}：参考身体姿态、动作方向、手脚位置和互动关系。`,
  outfit: (code) => `服装参考${code ? `（${code}）` : ""}：保留衣服的廓形、配色、材质和重要配饰。`,
  person: () => "人物参考：尽量保持人物可辨认的面部特征和发型，不照搬原图的服装和姿势。",
  scene: () => "场景参考：把人物放进这个地点，保留环境、光线和氛围。",
  item: () => "物品参考：让人物自然地佩戴或手持这件物品，保留它的形状、颜色和材质。"
};

export function boardPrompt(entries) {
  const lines = entries.map((e, i) => `${i + 1}. 从左数第 ${i + 1} 张是${ROLE_TEXT[e.role](e.code)}`);
  return `请根据这张参考板生成一张完整的人物作品，每张图片的用途不同：\n\n${lines.join("\n")}\n` +
    `${entries.length + 1}. 把各项参考自然融合成一张新作品，人物比例协调、细节清晰，不要输出参考板拼贴。`;
}

export function openBoardDialog({ pose, outfit, outfitUpload, person, sceneAsset, items = [] }) {
  const entries = [];
  if (pose) entries.push({ role: "pose", src: pose.preview, code: pose.id });
  if (outfit) entries.push({ role: "outfit", src: outfit.preview, code: outfit.id });
  else if (outfitUpload) entries.push({ role: "outfit", src: outfitUpload.url, code: "" });
  if (person) entries.push({ role: "person", src: person.url, code: "" });
  if (sceneAsset) entries.push({ role: "scene", src: sceneAsset.preview, code: sceneAsset.id });
  for (const item of items) entries.push({ role: "item", src: item.preview, code: item.id });
  const options = { background: "white", labels: true };
  const canvas = h("canvas.board-canvas", { "aria-label": "参考板预览" });
  const status = h("p.small.muted", { "aria-live": "polite" }, "正在排版…");
  const promptText = boardPrompt(entries);
  const redraw = async () => {
    try {
      await drawBoard(canvas, entries, options);
      status.textContent = `${canvas.width} × ${canvas.height} PNG，保留原图比例`;
    } catch (err) { status.textContent = err.message; }
  };
  const toBlob = () => new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("导出失败"))), "image/png"));
  const m = modal({
    title: "导出参考板",
    wide: true,
    content: h("div.board-dialog",
      h("div.board-stage", canvas),
      h("div.board-side",
        h("p.muted.small", "把选好的姿势、服装、人物、场景和物品拼成一张参考图，附带提示词，可以拿到其他支持图片参考的 AI 工具使用。导出不消耗点数。"),
        h("div.field", h("span", "画布背景"),
          h("div.chips", [["white", "白色"], ["soft", "浅灰"]].map(([value, text]) =>
            h("button.chip", { type: "button", "aria-pressed": String(options.background === value), onclick: (e) => {
              options.background = value;
              e.currentTarget.parentElement.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c === e.currentTarget)));
              redraw();
            } }, text)))),
        h("label.check", h("input", { type: "checkbox", checked: true, onchange: (e) => { options.labels = e.target.checked; redraw(); } }), "显示素材编号"),
        status,
        h("div.field", h("span", "提示词"), h("textarea.textarea", { rows: 8, readOnly: true, value: promptText })),
        h("div.board-actions",
          h("button.btn.btn-primary", { type: "button", onclick: async () => {
            const blob = await toBlob();
            const a = h("a", { href: URL.createObjectURL(blob), download: `reference-board-${Date.now()}.png` });
            document.body.append(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
          } }, cicon("download", "green", 16), "下载 PNG"),
          h("button.btn", { type: "button", onclick: async () => {
            try {
              await navigator.clipboard.write([new ClipboardItem({ "image/png": await toBlob() })]);
              toast("参考板已复制", { type: "success" });
            } catch { toast("当前浏览器不支持复制图片，请下载 PNG", { type: "error" }); }
          } }, cicon("photos", "blue", 16), "复制图片"),
          h("button.btn", { type: "button", onclick: () => copyText(promptText) }, cicon("copy", "indigo", 16), "复制提示词"))))
  });
  redraw();
  return m;
}

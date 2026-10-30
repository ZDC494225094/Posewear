import { h, cicon } from "../core/dom.js";
import { modal, toast, copyText } from "../core/ui.js";

// Reference board export, carried over from the original ai-reference-gallery
// compositor: pose, outfit and optional person side by side on one canvas,
// proportions kept, no cropping. Free, runs entirely in the browser, for
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

export function boardPrompt({ pose, outfit, person }) {
  const pos = person ? ["左侧", "中间", "右侧"] : ["左侧", "右侧"];
  const poseId = pose?.id || "姿势参考";
  const outfitId = outfit?.id || "服装参考";
  if (person) {
    return `请根据这张三图参考板生成一张完整的人物作品，每张图片的用途不同：\n\n` +
      `1. 姿势参考：画面${pos[0]}（${poseId}），参考身体姿态、动作和四肢位置。\n` +
      `2. 服装参考：画面${pos[1]}（${outfitId}），参考款式、配色、材质和配饰。\n` +
      `3. 人物参考：画面${pos[2]}，尽量保持照片中人物可辨认的面部特征与发型，不照搬原照片的服装和姿势。\n` +
      `4. 将三项参考自然融合为一张新作品，人物比例协调、细节清晰，不要输出参考板拼贴。`;
  }
  return `请根据我提供的组合参考图创作一幅完整、自然的人物画面。\n\n` +
    `1. 姿势参考：画面${pos[0]}（${poseId}）。遵循人物的姿态、动作方向、手脚位置及互动关系。\n` +
    `2. 服装参考：画面${pos[1]}（${outfitId}）。保留衣服的廓形、配色、材质与重要配饰。\n` +
    `3. 如另外提供了主角脸部参考图，请以该图片为准保持面部特征一致。\n` +
    `4. 将服装与动作自然结合，画面比例协调、细节清晰，不要把两张参考图简单拼接作为成品。`;
}

export function openBoardDialog({ pose, outfit, outfitUpload, person }) {
  const entries = [];
  if (pose) entries.push({ src: pose.preview, code: pose.id });
  if (outfit) entries.push({ src: outfit.preview, code: outfit.id });
  else if (outfitUpload) entries.push({ src: outfitUpload.url, code: "" });
  if (person) entries.push({ src: person.url, code: "" });
  const options = { background: "white", labels: true };
  const canvas = h("canvas.board-canvas", { "aria-label": "参考板预览" });
  const status = h("p.small.muted", { "aria-live": "polite" }, "正在排版…");
  const promptText = boardPrompt({ pose, outfit: outfit || (outfitUpload ? { id: "上传的服装" } : null), person });
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
        h("p.muted.small", "把姿势、服装和人物照片拼成一张参考图，附带提示词，可以拿到其他支持图片参考的 AI 工具使用。导出不消耗点数。"),
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

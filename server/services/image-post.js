import sharp from "sharp";
import * as settings from "./settings.js";
import { addPngText } from "../lib/png-text.js";

const escapeXml = (s) => String(s).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;", "'": "&apos;" })[c]);
const FONT_STACK = "'Microsoft YaHei','PingFang SC','Noto Sans CJK SC','Source Han Sans SC','WenQuanYi Micro Hei',sans-serif";

// Visible "AI生成" label (explicit AIGC marking): a translucent pill in a corner,
// sized relative to the image so it stays legible on 4K output.
export function watermarkSvg(width, height, { text, position, opacity }) {
  const fontSize = Math.max(14, Math.round(Math.min(width, height) * 0.026));
  const padX = Math.round(fontSize * 0.7);
  const padY = Math.round(fontSize * 0.42);
  // Rough width estimate: CJK glyphs ~1em, Latin ~0.6em.
  const textWidth = [...text].reduce((w, ch) => w + (/[⺀-￿]/.test(ch) ? fontSize : fontSize * 0.62), 0);
  const boxW = Math.round(textWidth + padX * 2);
  const boxH = Math.round(fontSize + padY * 2);
  const margin = Math.round(Math.min(width, height) * 0.025);
  const x = position.endsWith("left") ? margin : width - margin - boxW;
  const y = position.startsWith("top") ? margin : height - margin - boxH;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <g opacity="${opacity}">
      <rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" rx="${Math.round(boxH / 2)}" fill="#0d1f19" fill-opacity="0.55"/>
      <text x="${x + boxW / 2}" y="${y + boxH / 2}" dominant-baseline="central" text-anchor="middle"
        font-family="${FONT_STACK}" font-size="${fontSize}" font-weight="600" fill="#ffffff">${escapeXml(text)}</text>
    </g>
  </svg>`);
}

// Implicit AIGC label (metadata), following the field layout of
// GB 45438-2025 《人工智能生成合成内容标识方法》.
export function aigcLabel({ imageId, generationId }) {
  const site = settings.get("site").name;
  return JSON.stringify({
    Label: "1",
    ContentProducer: site,
    ProduceID: generationId,
    ReservedCode1: "",
    ContentPropagator: site,
    PropagateID: imageId,
    ReservedCode2: ""
  });
}

function xmpPacket(label) {
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:AIGC="http://www.tc260.org.cn/ns/AIGC/1.0/"><AIGC:AIGC>${escapeXml(label)}</AIGC:AIGC></rdf:Description>
</rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
}

// Apply watermark + metadata, encode in the configured format, make a thumbnail.
export async function finalizeImage(buffer, { imageId, generationId }) {
  const gen = settings.get("generation");
  const safety = settings.get("safety");
  const base = sharp(buffer, { limitInputPixels: 80_000_000 });
  const meta = await base.metadata();
  let pipeline = base;
  if (safety.watermark.enabled) {
    pipeline = pipeline.composite([{ input: watermarkSvg(meta.width, meta.height, safety.watermark), left: 0, top: 0 }]);
  }
  const label = safety.aigcMetadata ? aigcLabel({ imageId, generationId }) : null;
  let out;
  const format = gen.outputFormat;
  if (format === "jpeg") {
    pipeline = pipeline.flatten({ background: "#ffffff" }).jpeg({ quality: gen.outputCompression, mozjpeg: true });
    if (label) pipeline = pipeline.withXmp(xmpPacket(label));
    out = await pipeline.toBuffer();
  } else if (format === "webp") {
    pipeline = pipeline.webp({ quality: gen.outputCompression });
    if (label) pipeline = pipeline.withXmp(xmpPacket(label));
    out = await pipeline.toBuffer();
  } else {
    out = await pipeline.png({ compressionLevel: 6 }).toBuffer();
    if (label) out = addPngText(out, "AIGC", label);
  }
  const thumb = await sharp(out).resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 }).toBuffer();
  return { buffer: out, thumb, width: meta.width, height: meta.height, format: format === "jpeg" ? "jpg" : format };
}

// Admin preview of the watermark, to confirm the server has a CJK font.
export async function watermarkPreview() {
  const safety = settings.get("safety");
  const width = 720, height = 405;
  const svg = watermarkSvg(width, height, { ...safety.watermark, opacity: Math.max(0.6, safety.watermark.opacity) });
  return sharp({ create: { width, height, channels: 3, background: { r: 196, g: 210, b: 202 } } })
    .composite([{ input: svg, left: 0, top: 0 }]).png().toBuffer();
}

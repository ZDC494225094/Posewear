import sharp from "sharp";
import { ProviderError, PUBLIC_MESSAGES } from "./errors.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const escapeXml = (s) => String(s).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;", "'": "&apos;" })[c]);

// A stand-in for the real model, for demos and for testing billing, refunds
// and the job queue without spending API credit. It lays the reference images
// out on a canvas of the requested size and labels the result as a mock.
// Put "[mock:block]" or "[mock:fail]" in the prompt to simulate failures.
export async function run(channel, request) {
  await sleep(channel.options.mockDelayMs);
  if (/\[mock:block\]/i.test(request.prompt)) {
    throw new ProviderError("user", "Your request was rejected by the safety system. (mock)",
      { status: 400, code: "moderation_blocked", publicMessage: PUBLIC_MESSAGES.moderation });
  }
  if (/\[mock:fail\]/i.test(request.prompt)) {
    throw new ProviderError("transient", "Mock upstream returned 503", { status: 503, code: "HTTP_503", publicMessage: PUBLIC_MESSAGES.busy });
  }
  const m = /^(\d+)x(\d+)$/.exec(request.size || "");
  const width = m ? Number(m[1]) : 1024;
  const height = m ? Number(m[2]) : 1536;
  const palette = [[236, 236, 240], [228, 228, 233], [242, 242, 245], [232, 232, 237]];
  const images = [];
  for (let i = 0; i < request.n; i++) {
    const [r, g, b] = palette[i % palette.length];
    const composites = [];
    const refs = request.images.slice(0, 3);
    if (refs.length) {
      const gap = Math.round(width * 0.03);
      const cellW = Math.floor((width - gap * (refs.length + 1)) / refs.length);
      const cellH = Math.floor(height * 0.62);
      for (let k = 0; k < refs.length; k++) {
        const tile = await sharp(refs[k].buffer)
          .resize({ width: cellW, height: cellH, fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
          .png().toBuffer();
        composites.push({ input: tile, left: gap + k * (cellW + gap), top: Math.round(height * 0.12) });
      }
    }
    const fontSize = Math.round(width * 0.045);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <text x="50%" y="${Math.round(height * 0.84)}" text-anchor="middle" font-family="sans-serif" font-weight="700"
        font-size="${fontSize}" fill="#1d1d1f">MOCK ${i + 1}/${request.n}</text>
      <text x="50%" y="${Math.round(height * 0.84) + fontSize * 1.4}" text-anchor="middle" font-family="sans-serif"
        font-size="${Math.round(fontSize * 0.5)}" fill="#6e6e73">${escapeXml(`${request.quality} · ${width}×${height} · ${refs.length} refs`)}</text>
    </svg>`;
    composites.push({ input: Buffer.from(svg), left: 0, top: 0 });
    const png = await sharp({ create: { width, height, channels: 3, background: { r, g, b } } })
      .composite(composites).png().toBuffer();
    images.push(png);
  }
  const imageTokens = request.images.length * 765;
  return {
    images,
    usage: {
      input_tokens: 180 + imageTokens,
      input_tokens_details: { text_tokens: 180, image_tokens: imageTokens },
      output_tokens: Math.round((width * height) / 400) * request.n,
      total_tokens: 180 + imageTokens + Math.round((width * height) / 400) * request.n
    },
    size: `${width}x${height}`,
    revisedPrompt: ""
  };
}

export async function ping() {
  return { ok: true, ms: 0, message: "模拟渠道无需连接，可直接用于演示和测试" };
}

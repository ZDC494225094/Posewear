// What PoseWear knows about image models by their ID: which API they speak,
// the largest 清晰度 they draw, how they take sizes, and their official price.
// The channel editor fills a channel's settings from this when a model is
// picked, and "按官方价" costs use it. Relays rename models
// ("nano-banana-pro", "gemini-3-pro-image-preview"), so an ID matches the first
// profile with one of its patterns in it; the order below is most specific
// first. An unknown model is costed like gpt-image-2.
//
// Prices are USD (OpenAI and Google pricing pages, November 2026). Token
// prices are per 1M tokens. Google prices Nano Banana by output size; 1K is
// the 标准 tier, 2K the 2K tier and 4K the 4K tier. Nano Banana has no 画质
// parameter: all three 画质 draw the same image at the same price.

export const QUALITIES = ["low", "medium", "high"];

const gpt = (id, label, match, extra) => ({ id, kind: "openai", label, match, qualities: QUALITIES, ...extra });
const banana = (id, label, match, maxTier, perImage, note) => ({
  id, kind: "gemini", label, match, maxTier, qualities: QUALITIES, quality: false,
  price: { unit: "image", ...perImage }, note
});

const GPT2_PRICE = { unit: "token", textInput: 5, imageInput: 8, imageOutput: 30, textOutput: 0 };

export const MODEL_PROFILES = [
  gpt("gpt-image-2.5-sunburst", "gpt-image-2.5-sunburst", ["gpt-image-2.5-sunburst"],
    { sizeMode: "flexible", inputFidelity: "omit", maxTier: "uhd", price: GPT2_PRICE, note: "画质比 gpt-image-2 更好" }),
  gpt("gpt-image-2.5-flare", "gpt-image-2.5-flare", ["gpt-image-2.5-flare"],
    { sizeMode: "flexible", inputFidelity: "omit", maxTier: "uhd", price: GPT2_PRICE, note: "更快，画质接近 gpt-image-2" }),
  gpt("gpt-image-2.5", "gpt-image-2.5", ["gpt-image-2.5"],
    { sizeMode: "flexible", inputFidelity: "omit", maxTier: "uhd", price: GPT2_PRICE, hidden: true }),
  gpt("gpt-image-2", "gpt-image-2", ["gpt-image-2"],
    { sizeMode: "flexible", inputFidelity: "omit", maxTier: "uhd", price: GPT2_PRICE, note: "推荐" }),
  gpt("gpt-image-1.5", "gpt-image-1.5", ["gpt-image-1.5", "chatgpt-image"],
    { sizeMode: "fixed", inputFidelity: "high", maxTier: "standard",
      price: { unit: "token", textInput: 5, imageInput: 8, imageOutput: 32, textOutput: 10 }, note: "只有三种固定尺寸" }),
  gpt("gpt-image-1-mini", "gpt-image-1-mini", ["gpt-image-1-mini"],
    { sizeMode: "fixed", inputFidelity: "low", maxTier: "standard",
      price: { unit: "token", textInput: 2, imageInput: 2.5, imageOutput: 8, textOutput: 0 }, note: "便宜，只有三种固定尺寸" }),
  gpt("gpt-image-1", "gpt-image-1", ["gpt-image-1"],
    { sizeMode: "fixed", inputFidelity: "high", maxTier: "standard",
      price: { unit: "token", textInput: 5, imageInput: 10, imageOutput: 40, textOutput: 0 }, hidden: true }),
  banana("gemini-3-pro-image", "Nano Banana Pro", ["gemini-3-pro-image", "banana-pro"], "uhd",
    { standard: 0.134, hd: 0.134, uhd: 0.24 }, "画质最好，最贵"),
  banana("gemini-nano-banana-2.1", "Nano Banana 2.1", ["nano-banana-2.1", "banana-2.1"], "uhd",
    { standard: 0.0336, hd: 0.0504, uhd: 0.113 }, "最新的 Flash 版"),
  banana("gemini-3.1-flash-lite-image", "Nano Banana 2 Lite", ["flash-lite-image", "banana-2-lite", "banana-lite"], "standard",
    { standard: 0.0336, hd: 0.0336, uhd: 0.0336 }, "只出 1K，不擅长多张参考图"),
  banana("gemini-3.1-flash-image", "Nano Banana 2", ["gemini-3.1-flash-image", "nano-banana-2", "banana-2"], "uhd",
    { standard: 0.067, hd: 0.101, uhd: 0.151 }, "速度快，2K / 4K"),
  banana("gemini-2.5-flash-image", "Nano Banana", ["gemini-2.5-flash-image", "nano-banana"], "standard",
    { standard: 0.039, hd: 0.039, uhd: 0.039 }, "旧版，只出 1K，2027 年 3 月停用")
];

export function profileFor(model) {
  const id = String(model || "").toLowerCase();
  if (!id) return null;
  return MODEL_PROFILES.find((p) => p.id === id) || MODEL_PROFILES.find((p) => p.match.some((m) => id.includes(m))) || null;
}

// Model IDs that are probably image models, for sorting a relay's long list.
export const IMAGE_MODEL_HINT = /image|dall-e|banana|imagen|flux|seedream|seededit|kolors|recraft|ideogram|midjourney|stable-diffusion|sdxl|qwen-image|hidream|jimeng|cogview|wanx/i;

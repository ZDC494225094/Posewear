import * as settings from "./settings.js";
import { badRequest } from "../lib/errors.js";
import { dims } from "./sizes.js";

export function unitCost(quality, tier) {
  const gen = settings.get("generation");
  const q = gen.qualities.find((x) => x.id === quality && x.enabled);
  const t = gen.tiers.find((x) => x.id === tier && x.enabled);
  if (!q) throw badRequest("INVALID_QUALITY", "所选画质不可用");
  if (!t) throw badRequest("INVALID_TIER", "所选清晰度不可用");
  return Math.ceil(q.credits * t.multiplier);
}

export function creditCost({ quality, tier, n }) {
  return unitCost(quality, tier) * n;
}

// Output tokens of one gpt-image-2 image. OpenAI lists per-image prices only
// for the 1024 sizes and offers a calculator for the rest; this formula, worked
// out from that calculator, gives the same numbers: 1024×1024 medium 1,756
// tokens ($0.053), 1024×1536 medium 1,372 ($0.041), 3840×2160 high 13,342
// ($0.40). Cost follows the short side's share of a grid more than the pixel
// count, so 2K costs about 1.5× and 4K about 3× a standard image, not 2–5×.
const QUALITY_GRID = { low: 16, medium: 48, high: 96 };

export function outputTokens(width, height, quality) {
  const q = QUALITY_GRID[quality] ?? QUALITY_GRID.medium;
  const long = Math.max(width, height), short = Math.min(width, height);
  const band = Math.floor((2 * q * short + long) / (2 * long));
  return Math.ceil((q * band * (width * height + 2_000_000)) / 4_000_000);
}

// USD for the output of one image at a size, at the configured token price.
export function outputCostUsd(size, quality) {
  const d = dims(size);
  return d ? (outputTokens(d[0], d[1], quality) * settings.get("generation").tokenPriceUsd.imageOutput) / 1e6 : 0;
}

// Provider cost in USD for the dashboard's margin numbers. Uses token usage
// when the API returns it. Otherwise (many relays return none) the output is
// estimated: by the gpt-image-2 formula above, which gpt-image-2.5 shares the
// token prices with, or for gpt-image-1.x by its 1024×1024 price scaled by area.
// Reference images are not in the estimate.
export function apiCostUsd({ usage, quality, size, n, model = "" }) {
  const gen = settings.get("generation");
  if (usage && (usage.input_tokens || usage.output_tokens)) {
    const p = gen.tokenPriceUsd;
    const textIn = usage.input_tokens_details?.text_tokens ?? 0;
    const imageIn = usage.input_tokens_details?.image_tokens ?? Math.max(0, (usage.input_tokens || 0) - textIn);
    const out = usage.output_tokens || 0;
    return (textIn * p.textInput + imageIn * p.imageInput + out * p.imageOutput) / 1e6;
  }
  const d = dims(size);
  if (d && !/^gpt-image-1/.test(model)) return outputCostUsd(size, quality) * n;
  const scale = d ? (d[0] * d[1]) / (1024 * 1024) : 1;
  const base = gen.fallbackCostUsd[quality] ?? gen.fallbackCostUsd.medium;
  return base * scale * n;
}

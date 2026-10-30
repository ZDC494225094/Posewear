import * as settings from "./settings.js";
import { badRequest } from "../lib/errors.js";

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

// Provider cost in USD for the dashboard's margin numbers. Uses token usage
// when the API returns it, otherwise the per-image estimate scaled by area.
export function apiCostUsd({ usage, quality, size, n }) {
  const gen = settings.get("generation");
  if (usage && (usage.input_tokens || usage.output_tokens)) {
    const p = gen.tokenPriceUsd;
    const textIn = usage.input_tokens_details?.text_tokens ?? 0;
    const imageIn = usage.input_tokens_details?.image_tokens ?? Math.max(0, (usage.input_tokens || 0) - textIn);
    const out = usage.output_tokens || 0;
    return (textIn * p.textInput + imageIn * p.imageInput + out * p.imageOutput) / 1e6;
  }
  const m = /^(\d+)x(\d+)$/.exec(size || "");
  const scale = m ? (Number(m[1]) * Number(m[2])) / (1024 * 1024) : 1;
  const base = gen.fallbackCostUsd[quality] ?? gen.fallbackCostUsd.medium;
  return base * scale * n;
}

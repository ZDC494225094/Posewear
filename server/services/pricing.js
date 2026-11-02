import * as settings from "./settings.js";
import { badRequest } from "../lib/errors.js";
import { dims, outputTokens, tierOfPixels } from "./sizes.js";
import { profileFor } from "./models.js";

export { outputTokens };

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


// USD for the output of one image at a size, at the configured token price.
export function outputCostUsd(size, quality) {
  const d = dims(size);
  return d ? (outputTokens(d[0], d[1], quality) * settings.get("generation").tokenPriceUsd.imageOutput) / 1e6 : 0;
}

// A channel's prices in USD. "按官方价" (auto) is the model's official price:
// gpt-image-2 and 2.5, and models PoseWear doesn't know, at the token prices
// set in 生成与计费; the other GPT models at their own; Nano Banana per image
// by size. "token" and "image" are what the admin pays the relay, in USD or yuan.
export function channelPricing(channel) {
  const gen = settings.get("generation");
  const p = channel?.options?.pricing;
  if (p && p.mode !== "auto") {
    const k = p.currency === "cny" ? 1 / gen.usdToCny : 1;
    return p.mode === "image"
      ? { unit: "image", standard: p.standard * k, hd: p.hd * k, uhd: p.uhd * k }
      : { unit: "token", textInput: p.textInput * k, imageInput: p.imageInput * k, imageOutput: p.imageOutput * k, textOutput: p.textOutput * k };
  }
  const profile = profileFor(channel?.model);
  if (profile && !/^gpt-image-2/.test(profile.id)) return profile.price;
  return { unit: "token", ...gen.tokenPriceUsd, textOutput: 0 };
}

// Provider cost in USD of `n` images of `size` (what came back), for the
// dashboard's margin numbers. A per-image price goes by the size's 清晰度.
// Token prices apply to the usage the API returns; many relays return none,
// and then the output is estimated: by the gpt-image-2 formula above, which
// gpt-image-2.5 draws with too, or for gpt-image-1.x by its 1024×1024 price
// scaled by area. Reference images are not in the estimate.
export function apiCostUsd({ usage, quality, size, n, model = "", channel = null }) {
  const gen = settings.get("generation");
  const p = channelPricing(channel || { model });
  const d = dims(size);
  if (p.unit === "image") return (p[d ? tierOfPixels(d[0] * d[1]) : "standard"] ?? 0) * n;
  if (usage && (usage.input_tokens || usage.output_tokens)) {
    const textIn = usage.input_tokens_details?.text_tokens ?? 0;
    const imageIn = usage.input_tokens_details?.image_tokens ?? Math.max(0, (usage.input_tokens || 0) - textIn);
    const out = usage.output_tokens || 0;
    const textOut = usage.output_tokens_details?.text_tokens ?? 0;
    const imageOut = usage.output_tokens_details?.image_tokens ?? Math.max(0, out - textOut);
    return (textIn * p.textInput + imageIn * p.imageInput + imageOut * p.imageOutput + textOut * (p.textOutput || 0)) / 1e6;
  }
  const id = profileFor(channel?.model ?? model)?.id || channel?.model || model;
  if (d && !/^gpt-image-1/.test(id)) return ((outputTokens(d[0], d[1], quality) * p.imageOutput) / 1e6) * n;
  const scale = d ? (d[0] * d[1]) / (1024 * 1024) : 1;
  const base = gen.fallbackCostUsd[quality] ?? gen.fallbackCostUsd.medium;
  return base * scale * n;
}

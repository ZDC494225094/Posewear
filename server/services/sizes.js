// Output sizes per aspect ratio and resolution tier. gpt-image-2 and
// gpt-image-2.5 (Sunburst, Flare) take any WIDTHxHEIGHT within the same rules:
// both sides multiples of 16, aspect ratio within 1:3–3:1, longest edge ≤ 3840,
// total pixels 655,360–8,294,400 (= 3840×2160). OpenAI calls outputs above
// 3,686,400 pixels (2560×1440) experimental. "hd" (2K) is the largest size of
// each ratio at or under that line; "uhd" (4K) is near the cap, so experimental.
export const SIZE_TABLE = {
  "1:1": { standard: [1024, 1024], hd: [1920, 1920], uhd: [2880, 2880] },
  "2:3": { standard: [1024, 1536], hd: [1536, 2304], uhd: [2336, 3504] },
  "3:2": { standard: [1536, 1024], hd: [2304, 1536], uhd: [3504, 2336] },
  "3:4": { standard: [1152, 1536], hd: [1536, 2048], uhd: [2448, 3264] },
  "4:3": { standard: [1536, 1152], hd: [2048, 1536], uhd: [3264, 2448] },
  "9:16": { standard: [864, 1536], hd: [1440, 2560], uhd: [2160, 3840] },
  "16:9": { standard: [1536, 864], hd: [2560, 1440], uhd: [3840, 2160] }
};

export const EXPERIMENTAL_PIXELS = 2560 * 1440;

export const TIERS = ["standard", "hd", "uhd"];
export const TIER_RANK = { standard: 0, hd: 1, uhd: 2 };

// The tier a job asking for `tier` really got: what its pixels pass for at its
// ratio, and in any case below the tier it fell short of.
export function deliveredTier(pixels, ratio, tier) {
  const reached = tierOfPixels(pixels, ratio);
  return TIER_RANK[reached] < TIER_RANK[tier] ? reached : TIERS[Math.max(0, TIER_RANK[tier] - 1)];
}

// The highest tier an image of this many pixels passes for: at least 80% of
// that tier's size for the ratio (or, without a ratio, of its smallest size).
export function tierOfPixels(pixels, ratio) {
  const table = SIZE_TABLE[ratio];
  const need = (tier) => (table ? table[tier][0] * table[tier][1]
    : Math.min(...Object.values(SIZE_TABLE).map((s) => s[tier][0] * s[tier][1])));
  return ["uhd", "hd"].find((tier) => pixels >= need(tier) * 0.8) || "standard";
}

export function dims(size) {
  const m = /^(\d+)x(\d+)$/.exec(size || "");
  return m ? [Number(m[1]), Number(m[2])] : null;
}

export const isExperimental = (size) => { const d = dims(size); return !!d && d[0] * d[1] > EXPERIMENTAL_PIXELS; };

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

export function flexibleSize(ratio, tier) {
  const [w, h] = SIZE_TABLE[ratio]?.[tier] || SIZE_TABLE["1:1"].standard;
  return `${w}x${h}`;
}

// Channels running older GPT Image models only accept three fixed sizes.
export function sizeForChannel(ratio, tier, sizeMode) {
  if (sizeMode === "auto") return "auto";
  if (sizeMode === "fixed") {
    const [w, h] = SIZE_TABLE[ratio]?.standard || [1024, 1024];
    return w === h ? "1024x1024" : w > h ? "1536x1024" : "1024x1536";
  }
  return flexibleSize(ratio, tier);
}

export function validSize(size) {
  const m = /^(\d+)x(\d+)$/.exec(size);
  if (!m) return false;
  const w = Number(m[1]), h = Number(m[2]);
  const px = w * h;
  return w % 16 === 0 && h % 16 === 0 && Math.max(w, h) <= 3840 && px >= 655_360 && px <= 8_294_400 &&
    Math.max(w / h, h / w) <= 3;
}

// 超分 (redrawing a finished image larger): 2K is the "hd" pixel budget, 4K the
// "uhd" one, and the output keeps the source image's own aspect ratio. A source
// in one of the standard ratios gets that ratio's size from the table. null
// when the result wouldn't be clearly larger than the source.
const UPSCALE_PIXELS = { hd: 2560 * 1440, uhd: 3840 * 2160 };

export function upscaleSize(width, height, target) {
  if (!UPSCALE_PIXELS[target] || !(width > 0 && height > 0)) return null;
  const aspect = width / height;
  const listed = Object.values(SIZE_TABLE).map((sizes) => sizes[target]).find(([w, h]) => Math.abs(w / h - aspect) / aspect < 0.01);
  let w, h;
  if (listed) [w, h] = listed;
  else {
    const scale = Math.min(3840 / Math.max(width, height), Math.sqrt(UPSCALE_PIXELS[target] / (width * height)));
    w = Math.floor((width * scale) / 16) * 16;
    h = Math.floor((height * scale) / 16) * 16;
  }
  if (w * h < width * height * 1.2 || !validSize(`${w}x${h}`)) return null;
  return `${w}x${h}`;
}

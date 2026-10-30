// Output sizes per aspect ratio and resolution tier. Every value satisfies
// gpt-image-2's custom-size rules: both sides multiples of 16, aspect ratio
// within 1:3–3:1, longest edge ≤ 3840, total pixels 655,360–8,294,400.
// "hd" stays within 2560×1440 worth of pixels; "uhd" is the experimental range.
export const SIZE_TABLE = {
  "1:1": { standard: [1024, 1024], hd: [1920, 1920], uhd: [2880, 2880] },
  "2:3": { standard: [1024, 1536], hd: [1536, 2304], uhd: [2336, 3504] },
  "3:2": { standard: [1536, 1024], hd: [2304, 1536], uhd: [3504, 2336] },
  "3:4": { standard: [1152, 1536], hd: [1536, 2048], uhd: [2448, 3264] },
  "4:3": { standard: [1536, 1152], hd: [2048, 1536], uhd: [3264, 2448] },
  "9:16": { standard: [864, 1536], hd: [1440, 2560], uhd: [2160, 3840] },
  "16:9": { standard: [1536, 864], hd: [2560, 1440], uhd: [3840, 2160] }
};

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

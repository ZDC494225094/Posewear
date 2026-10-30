import { db } from "../db.js";
import { encryptSecret, decryptSecret, maskSecret } from "../lib/crypto.js";
import { badRequest } from "../lib/errors.js";
import { DEFAULT_LEGAL } from "./legal-defaults.js";

// Every operator-configurable value, grouped as the admin pages present them.
// Stored per group as JSON overrides on top of these defaults.
export const DEFAULTS = {
  site: {
    name: "姿衣 PoseWear",
    tagline: "挑一个姿势，选一套衣服，AI 帮你拍出来。",
    description: "从姿势库和服装库里各挑一张参考图，可选上传人物照片，AI 会把它们合成一张完整的人物成片。",
    keywords: "AI写真,AI换装,姿势参考,服装参考,AI绘图",
    announcement: "",
    announcementLevel: "info",
    supportContact: "",
    icp: "",
    publicSecurityRecord: "",
    publicBaseUrl: "",
    footerNote: ""
  },
  auth: {
    registrationOpen: true,
    inviteRequired: false,
    requireEmailVerification: false,
    signupBonus: 20,
    inviteReward: 10,
    inviteeBonus: 5,
    checkinCredits: 2,
    maxRegistrationsPerIpPerDay: 5,
    sessionDays: 30
  },
  generation: {
    enabled: true,
    maintenanceMessage: "生成服务维护中，请稍后再试。",
    allowTextOnly: true,
    allowOutfitUpload: true,
    allowPersonPhoto: true,
    qualities: [
      { id: "low", label: "草稿", credits: 2, enabled: true },
      { id: "medium", label: "标准", credits: 6, enabled: true },
      { id: "high", label: "精细", credits: 18, enabled: true }
    ],
    tiers: [
      { id: "standard", label: "标准", multiplier: 1, enabled: true },
      { id: "hd", label: "2K 高清", multiplier: 1.6, enabled: true },
      { id: "uhd", label: "4K 超清（实验）", multiplier: 2.8, enabled: false }
    ],
    ratios: ["2:3", "3:4", "1:1", "4:3", "3:2", "9:16", "16:9"],
    defaultRatio: "2:3",
    defaultQuality: "medium",
    defaultTier: "standard",
    maxN: 4,
    outputFormat: "png",
    outputCompression: 92,
    moderation: "auto",
    inputMaxEdge: 1536,
    workerConcurrency: 2,
    maxAttempts: 3,
    requestTimeoutSec: 240,
    maxActivePerUser: 3,
    dailyLimitPerUser: 100,
    styles: [
      { id: "photo", label: "写实摄影", prompt: "photorealistic fashion photography, natural skin texture, soft studio lighting, 85mm lens" },
      { id: "editorial", label: "时尚大片", prompt: "high-end fashion magazine editorial, dramatic lighting, polished retouching" },
      { id: "street", label: "街拍", prompt: "candid street-style photography, natural daylight, shallow depth of field" },
      { id: "anime", label: "日系动漫", prompt: "clean anime illustration, crisp line art, cel shading, vivid colours" },
      { id: "3d", label: "3D 角色", prompt: "stylised 3D character render, soft global illumination, high detail" },
      { id: "watercolor", label: "水彩插画", prompt: "delicate watercolour fashion illustration, visible paper texture" }
    ],
    scenes: [
      { id: "studio", label: "纯色影棚", prompt: "seamless light grey studio backdrop" },
      { id: "city", label: "城市街道", prompt: "a lively city street with soft bokeh" },
      { id: "cafe", label: "咖啡馆", prompt: "a cosy cafe interior with warm window light" },
      { id: "beach", label: "海边", prompt: "a sunny beach with gentle waves" },
      { id: "garden", label: "花园", prompt: "a blooming garden in spring" },
      { id: "home", label: "居家", prompt: "a bright, minimal living room" }
    ],
    tokenPriceUsd: { textInput: 5, imageInput: 8, imageOutput: 30 },
    fallbackCostUsd: { low: 0.006, medium: 0.053, high: 0.211 },
    usdToCny: 7.2
  },
  prompt: {
    intro: "Create one finished, coherent image from the reference images described below.",
    textOnlyIntro: "Create one finished, coherent image.",
    pose: "Image {n} is the POSE reference: a neutral line-art mannequin. Match its body pose, limb positions, head direction, camera angle and framing. Do not copy the line-art style or the mannequin's body proportions.",
    poseDuo: "Image {n} is the POSE reference for two people: neutral line-art mannequins. Match both figures' poses, their positions relative to each other, the camera angle and framing. Do not copy the line-art style.",
    outfit: "Image {n} is the OUTFIT reference: dress the subject in exactly this outfit, keeping its silhouette, colours, fabrics, patterns and accessories. Ignore how the outfit is displayed in the reference.",
    person: "Image {n} is the PERSON reference: keep this person's facial features, skin tone and hairstyle recognisable. Do not copy their clothing, pose or background.",
    personSafety: "Depict the person as an adult, fully clothed in the outfit, in a natural and non-sexualised way.",
    style: "Visual style: {value}.",
    scene: "Setting and background: {value}.",
    user: "Additional instructions from the user: {value}",
    outro: "Output a single finished image, not a collage, comparison sheet or reference board. Do not add text, captions, labels, frames or watermarks."
  },
  safety: {
    suggestiveForAI: true,
    showSuggestive: true,
    showExplicit: false,
    personRetentionDays: 7,
    outfitRetentionDays: 30,
    bannedWords: [
      "裸体", "全裸", "裸露", "露点", "脱光", "色情", "性爱", "做爱", "未成年", "幼女", "萝莉", "儿童",
      "nude", "naked", "nsfw", "porn", "sex", "loli", "underage", "child"
    ],
    watermark: { enabled: true, text: "AI生成", position: "bottom-right", opacity: 0.72 },
    aigcMetadata: true,
    showcaseEnabled: true,
    showcaseReview: false
  },
  library: {
    originalDownload: "login"
  },
  // Asset generation (platform and user), sharing and revenue split. The
  // templates follow the existing asset specs: line-art mannequins for poses,
  // ghost-mannequin product renders for outfits.
  assets: {
    userGeneration: true,
    quality: "medium",
    tier: "standard",
    poseCredits: 6,
    outfitCredits: 6,
    maxPerJob: 4,
    dailyLimitPerUser: 20,
    publicReview: true,
    maxPrice: 50,
    rebatePercent: 70,
    commercialOnly: false,
    posePrompt: [
      "A clean pose-reference drawing: black line art of one female artist's mannequin on a pure white background.",
      "The mannequin has a smooth egg-shaped head with one vertical and one horizontal guide line showing where the face points, no facial features and no hair, ball joints at the shoulders, elbows, wrists, hips, knees and ankles, simple anatomical body contours with a few light construction lines, and detailed hands and feet.",
      "Thin, even black outlines only: no shading, no colour, no clothing, no floor, no shadow, no text. The whole body is visible with a small margin, centred in a portrait frame.",
      "Pose category: {category}.",
      "Category guidance: {hint}.",
      "Pose: {description}.",
      "Camera: {angle}."
    ].join("\n"),
    poseRefPrompt: [
      "Image 1 shows a person or figure in a pose. Redraw only that body pose as a clean pose-reference drawing: black line art of one female artist's mannequin on a pure white background.",
      "The mannequin has a smooth egg-shaped head with one vertical and one horizontal guide line showing where the face points, no facial features and no hair, ball joints at the shoulders, elbows, wrists, hips, knees and ankles, simple anatomical body contours, and detailed hands and feet.",
      "Match the pose, limb positions, head direction and camera angle of image 1. Ignore its clothing, face, hair, body shape, props and background.",
      "Thin, even black outlines only: no shading, no colour, no clothing, no floor, no shadow, no text. The whole body is visible with a small margin, centred in a portrait frame.",
      "Pose category: {category}.",
      "Notes: {description}."
    ].join("\n"),
    poseAnglePrompt: [
      "Image 1 is a pose-reference drawing of an artist's mannequin. Draw the same mannequin holding exactly the same pose, seen from a different camera angle: {angle}.",
      "Keep the same drawing style: black line art on a pure white background, egg-shaped head with guide lines, ball joints, no shading, no colour, no floor, no text. The whole body is visible with a small margin, centred in a portrait frame."
    ].join("\n"),
    outfitPrompt: [
      "A product render of one complete women's outfit on an invisible mannequin (ghost mannequin style): the garments keep the 3D shape of a slim adult body, but no person, skin, face or hands are visible.",
      "Show the whole look from head to toe in front view, centred in a portrait frame: any hat or headwear floats above the collar, the shoes stand below the hem, and a bag or small accessory may hang beside the outfit.",
      "Photorealistic fabrics, stitching and details, soft even studio lighting, a seamless light grey gradient background, no props, no text, no logos.",
      "Outfit category: {category}.",
      "Typical pieces in this category: {hint}.",
      "Outfit details: {description}."
    ].join("\n"),
    outfitRefPrompt: [
      "Image 1 shows an outfit. Recreate the same outfit, keeping its garments, colours, fabrics, patterns and accessories, as a product render on an invisible mannequin (ghost mannequin style): the garments keep the 3D shape of a slim adult body, but no person, skin, face or hands are visible.",
      "Show the whole look from head to toe in front view, centred in a portrait frame, with any hat floating above the collar and the shoes below the hem. Ignore the person, pose and background of image 1.",
      "Photorealistic fabrics, soft even studio lighting, a seamless light grey gradient background, no props, no text, no logos.",
      "Outfit category: {category}.",
      "Notes: {description}."
    ].join("\n"),
    angles: {
      "正面": "front view, the figure faces the viewer, camera at chest height",
      "斜め": "three-quarter view, the figure turned about 45 degrees from the viewer, camera at chest height",
      "横": "side view, the figure seen in profile, camera at chest height",
      "上から": "high-angle view, looking down at the figure from above",
      "下から": "low-angle view, looking up at the figure from below"
    }
  },
  payment: {
    orderExpireMinutes: 30,
    mock: { enabled: false },
    alipay: { enabled: false, sandbox: false, mode: "page", appId: "", privateKey: "", alipayPublicKey: "" },
    wechat: { enabled: false, appId: "", mchId: "", serialNo: "", privateKey: "", apiV3Key: "", platformPublicKey: "", platformPublicKeyId: "" }
  },
  mail: {
    enabled: false, host: "", port: 465, secure: true, user: "", pass: "", from: ""
  },
  legal: DEFAULT_LEGAL
};

// Dotted paths whose values are encrypted at rest and never sent back in full.
const SECRET_PATHS = new Set([
  "payment.alipay.privateKey", "payment.wechat.privateKey", "payment.wechat.apiV3Key", "mail.pass"
]);

const isPlainObject = (v) => v && typeof v === "object" && !Array.isArray(v);

function deepMerge(base, patch) {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch === undefined ? base : patch;
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    out[key] = isPlainObject(value) && isPlainObject(base[key]) ? deepMerge(base[key], value) : value;
  }
  return out;
}

const clone = (v) => JSON.parse(JSON.stringify(v));
const cache = new Map();

function readStored(group) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(group);
  if (!row) return {};
  try { return JSON.parse(row.value); } catch { return {}; }
}

function walkSecrets(group, obj, fn, prefix = group) {
  if (!isPlainObject(obj)) return;
  for (const key of Object.keys(obj)) {
    const p = `${prefix}.${key}`;
    if (SECRET_PATHS.has(p)) obj[key] = fn(obj[key], p);
    else if (isPlainObject(obj[key])) walkSecrets(group, obj[key], fn, p);
  }
}

// Full settings for server-side use, with secrets decrypted.
export function get(group) {
  if (!(group in DEFAULTS)) throw new Error(`Unknown settings group: ${group}`);
  if (!cache.has(group)) {
    const merged = deepMerge(clone(DEFAULTS[group]), readStored(group));
    walkSecrets(group, merged, (value) => {
      if (value && typeof value === "object" && value.__enc) {
        try { return decryptSecret(value.__enc); } catch { return ""; }
      }
      return typeof value === "string" ? value : "";
    });
    cache.set(group, Object.freeze(sanitize(group, merged)));
  }
  return cache.get(group);
}

// Settings for the admin UI: secrets replaced by { __secret, set, hint }.
export function getForAdmin(group) {
  const value = clone(get(group));
  walkSecrets(group, value, (plain) => ({ __secret: true, set: !!plain, hint: maskSecret(plain) }));
  return value;
}

export function update(group, patch) {
  if (!(group in DEFAULTS)) throw badRequest("UNKNOWN_GROUP", "未知的设置分组");
  if (!isPlainObject(patch)) throw badRequest("INVALID_INPUT", "设置内容格式不正确");
  const current = clone(get(group));
  const incoming = clone(patch);
  // Secret fields: keep the existing value when the client echoes the mask
  // object back; an explicit empty string clears the secret.
  walkSecrets(group, incoming, (value, p) => {
    if (value && typeof value === "object" && value.__secret) {
      return p.split(".").slice(1).reduce((o, k) => o?.[k], current) || "";
    }
    return typeof value === "string" ? value.trim() : "";
  });
  const merged = sanitize(group, deepMerge(current, incoming));
  const stored = clone(merged);
  walkSecrets(group, stored, (plain) => (plain ? { __enc: encryptSecret(plain) } : ""));
  db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(group, JSON.stringify(stored), Date.now());
  cache.delete(group);
  return getForAdmin(group);
}

export function clearCache() {
  cache.clear();
}

// ---------- sanitizers: coerce types and clamp ranges so bad admin input can't break the app

const text = (v, fallback = "", max = 2000) => (typeof v === "string" ? v.slice(0, max) : fallback);
const flag = (v, fallback) => (typeof v === "boolean" ? v : fallback);
const intIn = (v, min, max, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const numIn = (v, min, max, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
const ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;

function presetList(list, fallback) {
  if (!Array.isArray(list)) return fallback;
  const seen = new Set();
  const out = [];
  for (const item of list.slice(0, 40)) {
    const id = text(item?.id).trim().toLowerCase();
    if (!ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: text(item.label, id, 24).trim() || id, prompt: text(item.prompt, "", 600).trim() });
  }
  return out;
}

const RATIOS = ["2:3", "3:4", "1:1", "4:3", "3:2", "9:16", "16:9"];

function sanitize(group, v) {
  const d = DEFAULTS[group];
  switch (group) {
    case "site":
      return {
        name: text(v.name, d.name, 40).trim() || d.name,
        tagline: text(v.tagline, d.tagline, 120),
        description: text(v.description, d.description, 300),
        keywords: text(v.keywords, d.keywords, 300),
        announcement: text(v.announcement, "", 300),
        announcementLevel: pick(v.announcementLevel, ["info", "warning"], "info"),
        supportContact: text(v.supportContact, "", 200),
        icp: text(v.icp, "", 60),
        publicSecurityRecord: text(v.publicSecurityRecord, "", 80),
        publicBaseUrl: text(v.publicBaseUrl, "", 200).trim().replace(/\/+$/, ""),
        footerNote: text(v.footerNote, "", 300)
      };
    case "auth":
      return {
        registrationOpen: flag(v.registrationOpen, d.registrationOpen),
        inviteRequired: flag(v.inviteRequired, d.inviteRequired),
        requireEmailVerification: flag(v.requireEmailVerification, d.requireEmailVerification),
        signupBonus: intIn(v.signupBonus, 0, 100000, d.signupBonus),
        inviteReward: intIn(v.inviteReward, 0, 100000, d.inviteReward),
        inviteeBonus: intIn(v.inviteeBonus, 0, 100000, d.inviteeBonus),
        checkinCredits: intIn(v.checkinCredits, 0, 10000, d.checkinCredits),
        maxRegistrationsPerIpPerDay: intIn(v.maxRegistrationsPerIpPerDay, 1, 10000, d.maxRegistrationsPerIpPerDay),
        sessionDays: intIn(v.sessionDays, 1, 365, d.sessionDays)
      };
    case "generation": {
      const qualities = ["low", "medium", "high"].map((id) => {
        const item = (Array.isArray(v.qualities) ? v.qualities : []).find((q) => q?.id === id) ||
          d.qualities.find((q) => q.id === id);
        const def = d.qualities.find((q) => q.id === id);
        return { id, label: text(item.label, def.label, 12).trim() || def.label,
          credits: intIn(item.credits, 0, 100000, def.credits), enabled: flag(item.enabled, def.enabled) };
      });
      if (!qualities.some((q) => q.enabled)) qualities[1].enabled = true;
      const tiers = ["standard", "hd", "uhd"].map((id) => {
        const item = (Array.isArray(v.tiers) ? v.tiers : []).find((t) => t?.id === id) ||
          d.tiers.find((t) => t.id === id);
        const def = d.tiers.find((t) => t.id === id);
        return { id, label: text(item.label, def.label, 16).trim() || def.label,
          multiplier: numIn(item.multiplier, 0.1, 100, def.multiplier), enabled: flag(item.enabled, def.enabled) };
      });
      tiers[0].enabled = true;
      const ratios = Array.isArray(v.ratios) ? RATIOS.filter((r) => v.ratios.includes(r)) : d.ratios;
      const safeRatios = ratios.length ? ratios : d.ratios;
      const enabledQualities = qualities.filter((q) => q.enabled).map((q) => q.id);
      const enabledTiers = tiers.filter((t) => t.enabled).map((t) => t.id);
      const price = v.tokenPriceUsd || {};
      const fallback = v.fallbackCostUsd || {};
      return {
        enabled: flag(v.enabled, d.enabled),
        maintenanceMessage: text(v.maintenanceMessage, d.maintenanceMessage, 200),
        allowTextOnly: flag(v.allowTextOnly, d.allowTextOnly),
        allowOutfitUpload: flag(v.allowOutfitUpload, d.allowOutfitUpload),
        allowPersonPhoto: flag(v.allowPersonPhoto, d.allowPersonPhoto),
        qualities, tiers, ratios: safeRatios,
        defaultRatio: pick(v.defaultRatio, safeRatios, safeRatios[0]),
        defaultQuality: pick(v.defaultQuality, enabledQualities, enabledQualities[0]),
        defaultTier: pick(v.defaultTier, enabledTiers, "standard"),
        maxN: intIn(v.maxN, 1, 10, d.maxN),
        outputFormat: pick(v.outputFormat, ["png", "webp", "jpeg"], d.outputFormat),
        outputCompression: intIn(v.outputCompression, 10, 100, d.outputCompression),
        moderation: pick(v.moderation, ["auto", "low"], d.moderation),
        inputMaxEdge: intIn(v.inputMaxEdge, 512, 4096, d.inputMaxEdge),
        workerConcurrency: intIn(v.workerConcurrency, 1, 32, d.workerConcurrency),
        maxAttempts: intIn(v.maxAttempts, 1, 6, d.maxAttempts),
        requestTimeoutSec: intIn(v.requestTimeoutSec, 30, 900, d.requestTimeoutSec),
        maxActivePerUser: intIn(v.maxActivePerUser, 1, 50, d.maxActivePerUser),
        dailyLimitPerUser: intIn(v.dailyLimitPerUser, 0, 100000, d.dailyLimitPerUser),
        styles: presetList(v.styles, d.styles),
        scenes: presetList(v.scenes, d.scenes),
        tokenPriceUsd: {
          textInput: numIn(price.textInput, 0, 1000, d.tokenPriceUsd.textInput),
          imageInput: numIn(price.imageInput, 0, 1000, d.tokenPriceUsd.imageInput),
          imageOutput: numIn(price.imageOutput, 0, 1000, d.tokenPriceUsd.imageOutput)
        },
        fallbackCostUsd: {
          low: numIn(fallback.low, 0, 100, d.fallbackCostUsd.low),
          medium: numIn(fallback.medium, 0, 100, d.fallbackCostUsd.medium),
          high: numIn(fallback.high, 0, 100, d.fallbackCostUsd.high)
        },
        usdToCny: numIn(v.usdToCny, 0.01, 1000, d.usdToCny)
      };
    }
    case "prompt": {
      const out = {};
      for (const key of Object.keys(d)) out[key] = text(v[key], d[key], 1500);
      return out;
    }
    case "safety": {
      const words = Array.isArray(v.bannedWords) ? v.bannedWords : d.bannedWords;
      const wm = v.watermark || {};
      return {
        suggestiveForAI: flag(v.suggestiveForAI, d.suggestiveForAI),
        showSuggestive: flag(v.showSuggestive, d.showSuggestive),
        showExplicit: flag(v.showExplicit, d.showExplicit),
        personRetentionDays: intIn(v.personRetentionDays, 1, 365, d.personRetentionDays),
        outfitRetentionDays: intIn(v.outfitRetentionDays, 1, 3650, d.outfitRetentionDays),
        bannedWords: [...new Set(words.map((w) => text(w, "", 40).trim()).filter(Boolean))].slice(0, 500),
        watermark: {
          enabled: flag(wm.enabled, d.watermark.enabled),
          text: text(wm.text, d.watermark.text, 30).trim() || d.watermark.text,
          position: pick(wm.position, ["bottom-right", "bottom-left", "top-right", "top-left"], d.watermark.position),
          opacity: numIn(wm.opacity, 0.2, 1, d.watermark.opacity)
        },
        aigcMetadata: flag(v.aigcMetadata, d.aigcMetadata),
        showcaseEnabled: flag(v.showcaseEnabled, d.showcaseEnabled),
        showcaseReview: flag(v.showcaseReview, d.showcaseReview)
      };
    }
    case "library":
      return { originalDownload: pick(v.originalDownload, ["public", "login", "disabled"], d.originalDownload) };
    case "assets": {
      const angles = {};
      for (const key of Object.keys(d.angles)) angles[key] = text(v.angles?.[key], d.angles[key], 300).trim() || d.angles[key];
      const template = (key) => text(v[key], d[key], 3000).trim() || d[key];
      return {
        userGeneration: flag(v.userGeneration, d.userGeneration),
        quality: pick(v.quality, ["low", "medium", "high"], d.quality),
        tier: pick(v.tier, ["standard", "hd"], d.tier),
        poseCredits: intIn(v.poseCredits, 0, 100000, d.poseCredits),
        outfitCredits: intIn(v.outfitCredits, 0, 100000, d.outfitCredits),
        maxPerJob: intIn(v.maxPerJob, 1, 4, d.maxPerJob),
        dailyLimitPerUser: intIn(v.dailyLimitPerUser, 0, 10000, d.dailyLimitPerUser),
        publicReview: flag(v.publicReview, d.publicReview),
        maxPrice: intIn(v.maxPrice, 0, 10000, d.maxPrice),
        rebatePercent: intIn(v.rebatePercent, 0, 100, d.rebatePercent),
        commercialOnly: flag(v.commercialOnly, d.commercialOnly),
        posePrompt: template("posePrompt"),
        poseRefPrompt: template("poseRefPrompt"),
        poseAnglePrompt: template("poseAnglePrompt"),
        outfitPrompt: template("outfitPrompt"),
        outfitRefPrompt: template("outfitRefPrompt"),
        angles
      };
    }
    case "payment": {
      const a = v.alipay || {}, w = v.wechat || {};
      return {
        orderExpireMinutes: intIn(v.orderExpireMinutes, 5, 1440, d.orderExpireMinutes),
        mock: { enabled: flag(v.mock?.enabled, false) },
        alipay: {
          enabled: flag(a.enabled, false), sandbox: flag(a.sandbox, false),
          mode: pick(a.mode, ["page", "qr"], "page"),
          appId: text(a.appId, "", 40).trim(),
          privateKey: text(a.privateKey, "", 8000), alipayPublicKey: text(a.alipayPublicKey, "", 4000).trim()
        },
        wechat: {
          enabled: flag(w.enabled, false),
          appId: text(w.appId, "", 40).trim(), mchId: text(w.mchId, "", 40).trim(),
          serialNo: text(w.serialNo, "", 80).trim(),
          privateKey: text(w.privateKey, "", 8000), apiV3Key: text(w.apiV3Key, "", 64),
          platformPublicKey: text(w.platformPublicKey, "", 4000).trim(),
          platformPublicKeyId: text(w.platformPublicKeyId, "", 80).trim()
        }
      };
    }
    case "mail":
      return {
        enabled: flag(v.enabled, false), host: text(v.host, "", 200).trim(),
        port: intIn(v.port, 1, 65535, 465), secure: flag(v.secure, true),
        user: text(v.user, "", 200).trim(), pass: text(v.pass, "", 500), from: text(v.from, "", 200).trim()
      };
    case "legal":
      return {
        terms: text(v.terms, d.terms, 50000),
        privacy: text(v.privacy, d.privacy, 50000),
        contentPolicy: text(v.contentPolicy, d.contentPolicy, 50000)
      };
    default:
      return v;
  }
}

export function publicBaseUrl(req) {
  const configured = get("site").publicBaseUrl;
  if (configured) return configured;
  if (!req) return "";
  return `${req.protocol}://${req.get("host")}`;
}

// The subset of configuration the browser needs. Nothing secret.
export function publicConfig() {
  const site = get("site"), auth = get("auth"), gen = get("generation"), safety = get("safety"),
    payment = get("payment"), mail = get("mail"), library = get("library"), assets = get("assets");
  const providers = [];
  if (payment.alipay.enabled) providers.push("alipay");
  if (payment.wechat.enabled) providers.push("wechat");
  if (payment.mock.enabled) providers.push("mock");
  return {
    site: {
      name: site.name, tagline: site.tagline, description: site.description,
      announcement: site.announcement, announcementLevel: site.announcementLevel,
      supportContact: site.supportContact, icp: site.icp, publicSecurityRecord: site.publicSecurityRecord,
      footerNote: site.footerNote
    },
    auth: {
      registrationOpen: auth.registrationOpen, inviteRequired: auth.inviteRequired,
      requireEmailVerification: auth.requireEmailVerification && mail.enabled,
      signupBonus: auth.signupBonus, inviteReward: auth.inviteReward, inviteeBonus: auth.inviteeBonus,
      checkinCredits: auth.checkinCredits, passwordReset: mail.enabled
    },
    generation: {
      enabled: gen.enabled, maintenanceMessage: gen.maintenanceMessage,
      allowTextOnly: gen.allowTextOnly, allowOutfitUpload: gen.allowOutfitUpload,
      allowPersonPhoto: gen.allowPersonPhoto,
      qualities: gen.qualities.filter((q) => q.enabled).map(({ id, label, credits }) => ({ id, label, credits })),
      tiers: gen.tiers.filter((t) => t.enabled).map(({ id, label, multiplier }) => ({ id, label, multiplier })),
      ratios: gen.ratios, defaultRatio: gen.defaultRatio, defaultQuality: gen.defaultQuality,
      defaultTier: gen.defaultTier, maxN: gen.maxN,
      styles: gen.styles.map(({ id, label }) => ({ id, label })),
      scenes: gen.scenes.map(({ id, label }) => ({ id, label })),
      personRetentionDays: safety.personRetentionDays
    },
    payment: { providers },
    showcase: { enabled: safety.showcaseEnabled },
    library: { originalDownload: library.originalDownload, showSuggestive: safety.showSuggestive },
    assets: {
      generation: assets.userGeneration && gen.enabled,
      poseCredits: assets.poseCredits, outfitCredits: assets.outfitCredits, maxPerJob: assets.maxPerJob,
      maxPrice: assets.maxPrice, rebatePercent: assets.rebatePercent, publicReview: assets.publicReview,
      referenceRetentionDays: safety.personRetentionDays
    }
  };
}

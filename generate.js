"use strict";
// BYOK image generation for ai-reference-gallery.
//
// Design constraints (minimal, no backend):
// - The user brings their own key. It is stored ONLY in this browser's
//   localStorage, under `arg-gen-config-v1`, and is sent ONLY to the
//   baseUrl the user configured. It is never committed to the repo and
//   never sent anywhere else by this code.
// - The channel is configurable: any OpenAI-compatible /v1/images API
//   works (moosecloud.cc is just one preset, not a hard-coded dependency).
// - Final images are generated from the ORIGINAL reference images
//   (pose / costume / person), not from the spliced reference board:
//   the board's borders and catalog numbers would only confuse the model.
// - Generated costumes are saved in IndexedDB in this browser only.
//   They are not uploaded to the repo, so they do not touch the licensed
//   gallery assets in img/ at all.
window.ReferenceGalleryGenerate = (() => {
  const STORAGE_KEY = "arg-gen-config-v1";
  const PRESETS = {
    moosecloud: { label: "moosecloud.cc", baseUrl: "https://moosecloud.cc" },
    openai: { label: "OpenAI", baseUrl: "https://api.openai.com" },
    custom: { label: "自定义", baseUrl: "" },
  };

  const MENS_STYLES = [
    { id: "business-suit", zh: "商务西装", en: "tailored business suit, shirt and leather shoes" },
    { id: "business-casual", zh: "商务休闲", en: "smart casual blazer, shirt, chinos" },
    { id: "street", zh: "街头潮流", en: "streetwear: oversized jacket, graphic tee, cargo pants, sneakers" },
    { id: "daily-casual", zh: "休闲日常", en: "casual everyday outfit: jacket or sweater, jeans, sneakers" },
    { id: "sport", zh: "运动户外", en: "sporty outdoor outfit: technical jacket, athletic pants, running shoes" },
    { id: "workwear", zh: "复古工装", en: "vintage workwear: denim jacket, work boots, sturdy trousers" },
    { id: "chinese", zh: "新中式", en: "modern Chinese-style outfit: stand-collar jacket, wide trousers" },
    { id: "resort", zh: "度假", en: "resort outfit: linen shirt, shorts, sandals" },
    { id: "formal", zh: "正式礼服", en: "formal evening suit with bow tie" },
    { id: "preppy", zh: "学院风", en: "preppy outfit: knit polo, pleated trousers, loafers" },
  ];
  const WOMENS_STYLES = [
    { id: "spring", zh: "春季", en: "spring outfit" },
    { id: "summer", zh: "夏季", en: "summer outfit" },
    { id: "autumn", zh: "秋季", en: "autumn outfit" },
    { id: "winter", zh: "冬季", en: "winter outfit" },
    { id: "party", zh: "派对", en: "party outfit" },
    { id: "daily", zh: "休闲日常", en: "casual everyday outfit" },
  ];

  function loadConfig() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") || {};
      return {
        preset: saved.preset || "moosecloud",
        baseUrl: saved.baseUrl || PRESETS.moosecloud.baseUrl,
        apiKey: saved.apiKey || "",
        model: saved.model || "gpt-image-2",
        size: saved.size || "1024x1024",
      };
    } catch (_) {
      return { preset: "moosecloud", baseUrl: PRESETS.moosecloud.baseUrl, apiKey: "", model: "gpt-image-2", size: "1024x1024" };
    }
  }
  function saveConfig(config) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }
  function clearConfig() {
    localStorage.removeItem(STORAGE_KEY);
  }
  function assertConfig(config) {
    if (!config.baseUrl) throw new Error("请先填写生图渠道地址（Base URL）。");
    if (!config.apiKey) throw new Error("请先填写 API Key（只保存在本浏览器，不会上传到仓库）。");
    if (!config.model) throw new Error("请先填写模型名，例如 gpt-image-2。");
    if (/\/$/.test(config.baseUrl)) config.baseUrl = config.baseUrl.replace(/\/+$/, "");
  }

  function parseResult(data) {
    const item = data && Array.isArray(data.data) && data.data[0];
    if (!item) throw new Error("渠道返回了空结果，请换模型或稍后重试。");
    if (item.b64_json) return { kind: "b64", b64: item.b64_json, revisedPrompt: item.revised_prompt || "" };
    if (item.url) return { kind: "url", url: item.url, revisedPrompt: item.revised_prompt || "" };
    throw new Error("渠道返回格式无法识别（既没有 b64_json 也没有 url）。");
  }
  async function readError(response) {
    const text = await response.text();
    try {
      const json = JSON.parse(text);
      const message = json.error && (json.error.message || json.error.code) || json.message;
      if (message) return `渠道返回 ${response.status}：${message}`;
    } catch (_) { /* fall through to raw text */ }
    return `渠道返回 ${response.status}：${text.slice(0, 300)}`;
  }
  async function callGenerations(config, prompt) {
    assertConfig(config);
    const response = await fetch(`${config.baseUrl}/v1/images/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, prompt, size: config.size, n: 1 }),
    });
    if (!response.ok) throw new Error(await readError(response));
    return parseResult(await response.json());
  }
  async function callEdits(config, prompt, blobs) {
    assertConfig(config);
    const form = new FormData();
    for (const blob of blobs) form.append("image", blob, "reference.png");
    form.append("model", config.model);
    form.append("prompt", prompt);
    form.append("size", config.size);
    const response = await fetch(`${config.baseUrl}/v1/images/edits`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: form,
    });
    if (!response.ok) throw new Error(await readError(response));
    return parseResult(await response.json());
  }
  async function resultToBlob(result) {
    if (result.kind === "b64") {
      const binary = atob(result.b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new Blob([bytes], { type: "image/png" });
    }
    // url result: same-origin / CORS-permitting hosts can be fetched;
    // otherwise the caller falls back to showing the URL directly.
    const response = await fetch(result.url);
    if (!response.ok) throw new Error(`生成结果链接下载失败（${response.status}）。`);
    return await response.blob();
  }

  async function blobForEntry(entry) {
    if (!entry) throw new Error("缺少参考图。");
    if (entry.uploadUrl) {
      const response = await fetch(entry.uploadUrl);
      return await response.blob();
    }
    if (location.protocol === "file:") {
      throw new Error("file:// 打开时浏览器拿不到图库原图：请用本地 HTTP 服务打开（例如 python3 -m http.server），或把这张图上传为自定义图片后再生成。");
    }
    const src = entry.original || entry.preview || entry.thumbnail;
    const response = await fetch(src);
    if (!response.ok) throw new Error(`参考图读取失败（${response.status}）：${entry.id || src}`);
    return await response.blob();
  }

  function buildFinalPrompt(composition, extra) {
    const hasPerson = !!composition.person;
    const lines = [
      "Generate one realistic full-body photograph. Do NOT make a collage, a reference board, or a side-by-side comparison, and do NOT include any borders, catalog numbers, or text labels.",
      "Reference image 1 is the POSE reference: copy the body pose, body orientation and framing exactly.",
      "Reference image 2 is the OUTFIT reference: the person must wear exactly this outfit, including its colours, patterns, fabrics and accessories.",
    ];
    if (hasPerson) {
      lines.push("Reference image 3 is the PERSON reference: keep this person's face, hairstyle and overall appearance.");
    }
    lines.push("The outfit must be worn by a real adult person in a natural, well-lit scene. Fabric texture and garment details must stay faithful to reference image 2; do not invent a different outfit.");
    if (extra && extra.trim()) lines.push(`Additional requirements from the user: ${extra.trim()}`);
    return lines.join(" ");
  }
  function buildCostumePrompt({ gender, styleId, presentation, details }) {
    const styles = gender === "男装" ? MENS_STYLES : WOMENS_STYLES;
    const style = styles.find((s) => s.id === styleId) || styles[0];
    const model = gender === "男装" ? "an adult man" : gender === "女装" ? "an adult woman" : "an adult model in gender-neutral styling";
    const base = `Design a complete ${style.en}. ${details ? `Details: ${details}. ` : ""}No text, no watermark, no logo.`;
    if (presentation === "flat") {
      return `Flat lay photograph of a complete outfit (${style.en}) laid out neatly on a clean light background, top-down view, every piece fully visible, no model, no person. ${base}`;
    }
    if (presentation === "hanger") {
      return `Studio photograph of a complete outfit (${style.en}) displayed on a hanger against a clean light background, garment fully visible, no model, no person. ${base}`;
    }
    return `Full-body studio photograph of ${model} wearing a complete outfit (${style.en}), standing naturally, clean light-grey studio background, realistic fabric texture, the whole garment fully visible from head to toe. ${base}`;
  }

  // --- "My costumes": browser-local only, via IndexedDB ---
  let dbPromise = null;
  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error("当前浏览器不支持 IndexedDB，生成的服装只能下载、无法保存在“我的服装”里。"));
      const request = indexedDB.open("arg-my-costumes", 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("costumes")) {
          request.result.createObjectStore("costumes", { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error("本地服装库打开失败。"));
    });
    return dbPromise;
  }
  function dbOp(mode, run) {
    return openDb().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("costumes", mode);
      const store = tx.objectStore("costumes");
      const request = run(store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error("本地服装库读写失败。"));
      tx.onerror = () => reject(new Error("本地服装库读写失败。"));
    }));
  }
  function saveMyCostume(record) {
    return dbOp("readwrite", (store) => store.put(record));
  }
  function listMyCostumes() {
    return dbOp("readonly", (store) => store.getAll()).then((rows) =>
      rows.sort((a, b) => b.createdAt - a.createdAt));
  }
  function deleteMyCostume(id) {
    return dbOp("readwrite", (store) => store.delete(id));
  }

  return {
    PRESETS, MENS_STYLES, WOMENS_STYLES,
    loadConfig, saveConfig, clearConfig,
    callGenerations, callEdits, resultToBlob, blobForEntry,
    buildFinalPrompt, buildCostumePrompt,
    saveMyCostume, listMyCostumes, deleteMyCostume,
  };
})();

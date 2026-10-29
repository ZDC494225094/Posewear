"use strict";
// Offline-capable two-image compositor. No dependencies, network APIs, or server.
window.ReferenceComposition = (() => {
  let directory = null;
  let pickedFiles = null;
  const previewSize = { horizontal: [1200, 800], vertical: [800, 1200] };
  const exportSize = { horizontal: [2400, 1600], vertical: [1600, 2400] };

  function setFiles(files) {
    const selected = new Map();
    for (const file of files) {
      const relative = (file.webkitRelativePath || file.name).replaceAll("\\", "/");
      const offset = relative.indexOf("img/");
      if (offset >= 0) selected.set(relative.slice(offset), file);
      else if (/^(pose|costume)\//.test(relative)) selected.set("img/" + relative, file);
    }
    pickedFiles = selected;
    directory = null;
    return selected.size;
  }

  function clearFiles() {
    directory = null;
    pickedFiles = null;
  }

  async function requestFolder() {
    if (typeof window.showDirectoryPicker !== "function") return false;
    // Called only from a direct button click (required by File System Access).
    directory = await window.showDirectoryPicker({ id: "reference-gallery-images", mode: "read" });
    pickedFiles = null;
    return true;
  }

  async function fileFor(path) {
    if (pickedFiles?.has(path)) return pickedFiles.get(path);
    if (!directory) throw new Error("LOCAL_ACCESS_REQUIRED");
    const segments = path.split("/");
    if (segments[0] !== "img" || segments.length < 3 || segments.some((s) => !s || s === "..")) {
      throw new Error("INVALID_IMAGE_PATH");
    }
    // Both the img/ directory itself and the project root are accepted.
    async function traverse(start, parts) {
      let current = start;
      for (const segment of parts.slice(0, -1)) current = await current.getDirectoryHandle(segment);
      return (await current.getFileHandle(parts.at(-1))).getFile();
    }
    try { return await traverse(directory, segments.slice(1)); }
    catch (_) {
      try { return await traverse(directory, segments); }
      catch (_) { throw new Error("LOCAL_IMAGE_NOT_FOUND"); }
    }
  }

  // Validate the user's chosen folder against the actual selected assets.
  // An unrelated folder must not be remembered as a successful authorization.
  async function checkLocalAccess(entries) {
    if (location.protocol !== "file:") return true;
    for (const entry of entries) {
      if (entry && !entry.uploadUrl) await fileFor(entry.original);
    }
    return true;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      // Same-origin static assets work without configuration; external asset
      // hosts must allow CORS for Canvas to export a non-tainted PNG.
      if (/^https?:$/.test(location.protocol) && !src.startsWith("blob:")) {
        img.crossOrigin = "anonymous";
      }
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("IMAGE_LOAD_FAILED"));
      img.src = src;
    });
  }

  function sourceFor(entry, original) {
    if (entry.uploadUrl) return entry.uploadUrl;
    return original ? entry.original : (entry.preview || entry.thumbnail || entry.original);
  }

  async function loadSource(entry, original) {
    const path = sourceFor(entry, original);
    if (!original || entry.uploadUrl || location.protocol !== "file:") return { image: await loadImage(path) };
    const blob = await fileFor(path);
    const url = URL.createObjectURL(blob);
    try { return { image: await loadImage(url), url }; }
    catch (err) { URL.revokeObjectURL(url); throw err; }
  }

  function contain(ctx, image, x, y, w, h) {
    const iw = image.naturalWidth, ih = image.naturalHeight;
    const ratio = Math.min(w / iw, h / ih);
    const dw = iw * ratio, dh = ih * ratio;
    ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }

  function paint(canvas, options, images, original) {
    const vertical = options.layout === "vertical";
    const [w, h] = (original ? exportSize : previewSize)[vertical ? "vertical" : "horizontal"];
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = options.background === "soft" ? "#f2f3f6" : "#ffffff";
    ctx.fillRect(0, 0, w, h);
    const margin = Math.round(w * (vertical ? .058 : .038));
    const gap = Math.round(w * (vertical ? .027 : .025));
    const labelH = options.labels ? Math.round(w * (vertical ? .047 : .030)) : 0;
    const cols = vertical ? 1 : 2, rows = vertical ? 2 : 1;
    const pw = (w - 2 * margin - (cols - 1) * gap) / cols;
    const ph = (h - 2 * margin - (rows - 1) * gap) / rows;
    const entries = options.swapped ? [options.second, options.pose] : [options.pose, options.second];
    const loaded = options.swapped ? [images[1], images[0]] : images;
    for (let i = 0; i < 2; i++) {
      const x = margin + (vertical ? 0 : i * (pw + gap));
      const y = margin + (vertical ? i * (ph + gap) : 0);
      ctx.fillStyle = options.background === "soft" ? "#ffffff" : "#f7f8fa";
      ctx.fillRect(x, y, pw, ph);
      const padding = Math.max(12, Math.round(w * .012));
      contain(ctx, loaded[i], x + padding, y + padding, pw - padding * 2,
        ph - padding * 2 - labelH);
      if (options.labels) {
        const id = entries[i].id || "UPLOAD";
        ctx.fillStyle = "#525866";
        ctx.font = `600 ${Math.max(14, Math.round(w * .012))}px system-ui, sans-serif`;
        ctx.textBaseline = "middle";
        ctx.fillText(id.slice(0, 50), x + padding, y + ph - labelH / 2, pw - padding * 2);
      }
    }
    return [w, h];
  }

  async function draw(canvas, options, original = false) {
    if (!options.pose || !options.second) throw new Error("COMPOSITION_INCOMPLETE");
    const sources = [];
    try {
      sources.push(await loadSource(options.pose, original));
      sources.push(await loadSource(options.second, original));
      return paint(canvas, options, sources.map((s) => s.image), original);
    }
    finally { for (const source of sources) if (source.url) URL.revokeObjectURL(source.url); }
  }

  async function exportPNG(options) {
    const canvas = document.createElement("canvas");
    await draw(canvas, options, true);
    return new Promise((resolve, reject) => {
      try { canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("EXPORT_FAILED")), "image/png"); }
      catch (err) { reject(err); }
    });
  }

  function needsFolder() {
    return location.protocol === "file:" && !directory && !pickedFiles;
  }

  return { draw, exportPNG, setFiles, clearFiles, requestFolder, checkLocalAccess, needsFolder };
})();

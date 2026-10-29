"use strict";
// Composition UI controller. Canvas rendering and file access stay in composition.js.
window.ReferenceCompositionUI = ({state, composition, t, $, element, choosePose, chooseCostume, openComposition}) => {
  let previewVersion = 0;

  function releaseUploadedImage() {
    const prev = state.composition.second;
    if (prev?.uploadUrl) URL.revokeObjectURL(prev.uploadUrl);
  }
  function compositionOptions() {
    return { ...state.composition };
  }
  function setComposeStatus(key) {
    $("compose-status").textContent = key ? t(key) : "";
    $("compose-status").dataset.status = ["composeExportError", "composeOnlineImageError",
      "composeMissingFile"].includes(key) ? "error" : "";
  }
  function syncComposeFolderNotice() {
    $("compose-local-notice").hidden = location.protocol !== "file:" || !composition.needsFolder();
  }
  async function updateComposition() {
    const options = compositionOptions(), version = ++previewVersion;
    syncComposeFolderNotice();
    for (const [key, image] of [["pose", options.pose], ["costume", options.second]]) {
      const panel = $(key === "pose" ? "compose-pose-preview" : "compose-costume-preview");
      panel.querySelector("img")?.remove();
      $(key === "pose" ? "compose-pose-id" : "compose-costume-id").textContent = image?.id || "";
      $(key === "pose" ? "compose-pose-empty" : "compose-costume-empty").hidden = !!image;
      if (image) {
        const img = element("img");
        img.alt = image.id;
        img.src = image.uploadUrl || image.thumbnail || image.preview || image.original;
        panel.prepend(img);
      }
    }
    const complete = !!options.pose && !!options.second;
    $("compose-download").disabled = !complete;
    $("compose-size").textContent = options.layout === "vertical" ? "1600 × 2400 PNG" : "2400 × 1600 PNG";
    $("compose-placeholder").hidden = complete;
    if (!complete) return;
    const buffer = document.createElement("canvas");
    try {
      await composition.draw(buffer, options);
      if (version !== previewVersion) return;
      const canvas = $("compose-canvas");
      canvas.width = buffer.width;
      canvas.height = buffer.height;
      canvas.getContext("2d").drawImage(buffer, 0, 0);
      setComposeStatus("");
    } catch (_) {
      if (version === previewVersion) setComposeStatus("composePreviewError");
    }
  }
  async function chooseLocalFolder(force = false) {
    if (!force && !composition.needsFolder()) return true;
    try {
      if (await composition.requestFolder()) {
        await composition.checkLocalAccess([state.composition.pose, state.composition.second]);
        syncComposeFolderNotice();
        setComposeStatus("composeFolderReady");
        return true;
      }
    } catch (err) {
      if (err.name === "AbortError") return false;
      composition.clearFiles();
      syncComposeFolderNotice();
      setComposeStatus("composeMissingFile");
      return false;
    }
    setComposeStatus("composeSelectFolder");
    $("compose-folder-input").click();
    return false;
  }
  async function downloadComposition() {
    if (!state.composition.pose || !state.composition.second) return;
    if (composition.needsFolder() && !(await chooseLocalFolder())) return;
    $("compose-download").disabled = true;
    setComposeStatus("composeExporting");
    try {
      const blob = await composition.exportPNG(compositionOptions());
      const name = [state.composition.pose.id, state.composition.second.id]
        .map((s) => String(s).replace(/[^\w.-]/g, "_").slice(0, 48)).join("_") + ".png";
      const href = URL.createObjectURL(blob);
      const link = element("a");
      link.href = href; link.download = name; document.body.append(link);
      link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 30000);
      setComposeStatus("composeSaved");
    } catch (err) {
      if (["LOCAL_IMAGE_NOT_FOUND", "LOCAL_ACCESS_REQUIRED"].includes(err.message)) {
        composition.clearFiles();
        syncComposeFolderNotice();
        setComposeStatus("composeMissingFile");
      } else {
        setComposeStatus(err.message === "IMAGE_LOAD_FAILED" && location.protocol !== "file:"
          ? "composeOnlineImageError" : "composeExportError");
      }
    } finally {
      $("compose-download").disabled = false;
    }
  }
  async function uploadSecondImage(file) {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 50 * 1024 * 1024) {
      setComposeStatus("composeInvalidUpload"); return;
    }
    releaseUploadedImage();
    state.composition.second = { id: file.name, uploadUrl: URL.createObjectURL(file) };
    if (state.type === "compose") updateComposition();
    else openComposition();
  }
  function bind() {
    $("compose-choose-pose").onclick = choosePose;
    $("compose-choose-costume").onclick = chooseCostume;
    $("compose-upload").onclick = () => $("compose-upload-input").click();
    $("compose-upload-input").onchange = (event) => { uploadSecondImage(event.target.files[0]); event.target.value = ""; };
    $("compose-folder-button").onclick = () => chooseLocalFolder(true);
    $("compose-folder-input").onchange = (event) => {
      const count = composition.setFiles(event.target.files);
      composition.checkLocalAccess([state.composition.pose, state.composition.second])
        .then(() => {
          if (!count) composition.clearFiles();
          syncComposeFolderNotice();
          setComposeStatus(count ? "composeFolderReady" : "composeMissingFile");
        })
        .catch(() => {
          composition.clearFiles();
          syncComposeFolderNotice();
          setComposeStatus("composeMissingFile");
        });
      event.target.value = "";
    };
    $("compose-download").onclick = downloadComposition;
    $("compose-layout").onchange = (event) => { state.composition.layout = event.target.value; updateComposition(); };
    $("compose-bg").onchange = (event) => { state.composition.background = event.target.value; updateComposition(); };
    $("compose-labels").onchange = (event) => { state.composition.labels = event.target.checked; updateComposition(); };
    $("compose-swap").onclick = () => { state.composition.swapped = !state.composition.swapped; updateComposition(); };
  }

  return { bind, updateComposition, releaseUploadedImage, uploadSecondImage };
};

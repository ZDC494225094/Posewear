"use strict";
// Composition UI controller. Canvas rendering and file access stay in composition.js.
window.ReferenceCompositionUI = ({state, composition, t, label, $, element, choosePose, chooseCostume, openComposition}) => {
  let previewVersion = 0;
  let poseGroupsSource = null;
  let poseGroups = [];
  let filters = { outfit: "", pose: "", duo: false };
  const imageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
  const maxUploadBytes = 50 * 1024 * 1024;
  const validImageFile = (file) => file && imageTypes.has(file.type) &&
    file.size > 0 && file.size <= maxUploadBytes;

  // Draw uniformly from pose groups (then angles), not from repeated images:
  // a group with five angles should not be five times more likely to appear.
  function getPoseGroups() {
    if (poseGroupsSource !== state.poseImages) {
      const groups = new Map();
      for (const item of state.poseImages) {
        if (!groups.has(item.pose_key)) groups.set(item.pose_key, []);
        groups.get(item.pose_key).push(item);
      }
      poseGroups = [...groups.values()];
      poseGroupsSource = state.poseImages;
    }
    return poseGroups;
  }
  function pickDifferent(items, excluded, key) {
    if (!items.length) return null;
    const alternatives = items.filter((item) => key(item) !== excluded);
    const pool = alternatives.length ? alternatives : items;
    return pool[Math.floor(Math.random() * pool.length)];
  }
  const isDuo = (record) => record.series === "2人絡み";
  function eligiblePoseGroups() {
    return getPoseGroups().filter((images) =>
      (filters.duo || !isDuo(images[0])) &&
      (!filters.pose || images[0].category === filters.pose));
  }
  function eligibleOutfits() {
    return state.costumeImages.filter((item) => !filters.outfit || item.category === filters.outfit);
  }
  function updatePoolCount() {
    $("compose-random-pool-size").textContent =
      t("composeRandomRange", eligiblePoseGroups().length, eligibleOutfits().length);
  }
  function refreshRandomFilters() {
    const outfits = [...new Set(state.costumeImages.map((item) => item.category))];
    const outfitSelect = $("compose-random-outfit-filter");
    outfitSelect.replaceChildren(new Option(t("composeAllOutfits"), ""),
      ...outfits.map((category) => {
        const item = state.costumeImages.find((x) => x.category === category);
        return new Option(label(item, "category"), category);
      }));
    outfitSelect.value = filters.outfit;

    const categories = new Map();
    for (const group of getPoseGroups()) {
      const item = group[0];
      if (!filters.duo && isDuo(item)) continue;
      if (!categories.has(item.category)) categories.set(item.category, label(item, "category"));
    }
    if (filters.pose && !categories.has(filters.pose)) filters.pose = "";
    const poseSelect = $("compose-random-pose-filter");
    poseSelect.replaceChildren(new Option(t(filters.duo ? "composeAllPoses" : "composeSoloPoses"), ""),
      ...[...categories].sort((a, b) => a[1].localeCompare(b[1]))
        .map(([category, name]) => new Option(name, category)));
    poseSelect.value = filters.pose;
    $("compose-random-include-duo").checked = filters.duo;
    updatePoolCount();
  }
  // The composition module owns its own controls and translations; the gallery
  // controller only needs to refresh them when the selected language changes.
  function refreshLabels() {
    const keys = {
      "compose-pose-label": "composePose", "compose-costume-label": "composeSecond",
      "compose-random-title": "composeRandomTitle", "compose-random-hint": "composeRandomHint",
      "compose-random-pair-label": "composeRandomPair",
      "compose-random-pose": "composeRandomPose", "compose-random-costume": "composeRandomCostume",
      "compose-random-outfit-filter-label": "composeOutfitFilter",
      "compose-random-pose-filter-label": "composePoseFilter",
      "compose-random-duo-label": "composeIncludeDuo",
      "compose-prompt-title": "composePromptTitle", "compose-prompt-help": "composePromptHelp",
      "compose-copy-prompt": "composeCopyPrompt", "compose-copy-image": "composeCopyImage",
      "compose-pose-empty": "composeEmptyPose", "compose-costume-empty": "composeEmptySecond",
      "compose-person-label": "composePerson", "compose-person-empty": "composePersonEmpty",
      "compose-person-help": "composePersonHelp",
      "compose-upload-person": "composeUploadPerson", "compose-remove-person": "composeRemovePerson",
      "compose-choose-pose": "choosePose", "compose-choose-costume": "chooseCostume",
      "compose-upload": "uploadImage", "compose-preview-eyebrow": "composeEditorEyebrow",
      "compose-preview-title": "composeEditorTitle", "compose-open-preview": "composeOpenPreview",
      "compose-preview-dialog-title": "composePreviewDialogTitle",
      "compose-preview-hint": "composePreviewHint",
      "compose-preview-copy": "composePreviewCopy",
      "compose-preview-download": "composeDownload",
      "compose-bg-label": "composeBg", "compose-white": "composeWhite",
      "compose-soft": "composeSoft", "compose-labels-label": "composeLabels",
      "compose-help": "composeHelp",
      "compose-download": "composeDownload", "compose-folder-button": "composeFolder",
      "compose-local-title": "composeLocalTitle", "compose-local-step": "composeLocalStep"
    };
    for (const [id, key] of Object.entries(keys)) $(id).textContent = t(key);
    $("compose-preview-close").setAttribute("aria-label", t("close"));
    $("compose-random-filters").setAttribute("aria-label", t("composeRandomTitle"));
    refreshRandomFilters();
  }
  function drawRandomPose() {
    const group = pickDifferent(eligiblePoseGroups(), state.composition.pose?.pose_key,
      (images) => images[0].pose_key);
    if (!group) return false;
    state.composition.pose = group[Math.floor(Math.random() * group.length)];
    return true;
  }
  function drawRandomCostume() {
    const item = pickDifferent(eligibleOutfits(), state.composition.second?.id,
      (costume) => costume.id);
    if (!item) return false;
    releaseUploadedImage();
    state.composition.second = item;
    return true;
  }
  function randomize(which) {
    const poseChanged = which !== "costume" && drawRandomPose();
    const costumeChanged = which !== "pose" && drawRandomCostume();
    if (poseChanged || costumeChanged) updateComposition([
      ...(poseChanged ? ["pose"] : []), ...(costumeChanged ? ["costume"] : [])
    ]);
  }

  function releaseUpload(key) {
    const url = state.composition[key]?.uploadUrl;
    if (url) URL.revokeObjectURL(url);
  }
  function releaseUploadedImage() { releaseUpload("second"); }
  function releaseUploadedPerson() { releaseUpload("person"); }
  function compositionOptions() {
    return { ...state.composition };
  }
  function setStatus(id, key, error = false) {
    const message = key ? t(key) : "";
    const status = error ? "error" : "";
    $(id).textContent = message;
    $(id).dataset.status = status;
    if (!$("compose-preview-overlay").hidden) {
      $("compose-preview-action-status").textContent = message;
      $("compose-preview-action-status").dataset.status = status;
    }
  }
  function setComposeStatus(key) {
    setStatus("compose-status", key,
      ["composeExportError", "composeOnlineImageError", "composeMissingFile"].includes(key));
  }
  function syncComposeFolderNotice() {
    $("compose-local-notice").hidden = location.protocol !== "file:" || !composition.needsFolder();
  }
  function updatePrompt() {
    const { pose, second, person } = state.composition;
    if (!pose || !second) {
      $("compose-prompt-text").value = t("composePromptEmpty");
      return;
    }
    if (person) {
      $("compose-prompt-text").value = t("composePromptThree", pose.id,
        t("composePosLeft"), second.id, t("composePosMiddleHorizontal"), t("composePosRight"));
      return;
    }
    $("compose-prompt-text").value = t("composePrompt", pose.id,
      t("composePosLeft"), second.id, t("composePosRight"));
  }
  function setCopyStatus(key, error = false) {
    setStatus("compose-copy-status", key, error);
  }
  function closePreview() {
    if ($("compose-preview-overlay").hidden) return;
    $("compose-preview-overlay").hidden = true;
    ++previewVersion;
    document.body.style.overflow = "";
    $("compose-open-preview").focus();
  }
  function fitPreviewToViewport(width, height) {
    if ($("compose-preview-overlay").hidden) return;
    const dialog = $("compose-preview-dialog");
    const head = dialog.querySelector(".compose-preview-dialog-head");
    const hint = $("compose-preview-hint");
    const status = $("compose-preview-action-status");
    const ratio = width / height;
    const availableWidth = Math.max(200, window.innerWidth * .96 - 30);
    const overhead = head.offsetHeight + hint.offsetHeight + status.offsetHeight + 34;
    const availableHeight = Math.max(100, window.innerHeight * .96 - overhead);
    const artWidth = Math.min(availableWidth, availableHeight * ratio);
    dialog.style.width = `${Math.round(artWidth + 20)}px`;
    $("compose-preview-stage").style.aspectRatio = `${width} / ${height}`;
  }
  async function renderPreview() {
    if ($("compose-preview-overlay").hidden) return;
    const options = compositionOptions(), version = ++previewVersion;
    const placeholder = $("compose-placeholder");
    placeholder.hidden = false;
    placeholder.textContent = t("composePreviewLoading");
    const buffer = document.createElement("canvas");
    try {
      await composition.draw(buffer, options);
      if (version !== previewVersion || $("compose-preview-overlay").hidden) return;
      const canvas = $("compose-canvas");
      canvas.width = buffer.width;
      canvas.height = buffer.height;
      canvas.getContext("2d").drawImage(buffer, 0, 0);
      const sizeText = `${buffer.width * 2} × ${buffer.height * 2} PNG`;
      $("compose-size").textContent = sizeText;
      $("compose-preview-size").textContent = sizeText;
      fitPreviewToViewport(buffer.width, buffer.height);
      placeholder.hidden = true;
    } catch (_) {
      if (version !== previewVersion || $("compose-preview-overlay").hidden) return;
      placeholder.textContent = t("composePreviewError");
    }
  }
  function openPreview() {
    if (!state.composition.pose || !state.composition.second) return;
    $("compose-preview-overlay").hidden = false;
    $("compose-preview-dialog").style.width = "";
    $("compose-preview-stage").style.aspectRatio = "";
    $("compose-preview-action-status").textContent = "";
    document.body.style.overflow = "hidden";
    $("compose-preview-close").focus();
    void renderPreview();
  }
  async function copyPrompt() {
    const value = $("compose-prompt-text").value;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("CLIPBOARD_UNAVAILABLE");
      await navigator.clipboard.writeText(value);
      setCopyStatus("composeCopiedPrompt");
    } catch (_) {
      $("compose-prompt-box").open = true;
      $("compose-prompt-text").focus();
      $("compose-prompt-text").select();
      setCopyStatus("composeCopyError", true);
    }
  }
  async function copyMergedImage() {
    if (!state.composition.pose || !state.composition.second) return;
    if (composition.needsFolder() && !(await chooseLocalFolder())) return;
    const buttons = [$("compose-copy-image"), $("compose-preview-copy")];
    buttons.forEach((button) => { button.disabled = true; });
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
        throw new Error("CLIPBOARD_UNAVAILABLE");
      }
      const blob = await composition.exportPNG(compositionOptions());
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setCopyStatus("composeCopiedImage");
    } catch (err) {
      if (["LOCAL_IMAGE_NOT_FOUND", "LOCAL_ACCESS_REQUIRED"].includes(err.message)) {
        composition.clearFiles();
        syncComposeFolderNotice();
        setCopyStatus("composeMissingFile", true);
      } else {
        setCopyStatus("composeCopyImageError", true);
      }
    } finally {
      buttons.forEach((button) => { button.disabled = !(state.composition.pose && state.composition.second); });
    }
  }
  function updateComposition(animate = []) {
    const options = compositionOptions();
    syncComposeFolderNotice();
    for (const [key, image] of [["pose", options.pose], ["costume", options.second]]) {
      const panel = $(key === "pose" ? "compose-pose-preview" : "compose-costume-preview");
      panel.querySelector("img")?.remove();
      $(key === "pose" ? "compose-pose-id" : "compose-costume-id").textContent = image?.id || "";
      $(key === "pose" ? "compose-pose-empty" : "compose-costume-empty").hidden = !!image;
      $(key === "pose" ? "compose-pose-meta" : "compose-costume-meta").textContent = !image ? "" :
        key === "pose" ? t("composePoseMeta", label(image, "category"), label(image, "angle")) :
        (image.uploadUrl ? image.id : label(image, "category"));
      if (image) {
        const img = element("img");
        img.alt = image.id;
        img.src = image.uploadUrl || image.thumbnail || image.preview || image.original;
        if (animate.includes(key)) img.classList.add("compose-random-appear");
        panel.prepend(img);
      }
    }
    const personPreview = $("compose-person-preview");
    personPreview.querySelector("img")?.remove();
    $("compose-person-empty").hidden = !!options.person;
    $("compose-person-id").textContent = options.person?.id || "";
    $("compose-remove-person").hidden = !options.person;
    if (options.person) {
      const img = element("img");
      img.alt = options.person.id;
      img.src = options.person.uploadUrl;
      personPreview.prepend(img);
    }
    const complete = !!options.pose && !!options.second;
    $("compose-open-preview").disabled = !complete;
    $("compose-download").disabled = !complete;
    $("compose-preview-download").disabled = !complete;
    $("compose-copy-prompt").disabled = !complete;
    $("compose-copy-image").disabled = !complete;
    $("compose-preview-copy").disabled = !complete;
    updatePrompt();
    $("compose-size").textContent = t("composeAdaptiveSize");
    $("compose-preview-hint").textContent = t(options.person ? "composePreviewHintThree" : "composePreviewHint");
    if (!$("compose-preview-overlay").hidden) void renderPreview();
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
    $("compose-preview-download").disabled = true;
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
      const complete = !!state.composition.pose && !!state.composition.second;
      $("compose-download").disabled = !complete;
      $("compose-preview-download").disabled = !complete;
    }
  }
  async function uploadSecondImage(file) {
    if (!file) return;
    if (!validImageFile(file)) {
      setComposeStatus("composeInvalidUpload"); return;
    }
    releaseUploadedImage();
    state.composition.second = { id: file.name, uploadUrl: URL.createObjectURL(file) };
    if (state.type === "compose") updateComposition();
    else openComposition();
  }
  async function uploadPersonImage(file) {
    if (!file) return;
    if (!validImageFile(file)) {
      setComposeStatus("composeInvalidUpload");
      return;
    }
    // Reject corrupt files before replacing a valid selection.
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      releaseUploadedPerson();
      state.composition.person = { id: file.name, uploadUrl: url };
      setComposeStatus("");
      updateComposition();
    } catch (_) {
      URL.revokeObjectURL(url);
      setComposeStatus("composeInvalidUpload");
    }
  }
  function removePersonImage() {
    releaseUploadedPerson();
    state.composition.person = null;
    updateComposition();
  }
  function bind() {
    $("compose-open-preview").onclick = openPreview;
    $("compose-preview-close").onclick = closePreview;
    $("compose-preview-copy").onclick = copyMergedImage;
    $("compose-preview-download").onclick = downloadComposition;
    window.addEventListener("resize", () => {
      if (!$("compose-preview-overlay").hidden) {
        const canvas = $("compose-canvas");
        if (canvas.width && canvas.height && $("compose-placeholder").hidden) {
          fitPreviewToViewport(canvas.width, canvas.height);
        }
      }
    });
    $("compose-preview-overlay").onclick = (event) => {
      if (event.target === $("compose-preview-overlay")) closePreview();
    };
    document.addEventListener("keydown", (event) => {
      if ($("compose-preview-overlay").hidden) return;
      if (event.key === "Escape") { event.preventDefault(); closePreview(); }
      // Keep keyboard focus within the preview's working actions.
      if (event.key === "Tab") {
        const controls = [$("compose-preview-copy"), $("compose-preview-download"),
          $("compose-preview-close")].filter((button) => !button.disabled);
        const current = controls.indexOf(document.activeElement);
        if (current !== -1) {
          event.preventDefault();
          const next = (current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
          controls[next].focus();
        }
      }
    });
    $("compose-choose-pose").onclick = choosePose;
    $("compose-choose-costume").onclick = chooseCostume;
    $("compose-random-pose").onclick = () => randomize("pose");
    $("compose-random-costume").onclick = () => randomize("costume");
    $("compose-random-pair").onclick = () => randomize("both");
    $("compose-random-outfit-filter").onchange = (event) => {
      filters.outfit = event.target.value;
      updatePoolCount();
    };
    $("compose-random-pose-filter").onchange = (event) => {
      filters.pose = event.target.value;
      updatePoolCount();
    };
    $("compose-random-include-duo").onchange = (event) => {
      filters.duo = event.target.checked;
      refreshRandomFilters();
    };
    $("compose-copy-prompt").onclick = copyPrompt;
    $("compose-copy-image").onclick = copyMergedImage;
    $("compose-upload").onclick = () => $("compose-upload-input").click();
    $("compose-upload-input").onchange = (event) => { uploadSecondImage(event.target.files[0]); event.target.value = ""; };
    $("compose-upload-person").onclick = () => $("compose-person-input").click();
    $("compose-person-input").onchange = (event) => { void uploadPersonImage(event.target.files[0]); event.target.value = ""; };
    $("compose-remove-person").onclick = removePersonImage;
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
    $("compose-bg").onchange = (event) => { state.composition.background = event.target.value; updateComposition(); };
    $("compose-labels").onchange = (event) => { state.composition.labels = event.target.checked; updateComposition(); };
  }

  return { bind, updateComposition, closePreview, refreshLabels, releaseUploadedImage, uploadSecondImage,
    uploadPersonImage, removePersonImage };
};

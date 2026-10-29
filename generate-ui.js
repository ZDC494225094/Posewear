"use strict";
// Wiring for the BYOK panels injected into the compose workbench.
// Depends on window.ReferenceGalleryGenerate and on the state exposed by
// app.js as window.ReferenceGalleryState / window.ReferenceGalleryComposeUI.
(function () {
  const G = window.ReferenceGalleryGenerate;
  if (!G) return;
  const $ = (id) => document.getElementById(id);
  const state = () => window.ReferenceGalleryState;
  const composeUI = () => window.ReferenceGalleryComposeUI;

  function setStatus(el, message, isError) {
    if (!el) return;
    el.textContent = message || "";
    el.dataset.status = isError ? "error" : "";
  }
  function downloadBlob(blob, name) {
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href; link.download = name;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 30000);
  }
  function showResult(imgEl, blob) {
    const url = URL.createObjectURL(blob);
    imgEl.src = url;
    imgEl.hidden = false;
  }

  // --- config panel ---
  function readConfigFromForm() {
    const preset = $("gen-preset").value;
    let baseUrl = $("gen-base-url").value.trim();
    if (preset !== "custom" && G.PRESETS[preset]) baseUrl = G.PRESETS[preset].baseUrl;
    return {
      preset,
      baseUrl,
      apiKey: $("gen-api-key").value.trim(),
      model: $("gen-model").value.trim() || "gpt-image-2",
      size: $("gen-size").value,
    };
  }
  function fillConfigForm(config) {
    $("gen-preset").value = config.preset in G.PRESETS ? config.preset : "custom";
    $("gen-base-url").value = config.baseUrl;
    $("gen-base-url").disabled = $("gen-preset").value !== "custom";
    $("gen-api-key").value = config.apiKey;
    $("gen-model").value = config.model;
    $("gen-size").value = config.size;
  }
  function refreshStyleOptions() {
    const gender = $("costume-gender").value;
    const styles = gender === "男装" ? G.MENS_STYLES : G.WOMENS_STYLES;
    $("costume-style").replaceChildren(...styles.map((s) => new Option(s.zh, s.id)));
  }

  // --- my costumes (IndexedDB, browser-local) ---
  async function renderMyCostumes() {
    const grid = $("my-costume-grid");
    if (!grid) return;
    try {
      const rows = await G.listMyCostumes();
      if (!rows.length) {
        grid.innerHTML = "";
        const empty = document.createElement("p");
        empty.className = "muted";
        empty.textContent = "还没有生成的服装：选男装/女装风格，点“生成服装”即可保存到这里。";
        grid.append(empty);
        return;
      }
      grid.innerHTML = "";
      for (const row of rows) {
        const card = document.createElement("article");
        card.className = "my-costume-card";
        const img = document.createElement("img");
        img.src = URL.createObjectURL(row.blob);
        img.alt = row.name;
        const name = document.createElement("p");
        name.textContent = `${row.name} · ${row.gender} · ${row.styleZh}`;
        const use = document.createElement("button");
        use.type = "button"; use.textContent = "用作组合服装";
        use.onclick = () => {
          const st = state();
          if (!st) return;
          if (composeUI()) composeUI().releaseUploadedImage();
          st.composition.second = { id: row.name, uploadUrl: URL.createObjectURL(row.blob) };
          if (composeUI()) composeUI().updateComposition();
          setStatus($("gen-status"), `已把“${row.name}”设为当前服装，去组合制作里生成成图。`);
          document.getElementById("compose-panel").scrollIntoView({ behavior: "smooth" });
        };
        const del = document.createElement("button");
        del.type = "button"; del.className = "compose-secondary"; del.textContent = "删除";
        del.onclick = async () => { await G.deleteMyCostume(row.id); await renderMyCostumes(); };
        const dl = document.createElement("button");
        dl.type = "button"; dl.className = "compose-secondary"; dl.textContent = "下载";
        dl.onclick = () => downloadBlob(row.blob, `${row.name}.png`);
        card.append(img, name, use, dl, del);
        grid.append(card);
      }
    } catch (err) {
      grid.innerHTML = "";
      const p = document.createElement("p");
      p.className = "muted"; p.textContent = err.message;
      grid.append(p);
    }
  }

  function bind() {
    if (!$("gen-panel")) return;
    fillConfigForm(G.loadConfig());
    refreshStyleOptions();
    void renderMyCostumes();

    $("gen-preset").onchange = () => {
      const preset = $("gen-preset").value;
      $("gen-base-url").disabled = preset !== "custom";
      if (preset !== "custom") $("gen-base-url").value = G.PRESETS[preset].baseUrl;
    };
    $("gen-save").onclick = () => {
      const config = readConfigFromForm();
      G.saveConfig(config);
      setStatus($("gen-status"), "已保存到本浏览器（只存本地，不上传仓库）。换电脑/清缓存后需重新填写。");
    };
    $("gen-clear").onclick = () => {
      G.clearConfig();
      fillConfigForm({ preset: "moosecloud", baseUrl: G.PRESETS.moosecloud.baseUrl, apiKey: "", model: "gpt-image-2", size: "1024x1024" });
      setStatus($("gen-status"), "已清除本浏览器里保存的渠道配置与 Key。");
    };
    $("costume-gender").onchange = refreshStyleOptions;

    $("gen-final").onclick = async () => {
      const st = state();
      const comp = st && st.composition;
      if (!comp || !comp.pose || !comp.second) {
        setStatus($("gen-status"), "请先在组合制作里选好姿势和服装（人物照片可选）。", true);
        return;
      }
      const config = readConfigFromForm();
      const button = $("gen-final");
      button.disabled = true;
      setStatus($("gen-status"), "正在生成…（按渠道速度，通常几十秒，请勿重复点击）");
      try {
        const blobs = [await G.blobForEntry(comp.pose), await G.blobForEntry(comp.second)];
        if (comp.person) blobs.push(await G.blobForEntry(comp.person));
        const prompt = G.buildFinalPrompt(comp, $("gen-extra").value);
        const result = await G.callEdits(config, prompt, blobs);
        const blob = await G.resultToBlob(result);
        showResult($("gen-result-img"), blob);
        $("gen-result").hidden = false;
        $("gen-download").onclick = () => downloadBlob(blob, `generated_${comp.pose.id}_${comp.second.id}.png`.replace(/[^\w.-]/g, "_"));
        setStatus($("gen-status"), "生成完成。注意：成图只参考了原图，拼板上的编号和边框不会出现在成图里。");
      } catch (err) {
        setStatus($("gen-status"), err.message || String(err), true);
      } finally {
        button.disabled = false;
      }
    };

    $("gen-costume").onclick = async () => {
      const config = readConfigFromForm();
      const gender = $("costume-gender").value;
      const styleId = $("costume-style").value;
      const styles = gender === "男装" ? G.MENS_STYLES : G.WOMENS_STYLES;
      const style = styles.find((s) => s.id === styleId) || styles[0];
      const button = $("gen-costume");
      button.disabled = true;
      setStatus($("costume-gen-status"), "正在生成服装…（按渠道速度，通常几十秒）");
      try {
        const prompt = G.buildCostumePrompt({
          gender, styleId,
          presentation: $("costume-presentation").value,
          details: $("costume-details").value,
        });
        const result = await G.callGenerations(config, prompt);
        const blob = await G.resultToBlob(result);
        const record = {
          id: `GEN-${Date.now()}`,
          name: `${gender === "男装" ? "M" : gender === "女装" ? "W" : "U"}-${style.id}-${new Date().toISOString().slice(0, 10)}`,
          gender, styleZh: style.zh, prompt, blob, createdAt: Date.now(),
        };
        try { await G.saveMyCostume(record); } catch (saveErr) { setStatus($("costume-gen-status"), `图片已生成但保存到“我的服装”失败：${saveErr.message}，请先下载。`); }
        showResult($("costume-result-img"), blob);
        $("costume-result").hidden = false;
        $("costume-download").onclick = () => downloadBlob(blob, `${record.name}.png`);
        $("costume-use").onclick = () => {
          const st = state();
          if (!st) return;
          if (composeUI()) composeUI().releaseUploadedImage();
          st.composition.second = { id: record.name, uploadUrl: URL.createObjectURL(blob) };
          if (composeUI()) composeUI().updateComposition();
          setStatus($("costume-gen-status"), `已把“${record.name}”设为当前服装。`);
        };
        await renderMyCostumes();
        setStatus($("costume-gen-status"), "服装生成完成，已保存到本浏览器的“我的服装”。生成图是你自己渠道出图，不属于原图库授权范围。");
      } catch (err) {
        setStatus($("costume-gen-status"), err.message || String(err), true);
      } finally {
        button.disabled = false;
      }
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();

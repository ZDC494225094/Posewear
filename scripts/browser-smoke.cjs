"use strict";

// Optional end-to-end smoke test. Uses an installed Chrome/Edge and Node.js 22+;
// never needed by the website itself.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const candidates = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium"
];
const browser = candidates.find((file) => file && fs.existsSync(file));
if (!browser) throw new Error("Chrome or Edge is required for this optional test");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "reference-gallery-smoke-"));
const galleryUrl = process.env.GALLERY_TEST_URL || pathToFileURL(path.join(__dirname, "..", "index.html")).href;
const chrome = spawn(browser, [
  "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
  "--disable-gpu", "--no-sandbox", "--remote-debugging-port=0",
  `--user-data-dir=${profile}`,
  galleryUrl
], { stdio: "ignore" });

async function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function main() {
  let port;
  for (let i = 0; i < 60; i++) {
    const file = path.join(profile, "DevToolsActivePort");
    if (fs.existsSync(file)) { port = +fs.readFileSync(file, "utf8").split("\n")[0]; break; }
    if (chrome.exitCode !== null) throw new Error(`Browser exited: ${chrome.exitCode}`);
    await sleep(100);
  }
  if (!port) throw new Error("Browser did not enable debugging");
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((p) => p.type === "page");
  assert.ok(page, "Missing browser tab");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const pending = new Map();
  let serial = 0;
  ws.onmessage = (message) => {
    const response = JSON.parse(message.data);
    if (!pending.has(response.id)) return;
    const [resolve, reject] = pending.get(response.id);
    pending.delete(response.id);
    if (response.error) reject(new Error(response.error.message));
    else resolve(response.result);
  };
  function command(method, params) {
    const id = ++serial;
    return new Promise((resolve, reject) => {
      pending.set(id, [resolve, reject]);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evalJs(expression) {
    const result = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }
  for (let i = 0; i < 80 && await evalJs("document.querySelectorAll('.card').length") !== 60; i++) await sleep(100);
  assert.equal(await evalJs("document.querySelectorAll('.card').length"), 60);
  assert.match(await evalJs("document.querySelector('#counts').textContent"), /2846/);
  assert.equal(await evalJs("getComputedStyle(document.body).backgroundColor"), "rgb(245, 245, 247)");
  assert.equal(await evalJs("document.querySelector('#tagline').textContent"), "灵感，从这里开始。");
  assert.equal(await evalJs("document.querySelector('#footer-note').textContent"),
    "ai-reference-gallery · 图片与原始数据版权归原作者ギア所有 · 该版本由 vculjp 整理维护");
  assert.equal(await evalJs("document.querySelector('#github-link').href"), "https://github.com/vculjp/ai-reference-gallery");
  assert.equal(await evalJs("document.querySelector('#x-link').href"), "https://x.com/uljpVc");
  assert.equal(await evalJs("document.querySelectorAll('#footer-social-nav a').length"), 2);
  const headerHeight = await evalJs("document.querySelector('.site-header').getBoundingClientRect().height");
  assert.ok(headerHeight < 290, `Hero should be compact, got ${headerHeight}px`);

  await evalJs("document.querySelector('#type-costume').click()");
  assert.equal(await evalJs("document.querySelectorAll('.card').length"), 60);
  assert.match(await evalJs("document.querySelector('.cover img').getAttribute('src')"), /^img\/costume\/[a-z-]+\/thumbs\//);
  assert.equal(await evalJs("new Promise(resolve=>{const img=document.querySelector('.cover img');if(img.complete)resolve(img.naturalWidth>0);else{img.onload=()=>resolve(true);img.onerror=()=>resolve(false)}})"), true);
  assert.equal(await evalJs("document.querySelector('#angle-filter').hidden"), true);
  assert.equal(await evalJs("document.querySelector('#view-filter').hidden"), true);
  assert.equal(await evalJs("document.querySelector('#series').hidden"), true);

  await evalJs("document.querySelector('#category').value='summer';document.querySelector('#category').dispatchEvent(new Event('change',{bubbles:true}))");
  assert.match(await evalJs("document.querySelector('#result').textContent"), /254/);
  await evalJs("document.querySelector('#load-more').click()");
  assert.equal(await evalJs("document.querySelectorAll('.card').length"), 120);
  await evalJs("document.querySelector('#reset').click()");
  assert.equal(await evalJs("document.querySelector('#category').value"), "");

  await evalJs("document.querySelector('#query').value='SPR-0001';document.querySelector('#query').dispatchEvent(new Event('input',{bubbles:true}))");
  assert.equal(await evalJs("document.querySelectorAll('.card').length"), 1);
  await evalJs("document.querySelector('.card').click()");
  assert.equal(await evalJs("document.querySelector('#overlay').hidden"), false);
  assert.match(await evalJs("document.querySelector('#largeImage').getAttribute('src')"), /^img\/costume\/[a-z-]+\/preview\//);
  assert.equal(await evalJs("new Promise(resolve=>{const img=document.querySelector('#largeImage');if(img.complete)resolve(img.naturalWidth>0);else{img.onload=()=>resolve(true);img.onerror=()=>resolve(false)}})"), true);
  assert.match(await evalJs("document.querySelector('#download').getAttribute('href')"), /^img\/costume\/[a-z-]+\/original\//);
  await evalJs("document.querySelector('#close').click();document.querySelector('#lang-en').click()");
  assert.equal(await evalJs("document.querySelector('#type-costume').textContent"), "Costumes");
  assert.equal(await evalJs("document.querySelector('#collection-title').textContent"), "Explore outfits");
  await evalJs("document.querySelector('#type-pose').click()");
  assert.equal(await evalJs("document.querySelectorAll('.card').length"), 60);
  assert.equal(await evalJs("document.querySelector('#collection-title').textContent"), "Explore poses");
  assert.equal(await evalJs("document.querySelector('#angle-filter').hidden"), false);
  assert.match(await evalJs("document.querySelector('.cover img').getAttribute('src')"), /^img\/pose\/[a-z-]+\/thumbs\//);
  assert.equal(await evalJs("new Promise(resolve=>{const img=document.querySelector('.cover img');if(img.complete)resolve(img.naturalWidth>0);else{img.onload=()=>resolve(true);img.onerror=()=>resolve(false)}})"), true);
  await command("Emulation.setDeviceMetricsOverride", {
    width: 390, height: 844, deviceScaleFactor: 1, mobile: true
  });
  assert.equal(await evalJs("document.documentElement.scrollWidth <= window.innerWidth"), true);
  assert.equal(await evalJs("['github-link','x-link'].every(id=>{const r=document.getElementById(id).getBoundingClientRect();return r.width>0 && r.right<=window.innerWidth})"), true);
  assert.equal(await evalJs("getComputedStyle(document.querySelector('.grid')).gridTemplateColumns.trim().split(/\\s+/).length"), 2);
  await evalJs("document.querySelector('#type-pose').click();document.querySelector('.card').click();document.querySelector('#add-to-compose').click()");
  assert.equal(await evalJs("document.querySelector('#type-costume').getAttribute('aria-pressed')"), "true");
  await evalJs("document.querySelector('.card').click();document.querySelector('#add-to-compose').click()");
  assert.equal(await evalJs("document.querySelector('#compose-panel').hidden"), false);
  assert.equal(await evalJs("document.querySelector('#compose-local-notice').hidden"),
    /^https?:/.test(galleryUrl));
  assert.match(await evalJs("document.querySelector('#compose-local-step').textContent"), /img.*pose.*costume/);
  assert.equal(await evalJs("document.querySelector('#browser-panel').hidden"), true);
  assert.equal(await evalJs("document.querySelector('#compose-download').disabled"), false);
  await evalJs("new Promise(r=>setTimeout(r,400))");
  assert.equal(await evalJs("document.querySelector('#compose-canvas').width"), 1200);
  await evalJs("document.querySelector('#compose-layout').value='vertical';document.querySelector('#compose-layout').dispatchEvent(new Event('change'))");
  await evalJs("new Promise(r=>setTimeout(r,400))");
  assert.equal(await evalJs("document.querySelector('#compose-canvas').width"), 800);
  assert.equal(await evalJs("document.querySelector('#compose-canvas').height"), 1200);
  await evalJs("document.querySelector('#compose-swap').click();document.querySelector('#compose-labels').click()");
  assert.equal(await evalJs("document.documentElement.scrollWidth <= window.innerWidth"), true);
  await evalJs("document.querySelector('#type-costume').click()");
  assert.equal(await evalJs("document.documentElement.scrollWidth <= window.innerWidth"), true);
  assert.equal(await evalJs("getComputedStyle(document.querySelector('.grid')).gridTemplateColumns.trim().split(/\\s+/).length"), 2);
  await evalJs("document.querySelector('.card').click()");
  assert.equal(await evalJs("document.querySelector('#dialog').getBoundingClientRect().width <= window.innerWidth"), true);
  await evalJs("document.querySelector('#close').click();document.querySelector('#lang-ja').click()");
  assert.equal(await evalJs("document.querySelector('#social-nav').getAttribute('aria-label')"), "プロジェクトとSNS");
  assert.equal(await evalJs("document.querySelector('#collection-title').textContent"), "衣装を探す");
  assert.equal(await evalJs("document.querySelector('#dialog').getAttribute('aria-label')"), "衣装画像プレビュー");
  assert.equal(await evalJs("['姿势','图库','服装','搜索','筛选','预览','下载','重置','关闭'].filter(x=>document.body.innerText.includes(x)).join(',')"), "");
  assert.match(await evalJs("getComputedStyle(document.body).fontFamily"), /Yu Gothic|Meiryo/);
  await evalJs("document.querySelector('#type-pose').click()");
  assert.equal(await evalJs("['姿势','图库','服装','搜索','筛选','预览','下载','重置','关闭'].filter(x=>document.body.innerText.includes(x)).join(',')"), "");
  await evalJs("document.querySelector('#type-costume').click()");
  await command("Emulation.setDeviceMetricsOverride", {
    width: 320, height: 700, deviceScaleFactor: 1, mobile: true
  });
  assert.equal(await evalJs("document.documentElement.scrollWidth <= window.innerWidth"), true);
  assert.equal(await evalJs("getComputedStyle(document.querySelector('.grid')).gridTemplateColumns.trim().split(/\\s+/).length"), 2);
  await evalJs("document.querySelector('#type-pose').click();document.querySelector('.card').click();document.querySelector('#add-to-compose').click()");
  assert.equal(await evalJs("document.querySelector('#type-costume').getAttribute('aria-pressed')"), "true");
  await evalJs("document.querySelector('.card').click();document.querySelector('#add-to-compose').click()");
  assert.equal(await evalJs("document.querySelector('#compose-panel').hidden"), false);
  assert.equal(await evalJs("document.querySelector('#compose-download').disabled"), false);
  assert.equal(await evalJs("document.querySelector('#compose-placeholder').hidden"), true);
  await evalJs("document.querySelector('#compose-layout').value='vertical';document.querySelector('#compose-layout').dispatchEvent(new Event('change'))");
  assert.equal(await evalJs("document.querySelector('#compose-size').textContent"), "1600 × 2400 PNG");
  if (/^https?:/.test(galleryUrl)) {
    assert.equal(await evalJs("ReferenceComposition.needsFolder()"), false);
    assert.equal(await evalJs("document.querySelector('#compose-local-notice').hidden"), true);
    await command("Page.setDownloadBehavior", { behavior: "allow", downloadPath: profile });
    await evalJs("document.querySelector('#compose-download').click()");
    let pngFile;
    for (let i = 0; i < 100; i++) {
      pngFile = fs.readdirSync(profile).find((name) => name.endsWith(".png"));
      if (pngFile) break;
      await sleep(150);
    }
    assert.ok(pngFile, "Online composition must download PNG without a folder prompt");
    const contents = fs.readFileSync(path.join(profile, pngFile));
    assert.ok(contents.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")));
    assert.equal(contents.readUInt32BE(16), 1600);
    assert.equal(contents.readUInt32BE(20), 2400);
    assert.ok(contents.length > 10000);
    assert.equal(await evalJs("document.querySelector('#compose-status').textContent"),
      await evalJs("ReferenceGalleryI18n.t('composeSaved')"));
    console.log("PASS: HTTP same-origin gallery downloads 1600x2400 PNG without image-folder authorization");
    ws.close();
    return;
  }
  const exportCheck = await evalJs(`(async()=>{
    const paths=[state.composition.pose.original,state.composition.second.original];
    const fake=[];
    for(let k=0;k<2;k++){
      const c=document.createElement('canvas');c.width=80;c.height=100;
      const ctx=c.getContext('2d');ctx.fillStyle=k?'#0044ff':'#ff3300';ctx.fillRect(0,0,80,100);
      const blob=await new Promise(r=>c.toBlob(r,'image/png'));
      const f=new File([blob],paths[k].split('/').at(-1),{type:'image/png'});
      Object.defineProperty(f,'webkitRelativePath',{value:'project/'+paths[k]});
      fake.push(f);
    }
    const count=ReferenceComposition.setFiles(fake);
    const output=await ReferenceComposition.exportPNG({...state.composition,layout:'vertical'});
    const image=await createImageBitmap(output);
    const test=document.createElement('canvas');test.width=image.width;test.height=image.height;
    const tc=test.getContext('2d');tc.drawImage(image,0,0);
    const a=Array.from(tc.getImageData(800,600,1,1).data).slice(0,3);
    const b=Array.from(tc.getImageData(800,1800,1,1).data).slice(0,3);
    await composeUI.uploadSecondImage(fake[1]);
    const uploaded=state.composition.second.uploadUrl.startsWith('blob:');
    const uploadedPNG=await ReferenceComposition.exportPNG({...state.composition,layout:'horizontal'});
    return [count,output.type,output.size,image.width,image.height,a.join(','),b.join(','),uploaded,uploadedPNG.size];
  })()`);
  assert.equal(exportCheck[0], 2);
  assert.equal(exportCheck[1], "image/png");
  assert.ok(exportCheck[2] > 1000, "Composed PNG should contain image data");
  assert.equal(exportCheck[3], 1600);
  assert.equal(exportCheck[4], 2400);
  assert.notEqual(exportCheck[5], exportCheck[6], "Both source images must appear in the output");
  assert.equal(exportCheck[7], true, "Custom uploaded image should be selected");
  assert.ok(exportCheck[8] > 1000, "Custom upload should be exportable offline");
  assert.equal(await evalJs("composeUI.updateComposition();document.querySelector('#compose-local-notice').hidden"), true);
  const wrongFolderCheck = await evalJs(`(async()=>{
    const f=new File(['wrong'],'other.png',{type:'image/png'});
    Object.defineProperty(f,'webkitRelativePath',{value:'img/not-the-selected-original/other.png'});
    ReferenceComposition.setFiles([f]);
    let error;
    try { await ReferenceComposition.checkLocalAccess([state.composition.pose, state.composition.second]); }
    catch(e) { error=e.message; }
    ReferenceComposition.clearFiles();
    return [error,ReferenceComposition.needsFolder()];
  })()`);
  assert.ok(["LOCAL_ACCESS_REQUIRED", "LOCAL_IMAGE_NOT_FOUND"].includes(wrongFolderCheck[0]));
  assert.equal(wrongFolderCheck[1], true, "An invalid selection must allow re-authorizing the folder");
  assert.equal(await evalJs("composeUI.updateComposition();document.querySelector('#compose-local-notice').hidden"), false);
  assert.equal(await evalJs("document.documentElement.scrollWidth <= window.innerWidth"), true);
  await evalJs("document.querySelector('#lang-ja').click()");
  assert.equal(await evalJs("document.querySelector('#type-compose').textContent"), "組み合わせ");
  assert.equal(await evalJs("document.querySelector('#compose-download').textContent"), "PNGをダウンロード");
  await evalJs("document.querySelector('#lang-en').click()");
  assert.equal(await evalJs("document.querySelector('#type-compose').textContent"), "Compose");
  console.log("PASS: composition selection, vertical layout and offline PNG export via user-selected files");
  console.log("PASS: desktop/mobile style, 60/120-card pagination, category filters, costume search, preview, download, i18n and pose switch");
  ws.close();
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  chrome.kill();
  // Leave the temporary profile to the OS if Chrome is still shutting down.
});

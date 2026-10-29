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
const chrome = spawn(browser, [
  "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
  "--disable-gpu", "--no-sandbox", "--remote-debugging-port=0",
  `--user-data-dir=${profile}`,
  pathToFileURL(path.join(__dirname, "..", "index.html")).href
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
  await evalJs("document.querySelector('#type-pose').click()");
  assert.equal(await evalJs("document.querySelectorAll('.card').length"), 60);
  assert.equal(await evalJs("document.querySelector('#angle-filter').hidden"), false);
  assert.match(await evalJs("document.querySelector('.cover img').getAttribute('src')"), /^img\/pose\/[a-z-]+\/thumbs\//);
  assert.equal(await evalJs("new Promise(resolve=>{const img=document.querySelector('.cover img');if(img.complete)resolve(img.naturalWidth>0);else{img.onload=()=>resolve(true);img.onerror=()=>resolve(false)}})"), true);
  console.log("PASS: real browser offline load, 60/120-card pagination, category filters, costume search, preview, download, language and pose switch");
  ws.close();
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  chrome.kill();
  // Leave the temporary profile to the OS if Chrome is still shutting down.
});

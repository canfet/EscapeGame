#!/usr/bin/env node
/**
 * 手機版面自動檢查：用 Chrome（headless）依序開幾種手機尺寸，檢查
 *   1. 頁面是否有橫向捲動
 *   2. 是否有元素超出螢幕右側
 *   3. 可點的按鈕／連結是否小於 40px（不好點）
 *   4. 卡片（.tcg）的文字是否被裁掉
 * 並可選擇存下截圖，方便肉眼確認。
 *
 * 用法（先在專案資料夾啟動本機伺服器：python -m http.server 8000）：
 *   node tools/mobilecheck.js                         # 檢查 index.html、admin.html、board.html
 *   node tools/mobilecheck.js http://localhost:8000/index.html?p=xxx
 *   node tools/mobilecheck.js --shots out/            # 另外把每個尺寸的截圖存到 out/
 * 需要 Node 22 以上與已安裝的 Chrome／Edge（找不到時用環境變數 CHROME_PATH 指定）。
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SIZES = [[320, 568], [360, 640], [390, 844], [412, 915]];
const args = process.argv.slice(2);
let shots = null;
const urls = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--shots') shots = args[++i] || 'mobilecheck-shots';
  else urls.push(args[i]);
}
if (!urls.length) ['index.html', 'admin.html', 'board.html'].forEach(p => urls.push('http://localhost:8000/' + p));

function findChrome() {
  const c = [process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return c.find(p => p && fs.existsSync(p));
}

/** 在頁面內執行的檢查 */
function pageCheck() {
  const W = document.documentElement.clientWidth, out = { scrollX: document.documentElement.scrollWidth > W + 1, over: [], small: [], clipped: [] };
  const name = e => (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '') || e.tagName.toLowerCase();
  document.querySelectorAll('body *').forEach(e => {
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden' || e.closest('.hidden')) return;
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height) return;
    if (r.right > W + 2 && !e.closest('.table-wrap, .stage-wrap, .stage-list, .leaflet-container, #g-stages, pre')) out.over.push(name(e) + ' → ' + Math.round(r.right) + 'px');
    if (/^(BUTTON|A)$/.test(e.tagName) && !e.closest('.leaflet-control-attribution') && cs.position !== 'absolute' && Math.min(r.width, r.height) < 36 && (e.textContent.trim() || e.getAttribute('aria-label'))) out.small.push(name(e) + ' ' + Math.round(r.width) + '×' + Math.round(r.height));
  });
  document.querySelectorAll('.tcg').forEach(t => {
    if (t.classList.contains('mini')) return;
    const i = t.querySelector('.tcg-in');
    if (t.scrollHeight > t.clientHeight + 2 || (i && i.scrollHeight > i.clientHeight + 2)) out.clipped.push(name(t));
  });
  ['over', 'small', 'clipped'].forEach(k => { out[k] = Array.from(new Set(out[k])).slice(0, 8); });
  return out;
}

async function main() {
  const chrome = findChrome();
  if (!chrome) { console.error('找不到 Chrome／Edge，請用環境變數 CHROME_PATH 指定。'); process.exit(2); }
  const port = 9300 + Math.floor(Math.random() * 500);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mobilecheck-'));
  const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + port, '--user-data-dir=' + dir, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  let ws;
  try {
    let list;
    for (let i = 0; i < 50 && !list; i++) {
      try { list = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); } catch (e) { await new Promise(r => setTimeout(r, 200)); }
    }
    if (!list) throw new Error('Chrome 沒有啟動成功');
    const target = list.find(t => t.type === 'page');
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0; const wait = {};
    ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && wait[d.id]) { wait[d.id](d); delete wait[d.id]; } };
    const send = (method, params) => new Promise(res => { const n = ++id; wait[n] = res; ws.send(JSON.stringify({ id: n, method, params: params || {} })); });
    if (shots) fs.mkdirSync(shots, { recursive: true });

    let problems = 0;
    for (const url of urls) {
      console.log('\n▶ ' + url);
      for (const [w, h] of SIZES) {
        await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
        await send('Page.navigate', { url });
        await new Promise(r => setTimeout(r, 2500));
        const r = await send('Runtime.evaluate', { expression: '(' + pageCheck.toString() + ')()', returnByValue: true });
        const v = r.result && r.result.result && r.result.result.value;
        if (!v) { console.log('  ' + w + '×' + h + '  ⚠ 無法檢查'); continue; }
        const bad = v.scrollX || v.over.length || v.clipped.length, warn = v.small.length;
        problems += bad ? 1 : 0;
        console.log('  ' + w + '×' + h + '  ' + (bad ? '❌' : warn ? '⚠️ ' : '✅') +
          (v.scrollX ? ' 橫向捲動' : '') + (v.over.length ? ' 超出右側：' + v.over.join('、') : '') +
          (v.clipped.length ? ' 卡片被裁：' + v.clipped.join('、') : '') + (warn ? ' 偏小：' + v.small.join('、') : ''));
        if (shots) {
          const s = await send('Page.captureScreenshot', { format: 'png' });
          fs.writeFileSync(path.join(shots, url.replace(/[^a-z0-9]+/gi, '_').slice(-40) + '_' + w + 'x' + h + '.png'), Buffer.from(s.result.data, 'base64'));
        }
      }
    }
    console.log('\n' + (problems ? '有 ' + problems + ' 個尺寸需要處理' : '全部尺寸都沒有版面問題'));
    process.exitCode = problems ? 1 : 0;
  } finally {
    try { ws && ws.close(); } catch (e) { /* */ }
    proc.kill();
    setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* */ } }, 800);
  }
}
main().catch(e => { console.error(e.message || e); process.exit(2); });

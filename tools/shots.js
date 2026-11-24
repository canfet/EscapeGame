#!/usr/bin/env node
/**
 * 體驗套版瀏覽器驗證：啟動模擬後端（tools/mockserver.js）＋ headless Chrome，
 * 依序走完「介紹 → 開始 → 主畫面 → 進關卡 → 打卡 → 答錯 → 答對 → 完賽」並截圖到 shots/。
 *
 * 用法：
 *   node tools/shots.js                      # 6 個套版各搭配建議主題 ＋ rpg+neon、academy+mist
 *   node tools/shots.js rpg detective:mist   # 只跑指定組合（套版[:主題]）
 *   node tools/shots.js --size 320x568 rpg   # 改用其他螢幕尺寸（檔名會加上尺寸）
 * 環境變數：CHROME_PATH 指定 Chrome 路徑。需要 Node 22 以上（內建 WebSocket）。
 * 檔名：shots/<套版>[-<主題>][-<尺寸>]-<步驟>.png；主控台錯誤會印在最後。
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mock = require('./mockserver');

const SUGGEST = { classic: 'retro', rpg: 'forest', detective: 'history', agent: 'neon', pirate: 'ocean', academy: 'campus' };
const args = process.argv.slice(2);
let W = 390, H = 844, combos = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--size') { const m = /^(\d+)x(\d+)$/.exec(args[++i] || ''); if (m) { W = +m[1]; H = +m[2]; } }
  else combos.push(args[i]);
}
if (!combos.length) combos = Object.keys(SUGGEST).concat(['rpg:neon', 'academy:mist']);

const sleep = ms => new Promise(r => setTimeout(r, ms));
function findChrome() {
  return [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => p && fs.existsSync(p));
}

async function main() {
  const chrome = findChrome();
  if (!chrome) { console.error('找不到 Chrome，請設定 CHROME_PATH'); process.exit(2); }
  const srv = await mock.start(0);
  const base = 'http://localhost:' + srv.address().port;
  const port = 9300 + Math.floor(Math.random() * 500);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shots-'));
  const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + port, '--user-data-dir=' + dir, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  const outDir = path.join(__dirname, '..', 'shots');
  fs.mkdirSync(outDir, { recursive: true });
  let ws, count = 0;
  const errors = [], warns = [];
  let cur = '';
  try {
    let list;
    for (let i = 0; i < 50 && !list; i++) { try { list = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); } catch (e) { await sleep(200); } }
    if (!list) throw new Error('Chrome 沒有啟動成功');
    ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0; const wait = {};
    ws.onmessage = m => {
      const d = JSON.parse(m.data);
      if (d.id && wait[d.id]) { wait[d.id](d); delete wait[d.id]; return; }
      if (d.method === 'Runtime.exceptionThrown') errors.push(cur + ' 例外：' + ((d.params.exceptionDetails.exception || {}).description || d.params.exceptionDetails.text).split('\n')[0]);
      else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push(cur + ' console.error：' + d.params.args.map(a => a.value || a.description || '').join(' ').slice(0, 200));
      else if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error' && !/vibrate|tile|openstreetmap|ERR_INTERNET|ERR_NAME|ERR_CONNECTION|favicon/i.test(d.params.entry.text + d.params.entry.url)) errors.push(cur + ' log：' + d.params.entry.text + ' ' + (d.params.entry.url || ''));
    };
    const send = (method, params) => new Promise(res => { const n = ++id; wait[n] = res; ws.send(JSON.stringify({ id: n, method, params: params || {} })); });
    const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result && r.result.result && r.result.result.value; };
    await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
    await send('Network.enable');
    // 地圖圖磚等外部資源離線：直接擋掉，加快載入
    await send('Network.setBlockedURLs', { urls: ['*tile.openstreetmap*', '*fonts.googleapis*', '*fonts.gstatic*', '*basemaps.cartocdn*'] });
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true });

    const vis = sel => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;var r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'&&!e.closest('.hidden')})()`);
    const waitFor = async (sel, ms) => { for (let t = 0; t < (ms || 6000); t += 100) { if (await vis(sel)) return true; await sleep(100); } return false; };
    const click = async sel => { const ok = await ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;e.click();return true})()`); if (!ok) errors.push(cur + ' 找不到可點元素 ' + sel); return ok; };
    const fill = sel => async v => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;e.focus();e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
    // 版面檢查：橫向捲動、超出右側的元素、過小的按鈕（跟 mobilecheck 同標準，但在遊戲各步驟執行）
    const layoutCheck = async name => {
      const v = await ev(`(function(){var W=document.documentElement.clientWidth,o=[],sm=[];
        if(document.documentElement.scrollWidth>W+1)o.push('頁面橫向捲動');
        document.querySelectorAll('body *').forEach(function(e){var cs=getComputedStyle(e);if(cs.display==='none'||cs.visibility==='hidden'||e.closest('.hidden,.table-wrap,.stage-list,.leaflet-container,#fx-canvas,.leaflet-control-container'))return;
          var r=e.getBoundingClientRect();if(!r.width||!r.height)return;
          var n=(e.id?'#'+e.id:'')+(typeof e.className==='string'&&e.className?'.'+e.className.trim().split(/\\s+/)[0]:'')||e.tagName;
          if(r.right>W+2&&cs.position!=='fixed'&&!e.closest('#sheet-body'))o.push(n+' 右緣 '+Math.round(r.right));
          if(/^(BUTTON|A)$/.test(e.tagName)&&cs.position!=='absolute'&&Math.min(r.width,r.height)<36&&(e.textContent.trim()||e.getAttribute('aria-label')))sm.push(n+' '+Math.round(r.width)+'x'+Math.round(r.height))});
        return {o:Array.from(new Set(o)).slice(0,6),sm:Array.from(new Set(sm)).slice(0,6)}})()`);
      if (v && v.o.length) errors.push(cur + ' [' + name + '] 版面：' + v.o.join('、'));
      if (v && v.sm.length) warns.push(cur + ' [' + name + '] 按鈕偏小：' + v.sm.join('、'));
    };
    const shot = async name => {
      if (/^(3-game|4-stage-open|5-arrived|7b-solved|10-finish)$/.test(name)) await layoutCheck(name);
      const s = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(outDir, cur + '-' + name + '.png'), Buffer.from(s.result.data, 'base64')); count++;
    };
    const closeDlg = async () => { for (let i = 0; i < 8; i++) { if (await vis('#dialog')) await click('#dialog'); else if (await vis('#tutorial')) await click('#tut-skip'); else if (await vis('#cf-cancel')) await click('#cf-cancel'); else break; await sleep(400); } };
    const scrollSheet = y => ev(`(function(){var b=document.querySelector('#sheet-body');if(b)b.scrollTop=${y}})()`);
    const dismiss = async () => { for (const sel of ['#tut-skip', '#levelup', '#confirm .ghost']) { if (await vis(sel)) await click(sel); } };

    for (const combo of combos) {
      const [tpl, theme0] = combo.split(':');
      const theme = theme0 || SUGGEST[tpl];
      cur = tpl + (theme0 ? '-' + theme0 : '') + (W !== 390 ? '-' + W : '');
      await fetch(base + '/__reset'); await fetch(base + `/__set?tpl=${tpl}&theme=${theme}`);
      await send('Page.navigate', { url: base + '/index.html?p=demo' });
      await sleep(600);
      await ev('try{localStorage.clear();sessionStorage.clear()}catch(e){}');
      await send('Page.navigate', { url: base + '/index.html?p=demo' });
      if (!await waitFor('#v-intro')) { errors.push(cur + ' 介紹頁沒出現'); continue; }
      await sleep(500);
      await fill('#f-team')('勇者小隊');
      await shot('1-intro');
      await ev('window.scrollTo(0, document.body.scrollHeight)'); await sleep(200); await shot('1b-intro-bottom');
      await click('#btn-start');
      await waitFor('#v-game'); await sleep(900);
      if (await vis('#tutorial')) { await shot('2-tutorial'); await click('#tut-skip'); await sleep(400); }
      await sleep(2500);   // 開場對話
      await shot('3-game');
      await ev('window.__sy = window.scrollY'); const sy = await ev('window.scrollY'); if (sy > 0) errors.push(cur + ' 進入主畫面後頁面已被捲動 scrollY=' + sy);
      await closeDlg(); await sleep(500);
      if (await vis('#tutorial')) { await shot('2-tutorial'); await click('#tut-skip'); await sleep(400); }
      await ev('window.scrollTo(0, 500)'); await sleep(200); await shot('3b-game-list');
      await ev('window.scrollTo(0, 0)');
      // 進第 1 關
      await click('#g-stages .stage-card.open');
      await waitFor('#sheet-body'); await sleep(600);
      await shot('4-stage-open');
      await sleep(2500); await shot('4b-stage-open-later');
      await closeDlg(); await shot('4b2-dialog-closed');
      await scrollSheet(99999); await sleep(250); await shot('4c-stage-open-bottom');
      await fill('#s-code')('0000'); await click('#s-code-btn');
      await sleep(900); await shot('5-arrived');
      await sleep(2500); await closeDlg(); await scrollSheet(99999); await sleep(200); await shot('5b-arrived-bottom'); await scrollSheet(0);
      // 答錯
      await fill('#s-ans')('9999'); await click('#s-submit');
      await sleep(250); await shot('6-wrong-shake');
      await sleep(1500); await shot('6b-wrong');
      // 提示
      if (await vis('#s-hint')) { await click('#s-hint'); await sleep(300); if (await vis('#cf-ok')) await click('#cf-ok'); await sleep(900); await shot('6c-hint'); }
      // 答對
      await fill('#s-ans')('1111'); await click('#s-submit');
      await sleep(500); await shot('7-solved-fx');
      await sleep(2200); await shot('7b-solved');
      // 第 2、3 關
      for (const [n, ans] of [[2, '2222'], [3, '3333']]) {
        if (await vis('#solved-next')) await click('#solved-next'); else if (await vis('#solved-close')) await click('#solved-close');
        await sleep(700);
        await dismiss();
        if (!await vis('#s-ans')) {
          await sleep(500);
          await click('#g-stages .stage-card.arrived') || await click('#g-stages .stage-card.open');
          await waitFor('#s-ans');
        }
        await sleep(500);
        if (n === 2) await shot('8-stage2');
        await fill('#s-ans')(ans); await click('#s-submit');
        await sleep(n === 3 ? 600 : 1800);
        if (n === 3) await shot('9-final-solved');
      }
      await sleep(2500);
      if (await vis('#v-finish')) { await sleep(600); await shot('10-finish'); }
      else if (await vis('#solved')) { await shot('9b-solved-final'); await click('#solved-next'); await sleep(2500); await shot('10-finish'); }
      else { await shot('10-after'); errors.push(cur + ' 沒有進入完賽畫面'); }
      if (await vis('#v-finish')) { await ev('window.scrollTo(0, document.body.scrollHeight)'); await sleep(300); await shot('10b-finish-bottom'); }
    }
  } finally {
    try { ws && ws.close(); } catch (e) { /* */ }
    proc.kill(); srv.close();
    setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* */ } }, 800);
  }
  console.log('截圖 ' + count + ' 張 → shots/');
  const uniq = Array.from(new Set(errors));
  const uw = Array.from(new Set(warns));
  if (uw.length) console.log('提醒 ' + uw.length + ' 筆：\n  ' + uw.join('\n  '));
  console.log(uniq.length ? 'Console／流程問題 ' + uniq.length + ' 筆：\n  ' + uniq.join('\n  ') : 'Console 沒有錯誤');
  process.exit(0);
}
main().catch(e => { console.error(e.message || e); process.exit(2); });

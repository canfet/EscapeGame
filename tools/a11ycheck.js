#!/usr/bin/env node
/** 無障礙實測（headless Chrome + 模擬後端）：焦點圈住、彈窗焦點還原、NPC 通報、表情符號隱藏、標題焦點。用法：node tools/a11ycheck.js [tpl] */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const mock = require('./mockserver');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => p && fs.existsSync(p));
(async () => {
  const tpl = process.argv[2] || 'rpg';
  const srv = await mock.start(0), base = 'http://localhost:' + srv.address().port, port = 9800 + Math.floor(Math.random() * 100);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-'));
  const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + port, '--user-data-dir=' + dir, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  const res = [];
  const ok = (n, c, x) => res.push((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : ''));
  try {
    let list;
    for (let i = 0; i < 50 && !list; i++) { try { list = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); } catch (e) { await sleep(200); } }
    const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise(r => { ws.onopen = r; });
    let id = 0; const wait = {}; const errs = [];
    ws.onmessage = m => {
      const d = JSON.parse(m.data);
      if (d.id && wait[d.id]) { wait[d.id](d); delete wait[d.id]; }
      else if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.text + ' ' + ((d.params.exceptionDetails.exception || {}).description || ''));
    };
    const send = (method, params) => new Promise(r => { const n = ++id; wait[n] = r; ws.send(JSON.stringify({ id: n, method, params: params || {} })); });
    const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
    const key = async (k, shift) => {
      const code = k === 'Tab' ? 9 : 27;
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: code, modifiers: shift ? 8 : 0 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: code, modifiers: shift ? 8 : 0 });
    };
    const vis = s => ev(`(function(){var e=document.querySelector(${JSON.stringify(s)});if(!e)return false;var r=e.getBoundingClientRect();return r.width>0&&r.height>0&&!e.closest('.hidden')})()`);
    const waitFor = async (s, ms) => { for (let t = 0; t < (ms || 6000); t += 100) { if (await vis(s)) return true; await sleep(100); } return false; };
    const click = s => ev(`(function(){var e=document.querySelector(${JSON.stringify(s)});if(e)e.click();return !!e})()`);
    const inside = s => ev(`document.querySelector(${JSON.stringify(s)}).contains(document.activeElement)`);
    const active = () => ev('document.activeElement&&(document.activeElement.id||document.activeElement.tagName)');
    await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
    await send('Network.setBlockedURLs', { urls: ['*tile.openstreetmap*', '*fonts.g*', '*basemaps.cartocdn*'] });
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await fetch(base + '/__reset'); await fetch(base + '/__set?tpl=' + tpl);
    await send('Page.navigate', { url: base + '/index.html?p=demo' }); await sleep(600);
    await ev('try{localStorage.clear()}catch(e){}');
    await send('Page.navigate', { url: base + '/index.html?p=demo' });
    ok('介紹頁出現', await waitFor('#v-intro')); await sleep(500);
    ok('換畫面後焦點在標題', await ev('document.activeElement && /^H[12]$/.test(document.activeElement.tagName)'), await active());
    ok('有 main 地標與跳轉連結', await ev('!!document.querySelector("main#main") && !!document.querySelector("a.skip-link")'));
    await ev('(function(){var e=document.querySelector("#f-team");e.focus();e.value="測試隊";e.dispatchEvent(new Event("input",{bubbles:true}))})()');
    await click('#btn-start'); await waitFor('#v-game'); await sleep(900);
    for (let i = 0; i < 3 && await vis('#tutorial'); i++) {
      ok('教學彈窗開啟時焦點在彈窗內', await inside('#tutorial'), await active());
      for (let k = 0; k < 6; k++) await key('Tab');
      ok('教學彈窗按 Tab 6 次焦點仍在彈窗內', await inside('#tutorial'), await active());
      await key('Tab', true);
      ok('Shift+Tab 仍在彈窗內', await inside('#tutorial'), await active());
      await click('#tut-skip'); await sleep(400); if (await vis('#cf-ok')) await click('#cf-ok'); await sleep(300);
    }
    let tutTested = false;
    for (let i = 0; i < 12; i++) {
      if (await vis('#dialog')) { await click('#dialog'); await sleep(300); }
      else if (await vis('#cf-ok')) { await click('#cf-ok'); await sleep(300); }
      else if (await vis('#tutorial')) {
        if (!tutTested) {
          tutTested = true;
          ok('教學彈窗(後出現)焦點在彈窗內', await inside('#tutorial'), await active());
          for (let k = 0; k < 8; k++) await key('Tab');
          ok('教學彈窗按 Tab 8 次焦點仍在彈窗內', await inside('#tutorial'), await active());
        }
        await click('#tut-skip'); await sleep(400);
      } else await sleep(300);
    }
    ok('遊戲畫面有 h1', await ev('!!document.querySelector("h1#g-title") && document.querySelector("h1#g-title").textContent.length>0'));
    ok('地圖有文字說明', await ev('!!document.querySelector("#g-map").getAttribute("aria-label")'));
    ok('按鈕開頭表情符號已隱藏（我與目標）', await ev('!!document.querySelector("#btn-both [aria-hidden=true]") && document.querySelector("#btn-both").textContent.indexOf("我與目標")>=0'));
    ok('排行榜容器是 list', await ev('document.querySelector("#board-rows").getAttribute("role")==="list"'));
    ok('頂端列只剩背包與設定（無散落的音效／大字鈕）', await ev('(function(){var t=document.querySelector("#v-game .topbar");return !t.querySelector("#btn-sound")&&!t.querySelector("#btn-font")&&!!t.querySelector("#btn-settings")})()'));
    await click('#btn-settings'); await sleep(300);
    ok('設定選單開啟並含音效、大字', (await vis('#settings-menu')) && (await vis('#btn-sound')) && (await vis('#btn-font')), await ev('document.querySelector("#btn-settings").getAttribute("aria-expanded")'));
    const shotp = await send('Page.captureScreenshot', { format: 'png' }); fs.mkdirSync(path.join(__dirname, '..', 'shots'), { recursive: true }); fs.writeFileSync(path.join(__dirname, '..', 'shots', 'settings-open-' + tpl + '.png'), Buffer.from(shotp.result.data, 'base64'));
    const bt0 = await ev('document.documentElement.classList.contains("big-text")');
    await click('#btn-font'); await sleep(200);
    ok('設定內的大字鈕可切換', (await ev('document.documentElement.classList.contains("big-text")')) !== bt0);
    await click('#btn-font'); await key('Escape'); await sleep(300);
    ok('Esc 關閉設定選單', !(await vis('#settings-menu')));
    await ev('(function(){var s=document.getElementById("sr-live");if(s)s.textContent=""})()');
    await click('#g-stages .stage-card.open'); await waitFor('#sheet-body'); await sleep(900);
    const live = await ev('(document.getElementById("sr-live")||{}).textContent||""');
    if (tpl !== 'classic') ok('NPC 開場台詞用 sr-live 一次通報', live.length > 4, JSON.stringify(live));
    ok('氣泡本身不是 live 區域', await ev('(function(){var b=document.querySelector(".npc-bubble");return !b||(!b.getAttribute("aria-live")&&!b.getAttribute("role"))})()'));
    ok('關卡面板開啟時焦點在面板內', await inside('#sheet'), await active());
    const trail = []; for (let k = 0; k < 25; k++) { await key('Tab'); trail.push(await active()); }
    ok('trail', true, trail.join(','));
    ok('關卡面板 Tab 25 次焦點仍在面板內', await inside('#sheet'), await active());
    await key('Escape'); await sleep(500);
    ok('Esc 關閉關卡面板', !(await vis('#sheet')));
    ok('關閉後焦點回到頁面元素（非 body）', await ev('document.activeElement && document.activeElement!==document.body'), await active());
    ok('沒有 JS 例外', errs.length === 0, errs.join(' | '));
    ws.close();
  } catch (e) { res.push('ERROR ' + (e.message || e)); }
  finally { proc.kill(); srv.close(); setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* */ } }, 800); }
  console.log(res.join('\n'));
  process.exit(0);
})();

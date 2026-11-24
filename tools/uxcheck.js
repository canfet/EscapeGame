#!/usr/bin/env node
/**
 * 體驗改善實測（headless Chrome + 模擬後端）：
 * 教學頁數與大字選項、進入範圍的一鍵打卡、下一站方向箭頭、作答面板順序、提示確認文字、完賽星星回饋、斷線時用快照進入、Service Worker。
 * 用法：node tools/uxcheck.js [套版]
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const mock = require('./mockserver');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => p && fs.existsSync(p));
(async () => {
  const tpl = process.argv[2] || 'classic';
  const srv = await mock.start(0), base = 'http://localhost:' + srv.address().port, port = 9900 + Math.floor(Math.random() * 90);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ux-'));
  const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + port, '--user-data-dir=' + dir, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  const res = [];
  const ok = (n, c, x) => res.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && x !== '' ? '  ' + x : ''));
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
    const vis = s => ev(`(function(){var e=document.querySelector(${JSON.stringify(s)});if(!e)return false;var r=e.getBoundingClientRect();return r.width>0&&r.height>0&&!e.closest('.hidden')})()`);
    const waitFor = async (s, ms) => { for (let t = 0; t < (ms || 6000); t += 100) { if (await vis(s)) return true; await sleep(100); } return false; };
    const click = s => ev(`(function(){var e=document.querySelector(${JSON.stringify(s)});if(e)e.click();return !!e})()`);
    const text = s => ev(`(function(){var e=document.querySelector(${JSON.stringify(s)});return e?e.textContent.trim():''})()`);
    const dismissAll = async () => {
      for (let i = 0; i < 14; i++) {
        if (await vis('#dialog')) await click('#dialog');
        else if (await vis('#tutorial')) { if (await vis('#tut-skip')) await click('#tut-skip'); else await click('#tut-next'); }
        else if (await vis('#cf-ok')) await click('#cf-cancel');
        else if (await vis('#levelup')) await click('#levelup');
        else break;
        await sleep(300);
      }
    };
    await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
    await send('Network.setBlockedURLs', { urls: ['*tile.openstreetmap*', '*fonts.g*', '*basemaps.cartocdn*'] });
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await send('Browser.grantPermissions', { origin: base, permissions: ['geolocation'] }).catch(() => { });
    await fetch(base + '/__reset'); await fetch(base + '/__set?early=1&tpl=' + tpl);
    await send('Page.navigate', { url: base + '/index.html?p=demo' }); await sleep(600);
    await ev('try{localStorage.clear()}catch(e){}');
    await send('Page.navigate', { url: base + '/index.html?p=demo' });
    await waitFor('#v-intro');
    await ev('(function(){var e=document.querySelector("#f-team");e.value="測試隊";e.dispatchEvent(new Event("input",{bubbles:true}))})()');
    await click('#btn-start'); await waitFor('#v-game'); await sleep(1500);

    // ---- 1) 新手教學：頁數、大字選項在最後一頁、不再跳「文字大小」視窗
    for (let i = 0; i < 6 && !(await vis('#tutorial')); i++) { if (await vis('#dialog')) await click('#dialog'); await sleep(400); }
    if (await vis('#tutorial')) {
      let pages = 1, sawFont = false, fontEarly = false;
      for (let i = 0; i < 8; i++) {
        const last = (await text('#tut-next')).indexOf('開始闖關') >= 0;
        const fv = await vis('#tut-font');
        if (!last && fv) fontEarly = true;
        if (last) { sawFont = fv; break; }
        await click('#tut-next'); pages++; await sleep(150);
      }
      ok('教學最多 4 頁', pages <= 4, pages + ' 頁');
      ok('大字選項只在最後一頁', sawFont && !fontEarly);
      await click('#tut-font'); await sleep(200);
      ok('教學內的大字鈕可開啟大字模式', await ev('document.documentElement.classList.contains("big-text")'));
      await click('#tut-font');
      await click('#tut-next'); await sleep(600);
      ok('教學結束後沒有再跳「文字大小」確認視窗', !(await vis('#cf-ok')));
    } else ok('教學出現', false);
    await dismissAll();

    // ---- 3) 下一站：方向箭頭（定位到關卡西南方約 150 公尺）
    await send('Emulation.setGeolocationOverride', { latitude: 25.0320, longitude: 121.5640, accuracy: 10 });
    await sleep(2500);
    const sub = await text('#ns-sub');
    ok('下一站顯示方向箭頭與距離', /[↑↗→↘↓↙←↖]/.test(sub) && /公尺|公里/.test(sub), sub);

    // ---- 4a) 前往中：線索 → 方向與地圖 → 現場作答欄（附說明）；答案欄在地圖之後
    await click('#g-stages .stage-card.open'); await sleep(900);
    const openOrder = await ev(`(function(){var b=document.querySelector('#sheet-body');var m=b.querySelector('.sheet-map-card,.compass'),a=b.querySelector('#s-ans');if(!a)return 'no answer field';if(!m)return 'no map';return (m.compareDocumentPosition(a)&4)?'map<answer':'answer<map'})()`);
    ok('前往中：答案欄在方向／地圖之後', openOrder === 'map<answer', openOrder);
    ok('前往中：現場作答欄有說明', /到了再填答案/.test(await ev('document.querySelector("#sheet-body").textContent')));
    await click('#s-close'); await sleep(400);
    // ---- 2) 走進範圍：一鍵打卡提示
    await send('Emulation.setGeolocationOverride', { latitude: 25.0330, longitude: 121.5654, accuracy: 10 });
    const popped = await waitFor('#arrive-prompt', 8000);
    ok('走進範圍後跳出一鍵打卡提示', popped, await text('#ap-title'));
    if (popped) {
      await click('#ap-go'); await sleep(2500);
      await dismissAll();
      ok('按下後完成打卡並打開關卡', await vis('#sheet-body'));
      ok('提示已收起', !(await vis('#arrive-prompt')));
    }

    // ---- 4) 作答面板順序：題目、答案欄在前；線索收合；晶片列精簡
    if (await vis('#sheet-body')) {
      const order = await ev(`(function(){var b=document.querySelector('#sheet-body');var q=b.querySelector('.question'),a=b.querySelector('#s-ans'),c=b.querySelector('details[data-ck]');
        if(!q||!a)return 'missing q/a';return (q.compareDocumentPosition(a)&4?'q<a ':'a<q ')+(c?(a.compareDocumentPosition(c)&4?'a<clue':'clue<a'):'noclue')})()`);
      ok('題目→答案欄→收合的線索', /^q<a\s+a<clue$/.test(order), order);
      ok('線索預設收合', await ev('(function(){var d=document.querySelector("#sheet-body details[data-ck]");return !!d&&!d.open})()'));
      ok('晶片列不再重複顯示總分／題型', !(await ev('/目前總分/.test(document.querySelector("#sheet-body").textContent)')));
      ok('答案欄在第一個畫面內（不用捲動）', await ev('(function(){var a=document.querySelector("#s-ans");var r=a.getBoundingClientRect();return r.top<window.innerHeight&&r.bottom>0})()'));
      // ---- 剩餘作答次數：明顯的提示（答錯後少一次）
      ok('作答區顯示剩餘次數', /還有 5 次機會/.test(await text('#sheet-body .attempts')), await text('#sheet-body .attempts'));
      await ev('(function(){var e=document.querySelector("#s-ans");e.value="9999";e.dispatchEvent(new Event("input",{bubbles:true}))})()');
      await click('#s-submit'); await sleep(1500);
      ok('答錯後剩餘次數減一', /還有 4 次機會/.test(await text('#sheet-body .attempts')), await text('#sheet-body .attempts'));
      // ---- 高對比模式（設定選單內）
      await click('#btn-hc'); await sleep(200);
      const hc = await ev('(function(){var cs=getComputedStyle(document.body);return document.documentElement.classList.contains("hc")+"|"+cs.backgroundColor+"|"+cs.color})()');
      ok('高對比：純白底黑字', /^true\|rgb\(255, 255, 255\)\|rgb\(0, 0, 0\)$/.test(hc), hc);
      { const sp = await send('Page.captureScreenshot', { format: 'png' }); fs.mkdirSync(path.join(__dirname, '..', 'shots'), { recursive: true }); fs.writeFileSync(path.join(__dirname, '..', 'shots', 'hc-' + tpl + '.png'), Buffer.from(sp.result.data, 'base64')); }
      ok('高對比鈕狀態 aria-pressed=true', (await ev('document.querySelector("#btn-hc").getAttribute("aria-pressed")')) === 'true');
      await click('#btn-hc'); await sleep(150);
      ok('可再關閉高對比', !(await ev('document.documentElement.classList.contains("hc")')));
      // ---- 5) 提示確認：簡短
      if (await vis('#s-hint')) {
        await click('#s-hint'); await sleep(400);
        const msg = await text('#cf-msg');
        ok('提示確認文字簡短（≤ 40 字）', msg.length > 0 && msg.length <= 40, msg);
        await click('#cf-cancel'); await sleep(300);
      }
      // ---- 卡關協助：3 分鐘沒操作 → 提醒看提示（把時間快轉 200 秒來驗證）
      await ev('window.__dn = Date.now; Date.now = function(){return window.__dn() + 200000}');
      let nudged = false;
      for (let t = 0; t < 18000 && !nudged; t += 500) { nudged = /卡住了嗎/.test(await text('#toast')); if (!nudged) await sleep(500); }
      await ev('if (window.__dn) Date.now = window.__dn');
      ok('卡關 3 分鐘後提醒看提示', nudged, await text('#toast'));
      ok('提示鈕有閃動提示', await ev('!!document.querySelector("#s-hint.nudge")'));
      // ---- 同隊另一支手機完成這關：這支手機要收到通知並同步
      const sidNow = await ev('(function(){var k=Object.keys(localStorage).filter(function(k){return k.indexOf("escapegame:snap:")===0})[0];return k?k.slice("escapegame:snap:".length):""})()');
      const other = await ev(`(async function(){var sid=${JSON.stringify(sidNow)};
        await fetch('/api',{method:'POST',body:JSON.stringify({action:'arrive',sessionId:sid,stageId:'s1',code:'0000'})});
        var r=await fetch('/api',{method:'POST',body:JSON.stringify({action:'submitAnswer',sessionId:sid,stageId:'s1',answer:'1111'})});
        return (await r.json()).ok})()`);
      ok('（模擬另一支手機）送出正確答案', other === true || other === undefined, String(other));
      await ev('document.dispatchEvent(new Event("visibilitychange"))');
      let mate = false;
      for (let t = 0; t < 8000 && !mate; t += 400) { mate = /隊友在另一支手機完成了/.test(await text('#toast')); if (!mate) await sleep(400); }
      ok('收到「隊友在另一支手機完成」通知', mate, await text('#toast'));
      // 答完三關 → 完賽
      const ans = { s1: '1111', s2: '2222', s3: '3333' };
      for (const sid of ['s1', 's2', 's3']) {
        await dismissAll();
        if (!(await vis('#s-ans'))) {
          await ev('(function(){var c=document.querySelector("#g-stages .stage-card[data-id=' + sid + ']");if(c)c.click()})()');
          await sleep(500);
        }
        if (await vis('#s-code')) { await ev('(function(){var e=document.querySelector("#s-code");e.value="0000";})()'); await click('#s-code-btn'); await sleep(800); }
        if (await vis('#s-ans')) { await ev('(function(){var e=document.querySelector("#s-ans");e.value=' + JSON.stringify(ans[sid]) + ';e.dispatchEvent(new Event("input",{bubbles:true}))})()'); await click('#s-submit'); await sleep(1500); }
        await dismissAll();
        if (await vis('#solved-next')) { await click('#solved-close'); await sleep(300); }
      }
    }
    for (let i = 0; i < 20 && !(await vis('#v-finish')); i++) { await dismissAll(); if (await vis('#solved-next')) await click('#solved-next'); await sleep(500); }

    // ---- 11) 完賽星星回饋
    if (await vis('#v-finish')) {
      ok('完賽頁有星星回饋', await vis('#fb-stars'));
      await click('#fb-stars button[data-n="4"]'); await sleep(900);
      ok('點星星後已送出並顯示補充欄', (await vis('#fb-text')) && /謝謝/.test(await text('#fb-status')), await text('#fb-status'));
      ok('星星狀態：4 顆亮', (await ev('document.querySelectorAll("#fb-stars button.on").length')) === 4);
      await ev('(function(){var e=document.querySelector("#fb-text");e.value="第二關最好玩"})()');
      await click('#fb-send'); await sleep(700);
      ok('補充一句話已送出', /已補充/.test(await text('#fb-status')), await text('#fb-status'));
    } else ok('進入完賽頁', false);

    // ---- 8) 快照 + Service Worker
    const snapOk = await ev('Object.keys(localStorage).some(function(k){return k.indexOf("escapegame:snap:")===0})');
    ok('進度快照已存在手機', snapOk);
    const swOk = await ev('navigator.serviceWorker ? navigator.serviceWorker.getRegistration().then(function(r){return !!r}) : false');
    ok('Service Worker 已註冊', swOk);
    await sleep(1500);
    const cached = await ev('caches.keys().then(function(ks){return ks.join(",")})');
    ok('離線快取已建立', /escapegame-shell/.test(cached || ''), cached);

    // 模擬斷線後重新整理：後端打不到時要能用快照進入遊戲
    await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await send('Page.navigate', { url: base + '/index.html?p=demo' });
    const offlineIn = await waitFor('#v-game', 9000) || await waitFor('#v-finish', 9000);
    ok('斷線重新整理仍能進入遊戲（快照＋快取）', offlineIn);
    await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    ok('沒有 JS 例外', errs.length === 0, errs.join(' | '));
    ws.close();
  } catch (e) { res.push('ERROR ' + (e.message || e)); }
  finally { proc.kill(); srv.close(); setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* */ } }, 800); }
  console.log(res.join('\n'));
  process.exit(0);
})();

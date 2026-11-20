#!/usr/bin/env node
/**
 * 負載演練：模擬很多支隊伍同時闖關，看你部署的 Apps Script 撐不撐得住。
 *
 * 用法（需要 Node 18 以上）：
 *   node tools/loadtest.js <API_URL> <管理密碼> <專案代碼> [隊伍數=30] [秒數=30]
 *
 * 例：
 *   node tools/loadtest.js https://script.google.com/macros/s/AKfy.../exec 你的管理密碼 demo 40 30
 *
 * 說明：
 *  ‧ 全部用「試玩隊伍」，不會進排行榜；結束後會自動清除試玩資料（清除前後端會先備份）。
 *  ‧ 每隊每秒大約做一個動作：看進度（讀）、送錯誤答案／輸入錯誤通關碼（寫，會占用寫入鎖）。
 *  ‧ 看結果：
 *      BUSY（排隊逾時）越少越好，0 最理想；
 *      p95 是「95% 的動作在幾毫秒內完成」，一般手機網路 3000 ms 以內玩家都不太會有感覺。
 *  ‧ 專案若設定了「預設隊伍名單」，試玩隊伍名稱會被擋，請用一個沒有名單的測試專案（可複製專案後清掉名單）。
 *  ‧ 請在沒有正式活動的時候跑；跑的時候會占用你的 Apps Script 每日額度。
 */
'use strict';

const [, , API, KEY, PID, TEAMS_ARG, SECS_ARG] = process.argv;
if (!API || !KEY || !PID) {
  console.error('用法：node tools/loadtest.js <API_URL> <管理密碼> <專案代碼> [隊伍數=30] [秒數=30]');
  process.exit(1);
}
const TEAMS = Math.max(1, Math.min(200, parseInt(TEAMS_ARG || '30', 10) || 30));
const SECS = Math.max(5, Math.min(300, parseInt(SECS_ARG || '30', 10) || 30));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(action, payload) {
  const t0 = Date.now();
  let data;
  try {
    const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ action, fv: '1.1.0' }, payload || {})), redirect: 'follow' });
    data = JSON.parse(await res.text());
  } catch (e) {
    data = { ok: false, code: 'NETWORK', error: String(e && e.message || e) };
  }
  return { ms: Date.now() - t0, data };
}

const stat = { total: 0, ok: 0, busy: 0, wait: 0, rate: 0, network: 0, other: 0, lat: [], serverMs: [], reads: [], writes: [] };
const otherErrors = {};
function record(kind, r) {
  stat.total++;
  stat.lat.push(r.ms);
  if (r.data.ms != null) stat.serverMs.push(r.data.ms);
  (kind === 'write' ? stat.writes : stat.reads).push(r.ms);
  if (r.data.ok) stat.ok++;
  else if (r.data.code === 'BUSY') stat.busy++;
  else if (r.data.code === 'WAIT' || r.data.code === 'WRONG_CODE') stat.ok++;   // 預期內的結果（答錯、冷卻），不算失敗
  else if (r.data.code === 'RATE') stat.rate++;
  else if (r.data.code === 'NETWORK') stat.network++;
  else { stat.other++; otherErrors[r.data.error || r.data.code] = (otherErrors[r.data.error || r.data.code] || 0) + 1; }
}
const pct = (a, p) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };

async function team(i, tt, deadline) {
  const name = 'LT-' + Date.now().toString(36) + '-' + i;
  const start = await call('startSession', { projectId: PID, teamName: name, test: true, tt, userAgent: 'loadtest' });
  record('write', start);
  if (!start.data.ok) return;
  const sid = start.data.state.session.session_id;
  let state = start.data.state;
  while (Date.now() < deadline) {
    const roll = Math.random();
    let r;
    const open = (state.stages || []).filter((s) => s.status === 'arrived' && ['text', 'number'].includes(s.answer_type))[0];
    const gps = (state.stages || []).filter((s) => s.status === 'open')[0];
    if (roll < 0.35) { r = await call('getSession', { sessionId: sid }); record('read', r); }
    else if (roll < 0.5) { r = await call('leaderboard', { projectId: PID }); record('read', r); }
    else if (open) { r = await call('submitAnswer', { sessionId: sid, stageId: open.stage_id, answer: 'x' + Math.random() }); record('write', r); }
    else if (gps) { r = await call('arrive', { sessionId: sid, stageId: gps.stage_id, code: 'wrong' + Math.random() }); record('write', r); }
    else { r = await call('getSession', { sessionId: sid }); record('read', r); }
    if (r && r.data && r.data.state) state = r.data.state;
    await sleep(700 + Math.random() * 600);
  }
}

(async () => {
  console.log(`負載演練：${TEAMS} 支試玩隊伍，持續約 ${SECS} 秒，專案 ${PID}`);
  const tok = await call('adminGetTestToken', { adminKey: KEY });
  if (!tok.data.ok) { console.error('取得試玩金鑰失敗：' + (tok.data.error || tok.data.code)); process.exit(1); }
  const t0 = Date.now(), deadline = t0 + SECS * 1000;
  // 隊伍在前 5 秒內陸續開始（比較像真實情況）
  await Promise.all(Array.from({ length: TEAMS }, (_, i) => sleep(Math.random() * 5000).then(() => team(i, tok.data.token, deadline))));
  const elapsed = (Date.now() - t0) / 1000;
  console.log('\n===== 結果 =====');
  console.log(`總請求 ${stat.total}（約 ${(stat.total / elapsed).toFixed(1)} 次/秒）`);
  console.log(`成功 ${stat.ok}｜排隊逾時 BUSY ${stat.busy}｜操作太頻繁 RATE ${stat.rate}｜網路失敗 ${stat.network}｜其他錯誤 ${stat.other}`);
  console.log(`回應時間（整體）：中位數 ${pct(stat.lat, 0.5)} ms｜p95 ${pct(stat.lat, 0.95)} ms｜最慢 ${Math.max(0, ...stat.lat)} ms`);
  console.log(`  讀取類：p50 ${pct(stat.reads, 0.5)} ms｜p95 ${pct(stat.reads, 0.95)} ms`);
  console.log(`  寫入類：p50 ${pct(stat.writes, 0.5)} ms｜p95 ${pct(stat.writes, 0.95)} ms`);
  if (stat.serverMs.length) console.log(`後端處理時間：中位數 ${pct(stat.serverMs, 0.5)} ms｜p95 ${pct(stat.serverMs, 0.95)} ms（整體遠大於後端時間 = 網路或冷啟動）`);
  Object.keys(otherErrors).forEach((k) => console.log('  其他錯誤：' + k + ' × ' + otherErrors[k]));
  const failRate = (stat.busy + stat.network + stat.other) / Math.max(1, stat.total);
  console.log(failRate === 0 ? '\n✅ 沒有失敗，這個人數撐得住。' : failRate < 0.02 ? '\n🟡 偶爾失敗（<2%），前台會自動重試，通常玩家無感。' : '\n🔴 失敗偏多，這個人數有風險：建議減少同時人數、錯開出發時間，或把結果貼給我優化。');

  console.log('\n清除試玩資料…');
  const clr = await call('adminClearTests', { adminKey: KEY, projectId: PID });
  console.log(clr.data.ok ? `已清除 ${clr.data.deleted} 支試玩隊伍` : '清除失敗，請到後台「闖關紀錄」按「清除試玩」：' + (clr.data.error || ''));
})();

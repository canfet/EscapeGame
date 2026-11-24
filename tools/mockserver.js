#!/usr/bin/env node
/**
 * 本機模擬後端：同時提供靜態檔（專案根目錄）與 POST /api（回應形狀與 Code.gs 一致）。
 * 用法：node tools/mockserver.js [port=8800]
 *   GET /__set?tpl=rpg&theme=forest&switch=1   設定之後所有回應的套版／主題／允許玩家切換
 *   GET /__reset                               清掉所有隊伍進度
 * 前台頁面：http://localhost:8800/index.html?p=demo
 * 這個檔案只給開發驗證用，不會被部署。
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const AV = {
  classic: ['🦊', '🐼', '🐯', '🐸', '🦉', '🐙', '🦄', '🐳', '🦖', '🐧', '🐝', '🦋', '🐢', '🐬', '🦁', '🐰'],
  rpg: ['⚔️', '🧙', '🏹', '🗡️', '🛡️', '🩺', '🎻', '🐉'],
  detective: ['🕵️', '🔍', '🧐', '📜', '🗝️', '🎩', '🔦', '🧤'],
  agent: ['🛰️', '🤖', '👾', '🦾', '🔒', '💾', '📡', '🕶️'],
  pirate: ['⚓', '🏴‍☠️', '🦜', '🗺️', '🧭', '💰', '🦑', '🚢'],
  academy: ['🧙‍♀️', '📚', '🪄', '🦉', '🔮', '⭐', '🧪', '🎓']
};
const SUGGEST = { classic: 'retro', rpg: 'forest', detective: 'history', agent: 'neon', pirate: 'ocean', academy: 'campus' };
const cfg = { tpl: 'classic', theme: '', sw: false };
const sessions = {};

const STAGES = [
  { stage_id: 's1', order: 1, title: '古井旁的線索', answer: '1111', lat: 25.0330, lng: 121.5654, gps: true, bypass: '0000',
    clue: '走到廣場中央的古井，數一數井口刻了幾個符號。', question: '井口一共刻了幾個符號？（提示：答案是四個 1）',
    hints: ['看看井口邊緣', '符號是重複的數字'], arrive: '你終於到了！快看看井口。', wrong: '不對喔，再仔細數一數。', hint: '這個提示或許有幫助……', ok: '答對了！井底傳來一陣回聲。第二關的入口開啟了。' },
  { stage_id: 's2', order: 2, title: '老樹下的謎題', answer: '2222', lat: 25.0340, lng: 121.5664, gps: false,
    clue: '往東走到最老的那棵樹。', question: '樹牌上的編號是多少？', hints: ['樹牌在樹幹上'], arrive: '', wrong: '樹在對你搖頭，答案不是這個。', hint: '樹葉沙沙作響……', ok: '漂亮！樹洞裡掉出一把鑰匙。' },
  { stage_id: 's3', order: 3, title: '終點的寶箱', answer: '3333', lat: 25.0350, lng: 121.5674, gps: false,
    clue: '最後來到鐘樓下。', question: '鐘樓上的鐘停在幾點？（四位數代碼 3333）', hints: [], arrive: '', wrong: '寶箱紋風不動。', hint: '', ok: '寶箱打開了，恭喜完成所有挑戰！' }
];

function project(extra) {
  const tpl = cfg.tpl;
  return Object.assign({
    project_id: 'demo', name: '夜市尋寶大冒險', description: '三關小冒險，約 30 分鐘', intro: '依照線索找到每個地點，抵達後打卡解鎖題目！\n祝你們好運。',
    cover_url: '', theme: cfg.theme || SUGGEST[tpl], template: tpl,
    npc_name: '', npc_avatar: '', allow_tpl_switch: cfg.sw, restrict_teams: false, teams: [],
    avatars: AV[tpl] || [], collect_message: '', deck_title: '', deck_size: 0, deck_kind: 'nature', deck_style: 'foil',
    unlock_mode: 'sequential', time_limit_min: 0, show_leaderboard: true, leaderboard_live: true,
    require_run_code: false, is_default: true, start_at: null, end_at: null, stage_count: STAGES.length, routes: []
  }, extra || {});
}

function pubStage(def, s) {
  const g = s.prog[def.stage_id] || {};
  let prevDone = true;
  for (const d of STAGES) { if (d === def) break; const q = s.prog[d.stage_id] || {}; prevDone = prevDone && !!q.solved; }
  const status = g.solved ? 'solved' : !prevDone ? 'locked' : (g.arrived || !def.gps) ? 'arrived' : 'open';
  const used = g.hints || 0;
  const o = {
    stage_id: def.stage_id, order: def.order, title: def.title, status, answer_type: 'text', points: 100, earned: g.solved ? Math.max(0, 100 - used * 10) : 0,
    require_gps: def.gps, has_bypass: !!def.bypass, show_location: true, require_photo: false, uses_fragments: false, coop: false,
    hints_total: def.hints.length, hints: def.hints.slice(0, used), hint_penalty: 10, attempts: g.attempts || 0, max_attempts: 5
  };
  if (status === 'locked') return o;
  o.wait_sec = 0; o.clue = def.clue; o.image_url = '';
  ['arrive', 'wrong', 'hint'].forEach(k => { if (def[k]) o['npc_' + k] = def[k]; });
  o.lat = def.lat; o.lng = def.lng; o.radius_m = 30;
  if (status === 'arrived' || status === 'solved') { o.question = def.question; o.choices = []; }
  if (status === 'solved') { o.success_message = def.ok; o.file_url = ''; }
  return o;
}

function state(s, extra) {
  const list = STAGES.map(d => pubStage(d, s));
  const solved = list.filter(x => x.status === 'solved').length;
  if (solved === list.length && s.status === 'playing') { s.status = 'finished'; s.finished_at = new Date().toISOString(); s.just = true; }
  const score = list.reduce((a, x) => a + x.earned, 0);
  const st = {
    session: { session_id: s.id, code: s.code, project_id: 'demo', team_name: s.team, run_code: '', route: '', avatar: s.avatar, test: false, status: s.status, rating: s.rating || 0, score,
      started_at: s.started_at, finished_at: s.finished_at || null, deadline: null, server_time: new Date().toISOString() },
    project: project(), stages: list, fragments: [], collection: [], badges: [], title: '',
    summary: { total: list.length, solved, done: solved },
    finish_message: s.status === 'finished' ? '感謝你們完成冒險！\n別忘了集合拍張大合照。' : '', just_finished: !!s.just
  };
  s.just = false;
  return Object.assign({ state: st }, extra || {});
}

function handle(b) {
  const s = b.sessionId && sessions[b.sessionId];
  const need = () => { if (!s) { const e = new Error('找不到這支隊伍的進度'); e.code = 'SESSION_NOT_FOUND'; throw e; } return s; };
  const def = () => STAGES.find(d => d.stage_id === b.stageId);
  switch (b.action) {
    case 'listProjects': return { projects: [Object.assign(project(), { not_started: false, ended: false })] };
    case 'getProject': return { project: project(), link_info: null };
    case 'startSession': {
      const id = 'sess' + (Object.keys(sessions).length + 1) + Date.now().toString(36);
      sessions[id] = { id, code: 'ABCD' + Object.keys(sessions).length, team: String(b.teamName || '').slice(0, 30), avatar: b.avatar || '', status: 'playing', prog: {}, started_at: new Date().toISOString() };
      return state(sessions[id]);
    }
    case 'getSession': return state(need());
    case 'resumeSession': {
      const f = Object.values(sessions).find(x => x.code === String(b.code).toUpperCase());
      if (!f) { const e = new Error('找不到這個隊伍代碼'); e.code = 'NOT_FOUND'; throw e; }
      return state(f);
    }
    case 'arrive': {
      need(); const d = def(); const g = s.prog[d.stage_id] = s.prog[d.stage_id] || {};
      // 帶了定位座標：離關卡 80 公尺內就算抵達（模擬後端的 GPS 打卡）
      const near = b.lat != null && Math.hypot((b.lat - d.lat) * 111000, (b.lng - d.lng) * 100000) < 80;
      if (!g.arrived && d.gps && near) g.arrived = true;
      if (!g.arrived && d.gps) {
        if (!b.code || b.code !== d.bypass) { const e = new Error('通關碼不正確'); e.code = 'WRONG_CODE'; throw e; }
        g.arrived = true;
      }
      return state(s, { arrived: true, message: '抵達成功！題目已解鎖。' });
    }
    case 'submitAnswer': {
      need(); const d = def(); const g = s.prog[d.stage_id] = s.prog[d.stage_id] || {};
      g.attempts = (g.attempts || 0) + 1;
      const ok = String(b.answer).trim() === d.answer;
      if (ok) g.solved = true;
      return state(s, { correct: ok, message: ok ? d.ok : '答案不正確，再想想看（還剩 ' + (5 - g.attempts) + ' 次機會）' });
    }
    case 'getHint': {
      need(); const d = def(); const g = s.prog[d.stage_id] = s.prog[d.stage_id] || {};
      if ((g.hints || 0) >= d.hints.length) { const e = new Error('沒有更多提示了'); e.code = 'NO_HINT'; throw e; }
      const h = d.hints[g.hints || 0]; g.hints = (g.hints || 0) + 1;
      return state(s, { hint: h, message: '已使用提示：每則提示少 10 分' });
    }
    case 'submitFeedback': {
      need();
      const n = Math.round(Number(b.rating));
      if (!(n >= 1 && n <= 5)) { const e = new Error('請選 1 到 5 顆星'); e.code = 'BAD_INPUT'; throw e; }
      s.rating = n; s.feedback = String(b.comment || '').slice(0, 200);
      return { saved: true, rating: n };
    }
    case 'leaderboard': {
      const rows = Object.values(sessions).map(x => ({ team_name: x.team, avatar: x.avatar, route_name: '', score: 290, solved: 3, total: 3, duration_sec: 25, badges: [] }));
      rows.push({ team_name: '第二小隊', avatar: '', route_name: '', score: 180, solved: 2, total: 3, duration_sec: null, badges: [] });
      return { leaderboard: rows };
    }
    default: return {};
  }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };

function start(port) {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    if (u.pathname === '/api' && req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        let out;
        try { out = Object.assign({ ok: true, version: '1.2.0' }, handle(JSON.parse(body || '{}'))); }
        catch (e) { out = { ok: false, error: e.message, code: e.code || 'ERR', version: '1.2.0' }; }
        res.writeHead(200, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors));
        res.end(JSON.stringify(out));
      });
      return;
    }
    if (u.pathname === '/__set') {
      if (u.searchParams.has('tpl')) cfg.tpl = u.searchParams.get('tpl');
      cfg.theme = u.searchParams.get('theme') || '';
      cfg.sw = u.searchParams.get('switch') === '1';
      res.writeHead(200, cors); return res.end(JSON.stringify(cfg));
    }
    if (u.pathname === '/__reset') { Object.keys(sessions).forEach(k => delete sessions[k]); res.writeHead(200, cors); return res.end('ok'); }
    if (u.pathname === '/config.js') {
      res.writeHead(200, { 'Content-Type': MIME['.js'] });
      return res.end("window.APP_CONFIG={API_URL:location.origin+'/api'};");
    }
    let f = path.normalize(path.join(ROOT, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname)));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => srv.listen(port, () => r(srv)));
}

module.exports = { start };
if (require.main === module) {
  const port = parseInt(process.argv[2], 10) || 8800;
  start(port).then(() => console.log('mock server: http://localhost:' + port + '/index.html?p=demo'));
}

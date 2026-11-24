/* ========== 即時排行榜（大螢幕頁面）：每 15 秒自動更新 ========== */
(function () {
  'use strict';
  var $ = Q.$, esc = Q.esc;
  var THEMES = ['retro', 'history', 'sport', 'mist', 'forest', 'neon', 'campus', 'ocean'];
  var B = { pid: '', run: '', route: '', rows: [], routes: [], serverTime: null };

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    var q = new URLSearchParams(location.search);
    B.pid = q.get('p') || '';
    B.run = q.get('run') || '';
    if (!B.pid) { $('#b-note').textContent = '網址缺少專案代碼（?p=…）'; return; }
    $('#b-full').onclick = function () {
      var el = document.documentElement;
      if (document.fullscreenElement) document.exitFullscreen();
      else if (el.requestFullscreen) el.requestFullscreen();
    };
    try {
      var r = await Q.api('getProject', { projectId: B.pid });
      var th = THEMES.indexOf(r.project.theme) >= 0 ? r.project.theme : 'retro';
      var tid = (Q.Tpl && Q.Tpl.norm) ? Q.Tpl.norm(r.project.template) : 'classic';
      document.body.className = 'quest theme-' + th + ' tpl-' + tid;
      var bt = '即時排行榜';
      try { if (tid !== 'classic') bt = Q.Tpl.vocab(tid, 'boardTitle') || bt; } catch (e) { /* */ }
      $('#b-title').textContent = '🏆 ' + (tid !== 'classic' ? bt + '・' : '') + r.project.name + (B.run ? '（' + B.run + '）' : '');
      document.title = r.project.name + '・' + bt;
    } catch (e) { /* 取不到專案資訊就用預設風格 */ }
    await load();
    setInterval(load, 15000);
  }

  async function load() {
    try {
      var r = await Q.api('leaderboard', { projectId: B.pid, runCode: B.run, board: true });
      B.rows = r.leaderboard; B.routes = r.routes || []; B.serverTime = r.server_time;
      $('#b-note').textContent = '';
      $('#b-updated').textContent = '每 15 秒自動更新・' + Q.fmtTime(new Date());
      render();
    } catch (e) {
      $('#b-note').textContent = e.message;
    }
  }

  function render() {
    var tabs = $('#b-tabs');
    tabs.classList.toggle('hidden', B.routes.length < 2);
    if (B.routes.length > 1) {
      tabs.innerHTML = '<button class="' + (B.route ? '' : 'on') + '" aria-pressed="' + (B.route ? 'false' : 'true') + '" data-r="">全部</button>' + B.routes.map(function (x) {
        return '<button class="' + (B.route === x.name ? 'on' : '') + '" aria-pressed="' + (B.route === x.name ? 'true' : 'false') + '" data-r="' + esc(x.name) + '">' + esc(x.name) + '</button>';
      }).join('');
      Q.$$('#b-tabs [data-r]').forEach(function (b) { b.onclick = function () { B.route = b.dataset.r; render(); }; });
    }
    var rows = B.route ? B.rows.filter(function (x) { return x.route_name === B.route; }) : B.rows;
    $('#b-rows').innerHTML = Q.boardHtml(rows, { now: B.serverTime });
  }
})();

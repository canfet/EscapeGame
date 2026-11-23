/* ========== 闖關前台 ========== */
(function () {
  'use strict';
  var api = Q.api, $ = Q.$, esc = Q.esc;

  var P = {
    projectId: '', runCode: '', sid: '', project: null, state: null,
    pos: null, watchId: null, gpsState: 'wait',
    map: null, layers: null, me: null, meAcc: null, fitted: false,
    openId: null, choice: null, photo: null, timer: null
  };
  var LS = function (pid) { return 'escapegame:' + pid; };

  document.addEventListener('DOMContentLoaded', init);

  /* ---------- 畫面切換 ---------- */
  function show(id) {
    ['v-projects', 'v-intro', 'v-game', 'v-finish', 'v-error'].forEach(function (v) {
      $('#' + v).classList.toggle('hidden', v !== id);
    });
    $('#app-head').classList.toggle('hidden', id === 'v-game');   // 闖關畫面有自己的頂端列
    window.scrollTo(0, 0);
    if (id === 'v-game' && P.map) setTimeout(function () { P.map.invalidateSize(); }, 50);
  }
  function showError(msg) { $('#err-text').textContent = msg; show('v-error'); }

  /* ---------- 啟動 ---------- */
  async function init() {
    var name = '實境解謎';
    $('#site-name').textContent = name;
    $('#app-head-title').textContent = '🧭 ' + name;
    document.title = name;
    var q = new URLSearchParams(location.search);
    P.projectId = q.get('p') || '';
    P.runCode = q.get('run') || '';
    P.urlRoute = (q.get('route') || '').trim();   // 專屬 QR Code 帶的路線代碼
    P.urlTeam = (q.get('team') || '').trim().slice(0, 30);

    // LINE／Facebook／Instagram 等內建瀏覽器常常拿不到定位與指南針：提醒改用 Safari／Chrome
    try {
      var inApp = /Line\/|FBAN|FBAV|Instagram|MicroMessenger|; wv\)/i.test(navigator.userAgent);
      if (inApp && sessionStorage.getItem('escapegame:inapp-ok') !== '1') $('#inapp-banner').classList.remove('hidden');
    } catch (e) { /* */ }
    $('#inapp-x').onclick = function () { $('#inapp-banner').classList.add('hidden'); try { sessionStorage.setItem('escapegame:inapp-ok', '1'); } catch (e) { /* */ } };
    $('#inapp-copy').onclick = function () {
      var url = location.href;
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { Q.toast('已複製連結，請貼到 Safari／Chrome 開啟', 'ok', 5000); })
        .catch(function () { window.prompt('請複製這個連結，貼到 Safari／Chrome 開啟：', url); });
    };
    // 離線提示：山區訊號不穩時，頂部顯示「離線中」，輸入的答案會自動暫存
    var syncOnline = function () { queueChip(); };
    window.addEventListener('offline', syncOnline); window.addEventListener('online', syncOnline); syncOnline();
    // 大字模式（長輩友善）：整體字放大，設定會記住
    try { if (localStorage.getItem('escapegame:bigtext') === '1') document.documentElement.classList.add('big-text'); } catch (e) { /* */ }
    $('#btn-font').onclick = function () {
      var on = document.documentElement.classList.toggle('big-text');
      this.setAttribute('aria-pressed', String(on));
      try { localStorage.setItem('escapegame:bigtext', on ? '1' : '0'); } catch (e) { /* */ }
      Q.toast(on ? '已開啟大字模式' : '已關閉大字模式', 'ok', 1800);
    };
    // 答案輸入草稿：一輸入就暫存，重畫或斷線重連後還在
    $('#sheet-body').addEventListener('input', function (e) {
      var id = e.target.id;
      if (P.sid && P.openId && ['s-ans', 's-caption', 's-code'].indexOf(id) >= 0) { try { localStorage.setItem(draftKey(P.openId, id), e.target.value); } catch (x) { /* */ } }
    });
    $('#tut-next').onclick = tutNext; $('#tut-skip').onclick = tutEnd;
    $('#link-resume').onclick = async function (e) {
      e.preventDefault();
      var code = prompt('請輸入你們的隊伍代碼\n（闖關畫面頂部、隊伍名稱旁邊的英數字，例如 AB12CD）：');
      if (!code || !code.trim()) return;
      try {
        var r = await Q.run(function () { return api('resumeSession', { projectId: P.projectId, code: code.trim() }); });
        P.sid = r.state.session.session_id;
        try { localStorage.setItem(LS(P.projectId), P.sid); } catch (x) { /* */ }
        startGame(r.state);
        Q.toast('已接續「' + r.state.session.team_name + '」的進度', 'ok');
      } catch (x) { /* toast 已顯示 */ }
    };
    $('#btn-start').onclick = startSession;
    $('#btn-retry').onclick = function () { location.reload(); };
    $('#link-back-projects').onclick = function (e) { e.preventDefault(); location.href = location.pathname; };
    $('#link-reset').onclick = resetTeam;
    $('#btn-show-finish').onclick = showFinish;
    $('#btn-back-game').onclick = function () { show('v-game'); };
    $('#btn-both').onclick = showBoth;
    $('#btn-sound').onclick = toggleSound; renderSoundBtn();
    $('#btn-fs').onclick = function () { setFullscreen(!$('#map-card').classList.contains('full')); };
    if (window.visualViewport) { visualViewport.addEventListener('resize', fitSheet); visualViewport.addEventListener('scroll', fitSheet); }
    $('#sheet-body').addEventListener('focusin', function (e) {
      if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) setTimeout(function () { try { e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (x) { /* */ } }, 320);
    });
    $('#g-stages').addEventListener('scroll', updateStageMore, { passive: true });
    window.addEventListener('resize', updateStageMore);
    window.addEventListener('online', function () { $('#retry-bar').classList.add('hidden'); Q.toast('已恢復連線', 'ok'); if (P.sid) { queueFlush().then(refresh); } queueChip(); });
    window.addEventListener('offline', queueChip);
    setInterval(function () { if (P.sid && navigator.onLine !== false) queueFlush(); }, 15000);
    $('#next-step').onclick = function () { var st = nextStage(); if (st) openStage(st.stage_id); };
    $('#solved-next').onclick = goNextStage;
    $('#solved-close').onclick = hideSolved;
    $('#btn-board').onclick = openBoard;
    $('#btn-pack').onclick = openPack;
    $('#card-view-close').onclick = closeCardView;
    $('#card-view-x').onclick = closeCardView;
    (function () {   // 點背景空白處、或在卡片外往下滑，關閉放大的卡片
      var cv = $('#card-view'), y0 = null;
      cv.addEventListener('click', function (e) { if (e.target === cv || e.target.classList.contains('card-view-box')) closeCardView(); });
      cv.addEventListener('touchstart', function (e) { y0 = e.target.closest && e.target.closest('.tcg, button') ? null : e.touches[0].clientY; }, { passive: true });
      cv.addEventListener('touchend', function (e) { if (y0 != null && cv.scrollTop <= 0 && e.changedTouches[0].clientY - y0 > 80) closeCardView(); y0 = null; }, { passive: true });
    })();
    $('#gps-retry').onclick = retryGps;
    $('#btn-copy-code').onclick = function () { copyText((P.state && P.state.session && P.state.session.code) || '').then(function (ok) { Q.toast(ok ? '已複製隊伍代碼' : '複製失敗，請手動抄下代碼', ok ? 'ok' : 'warn'); }); };
    $('#time-banner').onclick = function () { this.classList.add('hidden'); };
    $('#btn-share').onclick = openShare;
    $('#share-x').onclick = closeShare;
    $('#share-view').addEventListener('click', function (e) { if (e.target === this || e.target.classList.contains('share-box')) closeShare(); });

    $('#pack-close').onclick = closePack;
    $('#board-close').onclick = closeBoard;
    $('#btn-locate').onclick = function () { if (P.pos && P.map) P.map.setView([P.pos.lat, P.pos.lng], 17); else toastGps(); };
    $('#sheet').addEventListener('click', function (e) { if (e.target.id === 'sheet') closeStage(); });

    if (!P.projectId) return showProjectList();
    enterProject(P.projectId);
  }

  async function showProjectList() {
    try {
      var r = await Q.run(function () { return api('listProjects'); }, { noToast: true });
      var list = r.projects || [];
      if (!list.length) return showError('目前沒有開放中的任務');
      if (list.length === 1) return goProject(list[0].project_id);
      $('#project-list').innerHTML = list.map(function (p) {
        var tag = p.ended ? '<span class="chip red">已結束</span>' : p.not_started ? '<span class="chip amber">尚未開始</span>' : '<span class="chip green">開放中</span>';
        return '<button class="stage-card" data-id="' + esc(p.project_id) + '">' +
          '<div class="grow"><b>' + esc(p.name) + '</b> ' + tag +
          '<div class="meta">' + esc(p.description || '') + '</div>' +
          '<div class="meta">' + p.stage_count + ' 個關卡' + (p.time_limit_min ? '・限時 ' + p.time_limit_min + ' 分鐘' : '') + '</div></div>' +
          '<span>›</span></button>';
      }).join('');
      Q.$$('#project-list [data-id]').forEach(function (b) { b.onclick = function () { goProject(b.dataset.id); }; });
      show('v-projects');
    } catch (e) { showError(e.message); }
  }

  function goProject(id) {
    var q = new URLSearchParams(location.search);
    q.set('p', id);
    history.replaceState(null, '', location.pathname + '?' + q.toString());
    P.projectId = id;
    enterProject(id);
  }

  async function enterProject(pid) {
    var sid = '';
    try { sid = localStorage.getItem(LS(pid)) || ''; } catch (e) { /* 無痕模式 */ }
    if (sid) {
      try {
        var r = await Q.run(function () { return api('getSession', { sessionId: sid }); }, { noToast: true });
        var ss = r.state.session;
        // 網址（專屬 QR Code）指定的隊伍／路線和這支手機上次的進度不同：以網址為準，不要偷偷接續舊隊伍
        var otherTeam = P.urlTeam && P.urlTeam !== ss.team_name;
        var otherRoute = !P.urlTeam && P.urlRoute && ss.route && P.urlRoute !== ss.route;
        if (!otherTeam && !otherRoute) {
          P.sid = sid;
          return startGame(r.state);
        }
        P.prevTeam = ss.team_name;   // 舊進度仍保留在手機上，直到新隊伍開始才會被取代
      } catch (e) {
        if (e.code === 'SESSION_NOT_FOUND') { try { localStorage.removeItem(LS(pid)); } catch (x) { /* */ } }
        else return showError(e.message);
      }
    }
    showIntro(pid);
  }

  async function showIntro(pid) {
    try {
      var r = await Q.run(function () { return api('getProject', { projectId: pid, route: P.urlRoute, team: P.urlTeam }); }, { noToast: true });
      var p = P.project = r.project;
      applyTheme(p.theme);
      document.title = p.name;
      $('#intro-name').textContent = p.name;
      $('#intro-desc').textContent = p.description || '';
      $('#intro-text').innerHTML = Q.linkify(p.intro || '依照線索找到每個地點，抵達後打卡解鎖題目！');
      var cov = $('#intro-cover');
      if (p.cover_url) { cov.src = p.cover_url; cov.classList.remove('hidden'); }
      else { cov.removeAttribute('src'); cov.classList.add('hidden'); }
      var meta = ['<span class="chip">🗺 ' + p.stage_count + ' 個關卡</span>',
        '<span class="chip">' + (p.unlock_mode === 'free' ? '🔓 自由順序' : '➡️ 依序解鎖') + '</span>'];
      if (p.time_limit_min) meta.push('<span class="chip amber">⏱ 限時 ' + p.time_limit_min + ' 分鐘</span>');
      $('#intro-meta').innerHTML = meta.join('');
      // 專案要求場次代碼、但網址只帶了路線（專屬 QR Code）：直接拿路線代碼當場次，玩家不用再輸入
      if (p.require_run_code && !P.runCode && P.urlRoute) P.runCode = P.urlRoute;
      $('#f-run').value = P.runCode;
      // 隊伍名稱：專案有「預設隊伍名單」就只能從名單選（路線由名單決定）；否則自由輸入
      var restrict = !!p.restrict_teams, tms = p.teams || [];
      var sel = $('#f-team-select'), inp = $('#f-team'), rb = $('#intro-route'), info = r.link_info;
      sel.classList.toggle('hidden', !restrict);
      inp.classList.toggle('hidden', restrict);
      var showRoute = function (t) {
        if (t && t.route_name) { rb.textContent = '🧭 你們的路線：' + t.route_name; rb.classList.remove('hidden', 'bad'); rb.style.borderColor = t.color || ''; }
        else rb.classList.add('hidden');
      };
      if (restrict) {
        sel.innerHTML = '<option value="">請選擇你們的隊伍</option>' + tms.map(function (t) {
          return '<option value="' + esc(t.name) + '">' + esc(t.name) + (t.route_name ? '（' + esc(t.route_name) + '）' : '') + '</option>';
        }).join('');
        var preset = P.urlTeam && tms.filter(function (t) { return t.name === P.urlTeam; })[0];
        sel.disabled = !!preset;          // 專屬 QR Code 進來：隊伍已鎖定
        sel.value = preset ? preset.name : '';
        sel.onchange = function () { var tt = tms.filter(function (t) { return t.name === sel.value; })[0]; showRoute(tt); renderAvatarPicker(p, tt); refreshRunField(); };
        showRoute(preset || null);
        renderAvatarPicker(p, preset || null);
      } else {
        if (P.urlTeam && !inp.value) inp.value = P.urlTeam;
        showRoute(info && !info.bad ? info : null);
        renderAvatarPicker(p, null);
      }
      if (info && info.bad) {
        rb.textContent = info.bad === 'team' ? '⚠️ 連結裡的隊伍名稱不在名單內，請從下方選擇，或向關主確認 QR Code。' : '⚠️ 連結裡的路線代碼不正確，請向關主確認 QR Code。';
        rb.classList.remove('hidden'); rb.classList.add('bad'); rb.style.borderColor = '';
      }
      $('#run-req').textContent = ' *';
      // 場次代碼只有「專案要求輸入」而且「網址沒帶」的時候才需要問玩家；其他情況不顯示這一欄，少一個要填的東西
      refreshRunField();
      show('v-intro');
    } catch (e) { showError(e.message); }
  }

  /** 隊伍造型挑選；名單指定了造型的隊伍就固定，不能改 */
  function renderAvatarPicker(proj, team) {
    var list = proj.avatars || [], box = $('#avatar-picker'), field = $('#avatar-field');
    field.classList.toggle('hidden', !list.length);
    if (!list.length) return;
    var fixed = team && team.avatar;
    if (fixed) P.avatar = fixed;
    else if (!P.avatar || list.indexOf(P.avatar) < 0) P.avatar = list[Math.floor(Math.random() * list.length)];
    box.innerHTML = list.map(function (a) {
      return '<button type="button" class="avatar-opt' + (a === P.avatar ? ' sel' : '') + '" data-av="' + esc(a) + '"' + (fixed ? ' disabled' : '') + '>' + esc(a) + '</button>';
    }).join('');
    Q.$$('#avatar-picker [data-av]').forEach(function (b) {
      b.onclick = function () { P.avatar = b.dataset.av; renderAvatarPicker(proj, team); };
    });
  }

  /** 專案有預設隊伍名單、選到的隊伍有指定路線：後端會自動用那條路線的代碼當場次，不用玩家輸入 */
  function runDerivable() {
    var pj = P.project || {};
    if (!pj.restrict_teams) return false;
    var name = $('#f-team-select').value, t = (pj.teams || []).filter(function (x) { return x.name === name; })[0];
    return !!(t && t.route_name);
  }
  function refreshRunField() {
    var pj = P.project || {};
    $('#run-field').classList.toggle('hidden', !pj.require_run_code || !!P.runCode || runDerivable());
  }

  async function startSession() {
    var restrict = !!(P.project && P.project.restrict_teams);
    var team = restrict ? $('#f-team-select').value : $('#f-team').value.trim();
    if (!team) { Q.toast(restrict ? '請先選擇你們的隊伍' : '請輸入隊伍名稱', 'warn'); (restrict ? $('#f-team-select') : $('#f-team')).focus(); return; }
    var run = $('#f-run').value.trim();
    if (P.project && P.project.require_run_code && !run && !runDerivable()) { Q.toast('請輸入場次代碼', 'warn'); return; }
    // 在使用者按下按鈕時要定位權限（iOS 比較穩）
    startWatch();
    startCompass(true);   // 一律在第一次進來、按下開始的當下就要定位權限（iOS 在使用者按鈕當下比較穩）
    try {
      var r = await Q.run(function () {
        return api('startSession', {
          projectId: P.projectId, teamName: team, route: P.urlRoute, avatar: P.avatar || '',
          runCode: run, userAgent: navigator.userAgent
        });
      });
      P.sid = r.state.session.session_id;
      try { localStorage.setItem(LS(P.projectId), P.sid); if (P.avatar) localStorage.setItem('escapegame:avatar:' + P.sid, P.avatar); } catch (e) { /* */ }
      startGame(r.state);
      Q.toast(r.resumed ? '這支隊伍已經開始過了，已接續原本的進度' : '隊伍建立成功，出發吧！', 'ok', r.resumed ? 5000 : 3000);
      // 新隊伍：教學（含隊伍代碼）只在這支手機第一次玩時出現；其餘情況單獨提醒記下代碼
      var tutSeen = false;
      try { tutSeen = localStorage.getItem('escapegame:tut') === '1'; } catch (e) { /* */ }
      if (!r.resumed && tutSeen) setTimeout(function () { showTeamCode(true); }, 1200);
    } catch (e) { /* toast 已顯示 */ }
  }

  function resetTeam(e) {
    e.preventDefault();
    if (!confirm('確定要換隊伍／重新開始嗎？\n目前這支隊伍的紀錄會保留在系統裡，但這台手機將不再接續它。')) return;
    try { localStorage.removeItem(LS(P.projectId)); } catch (x) { /* */ }
    location.reload();
  }

  /* ---------- 遊戲 ---------- */
  function startGame(state) {
    var sr = state.session.route;
    var diffRoute = P.urlRoute && sr && P.urlRoute !== sr;
    var diffTeam = P.urlTeam && P.urlTeam !== state.session.team_name;
    if (diffRoute || diffTeam) {
      var rn = sr ? routeName(state, sr) : '';
      setTimeout(function () {
        Q.toast('這支隊伍「' + state.session.team_name + '」已經在' + (rn ? ' ' + rn + ' ' : '') + '闖關中，已為你接續原本的進度。要換隊伍的話，請按頁面最下方的「重新開始」，再掃一次 QR Code。', 'warn', 9000);
      }, 600);
    }
    show('v-game');
    applyState(state);
    if (state.session.test) $('#test-banner').classList.remove('hidden');
    setTimeout(function () { maybeTutorial(state); }, 400);
    if (stateNoGps(state)) noGpsMode(); else {
      initMap();
      startWatch();
      // 按「開始闖關」時就先要了定位權限，位置常常比地圖更早到；地圖建好後要立刻把「我」畫上去，
      // 不能等下一次定位更新（省電定位模式下可能要等很久，玩家一開始就看不到自己的圖示）
      if (P.pos) updateMe();
    }
    clearInterval(P.timer);
    P.timer = setInterval(tick, 1000);
    tick();
  }

  function applyState(state) {
    P.locks = P.locks || {};
    state.stages.forEach(function (x) {
      if (x.wait_sec > 0) P.locks[x.stage_id] = Date.now() + x.wait_sec * 1000; else delete P.locks[x.stage_id];
    });
    var prevFinished = P.state && P.state.session.status === 'finished';
    P.state = state;
    renderGame();
    if (P.openId) renderStage();
    if (state.just_finished || (!prevFinished && state.session.status === 'finished' && P.stateLoadedOnce)) {
      if (P.cfDone) P.cfDone(false);
      setFullscreen(false);
      closeStage();
      setTimeout(showFinish, 400);
    }
    P.stateLoadedOnce = true;
  }

  function renderGame() {
    var s = P.state, se = s.session;
    applyTheme(s.project.theme);
    document.title = s.project.name;
    $('#g-title').textContent = s.project.name;
    $('#g-team').textContent = se.team_name;
    $('#g-code').textContent = se.code;
    $('#g-code-big').textContent = se.code;
    $('#g-code').classList.add('clickable');
    $('#g-code').onclick = function () { showTeamCode(false); };
    $('#btn-board').classList.toggle('hidden', !s.project.leaderboard_live);
    var frs = s.fragments || [], gotN = frs.filter(function (f) { return f.got; }).length;
    var col = s.collection || [], colGot = col.filter(function (x) { return x.got; }).length, bds = s.badges || [];
    $('#btn-pack').classList.toggle('hidden', !(frs.length || col.length || bds.length));
    $('#btn-pack').textContent = '🎒' + (col.length ? ' ' + colGot + '/' + col.length : frs.length ? ' ' + gotN + '/' + frs.length : '');
    $('#g-avatar').textContent = se.avatar ? se.avatar + ' ' : '';
    updatePackDot();
    var ht = $('#g-hud-title');
    ht.classList.toggle('hidden', !s.title);
    ht.textContent = s.title ? '🏷 ' + s.title + (bds.length ? '・' + bds.length + ' 枚徽章' : '') : '';
    updateCompanions();
    if (P.packOpen) renderPack();
    var rtEl = $('#g-route'), myRoute = se.route ? routeOf(s, se.route) : null;
    rtEl.classList.toggle('hidden', !myRoute);
    if (myRoute) {
      rtEl.textContent = '🧭 ' + myRoute.name;
      rtEl.style.background = myRoute.color || ''; rtEl.style.color = myRoute.color ? '#fff' : '';
    }
    $('#g-score').textContent = se.score;
    $('#g-progress-text').textContent = s.summary.done + ' / ' + s.summary.total;
    $('#g-progress').style.width = (s.summary.total ? s.summary.done / s.summary.total * 100 : 0) + '%';
    $('#g-unlock-mode').textContent = s.project.unlock_mode === 'free' ? '自由順序' : '依序解鎖';
    $('#g-finished').classList.toggle('hidden', se.status !== 'finished');
    $('#g-timeup').classList.toggle('hidden', se.status !== 'timeup');

    var stageList = $('#g-stages'), keepLeft = stageList.scrollLeft;
    stageList.innerHTML = s.stages.map(function (st, i) {
      var dist = '';
      if (P.pos && showsLoc(st)) dist = distText(st);
      var state = st.status === 'solved' ? '✓ 已完成 +' + st.earned
        : st.status === 'locked' ? '🔒 未解鎖'
        : st.status === 'failed' ? '✗ 未通過'
        : st.status === 'arrived' ? '作答中' : '挑戰中';
      return '<button class="stage-card ' + st.status + '" data-id="' + esc(st.stage_id) + '">' +
        '<div class="sc-top"><span class="sc-no">第 ' + (i + 1) + ' 關</span><span class="sc-state">' + state + '</span></div>' +
        '<div class="sc-title">' + esc(st.title) + '</div>' +
        '<div class="meta">' + Q.TYPE_LABEL[st.answer_type] + '・' + st.points + ' 分<span data-dist="' + esc(st.stage_id) + '">' + dist + '</span></div>' +
        '</button>';
    }).join('');
    // 重畫後保留橫向捲動位置；第一次才把進行中的那一關捲到可見位置
    stageList.scrollLeft = keepLeft;
    var cur = document.querySelector('#g-stages .stage-card.open, #g-stages .stage-card.arrived');
    if (cur && cur.scrollIntoView && !P.scrolledCur) { P.scrolledCur = true; cur.scrollIntoView({ block: 'nearest', inline: 'center' }); }
    Q.$$('#g-stages [data-id]').forEach(function (b) {
      b.onclick = function () {
        var st = findStage(b.dataset.id);
        if (st.status === 'locked') return Q.toast('請先完成前面的關卡', 'warn');
        openStage(st.stage_id);
      };
    });
    drawStagesOnMap();
    updateNextStep();
    updateStageMore();
    if (se.status === 'playing') { keepAwake(); resumeSensors(); } else stopSensors();
  }

  function routeOf(state, id) {
    var rts = (state && state.project && state.project.routes) || [];
    return rts.filter(function (r) { return r.id === id; })[0] || null;
  }
  function routeName(state, id) { var r = routeOf(state, id); return r ? r.name : id; }

  /** 收藏品圖示：emoji 直接顯示；http(s) / data 開頭視為圖片網址 */
  function iconHtml(icon) {
    icon = String(icon || '');
    if (/^(https?:|data:image)/i.test(icon)) return '<img src="' + esc(icon) + '" alt="" onerror="this.replaceWith(document.createTextNode(\'🎁\'))">';
    return esc(icon || '🎁');
  }
  function deckOpts(extra) {
    var pj = (P.state && P.state.project) || {};
    return Object.assign({ kind: pj.deck_kind || 'nature', style: pj.deck_style || 'foil' }, extra || {});
  }
  function openCardView(card) {
    $('#card-view-card').innerHTML = Q.cardHtml(card, deckOpts({ big: true, tilt: true })) + (card.art_credit ? '<div class="card-credit">圖片：' + esc(card.art_credit) + '</div>' : '');
    Q.bindTilt($('#card-view-card'));
    $('#card-view').classList.remove('hidden');
    layerOpen('cardview');
  }
  function closeCardView() { $('#card-view').classList.add('hidden'); layerClose('cardview'); }
  var RARITY_TXT = { normal: '普通', rare: '稀有', legend: '傳說' };

  function draftKey(stageId, field) { return 'escapegame:draft:' + P.sid + ':' + stageId + ':' + field; }
  function clearDrafts(stageId) { ['s-ans', 's-caption', 's-code'].forEach(function (f) { try { localStorage.removeItem(draftKey(stageId, f)); } catch (e) { /* */ } }); }

  /** 隊伍代碼：換手機、清掉瀏覽器資料時，靠它接回進度。點上方代碼可再看一次 */
  function showTeamCode(first) {
    var code = (P.state && P.state.session && P.state.session.code) || '';
    if (!code) return;
    try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code); } catch (e) { /* */ }
    askConfirm('🔑 隊伍代碼：' + code,
      (first ? '隊伍建立成功！請先把這組代碼截圖或抄下來。\n\n' : '') +
      '如果手機沒電、換手機、或瀏覽器資料被清掉，在開始頁面按「用隊伍代碼接續」輸入它，就能接回原本的進度。\n（代碼已複製到剪貼簿）',
      '我記下了', true);
  }

  function copyText(text) {
    return new Promise(function (resolve) {
      if (!text) return resolve(false);
      try { if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(function () { resolve(true); }, function () { resolve(legacyCopy(text)); }); } catch (e) { /* */ }
      resolve(legacyCopy(text));
    });
  }
  function legacyCopy(text) {
    try {
      var t = document.createElement('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(t); t.select(); t.setSelectionRange(0, 999);
      var ok = document.execCommand('copy'); t.remove(); return ok;
    } catch (e) { return false; }
  }

  /* ---------- 新手教學（第一次進來才顯示，可跳過） ---------- */
  var TUT = [];
  function maybeTutorial(state) {
    try { if (localStorage.getItem('escapegame:tut') === '1') return; } catch (e) { return; }
    var pj = state.project || {}, hasColl = (state.collection || []).length, hasFrag = (state.fragments || []).length;
    TUT = [
      { icon: '🔑', title: '記下你們的隊伍代碼：' + ((state.session && state.session.code) || ''), text: '換手機或瀏覽器資料被清掉時，靠這組代碼接回進度。\n請截圖或抄下來；之後點上方的代碼也能再看到。' },
      { icon: '📍', title: '跟著指示找地點', text: '地圖上的「下一站」會告訴你方向和距離。\n走到地點附近，按「我到了，定位打卡」。' },
      { icon: '✏️', title: '答題過關', text: '打卡後就能作答。需要幫忙時可以按「需要提示」，\n但看提示會讓這一關可得的分數變少。' }
    ];
    if (hasColl) TUT.push({ icon: '🃏', title: '收集卡牌與收藏品', text: '每過一關都能收進圖鑑。點右上角的 🎒 看收集進度，\n集滿整本會有驚喜。你的小夥伴也會越來越多！' });
    if (hasFrag) TUT.push({ icon: '🧩', title: '收集密碼碎片', text: '過關會得到密碼碎片，全部收集起來，\n就能在最後一關解開最終密碼。' });
    if (pj.leaderboard_live) TUT.push({ icon: '🏆', title: '看看其他隊伍', text: '點上方的「🏆 排行榜」，隨時看各隊的進度。' });
    var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
    if (TOUCH && !standalone) TUT.push({ icon: '📲', title: '小技巧：加到主畫面', text: 'iPhone：點 Safari 下方的分享鈕 →「加入主畫面」。\nAndroid：點瀏覽器選單 →「加到主畫面」。\n之後從主畫面開啟，沒有網址列，畫面更大。' });
    P.tutI = 0;
    renderTut();
    $('#tutorial').classList.remove('hidden');
  }
  function renderTut() {
    var s = TUT[P.tutI];
    $('#tut-icon').textContent = s.icon; $('#tut-title').textContent = s.title; $('#tut-text').textContent = s.text;
    $('#tut-dots').innerHTML = TUT.map(function (x, i) { return '<i class="' + (i === P.tutI ? 'on' : '') + '"></i>'; }).join('');
    $('#tut-next').textContent = P.tutI === TUT.length - 1 ? '開始闖關！' : '下一步';
    $('#tut-skip').classList.toggle('hidden', P.tutI === TUT.length - 1);
  }
  function tutNext() { if (P.tutI >= TUT.length - 1) return tutEnd(); P.tutI++; renderTut(); }
  function tutEnd() {
    $('#tutorial').classList.add('hidden');
    var first = true;
    try { first = localStorage.getItem('escapegame:tut') !== '1'; localStorage.setItem('escapegame:tut', '1'); } catch (e) { /* */ }
    if (first && !document.documentElement.classList.contains('big-text')) {
      askConfirm('文字大小', '在戶外太陽下看字吃力嗎？可以改成大字模式（之後也能在上方 Aa 隨時切換）。', '改成大字').then(function (yes) {
        if (!yes) return;
        document.documentElement.classList.add('big-text');
        try { localStorage.setItem('escapegame:bigtext', '1'); } catch (e) { /* */ }
      });
    }
  }

  /* ---------- 抵達成功的明顯回饋 ---------- */
  function arriveFlash() {
    var el = $('#arrive-flash');
    el.classList.remove('hidden');
    el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
    try { if (Snd.on && navigator.vibrate) navigator.vibrate([90, 50, 90, 50, 160]); } catch (e) { /* */ }
    setTimeout(function () { el.classList.add('hidden'); }, 1500);
  }

  /* ---------- 🎒 紅點：有新收集的東西 ---------- */
  function seenKey() { return 'escapegame:seen:' + P.sid; }
  function currentOwned() {
    var s = P.state || {}, ids = [];
    (s.collection || []).forEach(function (x) { if (x.got) ids.push('c:' + (x.id || x.stage_id)); });
    (s.badges || []).forEach(function (b) { ids.push('b:' + b.id); });
    (s.fragments || []).forEach(function (f) { if (f.got) ids.push('f:' + f.stage_id); });
    return ids;
  }
  function seenSet() {
    try { var raw = localStorage.getItem(seenKey()); return raw === null ? null : JSON.parse(raw); } catch (e) { return []; }
  }
  function newOwned() {
    var seen = seenSet(), cur = currentOwned();
    if (seen === null) { try { localStorage.setItem(seenKey(), JSON.stringify(cur)); } catch (e) { /* */ } return []; }   // 第一次：不要整排都算新的
    return cur.filter(function (id) { return seen.indexOf(id) < 0; });
  }
  function markSeen() { try { localStorage.setItem(seenKey(), JSON.stringify(currentOwned())); } catch (e) { /* */ } updatePackDot(); }
  function updatePackDot() { var b = $('#btn-pack'); if (b) b.classList.toggle('has-new', newOwned().length > 0 && !P.packOpen); }

  function findStage(id) {
    return P.state.stages.filter(function (x) { return x.stage_id === id; })[0];
  }

  function tick() {
    updateLock();
    var se = P.state && P.state.session;
    var el = $('#g-timer');
    if (!se || !se.deadline || se.status !== 'playing') { el.classList.add('hidden'); return; }
    var left = (new Date(se.deadline) - Date.now()) / 1000;
    el.classList.remove('hidden');
    el.textContent = '⏱ ' + Q.fmtDuration(left);
    el.style.background = left < 300 ? 'rgba(181,69,47,.85)' : '';
    if (left > 0) timeWarn(left);
    if (left <= 0 && !P.timeupChecked) {
      P.timeupChecked = true;
      refresh();
    }
  }

  /** 剩 10 分鐘、3 分鐘時，用醒目的橫幅＋震動提醒（每個門檻只提醒一次，重新整理也不會重複） */
  function timeWarn(left) {
    if (!P.sid) return;
    var key = 'escapegame:tw:' + P.sid, done = [];
    try { done = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { /* */ }
    var hit = [600, 180].filter(function (t) { return left <= t; }), th = hit.length ? hit[hit.length - 1] : null;
    if (th == null || done.indexOf(th) >= 0) return;
    [600, 180].forEach(function (t) { if (t >= th && done.indexOf(t) < 0) done.push(t); });
    try { localStorage.setItem(key, JSON.stringify(done)); } catch (e) { /* */ }
    var b = $('#time-banner');
    b.innerHTML = '⏰ 剩下約 <b>' + Math.max(1, Math.round(th / 60)) + ' 分鐘</b>！<span>' + (th <= 180 ? '趕快完成手上的關卡，或準備回集合點' : '注意時間，記得預留回集合點的時間') + '（點一下關閉）</span>';
    b.classList.toggle('urgent', th <= 180);
    b.classList.remove('hidden');
    try { if (Snd.on && navigator.vibrate) navigator.vibrate([250, 120, 250, 120, 250]); } catch (e) { /* */ }
    sfx('bad');
    clearTimeout(P.twT);
    P.twT = setTimeout(function () { b.classList.add('hidden'); }, 15000);
  }

  async function refresh() {
    try {
      var r = await api('getSession', { sessionId: P.sid });
      applyState(r.state);
    } catch (e) { /* 靜默 */ }
  }

  /**
   * 這一關要不要顯示位置（方向、距離、小地圖）。後端只有在「在地圖上顯示位置」開啟時才會給座標，所以有座標就顯示。
   * 不用打卡的關卡（打卡條件沒勾 GPS）也要顯示，玩家才知道去哪裡；只是不用按「我到了」。
   */
  function showsLoc(st) { return st.lat != null && (st.status === 'open' || (st.status === 'arrived' && !st.require_gps)); }

  /* ---------- 沒有任何定位關卡：不顯示地圖與定位標籤、不持續定位（權限仍照樣在進入時詢問） ---------- */
  function stateNoGps(state) {
    var ss = (state && state.stages) || [];
    return !!ss.length && !ss.some(function (s) { return s.lat != null; });
  }
  function noGpsMode() {
    P.noGps = true;
    try { if (P.watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(P.watchId); } catch (e) { /* */ }
    P.watchId = null;
    // 沒有定位關卡也一樣要過定位權限（只問一次，不持續定位、也不顯示地圖）
    try { if (navigator.geolocation) navigator.geolocation.getCurrentPosition(function () { /* */ }, function () { /* */ }, { maximumAge: 600000, timeout: 15000 }); } catch (e) { /* */ }
    ['#map-card', '#g-gps'].forEach(function (s) { var el = $(s); if (el) el.classList.add('hidden'); });
  }

  /* ---------- 定位 ---------- */
  function startWatch() {
    if (P.watchId != null || P.noGps || P.sensorsOff) return;
    if (!('geolocation' in navigator)) { setGps('none'); return; }
    var hi = P.gpsMode !== 'low';
    var onPos = function (p) {
      var prevPos = P.pos;
      P.pos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, t: Date.now() };
      // 走路時 GPS 會提供移動方向，沒有指南針的手機可以拿來用
      if (p.coords.heading != null && !isNaN(p.coords.heading) && p.coords.speed > 0.7) {
        P.gpsHeading = p.coords.heading; P.gpsHeadingT = Date.now();
      }
      if (prevPos && Q.distM(prevPos.lat, prevPos.lng, P.pos.lat, P.pos.lng) > 3) P.moveBearing = bearing(prevPos.lat, prevPos.lng, P.pos.lat, P.pos.lng);
      setGps('ok');
      updateMe();
      updateDistances();
      adaptGps();
    };
    var onErr = function (err) { setGps(err.code === 1 ? 'denied' : 'error'); };
    P.watchId = navigator.geolocation.watchPosition(onPos, onErr,
      hi ? { enableHighAccuracy: true, maximumAge: 5000, timeout: 25000 } : { enableHighAccuracy: false, maximumAge: 30000, timeout: 40000 });
    // 衛星定位（GPS）第一次定位常要等十幾秒甚至更久：同時先用 Wi-Fi／基地台要一個「概略位置」，一兩秒內就能在地圖上顯示「我」，
    // 之後 GPS 有精準位置了會自動取代它（已經有位置就不會被概略位置蓋掉）
    if (hi && !P.pos) {
      try {
        navigator.geolocation.getCurrentPosition(function (p) { if (!P.pos) onPos(p); }, function () { /* 失敗就等 GPS */ },
          { enableHighAccuracy: false, maximumAge: 300000, timeout: 8000 });
      } catch (e) { /* */ }
    }
  }

  /** 離下一個定位關卡超過 600 公尺 → 省電模式（不開高精度、更新較慢）；進到 350 公尺內就切回高精度 */
  function adaptGps() {
    if (!P.pos || P.noGps) return;
    var st = focusStage(), d = st ? Q.distM(P.pos.lat, P.pos.lng, st.lat, st.lng) : Infinity;
    var want = P.gpsMode === 'low' ? (d < 350 ? 'high' : 'low') : (d > 600 ? 'low' : 'high');
    if (want === (P.gpsMode || 'high') || Date.now() - (P.gpsModeT || 0) < 30000) return;
    P.gpsMode = want; P.gpsModeT = Date.now();
    try { navigator.geolocation.clearWatch(P.watchId); } catch (e) { /* */ }
    P.watchId = null; startWatch();
  }

  function setGps(state) {
    P.gpsState = state;
    var dot = $('#g-gps .gps-dot'), pill = $('#gps-pill'), pt = $('#gps-pill-text'), help = $('#g-gps-text'), box = $('#g-gps-box');
    var cls = '', text = '定位中…', tip = '';
    if (state === 'ok') {
      var acc = Math.round(P.pos.acc);
      cls = acc > 50 ? 'warn' : 'ok';
      text = P.gpsMode === 'low' ? '省電定位中 ±' + acc + ' 公尺' : (acc > 50 ? '定位不準 ±' : '定位中 ±') + acc + ' 公尺';
      if (P.gpsMode === 'low') cls = 'ok';
      if (acc > 100 && P.gpsMode !== 'low') tip = '⚠️ 誤差很大（電腦定位常見），地圖距離僅供參考，建議用手機到現場。';
    } else if (state === 'denied') {
      cls = 'bad'; text = '未允許定位';
      tip = (/iPhone|iPad|iPod/i.test(navigator.userAgent)
        ? '📍 iPhone：設定 → 隱私權與安全性 → 定位服務 → 開啟，並把 Safari（或你用的瀏覽器）設為「使用 App 期間」；再回來按「重新定位」。'
        : '📍 Android：點網址列左邊的 🔒 → 權限 → 位置 → 允許；再回來按「重新定位」。');
    } else if (state === 'stopped') {
      cls = ''; text = '定位已停止（任務已結束）';
    } else if (state === 'none') {
      cls = 'bad'; text = '不支援定位'; tip = '這台裝置不支援定位。';
    } else if (state === 'error') {
      cls = 'bad'; text = '無法定位'; tip = '📡 暫時抓不到定位，請走到空曠處、確認手機的定位已開啟，再按「重新定位」。';
    }
    dot.className = 'gps-dot ' + (cls === 'ok' || cls === 'warn' ? 'ok' : cls === 'bad' ? 'bad' : '');
    pill.className = 'gps-pill ' + cls;
    pt.textContent = text;
    help.textContent = tip;
    box.classList.toggle('hidden', !tip);
    $('#gps-retry').classList.toggle('hidden', state === 'none' || state === 'ok');
  }

  /** 重新要定位：清掉舊的監聽再重新開始（權限剛改過、定位卡住時用） */
  function retryGps() {
    try { if (P.watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(P.watchId); } catch (e) { /* */ }
    P.watchId = null;
    setGps('loading');
    startWatch();
    Q.toast('重新定位中…', 'warn', 2000);
  }

  function toastGps() {
    if (P.gpsState === 'denied') Q.toast('定位權限被拒絕：請到手機設定 → 瀏覽器 → 位置，改成「允許」，再重新整理頁面。', 'err', 7000);
    else Q.toast('還沒取得定位，請稍候或移到空曠處', 'warn');
  }

  /** 取得一次新鮮的定位 */
  async function getFix() {
    if (P.pos && Date.now() - P.pos.t < 8000 && P.pos.acc <= 40) return P.pos;
    try {
      P.pos = await Q.locate();
      setGps('ok'); updateMe();
      return P.pos;
    } catch (e) {
      setGps(e.code === 1 ? 'denied' : 'error');
      throw e;
    }
  }

  function distText(st) {
    var d = Q.distM(P.pos.lat, P.pos.lng, st.lat, st.lng);
    if (d <= st.radius_m) return '・✅ 已在範圍內';
    return '・' + dirName(bearing(P.pos.lat, P.pos.lng, st.lat, st.lng)) + ' ' + Q.fmtDist(d);
  }

  function updateDistances() {
    if (!P.state || !P.pos) return;
    P.state.stages.forEach(function (st) {
      if (!showsLoc(st)) return;
      var el = document.querySelector('[data-dist="' + st.stage_id + '"]');
      if (el) el.textContent = distText(st);
    });
    updateCompass();
    updateNextStep();
  }

  /* ---------- 方向與指南針 ---------- */
  var DIRS = ['北', '東北', '東', '東南', '南', '西南', '西', '西北'];
  var RELS = ['正前方', '右前方', '右邊', '右後方', '正後方', '左後方', '左邊', '左前方'];
  function dirName(b) { return DIRS[Math.round(((b % 360) + 360) % 360 / 45) % 8]; }
  function relName(r) { return RELS[Math.round(((r % 360) + 360) % 360 / 45) % 8]; }

  /** 從 A 點看 B 點的方位角（0 = 北，90 = 東） */
  function bearing(lat1, lng1, lat2, lng2) {
    var t = Math.PI / 180;
    var y = Math.sin((lng2 - lng1) * t) * Math.cos(lat2 * t);
    var x = Math.cos(lat1 * t) * Math.sin(lat2 * t) - Math.sin(lat1 * t) * Math.cos(lat2 * t) * Math.cos((lng2 - lng1) * t);
    return (Math.atan2(y, x) / t + 360) % 360;
  }

  /** 啟用手機指南針；iOS 必須在使用者點擊時要求權限 */
  function startCompass(fromGesture, manual) {
    if (P.compassOn || (P.compassDenied && !manual)) return;
    var D = window.DeviceOrientationEvent;
    if (!D) return;
    if (typeof D.requestPermission === 'function') {
      if (!fromGesture) return;
      D.requestPermission().then(function (r) {
        if (r === 'granted') listenCompass();
        else {
          P.compassDenied = true;
          if (manual) Q.toast('沒有允許使用方向感測器。iPhone 請關閉 Safari 分頁後重新開啟網頁再試；箭頭會先以北方為上。', 'warn', 6000);
          updateCompass();
        }
      }).catch(function () { /* 不是在點擊事件中 */ });
    } else {
      listenCompass();
    }
  }

  /* ---------- 任務結束（通關、時間到、關閉）後停掉定位與指南針，省電 ---------- */
  function stopSensors() {
    if (P.sensorsOff) return;
    P.sensorsOff = true;
    try { if (P.watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(P.watchId); } catch (e) { /* */ }
    P.watchId = null;
    P.compassWasOn = !!P.compassOn;
    if (P.compassOn) {
      var evt = ('ondeviceorientationabsolute' in window) ? 'deviceorientationabsolute' : 'deviceorientation';
      window.removeEventListener(evt, onOrientation, true);
      P.compassOn = false;
    }
    if (!P.noGps) setGps('stopped');
  }
  /** 結束後又有新關卡開放（隊伍重新開始闖關）時，把定位接回來 */
  function resumeSensors() {
    if (!P.sensorsOff) return;
    P.sensorsOff = false;
    if (!P.noGps) startWatch();
    if (P.compassWasOn) listenCompass();
  }

  function listenCompass() {
    P.compassOn = true;
    P.compassStart = Date.now();
    var evt = ('ondeviceorientationabsolute' in window) ? 'deviceorientationabsolute' : 'deviceorientation';
    window.addEventListener(evt, onOrientation, true);
    setTimeout(updateCompass, 3500); // 3.5 秒內沒收到資料 → 顯示「沒有指南針」
    updateCompass();
  }

  function onOrientation(e) {
    var h = null;
    if (typeof e.webkitCompassHeading === 'number' && !isNaN(e.webkitCompassHeading)) h = e.webkitCompassHeading; // iOS
    else if (e.absolute && e.alpha != null) h = 360 - e.alpha;                                                  // Android
    if (h == null) return;
    var so = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    h = (h + so + 360) % 360;
    if (P.heading == null) P.heading = h;
    else { var diff = ((h - P.heading + 540) % 360) - 180; P.heading = (P.heading + diff * 0.25 + 360) % 360; } // 平滑
    P.headingT = Date.now();
    if (!P.compassRaf) P.compassRaf = requestAnimationFrame(function () { P.compassRaf = null; updateCompass(); });
  }

  /** 目前面向的方向：指南針優先，其次用走路時的 GPS 移動方向 */
  function currentHeading() {
    if (P.heading != null && Date.now() - P.headingT < 3000) return { h: P.heading, src: 'compass' };
    if (P.gpsHeading != null && Date.now() - P.gpsHeadingT < 8000) return { h: P.gpsHeading, src: 'gps' };
    return null;
  }

  function compassHtml(st) {
    return '<div class="card compass-card">' +
      '<div class="compass" id="cmp">' +
      '<div class="compass-ring" id="cmp-ring"><span class="cn">北</span><span class="ce">東</span><span class="cs">南</span><span class="cw">西</span></div>' +
      '<svg class="compass-arrow" id="cmp-arrow" viewBox="0 0 100 100" aria-hidden="true"><path d="M50 6 L74 84 L50 68 L26 84 Z"/></svg>' +
      '<div class="compass-me"></div></div>' +
      '<div class="distance" id="live-dist">定位中…</div>' +
      '<div id="live-dir" class="live-dir"></div>' +
      '<div class="help" id="cmp-mode"></div>' +
      '<div class="help">' + (st.require_gps ? '進入 ' + st.radius_m + ' 公尺範圍內即可打卡' : '這一關不用打卡，到這個位置附近就可以了') + '</div>' +
      '<button class="sm ghost hidden" id="btn-compass" style="margin-top:8px">🧭 啟用指南針</button></div>';
  }

  /* ---------- 關卡面板裡的小地圖：只顯示「我」和「這一關的目標與範圍」 ---------- */
  function destroySheetMap() {
    if (P.sMap) { try { P.sMap.remove(); } catch (e) { /* */ } }
    P.sMap = null; P.sMe = null; P.sMeAcc = null;
  }
  function fitSheetMap(both) {
    var st = findStage(P.openId), m = P.sMap;
    if (!m || !st || st.lat == null) return;
    var tgt = [st.lat, st.lng];
    if (both && P.pos && Q.distM(P.pos.lat, P.pos.lng, st.lat, st.lng) < 20000) m.fitBounds([tgt, [P.pos.lat, P.pos.lng]], { padding: [34, 34], maxZoom: 18 });
    else m.setView(tgt, 17);
  }
  function mountSheetMap() {
    destroySheetMap();
    var el = document.getElementById('sheet-map'), st = findStage(P.openId);
    if (!el || !window.L || !st || st.lat == null) return;
    var m = P.sMap = L.map(el, { zoomControl: true, attributionControl: false, dragging: !TOUCH, tap: false }).setView([st.lat, st.lng], 17);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(m);
    var color = themeVar('--forest', '#265f46');
    L.circle([st.lat, st.lng], { radius: st.radius_m, color: color, weight: 2, fillOpacity: .16 }).addTo(m);
    var no = P.state.stages.indexOf(st) + 1;
    L.marker([st.lat, st.lng], { icon: L.divIcon({ className: '', html: '<div class="pin cur" style="background:' + color + '">' + no + '</div>', iconSize: [36, 36], iconAnchor: [18, 18] }), interactive: false }).addTo(m);
    updateSheetMap();
    fitSheetMap(true);
    var both = document.getElementById('sheet-map-both'), tgt = document.getElementById('sheet-map-target');
    if (both) both.onclick = function () { if (P.pos) fitSheetMap(true); else toastGps(); };
    if (tgt) tgt.onclick = function () { fitSheetMap(false); };
    setTimeout(function () { if (P.sMap === m) { m.invalidateSize(); fitSheetMap(true); } }, 150);   // 面板剛打開時容器大小還沒定，補一次
  }
  function updateSheetMap() {
    var m = P.sMap;
    if (!m || !P.pos) return;
    var ll = [P.pos.lat, P.pos.lng];
    if (!P.sMe) {
      P.sMeAcc = L.circle(ll, { radius: P.pos.acc, color: '#2f6690', weight: 1, fillOpacity: .1, interactive: false }).addTo(m);
      P.sMe = L.marker(ll, { icon: meIcon(myAvatar()), interactive: false, zIndexOffset: 900 }).addTo(m);
      fitSheetMap(true);
    } else { P.sMe.setLatLng(ll); P.sMeAcc.setLatLng(ll).setRadius(P.pos.acc); }
  }

  function updateCompass() {
    var arrow = document.getElementById('cmp-arrow');
    if (!arrow || !P.openId) return;
    var st = findStage(P.openId);
    if (!st || !showsLoc(st)) return;
    var ring = $('#cmp-ring'), dist = $('#live-dist'), dir = $('#live-dir'), mode = $('#cmp-mode'), box = $('#cmp');
    var btn = $('#btn-compass');
    var needBtn = !P.compassOn && !P.compassDenied && window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function';
    btn.classList.toggle('hidden', !needBtn);
    if (!P.pos) { dist.textContent = '定位中…'; dir.textContent = '請允許位置權限，並移到空曠處'; return; }

    var d = Q.distM(P.pos.lat, P.pos.lng, st.lat, st.lng);
    var b = bearing(P.pos.lat, P.pos.lng, st.lat, st.lng);
    var cur = currentHeading(), h = cur ? cur.h : 0;
    var inside = d <= st.radius_m;
    ring.style.transform = 'rotate(' + (-h) + 'deg)';
    arrow.style.transform = 'rotate(' + (b - h) + 'deg)';
    box.classList.toggle('inside', inside);
    dist.textContent = inside ? '已抵達！' : Q.fmtDist(d);
    if (inside) {
      dir.textContent = st.require_gps ? '你已經在範圍內，按下方「我到了」打卡' : '你已經到這一關的位置了';
    } else {
      dir.innerHTML = '目標在你的 <b>' + dirName(b) + '方</b>（' + Math.round(b) + '°）' +
        (cur ? '・<b>' + relName(b - h) + '</b>' : '');
    }
    var tips = [];
    if (cur && cur.src === 'compass') tips.push('🧭 指南針已啟用，請把手機放平，箭頭就是目標方向');
    else if (cur && cur.src === 'gps') tips.push('🚶 依你走路的方向判斷，停下來時會改成北方為上');
    else if (P.compassDenied) tips.push('未允許方向感測器，箭頭以「北」為上（邊走路會自動判斷方向）');
    else if (P.compassOn && Date.now() - P.compassStart > 3000) tips.push('這台裝置沒有指南針，箭頭以「北」為上（邊走路會自動判斷方向）');
    else tips.push('箭頭以「北」為上');
    if (P.pos.acc > 30) tips.push('定位誤差約 ' + Math.round(P.pos.acc) + ' 公尺，距離僅供參考');
    mode.textContent = tips.join('；');
  }

  /* ---------- 地圖 ---------- */
  function initMap() {
    if (P.map || !window.L) { if (!window.L) $('#map-card').classList.add('hidden'); return; }
    P.map = L.map('g-map', { zoomControl: true, attributionControl: true, dragging: !TOUCH }).setView([23.7, 121], 7);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap'
    }).addTo(P.map);
    P.layers = L.layerGroup().addTo(P.map);
    P.map.on('zoomend', updateLink);
    if (TOUCH) P.map.on('click', function () { if (!$('#map-card').classList.contains('full')) setFullscreen(true); });
    if (TOUCH) { var mh = $('#map-hint'); mh.classList.remove('hidden'); setTimeout(function () { mh.classList.add('hidden'); }, 6000); }
    drawStagesOnMap();
  }

  /* ---------- 前台主題（後台「前台畫面風格」） ---------- */
  var THEMES = ['retro', 'history', 'sport', 'mist', 'forest', 'neon', 'campus', 'ocean'];
  function themeVar(name, fallback) {
    var v = getComputedStyle(document.body).getPropertyValue(name);
    return (v && v.trim()) || fallback;
  }
  function pinColor(status) {
    var key = { locked: '--pin-locked', open: '--pin-open', arrived: '--pin-open', solved: '--pin-solved', failed: '--pin-failed' }[status] || '--pin-locked';
    return themeVar(key, '#5b4a32');
  }
  function applyTheme(t) {
    t = THEMES.indexOf(t) >= 0 ? t : 'retro';
    if (P.theme === t) return;
    P.theme = t;
    document.body.className = 'quest theme-' + t;
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', themeVar('--topbar', '#3b2d17'));
  }

  function drawStagesOnMap() {
    if (!P.map || !P.state) return;
    P.layers.clearLayers();
    var pts = [], prev = null;
    P.state.stages.forEach(function (st, i) {
      if (st.lat == null) return;
      // 闖關路線：依關卡順序連線，已完成的路段實線（綠）、未走的路段虛線（棕）
      if (prev) {
        var done = prev.status === 'solved';
        L.polyline([[prev.lat, prev.lng], [st.lat, st.lng]], done
          ? { color: themeVar('--route-done', '#2d6a4f'), weight: 4, opacity: .85, interactive: false }
          : { color: themeVar('--route-todo', '#5b4a32'), weight: 3, opacity: .75, dashArray: '2 8', lineCap: 'round', interactive: false }
        ).addTo(P.layers);
      }
      prev = st;
    });
    P.state.stages.forEach(function (st, i) {
      if (st.lat == null) return;
      var color = pinColor(st.status);
      var current = st.status === 'open' || st.status === 'arrived';
      L.circle([st.lat, st.lng], { radius: st.radius_m, color: color, weight: current ? 2 : 1, fillOpacity: current ? .16 : .06 }).addTo(P.layers);
      var sz = current ? 36 : 28;
      var icon = L.divIcon({ className: '', html: '<div class="pin ' + (current ? 'cur' : '') + '" style="background:' + color + '">' + (st.status === 'solved' ? '✓' : i + 1) + '</div>', iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2] });
      L.marker([st.lat, st.lng], { icon: icon, zIndexOffset: current ? 500 : 0 }).addTo(P.layers).on('click', function () {
        if (st.status === 'locked') return Q.toast('請先完成前面的關卡', 'warn');
        openStage(st.stage_id);
      });
      pts.push([st.lat, st.lng]);
    });
    if (!P.fitted) {
      if (P.pos) pts.push([P.pos.lat, P.pos.lng]);
      if (pts.length > 1) { P.map.fitBounds(pts, { padding: [30, 30], maxZoom: 17 }); P.fitted = true; }
      else if (pts.length === 1) { P.map.setView(pts[0], 17); P.fitted = true; }
    }
    $('#map-card').classList.toggle('hidden', !pts.length && !P.pos);
    updateLink();
  }

  /** 地圖上代表「我」的圖示：隊伍資料裡的造型，其次是這支手機開始時選的，最後才用預設的笑臉 */
  function myAvatar() {
    var s = P.state && P.state.session, av = s && s.avatar;
    if (!av && s) { try { av = localStorage.getItem('escapegame:avatar:' + s.session_id) || ''; } catch (e) { /* */ } }
    return av || P.avatar || '🙂';
  }
  function meIcon(av) { return L.divIcon({ className: '', html: '<div class="me-pin">' + esc(av) + '</div>', iconSize: [38, 38], iconAnchor: [19, 19] }); }

  function updateMe() {
    if (P.noGps || !P.map || !P.pos) return;
    $('#map-card').classList.remove('hidden');
    var ll = [P.pos.lat, P.pos.lng];
    if (!P.me) {
      P.meAcc = L.circle(ll, { radius: P.pos.acc, color: '#2f6690', weight: 1, fillOpacity: .1, interactive: false }).addTo(P.map);
      P.meAv = myAvatar();
      P.me = L.marker(ll, { icon: meIcon(P.meAv), interactive: false, zIndexOffset: 900 }).addTo(P.map);
      if (!P.fitted) { P.map.setView(ll, 17); }
    } else {
      P.me.setLatLng(ll); P.meAcc.setLatLng(ll).setRadius(P.pos.acc);
      var av2 = myAvatar();
      if (av2 !== P.meAv) { P.meAv = av2; P.me.setIcon(meIcon(av2)); }   // 圖示後來才知道（例如一開始還沒載入隊伍資料）時，補上
    }
    updateCompanions();
    updateLink();
    updateSheetMap();
  }

  /** 隨行夥伴：每收集一個收藏品，就多一隻跟在你後面（在移動方向的反側排成一列） */
  function updateCompanions() {
    if (!P.map || !P.pos) return;
    var items = ((P.state && P.state.collection) || []).filter(function (x) { return x.got; }).slice(-10);
    var key = items.map(function (x) { return x.stage_id; }).join(',');
    if (P.compKey !== key) {
      (P.comp || []).forEach(function (m) { P.map.removeLayer(m); });
      P.comp = items.map(function (it) {
        return L.marker([P.pos.lat, P.pos.lng], { icon: L.divIcon({ className: '', html: '<div class="comp">' + iconHtml(it.icon) + '</div>', iconSize: [28, 28], iconAnchor: [14, 14] }), interactive: false, zIndexOffset: 700 }).addTo(P.map);
      });
      P.compKey = key;
    }
    var back = ((P.moveBearing != null ? P.moveBearing : 0) + 180) * Math.PI / 180;
    (P.comp || []).forEach(function (m, i) {
      m.setLatLng([P.pos.lat, P.pos.lng]);
      var d = 28 + i * 17, el = m.getElement();
      if (el && el.firstChild) el.firstChild.style.transform = 'translate(' + (Math.sin(back) * d).toFixed(1) + 'px,' + (-Math.cos(back) * d).toFixed(1) + 'px)';
    });
  }

  /** 目前關注的目標：已打開的關卡，否則是離我最近、尚未完成的關卡 */
  function focusStage() {
    if (!P.state) return null;
    var st = P.openId ? findStage(P.openId) : null;
    if (st && showsLoc(st)) return st;   // 有位置就算（不用打卡的關卡也一樣，否則「我與目標」會找不到目標）
    var best = null, bd = Infinity;
    P.state.stages.forEach(function (s) {
      if (!showsLoc(s)) return;
      var d = P.pos ? Q.distM(P.pos.lat, P.pos.lng, s.lat, s.lng) : 0;
      if (d < bd) { bd = d; best = s; }
    });
    return best;
  }

  /** 我的位置 → 目標關卡 的虛線與距離，讓玩家一眼看出差多遠 */
  function updateLink() {
    if (!P.map) return;
    var st = P.pos && focusStage();
    P.focus = st || null;
    if (!st) { if (P.link) { P.map.removeLayer(P.link); P.link = null; } return; }
    var d = Q.distM(P.pos.lat, P.pos.lng, st.lat, st.lng);
    var inside = d <= st.radius_m;
    P.inside = P.inside || {};
    if (inside && P.pos.acc <= 100 && !P.inside[st.stage_id]) {   // 定位誤差太大（例如剛開始的概略位置）時先不要通知
      P.inside[st.stage_id] = true;
      if (P.state && P.state.session.status === 'playing') { sfx('near'); Q.toast('已進入「' + st.title + '」範圍' + (st.require_gps ? '，可以打卡了' : ''), 'ok'); }
    } else if (!inside && d > st.radius_m * 1.3) P.inside[st.stage_id] = false;
    var ll = [[P.pos.lat, P.pos.lng], [st.lat, st.lng]];
    var label = '距離「' + st.title + '」' + Q.fmtDist(d) + (P.pos.acc > 100 ? ' ⚠️誤差大' : '');
    var style = { color: inside ? themeVar('--link-near', '#2d6a4f') : themeVar('--link-far', '#c1440e') };
    if (!P.link) {
      P.link = L.polyline(ll, { color: style.color, weight: 2.5, dashArray: '4 7', interactive: false }).addTo(P.map);
      P.link.bindTooltip(label, { permanent: true, direction: 'center', className: 'dist-tip' });
    } else {
      P.link.setLatLngs(ll).setStyle(style);
      P.link.setTooltipContent(label);
    }
    // 已在範圍內、或線太短（標籤會蓋住圖釘）時隱藏標籤，距離仍顯示在面板／指南針
    var px = P.map.latLngToContainerPoint(ll[0]).distanceTo(P.map.latLngToContainerPoint(ll[1]));
    if (inside || px < 90) P.link.closeTooltip(); else P.link.openTooltip();
  }

  function showBoth() {
    if (!P.map) return;
    updateLink();
    var pts = [];
    if (P.pos) pts.push([P.pos.lat, P.pos.lng]);
    if (P.focus) pts.push([P.focus.lat, P.focus.lng]);
    if (pts.length > 1) P.map.fitBounds(pts, { padding: [50, 50], maxZoom: 18 });
    else if (pts.length === 1) P.map.setView(pts[0], 17);
    else toastGps();
  }

  /* ---------- 關卡面板 ---------- */
  function openStage(id) {
    startCompass(true); // 點擊關卡是使用者手勢，iOS 可在這時詢問方向權限
    if (P.openId !== id) { P.choice = null; P.photo = null; }
    P.openId = id;
    updateLink();
    renderStage();
    $('#sheet').classList.remove('hidden');
    layerOpen('sheet');
    fitSheet();
    if (!P.prevFocus) P.prevFocus = document.activeElement;
    var sb = $('#sheet-body');
    sb.setAttribute('tabindex', '-1');
    try { sb.focus({ preventScroll: true }); } catch (e) { /* */ }
  }

  function closeStage() {
    P.openId = null;
    destroySheetMap();
    updateLink();
    $('#sheet').classList.add('hidden');
    resetSheet();
    layerClose('sheet');
    try { if (P.prevFocus && P.prevFocus.focus) P.prevFocus.focus({ preventScroll: true }); } catch (e) { /* */ }
    P.prevFocus = null;
  }

  function renderStage() {
    var st = findStage(P.openId);
    if (!st) return closeStage();
    var se = P.state.session, playing = se.status === 'playing';
    var lab = Q.STATUS_LABEL[st.status];
    var h = [], acts = [];
    P.hintOpen = P.hintOpen || {};
    // 關卡有上傳圖片才顯示頂部大圖；沒設定就不顯示
    if (st.image_url) h.push('<div class="sheet-hero"><img class="hero-img" src="' + esc(st.image_url) + '" alt="" onerror="this.parentNode.remove()"></div>');
    var no = P.state.stages.indexOf(st) + 1;
    h.push('<div class="sheet-head"><div class="grow"><div class="sheet-sub">第 ' + no + ' 關</div><h2 class="sheet-title">' + esc(st.title) + '</h2></div><button class="close-x" id="s-close" aria-label="關閉">✕</button></div>');
    var pen = st.hint_penalty || 0, used = (st.hints || []).length;
    var avail = Math.max(0, st.points - used * pen);   // 目前這一關答對可得的分數
    var ptsChip = st.status === 'solved' ? '<span class="chip green">本關得 ' + st.earned + ' 分</span>'
      : st.status === 'failed' ? '<span class="chip gray">本關 ' + st.points + ' 分</span>'
      : used * pen > 0 ? '<span class="chip amber">本關可得 ' + avail + ' 分（原 ' + st.points + ' 分）</span>'
      : '<span class="chip">本關 ' + st.points + ' 分</span>';
    h.push('<div class="row wrap" style="margin-bottom:12px"><span class="chip ' + lab[1] + '">' + lab[0] + '</span>' +
      '<span class="chip">' + Q.TYPE_LABEL[st.answer_type] + '</span>' + ptsChip +
      '<span class="chip blue">⭐ 目前總分 ' + se.score + '</span></div>');
    h.push('<div class="sheet-content stack">');

    // 1) 線索 → 2) 題目 → 3) 提示（可收合）
    var contentStart = h.length;
    if (st.clue) h.push('<div class="clue">' + Q.linkify(st.clue) + '</div>');
    // 題目：抵達後一定顯示；前往中則看關卡是否設定「抵達前就顯示題目」
    if (st.question) {
      h.push('<div class="question">' + (st.status === 'open' ? '<div class="q-label">📝 題目（抵達地點後才能作答）</div>' : '') + Q.linkify(st.question) + '</div>');
    }
    // 已完成／未通過的關卡：線索與題目收合起來，面板只留結果，比較精簡
    if (st.status === 'solved' || st.status === 'failed') {
      var chunk = h.splice(contentStart).join('');
      if (chunk) h.push('<details class="stage-more"><summary>📄 查看關卡內容</summary><div class="stack" style="margin-top:10px">' + chunk + '</div></details>');
    }
    // 關卡完成（或結束）後，提示就不再顯示
    if (st.hints && st.hints.length && st.status !== 'solved' && st.status !== 'failed') {
      st.hints.forEach(function (t, i) {
        var key = st.stage_id + ':' + i;
        var open = key in P.hintOpen ? P.hintOpen[key] : false; // 重新打開關卡時，已解鎖的提示預設收合
        h.push('<details class="hint" data-hk="' + esc(key) + '"' + (open ? ' open' : '') + '><summary>💡 提示 ' + (i + 1) + '<span class="hint-tag">已解鎖・點開查看</span></summary><div class="hint-body">' + Q.linkify(t) + '</div></details>');
      });
    }

    // 最後一關（答案由碎片組成）：顯示碎片列
    if (st.uses_fragments && st.status !== 'solved' && st.status !== 'failed') h.push(fragStripHtml(st));

    var pushLoc = function () {
      h.push(compassHtml(st));
      if (window.L) h.push('<div class="card sheet-map-card"><div id="sheet-map" class="map sheet-map" aria-label="這一關的位置地圖"></div><div class="map-actions"><button class="ghost" id="sheet-map-both" type="button">🎯 我與目標</button><button class="ghost" id="sheet-map-target" type="button">📍 只看目標</button></div></div>');
    };
    // 4) 前往中：指南針／通關碼；打卡按鈕固定在底部
    if (st.status === 'open') {
      if (st.lat != null) pushLoc();   // 有座標就顯示方向、距離與地圖（不用打卡的關卡也一樣）
      if (playing) {
        // 需要 GPS 打卡、又要輸入文字／數字答案：到了現場可以直接填答案，一次完成「定位＋送答案」
        var combo = st.require_gps && st.question && !st.require_photo && !st.uses_fragments && (st.answer_type === 'text' || st.answer_type === 'number');
        if (combo) h.push(answerUI(st).body);
        if (st.require_gps) acts.push('<button class="big" id="s-arrive">' + (combo ? '📍 我到了，定位打卡' : '📍 我到了，定位打卡') + '</button>');
        if (st.has_bypass) {
          h.push('<div class="card"><label for="s-code">' + (st.require_gps ? '定位不準？輸入現場通關碼' : '輸入現場的通關碼') + '</label>' +
            '<div class="row"><input id="s-code" class="grow" autocomplete="off" placeholder="通關碼"><button id="s-code-btn">確認</button></div></div>');
        }
      }
    }

    // 5) 作答區；送出按鈕固定在底部
    if (st.status === 'arrived' && !st.require_gps && st.lat != null) pushLoc();   // 不用打卡：位置還是要讓玩家看到
    if (st.status === 'arrived' && playing) {
      var ui = answerUI(st);
      if (ui.body) h.push(ui.body);
      if (ui.btn) acts.push(ui.btn);
    }

    if (st.status === 'solved') {
      h.push('<div class="card" style="border-color:var(--forest)"><b>✅ 已完成，獲得 ' + st.earned + ' 分</b>' +
        (st.success_message ? '<div class="pre" style="margin-top:6px">' + Q.linkify(st.success_message) + '</div>' : '') + '</div>');
    }
    if (st.status === 'failed') h.push('<div class="card" style="border-color:var(--red)"><b>這一關沒有通過</b><div class="small muted">作答次數已用完，繼續挑戰下一關吧！</div></div>');

    // 提示按鈕（次要）
    if (playing && (st.status === 'open' || st.status === 'arrived') && st.hints.length < st.hints_total) {
      var nextAvail = Math.max(0, st.points - (used + 1) * pen);
      h.push('<button class="ghost big" id="s-hint">💡 需要提示？（' + (used + 1) + '/' + st.hints_total + '）' +
        (pen ? '<span class="hint-cost">本關可得 ' + avail + ' → ' + nextAvail + ' 分</span>' : '<span class="hint-cost">不扣分</span>') + '</button>');
    }
    if (!playing && st.status !== 'solved') h.push('<p class="muted center">' + (se.status === 'timeup' ? '闖關時間已到' : '闖關已結束') + '</p>');
    h.push('</div>');
    h.push(acts.length ? '<div class="sheet-actions">' + acts.join('') + '</div>' : '<div class="sheet-pad"></div>');
    var body = $('#sheet-body'), keep = body.scrollTop, saved = {};
    var same = P.renderedId === st.stage_id, focusId = document.activeElement && document.activeElement.id;
    if (same) ['s-ans', 's-caption', 's-code'].forEach(function (id) { var el = document.getElementById(id); if (el) saved[id] = el.value; });
    body.innerHTML = h.join('');
    body.scrollTop = same ? keep : 0;
    P.renderedId = st.stage_id;
    Object.keys(saved).forEach(function (id) { var el = document.getElementById(id); if (el && saved[id]) el.value = saved[id]; });
    ['s-ans', 's-caption', 's-code'].forEach(function (id) {   // 沒有現成內容就用暫存的草稿（斷線、重新整理後還在）
      var el = document.getElementById(id);
      if (el && !el.value) { try { var d = localStorage.getItem(draftKey(st.stage_id, id)); if (d) el.value = d; } catch (e) { /* */ } }
    });
    if (same && saved[focusId] !== undefined) { var fe = document.getElementById(focusId); if (fe) { try { fe.focus({ preventScroll: true }); } catch (e) { /* */ } } }
    bindStage(st);
    mountSheetMap();
  }

  /** 照片挑選區：可以直接拍照，也可以從相簿選（相簿不會強制開相機） */
  function photoPickerHtml(withCaption) {
    return '<div class="photo-picker">' +
      '<div class="row"><label class="btn ghost grow" for="s-file-cam">📷 拍照</label><label class="btn ghost grow" for="s-file">🖼 從相簿選擇</label></div>' +
      '<input type="file" id="s-file-cam" accept="image/*" capture="environment" class="hidden">' +
      '<input type="file" id="s-file" accept="image/*" class="hidden">' +
      (P.photo ? '<div class="photo-wrap"><img class="photo-preview" src="' + P.photo + '" alt="已選的照片"><button type="button" class="sm ghost" id="s-photo-clear">🔄 重新選擇</button></div>'
        : '<div class="help">還沒有選擇照片</div>') +
      (withCaption ? '<input id="s-caption" placeholder="照片說明（選填）" maxlength="200">' : '') + '</div>';
  }

  /** 還要等幾秒才能再作答（猜題冷卻） */
  function waitLeft(st) {
    var t = P.locks && P.locks[st.stage_id];
    return t ? Math.max(0, Math.ceil((t - Date.now()) / 1000)) : 0;
  }

  /** 送出答案按鈕：缺碎片或冷卻中時停用並說明原因 */
  function submitBtn(st) {
    var miss = st.uses_fragments ? (st.fragments_missing || 0) : 0, w = waitLeft(st);
    if (miss > 0) return '<button class="big" id="s-submit" disabled>還差 ' + miss + ' 個碎片</button>';
    if (w > 0) return '<button class="big" id="s-submit" disabled>答錯太多次，請等 <span id="wait-n">' + w + '</span> 秒</button>';
    return '<button class="big" id="s-submit">送出答案</button>';
  }

  /** 每秒更新冷卻倒數，時間到就重畫讓按鈕恢復 */
  function updateLock() {
    if (!P.openId) return;
    var st = findStage(P.openId), el = document.getElementById('wait-n');
    if (!st || !el) return;
    var w = waitLeft(st);
    if (w <= 0) { renderStage(); return; }
    el.textContent = w;
  }

  /** 回傳 { body: 作答區 HTML, btn: 固定在底部的主按鈕 HTML } */
  function answerUI(st) {
    var left = st.max_attempts > 0 ? '<div class="help">剩餘作答次數：' + (st.max_attempts - st.attempts) + '</div>' : '';
    switch (st.answer_type) {
      case 'text':
      case 'number':
        if (st.uses_fragments && (st.fragments_missing || 0) > 0) return { body: '', btn: submitBtn(st) };
        return {
          body: '<div class="card"><label for="s-ans">你的答案</label>' +
            '<input id="s-ans" ' + (st.answer_type === 'number' ? 'inputmode="decimal"' : '') + ' autocomplete="off" placeholder="輸入答案">' + left + '</div>' +
            (st.require_photo ? '<div class="card"><label>附上照片（必填）</label>' + photoPickerHtml(false) + '</div>' : ''),
          btn: submitBtn(st)
        };
      case 'choice':
        return {
          body: '<div class="card"><div class="choice-list">' + (st.choices || []).map(function (c, i) {
            return '<button data-choice="' + i + '" class="' + (P.choice === c ? 'sel' : '') + '">' + String.fromCharCode(65 + i) + '. ' + esc(c) + '</button>';
          }).join('') + '</div>' + left + '</div>' +
            (st.require_photo ? '<div class="card"><label>附上照片（必填）</label>' + photoPickerHtml(false) + '</div>' : ''),
          btn: submitBtn(st)
        };
      case 'photo':
        return {
          body: '<div class="card"><label>上傳照片</label>' + photoPickerHtml(true) + '</div>',
          btn: '<button class="big" id="s-upload" ' + (P.photo ? '' : 'disabled') + '>上傳照片</button>'
        };
      case 'form':
        return {
          body: '<div class="card stack">' +
            (st.form_url ? '<a class="btn big" style="width:100%" href="' + esc(st.form_url) + '" target="_blank" rel="noopener">📝 開啟表單作答</a>' : '<p class="muted">（關主尚未設定表單網址）</p>') +
            '<div class="help">表單裡的「隊伍代碼」已幫你填好：<b>' + esc(P.state.session.code) + '</b>，請不要修改。</div></div>',
          btn: '<button class="big amber" id="s-form">我已送出表單</button>'
        };
      case 'none':
        return { body: '', btn: '<button class="big" id="s-arrive">完成打卡</button>' };
    }
    return { body: '', btn: '' };
  }

  function bindStage(st) {
    var on = function (id, fn) { var el = document.getElementById(id); if (el) el.onclick = fn; };
    on('s-close', closeStage);
    Q.$$('details.hint').forEach(function (d) {
      d.querySelector('summary').addEventListener('click', function () { P.hintOpen[d.dataset.hk] = !d.open; });
    });
    on('btn-compass', function () { startCompass(true, true); });
    Q.$$('[data-frag]').forEach(function (b) {
      b.onclick = function () {
        var el = document.getElementById('s-ans');
        if (!el) return Q.toast('抵達關卡後才能輸入答案', 'warn');
        el.value += b.dataset.frag; el.dispatchEvent(new Event('input'));
      };
    });
    on('s-frag-all', function () {
      var el = document.getElementById('s-ans');
      if (!el) return Q.toast('抵達關卡後才能輸入答案', 'warn');
      el.value = ((P.state.fragments || []).map(function (f) { return f.code; })).join('');
    });
    on('s-frag-clear', function () { var el = document.getElementById('s-ans'); if (el) { el.value = ''; el.focus(); } });
    updateCompass();
    var arriveBtn = document.getElementById('s-arrive'), ansEl = document.getElementById('s-ans');
    var arriveLabel = function () { return ansEl && st.status === 'open' && ansEl.value.trim() ? '📍 定位打卡並送出答案' : '📍 我到了，定位打卡'; };
    if (arriveBtn && ansEl && st.status === 'open') {
      arriveBtn.textContent = arriveLabel();
      ansEl.addEventListener('input', function () { arriveBtn.textContent = arriveLabel(); });
    }
    on('s-arrive', function () { doArrive(st, ansEl && st.status === 'open' ? ansEl.value.trim() : ''); });
    on('s-code-btn', function () {
      var code = $('#s-code').value.trim();
      if (!code) return Q.toast('請輸入通關碼', 'warn');
      act('arrive', { stageId: st.stage_id, code: code });
    });
    on('s-hint', async function () {
      // 一律先跳出頁面內的確認視窗（不用瀏覽器內建 confirm，LINE 等內建瀏覽器常會直接擋掉）
      var pen = st.hint_penalty || 0, u = st.hints.length;
      var a0 = Math.max(0, st.points - u * pen), a1 = Math.max(0, st.points - (u + 1) * pen);
      var msg = pen
        ? '⚠️ 看提示會扣分！\n\n這一關答對可得的分數：' + a0 + ' 分 → ' + a1 + ' 分（每則提示少 ' + pen + ' 分）。\n\n你們目前總分 ' + P.state.session.score + ' 分，不會馬上被扣，會在這一關過關時少算。'
        : '這則提示不會扣分，可以放心使用。\n\n（你們目前總分 ' + P.state.session.score + ' 分）';
      var ok = await askConfirm('要看提示嗎？', msg, pen ? '看提示（少 ' + pen + ' 分）' : '看提示');
      if (ok) act('getHint', { stageId: st.stage_id });
    });
    on('s-submit', function () {
      var ans = st.answer_type === 'choice' ? P.choice : ($('#s-ans') && $('#s-ans').value.trim());
      if (!ans) return Q.toast(st.answer_type === 'choice' ? '請選擇一個答案' : '請輸入答案', 'warn');
      if (st.require_photo && !P.photo) return Q.toast('這一關要附上一張照片才能送出', 'warn');
      var left = st.max_attempts ? st.max_attempts - (st.attempts || 0) : 99;
      var go = left <= 1 ? askConfirm('最後一次機會', '這是這一關最後一次作答，確定要送出「' + (st.answer_type === 'choice' ? ans : String(ans).slice(0, 30)) + '」嗎？', '確定送出') : Promise.resolve(true);
      go.then(function (okGo) {
        if (!okGo) return;
        var sb = $('#s-submit'); if (sb) { sb.disabled = true; sb.textContent = '送出中…'; }
        return act('submitAnswer', st.require_photo ? { stageId: st.stage_id, answer: ans, dataUrl: P.photo } : { stageId: st.stage_id, answer: ans })
          .then(function (r) { if (r && r.correct) P.photo = null; else { sb = $('#s-submit'); if (sb) { sb.disabled = false; sb.textContent = '送出答案'; } } });
      });
    });
    Q.$$('[data-choice]').forEach(function (b) {
      b.onclick = function () { P.choice = st.choices[+b.dataset.choice]; renderStage(); };
    });
    var input = $('#s-ans');
    if (input) input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { var go = $('#s-submit') || $('#s-arrive'); if (go) go.click(); } });
    ['s-file', 's-file-cam'].forEach(function (id) {
      var file = document.getElementById(id);
      if (!file) return;
      file.onchange = async function () {
        if (!file.files[0]) return;
        var f0 = file.files[0];
        if (f0.type && !/^image\//i.test(f0.type)) { file.value = ''; return Q.toast('請選擇照片檔（jpg、png…）', 'warn'); }
        if (f0.size > 40 * 1024 * 1024) { file.value = ''; return Q.toast('這個檔案太大了（超過 40 MB），請換一張或重新拍攝', 'warn', 5000); }
        try { P.photo = await Q.run(function () { return compressToLimit(f0); }); renderStage(); }
        catch (e) { /* */ }
      };
    });
    on('s-photo-clear', function () { P.photo = null; renderStage(); });
    on('s-upload', function () {
      if (!P.photo) return;
      var ub = $('#s-upload'); if (ub) { ub.disabled = true; ub.textContent = '⏳ 上傳中，請不要離開…'; }
      act('uploadPhoto', { stageId: st.stage_id, dataUrl: P.photo, caption: ($('#s-caption') || {}).value || '' })
        .then(function (ok) { if (ok) P.photo = null; else { ub = $('#s-upload'); if (ub) { ub.disabled = false; ub.textContent = '上傳照片'; } } });
    });
    on('s-form', function () { act('checkForm', { stageId: st.stage_id }); });
  }

  async function doArrive(st, ans) {
    if (!st.require_gps) return act('arrive', { stageId: st.stage_id });
    var btn = $('#s-arrive');
    if (btn) { btn.disabled = true; btn.textContent = '定位中…'; }
    try {
      var pos = await getFix();
      var r = await act('arrive', { stageId: st.stage_id, lat: pos.lat, lng: pos.lng, accuracy: pos.acc });
      // 同時填了答案：定位通過（arrived 不是 false）才接著送出答案
      if (ans && r && r.arrived !== false) await act('submitAnswer', { stageId: st.stage_id, answer: ans });
    } catch (e) {
      Q.toast(e.message, 'err', 6000);
    } finally {
      btn = $('#s-arrive');
      if (btn) { btn.disabled = false; var a2 = $('#s-ans'); btn.textContent = (a2 && a2.value.trim() && findStage(st.stage_id) && findStage(st.stage_id).status === 'open') ? '📍 定位打卡並送出答案' : '📍 我到了，定位打卡'; }
    }
  }

  /** 呼叫動作 API → 更新狀態 → 顯示訊息 */
  async function act(action, payload) {
    if (P.busy) { Q.toast('處理中，請稍候…', 'warn', 1500); return false; }   // 防止連點重複送出
    P.busy = true;
    $('#retry-bar').classList.add('hidden');
    try {
      var r = await Q.run(function () { return api(action, Object.assign({ sessionId: P.sid }, payload)); }, { noToast: true });
      var before = {};
      if (P.state) P.state.stages.forEach(function (x) { before[x.stage_id] = x.status; });
      if (action === 'getHint') {   // 剛按下「需要提示」解鎖的那則，自動展開
        P.hintOpen = P.hintOpen || {};
        r.state.stages.forEach(function (x) { if (x.stage_id === payload.stageId && x.hints && x.hints.length) P.hintOpen[x.stage_id + ':' + (x.hints.length - 1)] = true; });
      }
      var beforeBadges = ((P.state && P.state.badges) || []).map(function (x) { return x.id; });
      applyState(r.state);
      (r.state.badges || []).filter(function (x) { return beforeBadges.indexOf(x.id) < 0; }).forEach(function (bd, i) {
        setTimeout(function () { Q.toast('🏅 獲得徽章：' + bd.icon + ' ' + bd.name + '（' + bd.desc + '）', 'ok', 5500); }, 900 + i * 1400);
      });
      var solved = r.state.stages.filter(function (x) { return x.status === 'solved' && before[x.stage_id] && before[x.stage_id] !== 'solved'; })[0];
      var type = (r.correct === false || r.arrived === false) ? 'warn' : 'ok';
      if (action === 'arrive' && r.arrived !== false && type !== 'warn') arriveFlash();
      if (r.correct && payload && payload.stageId) clearDrafts(payload.stageId);
      if (solved) sfx('win');
      else if (type === 'warn') sfx('bad');
      else if (action === 'arrive') sfx('arrive');
      else if (r.correct) sfx('ok');
      // 過關時顯示過關畫面（任務全部完成時由完成畫面接手）
      if (solved && r.state.session.status === 'playing') showSolved(solved);
      else if (r.message) Q.toast(r.message, type, type === 'warn' ? 4500 : 3000);
      return r;
    } catch (e) {
      if (['TIMEUP', 'FINISHED', 'CLOSED'].indexOf(e.code) >= 0) refresh();
      if (e.code === 'NETWORK') {
        if (queueAdd(action, payload)) return false;
        showRetry(function () { act(action, payload); });
      }
      Q.toast(e.message, 'err');
      return false;
    } finally { P.busy = false; }
  }

  /* ---------- 離線暫存：斷線時「打卡、送答案」先存在手機，恢復網路後自動補送 ---------- */
  var QUEUEABLE = ['arrive', 'submitAnswer'];
  function queueKey() { return 'escapegame:queue:' + P.sid; }
  function queueGet() { try { return JSON.parse(localStorage.getItem(queueKey()) || '[]') || []; } catch (e) { return []; } }
  function queueSet(q) { try { if (q.length) localStorage.setItem(queueKey(), JSON.stringify(q)); else localStorage.removeItem(queueKey()); } catch (e) { /* */ } queueChip(); }
  function queueChip() {
    var n = P.sid ? queueGet().length : 0, c = $('#offline-chip');
    if (!c) return;
    c.textContent = n ? '📴 待送出 ' + n : '📴 離線中';
    c.classList.toggle('hidden', !n && navigator.onLine !== false);
  }
  function queueAdd(action, payload) {
    if (QUEUEABLE.indexOf(action) < 0 || !P.sid || (payload && payload.dataUrl)) return false;
    var q = queueGet(), same = q.some(function (x) { return x.action === action && x.payload.stageId === payload.stageId && x.payload.answer === payload.answer; });
    if (!same) q.push({ action: action, payload: payload, t: Date.now() });
    queueSet(q);
    Q.toast('📴 沒有訊號，已先存在手機；恢復連線後會自動送出', 'warn', 5000);
    return true;
  }
  var flushing = false;
  async function queueFlush() {
    if (flushing || !P.sid || navigator.onLine === false) return;
    var q = queueGet();
    if (!q.length) return;
    flushing = true;
    var done = 0, dropped = 0;
    try {
      while (q.length) {
        var it = q[0];
        if (Date.now() - it.t > 6 * 3600 * 1000) { q.shift(); dropped++; continue; }   // 太舊的不補送
        try {
          var r = await api(it.action, Object.assign({ sessionId: P.sid }, it.payload));
          if (r && r.state) applyState(r.state);
          done++;
        } catch (e) {
          if (e.code === 'NETWORK') break;   // 還是沒訊號：留著下次再送
          dropped++;                          // 其他錯誤（例如這關已完成）：丟掉，避免重複
        }
        q.shift();
        queueSet(q);
      }
    } finally { queueSet(q); flushing = false; }
    if (done || dropped) {
      Q.toast('✅ 已自動補送 ' + done + ' 筆' + (dropped ? '（另有 ' + dropped + ' 筆已失效，略過）' : ''), 'ok', 5000);
      refresh();
    }
  }

  /** 壓縮到約 1.5 MB 以下：先 1280px，太大再逐步降低尺寸與品質（手機原圖常常好幾 MB，容易逾時） */
  async function compressToLimit(file) {
    var steps = [[1280, 0.82], [1024, 0.7], [800, 0.6], [640, 0.5]], out = '';
    for (var i = 0; i < steps.length; i++) {
      out = await compressImage(file, steps[i][0], steps[i][1]);
      if (out.length * 0.75 <= 1.5 * 1024 * 1024) return out;
    }
    if (out.length * 0.75 > 6 * 1024 * 1024) throw new Error('照片太大，請重新拍攝');
    return out;
  }

  /** 照片壓縮到長邊 1280px，避免上傳太久 */
  function compressImage(file, max, quality) {
    max = max || 1280; quality = quality || 0.82;
    return new Promise(function (resolve, reject) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var s = Math.min(1, max / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error(/heic|heif/i.test(file.type + file.name) ? '這個瀏覽器無法處理 HEIC 照片。iPhone 請到「設定 → 相機 → 格式」改選「最相容」，或改用 JPG／PNG。' : '無法讀取這張照片，請換一張'));
      };
      img.src = url;
    });
  }

  /* ---------- 音效與震動（可在右上角關閉） ---------- */
  var Snd = { on: true, ctx: null };
  try { Snd.on = localStorage.getItem('escapegame:sound') !== '0'; } catch (e) { /* */ }
  var TOUCH = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);

  /**
   * 解鎖音訊：手機瀏覽器（尤其 iPhone）規定要在「手指操作的當下」啟動音訊，否則之後的音效都會被靜音。
   * 音效多半在網路回應或定位更新時才觸發（不是手指操作），所以在第一次觸碰時先把音訊啟動好。
   * 另外讓 iPhone 的音效不被靜音鍵擋掉（Safari 16.4 以上）。
   */
  function unlockAudio() {
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      Snd.ctx = Snd.ctx || new AC();
      if (Snd.ctx.state === 'suspended') Snd.ctx.resume();
      var b = Snd.ctx.createBuffer(1, 1, 22050), s = Snd.ctx.createBufferSource();   // 播一段無聲的音，iOS 才算解鎖
      s.buffer = b; s.connect(Snd.ctx.destination); s.start(0);
    } catch (e) { /* 不支援就略過 */ }
  }
  ['touchend', 'pointerup', 'click', 'keydown'].forEach(function (ev) {
    var once = function () { unlockAudio(); if (Snd.ctx && Snd.ctx.state === 'running') document.removeEventListener(ev, once, true); };
    document.addEventListener(ev, once, true);
  });

  function sfx(kind) {
    if (!Snd.on) return;
    try {
      var vib = { ok: [60], win: [80, 50, 80, 50, 120], bad: [200], arrive: [60, 40, 60], near: [40] }[kind];
      if (vib && navigator.vibrate) navigator.vibrate(vib);
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      Snd.ctx = Snd.ctx || new AC();
      if (Snd.ctx.state === 'suspended') Snd.ctx.resume();
      var seq = { ok: [[660, .12], [880, .18]], win: [[523, .12], [659, .12], [784, .26]], bad: [[220, .28]], arrive: [[587, .1], [784, .18]], near: [[740, .14], [988, .14]] }[kind] || [];
      var t = Snd.ctx.currentTime;
      seq.forEach(function (n) {
        var o = Snd.ctx.createOscillator(), g = Snd.ctx.createGain();
        o.type = kind === 'bad' ? 'sawtooth' : 'sine'; o.frequency.value = n[0];
        g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.3, t + .02); g.gain.exponentialRampToValueAtTime(.0001, t + n[1]);
        o.connect(g); g.connect(Snd.ctx.destination); o.start(t); o.stop(t + n[1] + .02);
        t += n[1];
      });
    } catch (e) { /* 不支援就略過 */ }
  }

  function renderSoundBtn() {
    var b = $('#btn-sound');
    b.textContent = Snd.on ? '🔊' : '🔇';
    b.setAttribute('aria-pressed', String(Snd.on));
    b.title = Snd.on ? '音效與震動：開（點一下關閉）' : '音效與震動：關（點一下開啟）';
  }

  function toggleSound() {
    Snd.on = !Snd.on;
    try { localStorage.setItem('escapegame:sound', Snd.on ? '1' : '0'); } catch (e) { /* */ }
    renderSoundBtn();
    if (Snd.on) {
      unlockAudio();
      sfx('ok');
      setTimeout(function () {
        if (Snd.on && (!Snd.ctx || Snd.ctx.state !== 'running')) Q.toast('這支手機目前沒辦法播放音效。請確認沒有開靜音、媒體音量沒有調到最小，或改用 Safari／Chrome 開啟（LINE 等 App 內建瀏覽器可能會擋聲音）', 'warn', 8000);
      }, 400);
    }
  }

  /* ---------- 下一站提示 ---------- */
  function nextStage() {
    if (!P.state) return null;
    var ss = P.state.stages;
    var arrived = ss.filter(function (s) { return s.status === 'arrived'; })[0];
    if (arrived) return arrived;
    var opens = ss.filter(function (s) { return s.status === 'open'; });
    if (!opens.length) return null;
    if (!P.pos) return opens[0];
    var best = opens[0], bd = Infinity;
    opens.forEach(function (s) {
      if (s.lat == null) return;
      var d = Q.distM(P.pos.lat, P.pos.lng, s.lat, s.lng);
      if (d < bd) { bd = d; best = s; }
    });
    return best;
  }

  function updateNextStep() {
    var btn = $('#next-step');
    if (!btn) return;
    var st = P.state && P.state.session.status === 'playing' ? nextStage() : null;
    btn.classList.toggle('hidden', !st);
    if (!st) return;
    var no = P.state.stages.indexOf(st) + 1, sub;
    btn.classList.toggle('arrived', st.status === 'arrived');
    $('#ns-main').textContent = '第 ' + no + ' 關・' + st.title;
    if (st.status === 'arrived' && !(st.lat != null && !st.require_gps)) sub = '已抵達，點這裡作答';
    else if (st.lat != null && P.pos) {   // 前往中；不用打卡的關卡也顯示方向與距離
      var d = Q.distM(P.pos.lat, P.pos.lng, st.lat, st.lng);
      sub = d <= st.radius_m ? (st.require_gps ? '✅ 已在範圍內，點這裡打卡' : '✅ 已在這一關的位置，點這裡作答') : dirName(bearing(P.pos.lat, P.pos.lng, st.lat, st.lng)) + '方 ' + Q.fmtDist(d);
    }
    else if (st.lat != null) sub = '定位中…';
    else sub = '點這裡看線索';
    $('#ns-sub').textContent = sub;
  }

  /* ---------- 過關畫面 ---------- */
  function countUp(el, to) {
    var t0 = performance.now(), dur = 700;
    (function step(t) {
      var k = Math.max(0, Math.min(1, (t - t0) / dur)); // rAF 的時間戳可能略早於 t0，避免出現負數
      el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }

  function showSolved(st) {
    var stages = P.state.stages, no = stages.indexOf(st) + 1;
    var next = stages.filter(function (s) { return s.status === 'open' || s.status === 'arrived'; })[0] || null;
    P.solvedNext = next;
    $('#solved-title').textContent = '第 ' + no + ' 關完成！';
    $('#solved-msg').innerHTML = st.success_message ? Q.linkify(st.success_message) : '';
    countUp($('#solved-points'), st.earned || 0);
    var ib = $('#solved-item'), colAll = P.state.collection || [], colGot = colAll.filter(function (x) { return x.got; }).length;
    if (st.cards_new && st.cards_new.length) {
      var dn = colAll.length ? colAll.length : 0;
      ib.innerHTML = '<div class="item-reward-title">🎴 獲得卡牌！</div><div class="pack-open">' + st.cards_new.map(function (cd, ci) {
        return '<div class="flipper" data-fi="' + ci + '"><div class="face back">' + Q.cardBackHtml((P.state.project || {}).deck_title, deckOpts()) + '</div>' +
          '<div class="face front">' + Q.cardHtml(cd, deckOpts({ big: true, tilt: true })) + '</div></div>';
      }).join('') + '</div><div class="help">已收進圖鑑　' + colGot + ' / ' + dn + '（點🎒可以看全部）</div>' +
        (dn && colGot === dn ? '<div class="collect-done">🎊 圖鑑全收集完成！' + (P.state.project.collect_message ? '<br>' + esc(P.state.project.collect_message) : '') + '</div>' : '');
      ib.classList.remove('hidden');
      Q.bindTilt(ib);
      Q.$$('#solved-item .flipper').forEach(function (fl, i) { setTimeout(function () { fl.classList.add('open'); }, 700 + i * 450); });
    } else if (st.item) {
      ib.innerHTML = '<div class="item-reward-title">✨ 獲得收藏品</div><div class="item-big rar-' + esc(st.item.rarity) + '"><span class="item-icon">' + iconHtml(st.item.icon) + '</span></div>' +
        '<div class="item-reward-name">' + esc(st.item.name) + ' <span class="chip">' + RARITY_TXT[st.item.rarity] + '</span></div>' +
        (st.item.story ? '<div class="small">' + esc(st.item.story) + '</div>' : '') +
        '<div class="help">已收進收藏冊　' + colGot + ' / ' + colAll.length + '</div>' +
        (colAll.length && colGot === colAll.length ? '<div class="collect-done">🎊 全收集完成！' + (P.project && P.project.collect_message ? '<br>' + esc(P.project.collect_message) : (P.state.project.collect_message ? '<br>' + esc(P.state.project.collect_message) : '')) + '</div>' : '');
      ib.classList.remove('hidden');
    } else { ib.classList.add('hidden'); ib.innerHTML = ''; }
    var rw = $('#solved-reward'), fr = (P.state.fragments || []).filter(function (f) { return f.stage_id === st.stage_id; })[0];
    if (st.reward_code && fr) {
      rw.innerHTML = '<div class="frag-reward-title">🎉 獲得密碼碎片</div><div class="frag-reward-code"><small>第 ' + fr.order + ' 碼</small><b>' + esc(st.reward_code) + '</b></div><div class="help">已收進 🎒 線索背包</div>';
      rw.classList.remove('hidden');
    } else { rw.classList.add('hidden'); rw.innerHTML = ''; }
    var nb = $('#solved-next');
    nb.classList.toggle('hidden', !next);
    if (next) nb.textContent = '前往第 ' + (stages.indexOf(next) + 1) + ' 關：' + next.title;
    $('#solved').classList.remove('hidden');
    layerOpen('solved');  // 先開過關畫面，再關面板，避免返回鍵紀錄錯亂
    closeStage();
  }

  function hideSolved() {
    $('#solved').classList.add('hidden');
    layerClose('solved');
  }

  function goNextStage() {
    var next = P.solvedNext;
    var hasLoc = !!(next && P.map && next.lat != null);
    if (next && !hasLoc) openStage(next.stage_id); // 這關不顯示位置：直接打開線索
    hideSolved();
    if (!next) return;
    window.scrollTo(0, 0);
    var card = document.querySelector('#g-stages [data-id="' + next.stage_id + '"]');
    if (card && card.scrollIntoView) card.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    if (hasLoc) {
      var pts = [[next.lat, next.lng]];
      if (P.pos) pts.push([P.pos.lat, P.pos.lng]);
      if (pts.length > 1) P.map.fitBounds(pts, { padding: [40, 40], maxZoom: 17 }); else P.map.setView(pts[0], 17);
    }
  }

  /* ---------- 地圖全螢幕（手機單指預設捲頁面，全螢幕後才可拖曳） ---------- */
  function setFullscreen(on) {
    var card = $('#map-card');
    if (card.classList.contains('full') === on) return;
    card.classList.toggle('full', on);
    var b = $('#btn-fs');
    b.textContent = on ? '✕' : '⛶';
    b.setAttribute('aria-label', on ? '關閉全螢幕' : '全螢幕地圖');
    $('#map-hint').classList.add('hidden');
    if (on) layerOpen('fs'); else layerClose('fs');
    if (P.map) {
      if (on || !TOUCH) P.map.dragging.enable(); else P.map.dragging.disable();
      setTimeout(function () { P.map.invalidateSize(); }, 60);
    }
  }

  /* ---------- 疊層管理：手機「上一頁」與 Esc 只關閉最上層，不會離開網站 ---------- */
  var LAYERS = [];
  function syncLock() { document.body.style.overflow = LAYERS.length ? 'hidden' : ''; }
  function layerOpen(name) {
    if (LAYERS.indexOf(name) >= 0) return;
    LAYERS.push(name);
    if (LAYERS.length === 1) { try { history.pushState({ q: 1 }, ''); P.histOn = true; } catch (e) { /* */ } }
    syncLock();
  }
  function layerClose(name) {
    var i = LAYERS.indexOf(name);
    if (i < 0) return;
    LAYERS.splice(i, 1);
    if (!LAYERS.length && P.histOn) {
      P.histOn = false; P.skipPop = true;
      try { history.back(); } catch (e) { P.skipPop = false; }
    }
    syncLock();
  }
  function closeTopLayer() {
    var n = LAYERS[LAYERS.length - 1];
    if (n === 'sheet') closeStage();
    else if (n === 'solved') hideSolved();
    else if (n === 'fs') setFullscreen(false);
    else if (n === 'confirm' && P.cfDone) P.cfDone(false);
    else if (n === 'board') closeBoard();
    else if (n === 'pack') closePack();
    else if (n === 'cardview') closeCardView();
  }
  window.addEventListener('popstate', function () {
    if (P.skipPop) { P.skipPop = false; return; }
    if (!LAYERS.length) return;
    P.histOn = false;          // 返回鍵已經移除了我們的紀錄
    closeTopLayer();
    if (LAYERS.length) { try { history.pushState({ q: 1 }, ''); P.histOn = true; } catch (e) { /* */ } }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeTopLayer(); });

  /* ---------- 螢幕常亮（戶外走路時避免鎖屏中斷定位） ---------- */
  function keepAwake() {
    if (P.wake || !navigator.wakeLock || document.visibilityState !== 'visible') return;
    try {
      navigator.wakeLock.request('screen').then(function (l) {
        P.wake = l;
        l.addEventListener('release', function () { P.wake = null; });
      }).catch(function () { /* 不支援或被拒絕就略過 */ });
    } catch (e) { /* */ }
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && P.state && P.state.session.status === 'playing') keepAwake();
  });

  /* ---------- 手機鍵盤跳出時，讓關卡面板貼著可視範圍 ---------- */
  function fitSheet() {
    var vv = window.visualViewport, sh = $('#sheet');
    if (!vv || sh.classList.contains('hidden')) return;
    sh.style.top = vv.offsetTop + 'px'; sh.style.bottom = 'auto'; sh.style.height = vv.height + 'px';
    sh.style.setProperty('--sheet-max', Math.round(vv.height * 0.96) + 'px');
  }
  function resetSheet() {
    var sh = $('#sheet');
    sh.style.top = ''; sh.style.bottom = ''; sh.style.height = ''; sh.style.removeProperty('--sheet-max');
  }

  /* ---------- 進度表橫向捲動提示 ---------- */
  function updateStageMore() {
    var list = $('#g-stages'), wrap = $('#stage-wrap');
    if (!list || !wrap) return;
    wrap.classList.toggle('more', list.scrollLeft + list.clientWidth < list.scrollWidth - 6);
  }

  /* ---------- 連線失敗：顯示「重試」 ---------- */
  function showRetry(fn) {
    var bar = $('#retry-bar');
    bar.classList.remove('hidden');
    $('#retry-btn').onclick = function () { bar.classList.add('hidden'); fn(); };
    $('#retry-x').onclick = function () { bar.classList.add('hidden'); };
  }

  /* ---------- 線索背包（密碼碎片） ---------- */
  function fragRowsHtml(frs) {
    return frs.map(function (f) {
      return '<div class="pack-row' + (f.got ? ' got' : '') + '"><div class="pack-no">第 ' + f.order + ' 碼</div>' +
        '<div class="pack-code">' + (f.got ? esc(f.code) : '❓') + '</div>' +
        '<div class="pack-from">' + (f.got ? '✅ ' : '') + '第 ' + f.stage_no + ' 關・' + esc(f.stage_title) + '</div></div>';
    }).join('');
  }
  function itemCellHtml(it, i) {
    return '<button type="button" class="item-cell rar-' + esc(it.rarity) + (it.got ? ' got' : ' locked') + '" data-ci="' + i + '">' +
      '<span class="item-icon">' + iconHtml(it.icon) + '</span>' +
      '<span class="item-name">' + (it.got ? esc(it.name) : '？？？') + '</span>' +
      '<small>第 ' + it.stage_no + ' 關</small></button>';
  }

  function renderPack() {
    P.newNow = P.packOpen ? (P.newNow || newOwned()) : [];
    var s = P.state, col = s.collection || [], frs = s.fragments || [], bds = s.badges || [], h = [];
    var colGot = col.filter(function (x) { return x.got; }).length, gotN = frs.filter(function (f) { return f.got; }).length;
    var isDeck = col.length && col[0].kind === 'card';
    if (bds.length) {
      h.push('<h3 class="pack-h">🏅 成就徽章' + (s.title ? '　<small>稱號：' + esc(s.title) + '</small>' : '') + '</h3>');
      h.push('<div class="badge-list">' + bds.map(function (b) { return '<div class="badge-row"><span class="badge-ic">' + esc(b.icon) + '</span><div><b>' + esc(b.name) + '</b><small>' + esc(b.desc) + '</small></div></div>'; }).join('') + '</div>');
    }
    if (frs.length) {
      h.push('<h3 class="pack-h">🧩 密碼碎片　' + gotN + ' / ' + frs.length + '</h3>');
      h.push('<div class="pack-rows">' + fragRowsHtml(frs) + '</div>');
      h.push('<div class="help">最後一關要把所有碎片「依第 1 碼 → 第 ' + frs.length + ' 碼」的順序組成密碼。</div>');
    }
    var colH = [];
    if (isDeck) {
      var pj = s.project || {};
      colH.push('<h3 class="pack-h">🃏 ' + esc(pj.deck_title || '圖鑑') + '　' + colGot + ' / ' + col.length + (colGot === col.length ? ' 🎊 全收集！' : '') + '</h3>');
      colH.push('<div class="progress" style="margin:-2px 0 10px"><i style="width:' + Math.round(colGot / col.length * 100) + '%"></i></div>');
      colH.push('<div class="deck-grid">' + col.map(function (it, i) {
        var isNew = (P.newNow || []).indexOf('c:' + it.id) >= 0;
        return '<button type="button" class="deck-cell' + (isNew ? ' is-new' : '') + '" data-ci="' + i + '">' + Q.cardHtml(it.card, deckOpts({ mini: true })) + '</button>';
      }).join('') + '</div>');
    } else if (col.length) {
      colH.push('<h3 class="pack-h">📖 收藏冊　' + colGot + ' / ' + col.length + (colGot === col.length ? ' 🎊 全收集！' : '') + '</h3>');
      colH.push('<div class="item-grid">' + col.map(itemCellHtml).join('') + '</div>');
    }
    h = h.concat(colH);   // 卡牌放最下面
    $('#pack-rows').innerHTML = h.join('') || '<div class="lb-empty">還沒有收集到任何東西</div>';
    $('#pack-note').textContent = '';
    Q.$$('#pack-rows [data-ci]').forEach(function (b) {
      b.onclick = function () {
        var it = col[+b.dataset.ci];
        if (isDeck) return it.got ? openCardView(it.card) : Q.toast('這張卡還沒收集到，繼續挑戰關卡吧！', 'warn');
        if (!it.got) return Q.toast('通過第 ' + it.stage_no + ' 關「' + it.stage_title + '」就能獲得', 'warn');
        askConfirm((it.icon && !/^(https?:|data:)/i.test(it.icon) ? it.icon + ' ' : '') + it.name + '（' + RARITY_TXT[it.rarity] + '）', it.story || '收藏成功！', '關閉', true);
      };
    });
  }
  function openPack() {
    P.packOpen = true;
    P.newNow = newOwned();
    renderPack();
    markSeen();
    $('#pack').classList.remove('hidden');
    layerOpen('pack');
  }
  function closePack() {
    P.packOpen = false;
    P.newNow = [];
    $('#pack').classList.add('hidden');
    layerClose('pack');
  }

  /** 最後一關：把碎片排在答案欄上方（點一下碎片帶入答案欄） */
  function fragStripHtml(st) {
    var frs = (P.state && P.state.fragments) || [];
    var miss = st.fragments_missing || 0;
    var chip = function (f) {
      return f.got ? '<button type="button" class="frag-chip got" data-frag="' + esc(f.code) + '"><small>第 ' + f.order + ' 碼</small><b>' + esc(f.code) + '</b></button>'
        : '<div class="frag-chip"><small>第 ' + f.order + ' 碼</small><b>❓</b><em>第 ' + f.stage_no + ' 關</em></div>';
    };
    // 合作任務：每條路線各一段，別條路線的碼要和其他隊伍交換
    if (st.coop && (st.coop_parts || []).length > 1) {
      return '<div class="card frag-card"><label>🤝 合作任務：和其他路線的隊伍一起解開</label>' +
        '<div class="help" style="margin:0 0 6px">每條路線的隊伍只拿得到自己那一段密碼。請找到走其他路線的隊伍，交換你們的碼，再依下面的路線順序組合起來。</div>' +
        st.coop_parts.map(function (part) {
          return '<div class="coop-part"><span class="chip" style="background:' + esc(part.color || '#e6e3dc') + ';color:' + (part.color ? '#fff' : 'inherit') + '">' + esc(part.route_name) + (part.own ? '（你們）' : '') + '</span>' +
            '<div class="frag-strip">' + (part.own ? frs.map(chip).join('') : new Array(part.count + 1).join('<div class="frag-chip"><b>❓</b><em>向對方問</em></div>')) + '</div></div>';
        }).join('') +
        (miss > 0 ? '<div class="help" style="color:var(--red)">你們自己還差 ' + miss + ' 個碎片，請先完成其他關卡。</div>'
          : '<div class="row" style="margin-top:8px"><button type="button" class="sm ghost" id="s-frag-clear">清除答案欄</button></div><div class="help">點自己的碎片可以加進答案欄，其他路線的碼請自己輸入。</div>') + '</div>';
    }
    if (!frs.length) return '';
    return '<div class="card frag-card"><label>🎒 你的密碼碎片（依順序組成最終密碼）</label><div class="frag-strip">' +
      frs.map(chip).join('') + '</div>' +
      (miss > 0 ? '<div class="help" style="color:var(--red)">還差 ' + miss + ' 個碎片，請先完成其他關卡。</div>'
        : '<div class="row" style="margin-top:8px"><button type="button" class="sm ghost" id="s-frag-all">依順序帶入</button><button type="button" class="sm ghost" id="s-frag-clear">清除</button></div>' +
          '<div class="help">點碎片可以加進答案欄，也可以自己輸入。</div>') + '</div>';
  }

  /* ---------- 即時排行榜（闖關中） ---------- */
  async function openBoard() {
    $('#board').classList.remove('hidden');
    layerOpen('board');
    var load = async function () {
      try {
        var r = await api('leaderboard', { projectId: P.projectId, runCode: P.state.session.run_code, board: true });
        $('#board-rows').innerHTML = Q.boardHtml(r.leaderboard, { me: P.state.session.team_name, now: r.server_time });
        $('#board-note').textContent = '每 15 秒自動更新・更新於 ' + Q.fmtTime(new Date());
      } catch (e) { $('#board-note').textContent = e.message; }
    };
    await load();
    clearInterval(P.boardTimer);
    P.boardTimer = setInterval(load, 15000);
  }
  function closeBoard() {
    clearInterval(P.boardTimer);
    $('#board').classList.add('hidden');
    layerClose('board');
  }

  /** 頁面內的確認視窗，回傳 Promise<boolean>；返回鍵／Esc 等於取消 */
  function askConfirm(title, msg, okText, noCancel) {
    return new Promise(function (resolve) {
      var box = $('#confirm'), ok = $('#cf-ok'), cancel = $('#cf-cancel');
      $('#cf-title').textContent = title;
      $('#cf-msg').textContent = msg;
      ok.textContent = okText || '確定';
      cancel.classList.toggle('hidden', !!noCancel);
      box.classList.remove('hidden');
      function done(v) {
        if (!P.cfDone) return;
        P.cfDone = null;
        box.classList.add('hidden');
        ok.onclick = cancel.onclick = null;
        layerClose('confirm');
        resolve(v);
      }
      P.cfDone = done;
      ok.onclick = function () { done(true); };
      cancel.onclick = function () { done(false); };
      layerOpen('confirm');
    });
  }

  /* ---------- 完成 ---------- */
  /* ---------- 成果圖：把成績、稱號、徽章、卡牌畫成一張圖，可存圖或分享 ---------- */
  function buildShareImage() {
    var s = P.state, se = s.session, W = 1080, pj = s.project || {};
    var fb = s.badges || [], got = (s.collection || []).filter(function (x) { return x.got; });
    var rows = Math.max(1, Math.ceil(Math.min(got.length, 12) / 4));
    var H = 760 + (fb.length ? 150 : 0) + (got.length ? 120 + rows * 250 : 0) + 120;
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var g = cv.getContext('2d'), FONT = '"PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif';
    var bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#1d2a2f'); bg.addColorStop(1, '#265f46');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    function rr(x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
    function wrap(text, x, y, maxW, lh, maxLines) {
      var line = '', n = 0;
      for (var i = 0; i < text.length; i++) {
        var t = line + text[i];
        if (g.measureText(t).width > maxW && line) { g.fillText(line, x, y + n * lh); n++; line = text[i]; if (n >= maxLines) return; } else line = t;
      }
      if (line) g.fillText(line, x, y + n * lh);
    }
    g.textAlign = 'center'; g.fillStyle = '#e8c97a'; g.font = '700 34px ' + FONT; g.fillText('實境解謎', W / 2, 90);
    g.fillStyle = '#fff'; g.font = '800 64px ' + FONT; wrap(pj.name || '', W / 2, 190, W - 160, 76, 2);
    g.font = '700 54px ' + FONT; g.fillStyle = '#ffe9a8';
    g.fillText((se.avatar ? se.avatar + ' ' : '') + se.team_name, W / 2, 360);
    if (s.title) { g.font = '600 38px ' + FONT; g.fillStyle = '#cfe8d5'; g.fillText('稱號：' + s.title, W / 2, 425); }
    // 三個數字
    var stats = [[String(se.score), '總分'], [s.summary.solved + '/' + s.summary.total, '完成關卡'], [se.finished_at ? Q.fmtDuration((new Date(se.finished_at) - new Date(se.started_at)) / 1000) : '—', '花費時間']];
    stats.forEach(function (it, i) {
      var x = 70 + i * 316;
      g.fillStyle = 'rgba(255,255,255,.12)'; rr(x, 480, 296, 190, 28); g.fill();
      g.fillStyle = '#fff'; g.font = '800 70px ' + FONT; g.fillText(it[0], x + 148, 580);
      g.fillStyle = '#cfe8d5'; g.font = '500 32px ' + FONT; g.fillText(it[1], x + 148, 637);
    });
    var y = 730;
    if (fb.length) {
      g.fillStyle = '#e8c97a'; g.font = '700 36px ' + FONT; g.fillText('🏅 成就', W / 2, y + 20);
      g.font = '56px ' + FONT; var shown = fb.slice(0, 8), step = Math.min(120, (W - 160) / shown.length);
      shown.forEach(function (b, i) { g.fillText(b.icon || '🏅', W / 2 - (shown.length - 1) * step / 2 + i * step, y + 100); });
      y += 150;
    }
    if (got.length) {
      g.fillStyle = '#e8c97a'; g.font = '700 36px ' + FONT; g.fillText('🃏 ' + (pj.deck_title || '收藏') + '　' + got.length + ' 件', W / 2, y + 20);
      var col = { normal: '#cfe8d5', rare: '#bcd4ff', legend: '#ffe08a' };
      got.slice(0, 12).forEach(function (it, i) {
        var cx = 60 + (i % 4) * 242, cy = y + 60 + Math.floor(i / 4) * 250, art = (it.card && it.card.art) || it.icon || '🃏';
        g.fillStyle = col[it.rarity] || col.normal; rr(cx, cy, 222, 230, 22); g.fill();
        g.fillStyle = '#1d2a2f'; g.font = '84px ' + FONT;
        g.fillText(/^(https?:|data:)/i.test(art) ? '🃏' : String(art).slice(0, 2), cx + 111, cy + 112);
        g.font = '700 28px ' + FONT; g.fillText(String(it.name || '').slice(0, 7), cx + 111, cy + 168);
        g.font = '500 24px ' + FONT; g.fillText(it.rarity === 'legend' ? '★★★' : it.rarity === 'rare' ? '★★' : '★', cx + 111, cy + 205);
      });
      if (got.length > 12) { g.fillStyle = '#cfe8d5'; g.font = '500 28px ' + FONT; g.fillText('…還有 ' + (got.length - 12) + ' 件', W / 2, y + 60 + rows * 250 + 20); }
    }
    g.fillStyle = 'rgba(255,255,255,.6)'; g.font = '500 28px ' + FONT; g.fillText(Q.fmtTime(new Date()) + '・一起來玩實境解謎', W / 2, H - 50);
    return new Promise(function (resolve) { cv.toBlob(resolve, 'image/png'); });
  }
  var shareBlob = null, shareUrl = '';
  async function openShare() {
    try {
      var blob = await Q.run(buildShareImage);
      if (!blob) throw new Error('產生圖片失敗');
      shareBlob = blob;
      if (shareUrl) URL.revokeObjectURL(shareUrl);
      shareUrl = URL.createObjectURL(blob);
      $('#share-img').src = shareUrl;
      $('#share-dl').href = shareUrl;
      var file = new File([blob], 'escape-result.png', { type: 'image/png' });
      var can = !!(navigator.canShare && navigator.canShare({ files: [file] }));
      $('#share-send').classList.toggle('hidden', !can);
      $('#share-send').onclick = function () { navigator.share({ files: [file], title: '實境解謎成果', text: '我們完成了「' + ((P.state.project || {}).name || '') + '」！' }).catch(function () { /* 取消分享 */ }); };
      $('#share-view').classList.remove('hidden');
      layerOpen('share');
    } catch (e) { Q.toast(e.message || '產生圖片失敗', 'err'); }
  }
  function closeShare() { $('#share-view').classList.add('hidden'); layerClose('share'); }

  async function showFinish() {
    var s = P.state, se = s.session;
    $('#fin-team').textContent = se.team_name + (se.run_code ? '・' + se.run_code : '');
    $('#fin-score').textContent = se.score;
    $('#fin-solved').textContent = s.summary.solved + '/' + s.summary.total;
    $('#fin-time').textContent = se.finished_at ? Q.fmtDuration((new Date(se.finished_at) - new Date(se.started_at)) / 1000) : '—';
    $('#fin-message').innerHTML = Q.linkify(s.finish_message || '恭喜完成所有關卡！');
    var fb = s.badges || [], fcol = s.collection || [];
    $('#fin-badges-card').classList.toggle('hidden', !fb.length && !fcol.length);
    $('#fin-title').textContent = s.title ? (se.avatar ? se.avatar + ' ' : '') + '稱號：' + s.title : '';
    $('#fin-badges').innerHTML = fb.map(function (b) { return '<div class="badge-row"><span class="badge-ic">' + esc(b.icon) + '</span><div><b>' + esc(b.name) + '</b><small>' + esc(b.desc) + '</small></div></div>'; }).join('');
    var finIsDeck = fcol.length && fcol[0].kind === 'card';
    $('#fin-collection').className = finIsDeck ? 'deck-grid' : 'item-grid';
    $('#fin-col-help').classList.toggle('hidden', !fcol.length);
    $('#fin-collection').innerHTML = fcol.map(function (it, i) {
      if (it.kind === 'card') return '<button type="button" class="deck-cell" data-fi="' + i + '">' + Q.cardHtml(it.card, deckOpts({ mini: true })) + '</button>';
      return '<button type="button" class="item-cell rar-' + esc(it.rarity) + (it.got ? ' got' : ' locked') + '" data-fi="' + i + '"><span class="item-icon">' + iconHtml(it.icon) + '</span><span class="item-name">' + (it.got ? esc(it.name) : '？？？') + '</span></button>';
    }).join('');
    // 點卡片：放大看（沒收集到的提示一下；一般收藏品顯示故事）
    Q.$$('#fin-collection [data-fi]').forEach(function (btn) {
      btn.onclick = function () {
        var it = fcol[+btn.dataset.fi];
        if (!it.got) return Q.toast('這一個沒有收集到', 'warn');
        if (it.kind === 'card') return openCardView(it.card);
        askConfirm((it.icon && !/^(https?:|data:)/i.test(it.icon) ? it.icon + ' ' : '') + it.name + '（' + RARITY_TXT[it.rarity] + '）', it.story || '收藏成功！', '關閉', true);
      };
    });
    show('v-finish');
    if (!s.project.show_leaderboard) return;
    var hasRoutes = !!(se.route && (s.project.routes || []).length > 1);
    $('#fin-board-tabs').classList.toggle('hidden', !hasRoutes);
    var scope = hasRoutes ? 'route' : 'all';
    var load = async function () {
      try {
        var r = await api('leaderboard', { projectId: P.projectId, runCode: se.run_code, route: scope === 'route' ? se.route : '' });
        $('#fin-board-card').classList.remove('hidden');
        $('#tab-board-route').classList.toggle('ghost', scope !== 'route');
        $('#tab-board-all').classList.toggle('ghost', scope !== 'all');
        var showRoute = hasRoutes && scope === 'all';
        $('#fin-board').innerHTML = '<div class="table-wrap"><table><thead><tr><th>#</th><th>隊伍</th><th>分數</th><th>完成</th><th>時間</th></tr></thead><tbody>' +
          r.leaderboard.map(function (x, i) {
            var me = x.team_name === se.team_name ? ' style="background:#eaf4ee;font-weight:700"' : '';
            var rt = showRoute && x.route_name ? ' <span class="chip gray">' + esc(x.route_name) + '</span>' : '';
            return '<tr' + me + '><td>' + (i + 1) + '</td><td>' + esc(x.team_name) + rt + '</td><td>' + x.score + '</td><td>' + x.solved + '/' + x.total +
              '</td><td>' + (x.duration_sec != null ? Q.fmtDuration(x.duration_sec) : '進行中') + '</td></tr>';
          }).join('') + '</tbody></table></div>';
      } catch (e) { /* 排行榜失敗不影響 */ }
    };
    $('#tab-board-route').onclick = function () { scope = 'route'; load(); };
    $('#tab-board-all').onclick = function () { scope = 'all'; load(); };
    load();
  }
})();

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
  var LS = function (pid) { return 'gpsquest:' + pid; };

  document.addEventListener('DOMContentLoaded', init);

  /* ---------- 畫面切換 ---------- */
  function show(id) {
    ['v-projects', 'v-intro', 'v-game', 'v-finish', 'v-error'].forEach(function (v) {
      $('#' + v).classList.toggle('hidden', v !== id);
    });
    window.scrollTo(0, 0);
    if (id === 'v-game' && P.map) setTimeout(function () { P.map.invalidateSize(); }, 50);
  }
  function showError(msg) { $('#err-text').textContent = msg; show('v-error'); }

  /* ---------- 啟動 ---------- */
  async function init() {
    var name = (window.APP_CONFIG && APP_CONFIG.SITE_NAME) || 'GPS 實境解謎';
    $('#site-name').textContent = name;
    document.title = name;
    var q = new URLSearchParams(location.search);
    P.projectId = q.get('p') || '';
    P.runCode = q.get('run') || '';

    $('#btn-start').onclick = startSession;
    $('#btn-retry').onclick = function () { location.reload(); };
    $('#link-back-projects').onclick = function (e) { e.preventDefault(); location.href = location.pathname; };
    $('#link-reset').onclick = resetTeam;
    $('#btn-show-finish').onclick = showFinish;
    $('#btn-back-game').onclick = function () { show('v-game'); };
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
        P.sid = sid;
        return startGame(r.state);
      } catch (e) {
        if (e.code === 'SESSION_NOT_FOUND') { try { localStorage.removeItem(LS(pid)); } catch (x) { /* */ } }
        else return showError(e.message);
      }
    }
    showIntro(pid);
  }

  async function showIntro(pid) {
    try {
      var r = await Q.run(function () { return api('getProject', { projectId: pid }); }, { noToast: true });
      var p = P.project = r.project;
      document.title = p.name;
      $('#intro-name').textContent = p.name;
      $('#intro-desc').textContent = p.description || '';
      $('#intro-text').innerHTML = Q.linkify(p.intro || '依照線索找到每個地點，抵達後打卡解鎖題目！');
      if (p.cover_url) { $('#intro-cover').src = p.cover_url; $('#intro-cover').classList.remove('hidden'); }
      var meta = ['<span class="chip">🗺 ' + p.stage_count + ' 個關卡</span>',
        '<span class="chip">' + (p.unlock_mode === 'free' ? '🔓 自由順序' : '➡️ 依序解鎖') + '</span>'];
      if (p.time_limit_min) meta.push('<span class="chip amber">⏱ 限時 ' + p.time_limit_min + ' 分鐘</span>');
      $('#intro-meta').innerHTML = meta.join('');
      $('#f-run').value = P.runCode;
      $('#run-req').textContent = p.require_run_code ? ' *' : '（選填）';
      // 網址已帶場次代碼就不用再填
      $('#run-field').classList.toggle('hidden', !!P.runCode);
      show('v-intro');
    } catch (e) { showError(e.message); }
  }

  async function startSession() {
    var team = $('#f-team').value.trim();
    if (!team) { Q.toast('請輸入隊伍名稱', 'warn'); $('#f-team').focus(); return; }
    var run = $('#f-run').value.trim();
    if (P.project && P.project.require_run_code && !run) { Q.toast('請輸入場次代碼', 'warn'); return; }
    // 在使用者按下按鈕時要定位權限（iOS 比較穩）
    startWatch();
    startCompass(true);
    try {
      var r = await Q.run(function () {
        return api('startSession', {
          projectId: P.projectId, teamName: team, members: $('#f-members').value.trim(),
          runCode: run, userAgent: navigator.userAgent
        });
      });
      P.sid = r.state.session.session_id;
      try { localStorage.setItem(LS(P.projectId), P.sid); } catch (e) { /* */ }
      startGame(r.state);
      Q.toast('隊伍建立成功，出發吧！', 'ok');
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
    show('v-game');
    applyState(state);
    initMap();
    startWatch();
    clearInterval(P.timer);
    P.timer = setInterval(tick, 1000);
    tick();
  }

  function applyState(state) {
    var prevFinished = P.state && P.state.session.status === 'finished';
    P.state = state;
    renderGame();
    if (P.openId) renderStage();
    if (state.just_finished || (!prevFinished && state.session.status === 'finished' && P.stateLoadedOnce)) {
      closeStage();
      setTimeout(showFinish, 400);
    }
    P.stateLoadedOnce = true;
  }

  function renderGame() {
    var s = P.state, se = s.session;
    document.title = s.project.name;
    $('#g-title').textContent = s.project.name;
    $('#g-team').textContent = se.team_name;
    $('#g-code').textContent = se.code;
    $('#g-score').textContent = se.score;
    $('#g-progress-text').textContent = s.summary.done + ' / ' + s.summary.total;
    $('#g-progress').style.width = (s.summary.total ? s.summary.done / s.summary.total * 100 : 0) + '%';
    $('#g-finished').classList.toggle('hidden', se.status !== 'finished');
    $('#g-timeup').classList.toggle('hidden', se.status !== 'timeup');

    $('#g-stages').innerHTML = s.stages.map(function (st, i) {
      var lab = Q.STATUS_LABEL[st.status];
      var right = st.status === 'solved' ? '+' + st.earned : st.status === 'locked' ? '🔒' : '›';
      var dist = '';
      if (st.lat != null && P.pos && (st.status === 'open')) dist = distText(st);
      return '<button class="stage-card ' + st.status + '" data-id="' + esc(st.stage_id) + '">' +
        '<div class="stage-no">' + (st.status === 'solved' ? '✓' : (i + 1)) + '</div>' +
        '<div class="grow"><div><b>' + esc(st.title) + '</b> <span class="chip ' + lab[1] + '">' + lab[0] + '</span></div>' +
        '<div class="meta">' + Q.TYPE_LABEL[st.answer_type] + '・' + st.points + ' 分<span data-dist="' + esc(st.stage_id) + '">' + dist + '</span></div></div>' +
        '<b>' + right + '</b></button>';
    }).join('');
    Q.$$('#g-stages [data-id]').forEach(function (b) {
      b.onclick = function () {
        var st = findStage(b.dataset.id);
        if (st.status === 'locked') return Q.toast('請先完成前面的關卡', 'warn');
        openStage(st.stage_id);
      };
    });
    drawStagesOnMap();
  }

  function findStage(id) {
    return P.state.stages.filter(function (x) { return x.stage_id === id; })[0];
  }

  function tick() {
    var se = P.state && P.state.session;
    var el = $('#g-timer');
    if (!se || !se.deadline || se.status !== 'playing') { el.classList.add('hidden'); return; }
    var left = (new Date(se.deadline) - Date.now()) / 1000;
    el.classList.remove('hidden');
    el.textContent = '⏱ ' + Q.fmtDuration(left);
    el.style.background = left < 300 ? 'rgba(181,69,47,.85)' : '';
    if (left <= 0 && !P.timeupChecked) {
      P.timeupChecked = true;
      refresh();
    }
  }

  async function refresh() {
    try {
      var r = await api('getSession', { sessionId: P.sid });
      applyState(r.state);
    } catch (e) { /* 靜默 */ }
  }

  /* ---------- 定位 ---------- */
  function startWatch() {
    if (P.watchId != null) return;
    if (!('geolocation' in navigator)) { setGps('none'); return; }
    P.watchId = navigator.geolocation.watchPosition(function (p) {
      P.pos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, t: Date.now() };
      // 走路時 GPS 會提供移動方向，沒有指南針的手機可以拿來用
      if (p.coords.heading != null && !isNaN(p.coords.heading) && p.coords.speed > 0.7) {
        P.gpsHeading = p.coords.heading; P.gpsHeadingT = Date.now();
      }
      setGps('ok');
      updateMe();
      updateDistances();
    }, function (err) {
      setGps(err.code === 1 ? 'denied' : 'error');
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 25000 });
  }

  function setGps(state) {
    P.gpsState = state;
    var dot = $('#g-gps .gps-dot'), txt = $('#g-gps-text');
    dot.className = 'gps-dot ' + (state === 'ok' ? 'ok' : state === 'wait' ? '' : 'bad');
    if (state === 'ok') txt.textContent = '定位中，誤差約 ' + Math.round(P.pos.acc) + ' 公尺';
    else if (state === 'denied') txt.textContent = '⚠️ 定位權限被拒絕，請到瀏覽器設定允許位置存取';
    else if (state === 'none') txt.textContent = '⚠️ 這台裝置不支援定位';
    else if (state === 'error') txt.textContent = '⚠️ 暫時無法取得定位，請移到空曠處';
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
      if (st.lat == null || st.status !== 'open') return;
      var el = document.querySelector('[data-dist="' + st.stage_id + '"]');
      if (el) el.textContent = distText(st);
    });
    updateCompass();
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
      '<div class="help">進入 ' + st.radius_m + ' 公尺範圍內即可打卡</div>' +
      '<button class="sm ghost hidden" id="btn-compass" style="margin-top:8px">🧭 啟用指南針</button></div>';
  }

  function updateCompass() {
    var arrow = document.getElementById('cmp-arrow');
    if (!arrow || !P.openId) return;
    var st = findStage(P.openId);
    if (!st || st.status !== 'open' || st.lat == null) return;
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
      dir.textContent = '你已經在範圍內，按下方「我到了」打卡';
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
    P.map = L.map('g-map', { zoomControl: true, attributionControl: true }).setView([23.7, 121], 7);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap'
    }).addTo(P.map);
    P.layers = L.layerGroup().addTo(P.map);
    drawStagesOnMap();
  }

  function drawStagesOnMap() {
    if (!P.map || !P.state) return;
    P.layers.clearLayers();
    var pts = [];
    P.state.stages.forEach(function (st, i) {
      if (st.lat == null) return;
      var color = Q.STATUS_COLOR[st.status];
      L.circle([st.lat, st.lng], { radius: st.radius_m, color: color, weight: 2, fillOpacity: .12 }).addTo(P.layers);
      var icon = L.divIcon({ className: '', html: '<div class="pin" style="background:' + color + '">' + (st.status === 'solved' ? '✓' : i + 1) + '</div>', iconSize: [28, 28], iconAnchor: [14, 14] });
      L.marker([st.lat, st.lng], { icon: icon }).addTo(P.layers).on('click', function () { openStage(st.stage_id); });
      pts.push([st.lat, st.lng]);
    });
    if (!P.fitted) {
      if (P.pos) pts.push([P.pos.lat, P.pos.lng]);
      if (pts.length > 1) { P.map.fitBounds(pts, { padding: [30, 30], maxZoom: 17 }); P.fitted = true; }
      else if (pts.length === 1) { P.map.setView(pts[0], 17); P.fitted = true; }
    }
    $('#map-card').classList.toggle('hidden', !pts.length && !P.pos);
  }

  function updateMe() {
    if (!P.map || !P.pos) return;
    $('#map-card').classList.remove('hidden');
    var ll = [P.pos.lat, P.pos.lng];
    if (!P.me) {
      P.meAcc = L.circle(ll, { radius: P.pos.acc, color: '#2f6690', weight: 1, fillOpacity: .1 }).addTo(P.map);
      P.me = L.circleMarker(ll, { radius: 8, color: '#fff', weight: 3, fillColor: '#2f6690', fillOpacity: 1 }).addTo(P.map);
      if (!P.fitted) { P.map.setView(ll, 17); }
    } else {
      P.me.setLatLng(ll); P.meAcc.setLatLng(ll).setRadius(P.pos.acc);
    }
  }

  /* ---------- 關卡面板 ---------- */
  function openStage(id) {
    startCompass(true); // 點擊關卡是使用者手勢，iOS 可在這時詢問方向權限
    if (P.openId !== id) { P.choice = null; P.photo = null; }
    P.openId = id;
    renderStage();
    $('#sheet').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeStage() {
    P.openId = null;
    $('#sheet').classList.add('hidden');
    document.body.style.overflow = '';
  }

  function renderStage() {
    var st = findStage(P.openId);
    if (!st) return closeStage();
    var se = P.state.session, playing = se.status === 'playing';
    var lab = Q.STATUS_LABEL[st.status];
    var h = [];
    h.push('<div class="sheet-head"><h2>' + esc(st.title) + '</h2><button class="close-x" id="s-close" aria-label="關閉">✕</button></div>');
    h.push('<div class="row wrap" style="margin-bottom:12px"><span class="chip ' + lab[1] + '">' + lab[0] + '</span>' +
      '<span class="chip">' + Q.TYPE_LABEL[st.answer_type] + '</span><span class="chip">' + st.points + ' 分</span></div>');
    h.push('<div class="stack">');
    if (st.image_url) h.push('<img src="' + esc(st.image_url) + '" alt="" style="border-radius:12px">');
    if (st.clue) h.push('<div class="clue">' + Q.linkify(st.clue) + '</div>');

    // 提示
    if (st.hints && st.hints.length) {
      st.hints.forEach(function (t, i) { h.push('<div class="hint">💡 提示 ' + (i + 1) + '：' + Q.linkify(t) + '</div>'); });
    }

    if (st.status === 'open') {
      if (st.lat != null) h.push(compassHtml(st));
      if (playing) {
        if (st.require_gps) h.push('<button class="big" id="s-arrive">📍 我到了，定位打卡</button>');
        if (st.has_bypass) {
          h.push('<div class="card"><label for="s-code">' + (st.require_gps ? '定位不準？輸入現場通關碼' : '輸入現場的通關碼') + '</label>' +
            '<div class="row"><input id="s-code" class="grow" autocomplete="off" placeholder="通關碼"><button id="s-code-btn">確認</button></div></div>');
        }
      }
    }

    if (st.status === 'arrived' || st.status === 'solved' || st.status === 'failed') {
      if (st.question) h.push('<div class="question">' + Q.linkify(st.question) + '</div>');
    }

    if (st.status === 'arrived' && playing) h.push(answerUI(st));

    if (st.status === 'solved') {
      h.push('<div class="card" style="border-color:var(--forest)"><b>✅ 已完成，獲得 ' + st.earned + ' 分</b>' +
        (st.success_message ? '<div class="pre" style="margin-top:6px">' + Q.linkify(st.success_message) + '</div>' : '') + '</div>');
    }
    if (st.status === 'failed') h.push('<div class="card" style="border-color:var(--red)"><b>這一關沒有通過</b><div class="small muted">作答次數已用完，繼續挑戰下一關吧！</div></div>');

    // 提示按鈕
    if (playing && (st.status === 'open' || st.status === 'arrived') && st.hints.length < st.hints_total) {
      h.push('<button class="ghost big" id="s-hint">💡 看提示（' + (st.hints.length + 1) + '/' + st.hints_total + '）' +
        (st.hint_penalty ? '・扣 ' + st.hint_penalty + ' 分' : '') + '</button>');
    }
    if (!playing && st.status !== 'solved') h.push('<p class="muted center">' + (se.status === 'timeup' ? '闖關時間已到' : '闖關已結束') + '</p>');
    h.push('</div>');
    $('#sheet-body').innerHTML = h.join('');
    bindStage(st);
  }

  function answerUI(st) {
    var left = st.max_attempts > 0 ? '<div class="help">剩餘作答次數：' + (st.max_attempts - st.attempts) + '</div>' : '';
    switch (st.answer_type) {
      case 'text':
      case 'number':
        return '<div class="card"><label for="s-ans">你的答案</label>' +
          '<input id="s-ans" ' + (st.answer_type === 'number' ? 'inputmode="decimal"' : '') + ' autocomplete="off" placeholder="輸入答案">' + left +
          '<button class="big" id="s-submit" style="margin-top:10px">送出答案</button></div>';
      case 'choice':
        return '<div class="card"><div class="choice-list">' + (st.choices || []).map(function (c, i) {
          return '<button data-choice="' + i + '" class="' + (P.choice === c ? 'sel' : '') + '">' + String.fromCharCode(65 + i) + '. ' + esc(c) + '</button>';
        }).join('') + '</div>' + left + '<button class="big" id="s-submit" style="margin-top:10px">送出答案</button></div>';
      case 'photo':
        return '<div class="card stack"><label class="btn ghost" style="width:100%;padding:14px" for="s-file">📷 拍照或選擇照片</label>' +
          '<input type="file" id="s-file" accept="image/*" capture="environment" class="hidden">' +
          (P.photo ? '<img class="photo-preview" src="' + P.photo + '">' : '') +
          '<input id="s-caption" placeholder="照片說明（選填）" maxlength="200">' +
          '<button class="big" id="s-upload" ' + (P.photo ? '' : 'disabled') + '>上傳照片</button></div>';
      case 'form':
        return '<div class="card stack">' +
          (st.form_url ? '<a class="btn big" style="width:100%" href="' + esc(st.form_url) + '" target="_blank" rel="noopener">📝 開啟表單作答</a>' : '<p class="muted">（關主尚未設定表單網址）</p>') +
          '<div class="help">表單裡的「隊伍代碼」已幫你填好：<b>' + esc(P.state.session.code) + '</b>，請不要修改。</div>' +
          '<button class="big amber" id="s-form">我已送出表單</button></div>';
      case 'none':
        return '<div class="card"><button class="big" id="s-arrive">完成打卡</button></div>';
    }
    return '';
  }

  function bindStage(st) {
    var on = function (id, fn) { var el = document.getElementById(id); if (el) el.onclick = fn; };
    on('s-close', closeStage);
    on('btn-compass', function () { startCompass(true, true); });
    updateCompass();
    on('s-arrive', function () { doArrive(st); });
    on('s-code-btn', function () {
      var code = $('#s-code').value.trim();
      if (!code) return Q.toast('請輸入通關碼', 'warn');
      act('arrive', { stageId: st.stage_id, code: code });
    });
    on('s-hint', function () {
      if (st.hint_penalty && !confirm('使用提示會扣 ' + st.hint_penalty + ' 分，確定嗎？')) return;
      act('getHint', { stageId: st.stage_id });
    });
    on('s-submit', function () {
      var ans = st.answer_type === 'choice' ? P.choice : ($('#s-ans') && $('#s-ans').value.trim());
      if (!ans) return Q.toast(st.answer_type === 'choice' ? '請選擇一個答案' : '請輸入答案', 'warn');
      act('submitAnswer', { stageId: st.stage_id, answer: ans });
    });
    Q.$$('[data-choice]').forEach(function (b) {
      b.onclick = function () { P.choice = st.choices[+b.dataset.choice]; renderStage(); };
    });
    var input = $('#s-ans');
    if (input) input.addEventListener('keydown', function (e) { if (e.key === 'Enter') $('#s-submit').click(); });
    var file = $('#s-file');
    if (file) file.onchange = async function () {
      if (!file.files[0]) return;
      try { P.photo = await Q.run(function () { return compressImage(file.files[0]); }); renderStage(); }
      catch (e) { /* */ }
    };
    on('s-upload', function () {
      if (!P.photo) return;
      act('uploadPhoto', { stageId: st.stage_id, dataUrl: P.photo, caption: ($('#s-caption') || {}).value || '' })
        .then(function (ok) { if (ok) P.photo = null; });
    });
    on('s-form', function () { act('checkForm', { stageId: st.stage_id }); });
  }

  async function doArrive(st) {
    if (!st.require_gps) return act('arrive', { stageId: st.stage_id });
    var btn = $('#s-arrive');
    if (btn) { btn.disabled = true; btn.textContent = '定位中…'; }
    try {
      var pos = await getFix();
      await act('arrive', { stageId: st.stage_id, lat: pos.lat, lng: pos.lng, accuracy: pos.acc });
    } catch (e) {
      Q.toast(e.message, 'err', 6000);
    } finally {
      btn = $('#s-arrive');
      if (btn) { btn.disabled = false; btn.textContent = '📍 我到了，定位打卡'; }
    }
  }

  /** 呼叫動作 API → 更新狀態 → 顯示訊息 */
  async function act(action, payload) {
    try {
      var r = await Q.run(function () { return api(action, Object.assign({ sessionId: P.sid }, payload)); });
      applyState(r.state);
      var type = (r.correct === false || r.arrived === false) ? 'warn' : 'ok';
      if (r.message) Q.toast(r.message, type, type === 'warn' ? 4500 : 3000);
      return true;
    } catch (e) {
      if (['TIMEUP', 'FINISHED', 'CLOSED'].indexOf(e.code) >= 0) refresh();
      return false;
    }
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
      img.onerror = function () { reject(new Error('無法讀取這張照片，請換一張')); };
      img.src = url;
    });
  }

  /* ---------- 完成 ---------- */
  async function showFinish() {
    var s = P.state, se = s.session;
    $('#fin-team').textContent = se.team_name + (se.run_code ? '・' + se.run_code : '');
    $('#fin-score').textContent = se.score;
    $('#fin-solved').textContent = s.summary.solved + '/' + s.summary.total;
    $('#fin-time').textContent = se.finished_at ? Q.fmtDuration((new Date(se.finished_at) - new Date(se.started_at)) / 1000) : '—';
    $('#fin-message').innerHTML = Q.linkify(s.finish_message || '恭喜完成所有關卡！');
    show('v-finish');
    if (!s.project.show_leaderboard) return;
    try {
      var r = await api('leaderboard', { projectId: P.projectId, runCode: se.run_code });
      $('#fin-board-card').classList.remove('hidden');
      $('#fin-board').innerHTML = '<div class="table-wrap"><table><thead><tr><th>#</th><th>隊伍</th><th>分數</th><th>完成</th><th>時間</th></tr></thead><tbody>' +
        r.leaderboard.map(function (x, i) {
          var me = x.team_name === se.team_name ? ' style="background:#eaf4ee;font-weight:700"' : '';
          return '<tr' + me + '><td>' + (i + 1) + '</td><td>' + esc(x.team_name) + '</td><td>' + x.score + '</td><td>' + x.solved + '/' + x.total +
            '</td><td>' + (x.duration_sec != null ? Q.fmtDuration(x.duration_sec) : '進行中') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    } catch (e) { /* 排行榜失敗不影響 */ }
  }
})();

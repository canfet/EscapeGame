/* ========== 管理後台 ========== */
(function () {
  'use strict';
  var $ = Q.$, $$ = Q.$$, esc = Q.esc;
  var KEY_STORE = 'gpsquest-admin-key';
  var PROJECT_FIELDS = ['project_id', 'name', 'status', 'unlock_mode', 'description', 'intro', 'finish_message', 'cover_url',
    'start_at', 'end_at', 'time_limit_min', 'gps_max_accuracy', 'is_default', 'show_leaderboard', 'require_run_code'];
  var STAGE_FIELDS = ['stage_id', 'enabled', 'clue', 'image_url', 'require_gps', 'show_location', 'bypass_code', 'question',
    'answer_type', 'points', 'choices', 'answer', 'max_attempts', 'form_url', 'form_verify_sheet', 'success_message',
    'hint1', 'hint2', 'hint3', 'hint_penalty', 'lat', 'lng', 'radius_m'];
  var STATUS_TXT = { active: ['開放中', 'green'], hidden: ['連結可玩', 'blue'], draft: ['準備中', 'gray'], closed: ['已結束', 'red'] };

  var A = {
    key: '', projects: [], pid: '', stages: [], editStage: null, editProjectNew: false,
    stagesMap: null, stagesLayer: null, edMap: null, edMarker: null, edCircle: null, edOthers: null,
    monMap: null, monLayer: null, monTimer: null, tab: 'projects'
  };

  function call(action, payload) {
    return Q.run(function () { return Q.api(action, Object.assign({ adminKey: A.key }, payload || {})); })
      .catch(function (e) { if (e.code === 'UNAUTHORIZED') logout(); throw e; });
  }

  document.addEventListener('DOMContentLoaded', function () {
    $('#btn-login').onclick = login;
    $('#login-key').addEventListener('keydown', function (e) { if (e.key === 'Enter') login(); });
    $('#btn-logout').onclick = logout;
    $$('.tabs button').forEach(function (b) { b.onclick = function () { setTab(b.dataset.tab); }; });
    $$('[data-close]').forEach(function (b) { b.onclick = function () { b.closest('.modal').classList.add('hidden'); }; });
    $('#btn-new-project').onclick = function () { openProject(null); };
    $('#mp-save').onclick = saveProject;
    $('#stage-project').onchange = function () { selectProject(this.value); };
    $('#btn-new-stage').onclick = function () { openStage(null); };
    $('#btn-preview').onclick = function () { if (A.pid) window.open(playerUrl(A.pid), '_blank'); };
    $('#ms-save').onclick = saveStage;
    $('#ms-delete').onclick = deleteStage;
    $('#ms-answer_type').onchange = toggleTypeFields;
    $('#ms-here').onclick = useMyLocation;
    bindImageField('mp-cover_url', 'cover', function () { return $('#mp-project_id').value.trim(); });
    bindImageField('ms-image_url', 'stage', function () { return A.pid; });
    $('#ms-restore').onclick = function () {
      if (A.edOrig) { setEdPoint(A.edOrig.lat, A.edOrig.lng, true); Q.toast('已還原為原本位置', 'ok'); }
    };
    $('#ms-paste').addEventListener('input', function () {
      var ll = Q.parseLatLng(this.value);
      if (ll) { setEdPoint(ll.lat, ll.lng, true); this.value = ''; Q.toast('已套用座標', 'ok'); }
    });
    ['#ms-lat', '#ms-lng', '#ms-radius_m'].forEach(function (s) {
      $(s).addEventListener('change', function () {
        var lat = parseFloat($('#ms-lat').value), lng = parseFloat($('#ms-lng').value);
        if (isFinite(lat) && isFinite(lng)) setEdPoint(lat, lng, s !== '#ms-radius_m');
      });
    });
    $('#ml-run').addEventListener('input', updateLink);
    $('#ml-copy').onclick = function () {
      var el = $('#ml-url'); el.select();
      (navigator.clipboard ? navigator.clipboard.writeText(el.value) : Promise.reject()).then(function () { Q.toast('已複製', 'ok'); })
        .catch(function () { document.execCommand('copy'); Q.toast('已複製', 'ok'); });
    };
    $('#mon-project').onchange = function () { $('#mon-run').value = ''; A.monFitted = false; loadMonitor(); };
    $('#mon-run').onchange = loadMonitor;
    $('#btn-mon-refresh').onclick = loadMonitor;
    $('#mon-auto').onchange = setMonitorTimer;

    var saved = '';
    try { saved = sessionStorage.getItem(KEY_STORE) || ''; } catch (e) { /* */ }
    if (saved) { A.key = saved; enter(); }
  });

  /* ---------- 圖片上傳（封面／關卡圖） ---------- */
  function compressImage(file, max, quality) {
    max = max || 1600; quality = quality || 0.82;
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
      img.onerror = function () { reject(new Error('無法讀取這張圖片，請換一張')); };
      img.src = url;
    });
  }

  function refreshImgPrev(id) {
    var url = $('#' + id).value.trim(), prev = $('#' + id + '-prev');
    prev.classList.toggle('hidden', !url);
    if (url) prev.src = url; else prev.removeAttribute('src');
  }

  /** id 是網址輸入框；旁邊有 -pick / -clear / -file / -prev。kind: cover | stage */
  function bindImageField(id, kind, getProjectId) {
    var input = $('#' + id), file = $('#' + id + '-file'), pick = $('#' + id + '-pick');
    input.addEventListener('input', function () { refreshImgPrev(id); });
    $('#' + id + '-clear').onclick = function () { input.value = ''; refreshImgPrev(id); };
    pick.onclick = function () {
      if (!getProjectId()) return Q.toast(kind === 'cover' ? '請先填寫專案代碼再上傳' : '請先選擇專案', 'warn');
      file.click();
    };
    file.onchange = async function () {
      var f = file.files[0]; file.value = '';
      if (!f) return;
      if (!/^image\//.test(f.type)) return Q.toast('請選擇圖片檔', 'warn');
      pick.disabled = true; var old = pick.textContent; pick.textContent = '上傳中…';
      try {
        var dataUrl = await Q.run(function () { return compressImage(f); });
        var r = await call('adminUploadImage', { projectId: getProjectId(), kind: kind, dataUrl: dataUrl });
        if (!r || !r.url) throw new Error('伺服器沒有回傳圖片網址');
        input.value = r.url; refreshImgPrev(id);
        Q.toast('圖片已上傳，記得按「儲存」', 'ok');
      } catch (e) { /* call 已顯示錯誤 */ }
      finally { pick.disabled = false; pick.textContent = old; }
    };
  }

  /* ---------- 登入 ---------- */
  async function login() {
    A.key = $('#login-key').value.trim();
    if (!A.key) return Q.toast('請輸入管理密碼', 'warn');
    enter();
  }

  async function enter() {
    try {
      var r = await call('adminLogin');
      try { sessionStorage.setItem(KEY_STORE, A.key); } catch (e) { /* */ }
      $('#link-sheet').href = r.spreadsheet_url;
      $('#v-login').classList.add('hidden');
      $('#v-app').classList.remove('hidden');
      await loadProjects();
    } catch (e) { /* toast 已顯示 */ }
  }

  function logout() {
    try { sessionStorage.removeItem(KEY_STORE); } catch (e) { /* */ }
    A.key = '';
    clearInterval(A.monTimer);
    $('#v-app').classList.add('hidden');
    $('#v-login').classList.remove('hidden');
  }

  function setTab(tab) {
    A.tab = tab;
    $$('.tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === tab); });
    ['projects', 'stages', 'monitor'].forEach(function (t) { $('#t-' + t).classList.toggle('hidden', t !== tab); });
    clearInterval(A.monTimer);
    if (tab === 'stages') { if (A.pid) selectProject(A.pid); else if (A.projects[0]) selectProject(A.projects[0].project_id); }
    if (tab === 'monitor') { if (A.pid) $('#mon-project').value = A.pid; loadMonitor(); setMonitorTimer(); }
  }

  function playerUrl(pid, run) {
    var base = location.href.replace(/admin\.html.*$/, '').replace(/[?#].*$/, '');
    return base + 'index.html?p=' + encodeURIComponent(pid) + (run ? '&run=' + encodeURIComponent(run) : '');
  }

  /* ---------- 專案 ---------- */
  async function loadProjects() {
    var r = await call('adminListProjects');
    A.projects = r.projects;
    var opts = A.projects.map(function (p) { return '<option value="' + esc(p.project_id) + '">' + esc(p.name) + '（' + esc(p.project_id) + '）</option>'; }).join('');
    $('#stage-project').innerHTML = opts;
    $('#mon-project').innerHTML = opts;
    if (A.pid) { $('#stage-project').value = A.pid; $('#mon-project').value = A.pid; }
    renderProjects();
  }

  function renderProjects() {
    if (!A.projects.length) {
      $('#project-grid').innerHTML = '<div class="card muted">還沒有專案。按「新增專案」，或在試算表選單執行「初始化」建立示範專案。</div>';
      return;
    }
    $('#project-grid').innerHTML = A.projects.map(function (p) {
      var st = STATUS_TXT[p.status] || ['?', 'gray'];
      return '<div class="card stack" data-pid="' + esc(p.project_id) + '">' +
        '<div class="row"><b class="grow">' + esc(p.name) + '</b><span class="chip ' + st[1] + '">' + st[0] + '</span>' + (p.is_default ? '<span class="chip amber">預設</span>' : '') + '</div>' +
        '<div class="small muted">代碼：' + esc(p.project_id) + '・' + p.stage_count + ' 關・' + p.session_count + ' 隊玩過・' + (p.unlock_mode === 'free' ? '自由順序' : '依序解鎖') +
        (p.time_limit_min ? '・限時 ' + p.time_limit_min + ' 分' : '') + '</div>' +
        (p.description ? '<div class="small">' + esc(p.description) + '</div>' : '') +
        '<div class="row wrap">' +
        '<button class="sm" data-act="stages">關卡</button>' +
        '<button class="sm ghost" data-act="edit">設定</button>' +
        '<button class="sm ghost" data-act="link">連結／QR</button>' +
        '<button class="sm ghost" data-act="monitor">紀錄</button>' +
        '<button class="sm ghost" data-act="dup">複製</button>' +
        '<button class="sm ghost" data-act="del" style="color:var(--red)">刪除</button></div></div>';
    }).join('');
    $$('#project-grid [data-act]').forEach(function (b) {
      b.onclick = function () {
        var pid = b.closest('[data-pid]').dataset.pid, act = b.dataset.act;
        var p = A.projects.filter(function (x) { return x.project_id === pid; })[0];
        if (act === 'edit') openProject(p);
        if (act === 'stages') { A.pid = pid; setTab('stages'); }
        if (act === 'monitor') { A.pid = pid; setTab('monitor'); }
        if (act === 'link') openLink(pid);
        if (act === 'dup') duplicateProject(p);
        if (act === 'del') deleteProject(p);
      };
    });
  }

  function openProject(p) {
    A.editProjectNew = !p;
    p = p || { status: 'draft', unlock_mode: 'sequential', gps_max_accuracy: 80, time_limit_min: 0, show_leaderboard: true };
    $('#mp-title').textContent = A.editProjectNew ? '新增專案' : '專案設定';
    PROJECT_FIELDS.forEach(function (f) {
      var el = $('#mp-' + f);
      if (el.type === 'checkbox') el.checked = !!p[f];
      else if (el.type === 'datetime-local') el.value = Q.toLocalInput(p[f]);
      else el.value = p[f] == null ? '' : p[f];
    });
    refreshImgPrev('mp-cover_url');
    $('#mp-project_id').disabled = !A.editProjectNew;
    $('#m-project').classList.remove('hidden');
  }

  async function saveProject() {
    var p = {};
    PROJECT_FIELDS.forEach(function (f) {
      var el = $('#mp-' + f);
      p[f] = el.type === 'checkbox' ? el.checked : el.value.trim();
    });
    ['time_limit_min', 'gps_max_accuracy'].forEach(function (f) { p[f] = p[f] === '' ? '' : Number(p[f]); });
    try {
      await call('adminSaveProject', { project: p, isNew: A.editProjectNew });
      $('#m-project').classList.add('hidden');
      Q.toast('已儲存', 'ok');
      A.pid = p.project_id;
      await loadProjects();
    } catch (e) { /* */ }
  }

  async function duplicateProject(p) {
    var newId = prompt('複製「' + p.name + '」\n請輸入新專案代碼（英數字、-、_）：', p.project_id + '-copy');
    if (!newId) return;
    var newName = prompt('新專案名稱：', p.name + '（新地點）');
    if (newName === null) return;
    try {
      await call('adminDuplicateProject', { projectId: p.project_id, newId: newId.trim(), newName: newName.trim() });
      Q.toast('已複製，新專案狀態為「準備中」。記得修改關卡座標！', 'ok', 5000);
      A.pid = newId.trim();
      await loadProjects();
    } catch (e) { /* */ }
  }

  async function deleteProject(p) {
    var typed = prompt('刪除專案會一併刪除所有關卡設定（闖關紀錄會保留）。\n確定要刪除請輸入專案代碼「' + p.project_id + '」：');
    if (typed !== p.project_id) { if (typed !== null) Q.toast('代碼不符，未刪除', 'warn'); return; }
    try {
      await call('adminDeleteProject', { projectId: p.project_id });
      Q.toast('已刪除', 'ok');
      if (A.pid === p.project_id) A.pid = '';
      await loadProjects();
    } catch (e) { /* */ }
  }

  /* ---------- 連結／QR ---------- */
  function openLink(pid) {
    A.linkPid = pid;
    $('#ml-run').value = '';
    updateLink();
    $('#m-link').classList.remove('hidden');
  }
  function updateLink() {
    var url = playerUrl(A.linkPid, $('#ml-run').value.trim());
    $('#ml-url').value = url;
    $('#ml-open').href = url;
    var box = $('#ml-qr');
    box.innerHTML = '';
    if (window.QRCode) new QRCode(box, { text: url, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });
    else box.innerHTML = '<span class="small muted">QR Code 元件載入失敗，可複製連結到任一 QR 產生器</span>';
  }

  /* ---------- 關卡 ---------- */
  async function selectProject(pid) {
    A.pid = pid;
    $('#stage-project').value = pid;
    try {
      var r = await call('adminGetProject', { projectId: pid });
      A.stages = r.stages;
      renderStages();
    } catch (e) { /* */ }
  }

  function renderStages() {
    var n = A.stages.length;
    $('#stage-rows').innerHTML = n ? A.stages.map(function (s, i) {
      var gps = s.require_gps ? (s.lat != null ? '📍 ' + s.radius_m + 'm' : '<span class="chip red">未設座標</span>') : '—';
      if (s.bypass_code) gps += ' <span class="chip">碼</span>';
      if (!s.show_location) gps += ' <span class="chip gray">隱藏</span>';
      return '<tr data-sid="' + esc(s.stage_id) + '"' + (s.enabled ? '' : ' style="opacity:.5"') + '>' +
        '<td><b>' + (i + 1) + '</b></td>' +
        '<td><b>' + esc(s.title) + '</b>' + (s.enabled ? '' : ' <span class="chip gray">停用</span>') + '<div class="small muted">' + esc(s.stage_id) + '・' + s.points + ' 分</div></td>' +
        '<td>' + Q.TYPE_LABEL[s.answer_type] + '</td><td>' + gps + '</td>' +
        '<td><div class="row"><button class="sm ghost" data-mv="-1" ' + (i ? '' : 'disabled') + '>⬆</button>' +
        '<button class="sm ghost" data-mv="1" ' + (i < n - 1 ? '' : 'disabled') + '>⬇</button>' +
        '<button class="sm" data-edit>編輯</button></div></td></tr>';
    }).join('') : '<tr><td colspan="5" class="muted">這個專案還沒有關卡，按右上角「新增關卡」。</td></tr>';
    $$('#stage-rows [data-edit]').forEach(function (b) {
      b.onclick = function () { openStage(findStage(b.closest('tr').dataset.sid)); };
    });
    $$('#stage-rows [data-mv]').forEach(function (b) {
      b.onclick = function () { moveStage(b.closest('tr').dataset.sid, +b.dataset.mv); };
    });
    drawStagesMap();
  }

  function findStage(id) { return A.stages.filter(function (s) { return s.stage_id === id; })[0]; }

  async function moveStage(id, dir) {
    var ids = A.stages.map(function (s) { return s.stage_id; });
    var i = ids.indexOf(id), j = i + dir;
    if (j < 0 || j >= ids.length) return;
    ids[i] = ids[j]; ids[j] = id;
    try {
      await call('adminReorderStages', { projectId: A.pid, order: ids });
      await selectProject(A.pid);
    } catch (e) { /* */ }
  }

  function drawStagesMap() {
    if (!window.L) return;
    if (!A.stagesMap) {
      A.stagesMap = L.map('stages-map').setView([23.7, 121], 7);
      tiles().addTo(A.stagesMap);
      A.stagesLayer = L.layerGroup().addTo(A.stagesMap);
    }
    setTimeout(function () { A.stagesMap.invalidateSize(); }, 60);
    A.stagesLayer.clearLayers();
    var pts = [];
    A.stages.forEach(function (s, i) {
      if (s.lat == null || s.lng == null) return;
      L.circle([s.lat, s.lng], { radius: s.radius_m, color: '#2d6a4f', weight: 2, fillOpacity: .12 }).addTo(A.stagesLayer);
      L.marker([s.lat, s.lng], { icon: pinIcon(i + 1, s.enabled ? '#2d6a4f' : '#9a9486') }).addTo(A.stagesLayer)
        .bindTooltip(s.title).on('click', function () { openStage(s); });
      pts.push([s.lat, s.lng]);
    });
    if (pts.length > 1) A.stagesLayer.addLayer(L.polyline(pts, { color: '#e09f3e', dashArray: '6 6', weight: 2 }));
    if (pts.length) A.stagesMap.fitBounds(pts, { padding: [40, 40], maxZoom: 17 });
  }

  function tiles() {
    return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' });
  }
  function pinIcon(label, color) {
    return L.divIcon({ className: '', html: '<div class="pin" style="background:' + color + '">' + label + '</div>', iconSize: [28, 28], iconAnchor: [14, 14] });
  }

  function openStage(s) {
    if (!A.pid) return Q.toast('請先選擇專案', 'warn');
    A.editStage = s;
    var d = s || { enabled: true, require_gps: true, show_location: true, answer_type: 'text', points: 10, radius_m: 40, max_attempts: 0, hint_penalty: 0 };
    $('#ms-title').textContent = s ? '編輯關卡' : '新增關卡';
    $('#ms-title-input').value = d.title || '';
    STAGE_FIELDS.forEach(function (f) {
      var el = $('#ms-' + f);
      if (el.type === 'checkbox') el.checked = !!d[f];
      else el.value = d[f] == null ? '' : d[f];
    });
    refreshImgPrev('ms-image_url');
    $('#ms-stage_id').disabled = !!s;
    $('#ms-delete').classList.toggle('hidden', !s);
    toggleTypeFields();
    $('#m-stage').classList.remove('hidden');
    setTimeout(initEdMap, 30);
  }

  function toggleTypeFields() {
    var t = $('#ms-answer_type').value;
    $$('#m-stage [data-show]').forEach(function (el) {
      el.classList.toggle('hidden', el.dataset.show.split(' ').indexOf(t) < 0);
    });
  }

  function initEdMap() {
    if (!window.L) return;
    if (!A.edMap) {
      A.edMap = L.map('ms-map').setView([23.7, 121], 7);
      tiles().addTo(A.edMap);
      A.edOthers = L.layerGroup().addTo(A.edMap);
      A.edMap.on('click', function (e) { setEdPoint(e.latlng.lat, e.latlng.lng, false); });
    }
    A.edMap.invalidateSize();
    A.edOthers.clearLayers();
    var pts = [];
    A.stages.forEach(function (s, i) {
      if (s.lat == null || (A.editStage && s.stage_id === A.editStage.stage_id)) return;
      L.circle([s.lat, s.lng], { radius: s.radius_m, color: '#9a9486', weight: 1, fillOpacity: .08 }).addTo(A.edOthers);
      L.marker([s.lat, s.lng], { icon: pinIcon(i + 1, '#9a9486') }).addTo(A.edOthers).bindTooltip(s.title);
      pts.push([s.lat, s.lng]);
    });
    if (A.edMarker) { A.edMap.removeLayer(A.edMarker); A.edMap.removeLayer(A.edCircle); A.edMarker = null; }
    clearEdExtras();
    var lat = parseFloat($('#ms-lat').value), lng = parseFloat($('#ms-lng').value);
    // 記住開啟時的原本位置，之後按「使用我目前的位置」仍可對照／還原
    A.edOrig = (isFinite(lat) && isFinite(lng))
      ? { lat: lat, lng: lng, r: parseFloat($('#ms-radius_m').value) || 40 } : null;
    refreshEdOrig();
    if (isFinite(lat) && isFinite(lng)) setEdPoint(lat, lng, true);
    else if (pts.length) A.edMap.fitBounds(pts, { padding: [40, 40], maxZoom: 17 });
  }

  function setEdPoint(lat, lng, pan) {
    lat = Math.round(lat * 1e6) / 1e6; lng = Math.round(lng * 1e6) / 1e6;
    $('#ms-lat').value = lat; $('#ms-lng').value = lng;
    if (!A.edMap) return;
    var r = parseFloat($('#ms-radius_m').value) || 40;
    if (!A.edMarker) {
      A.edMarker = L.marker([lat, lng], { draggable: true, icon: pinIcon('★', '#e09f3e') }).addTo(A.edMap);
      A.edCircle = L.circle([lat, lng], { radius: r, color: '#e09f3e', weight: 2, fillOpacity: .18 }).addTo(A.edMap);
      A.edMarker.on('drag', function (e) { A.edCircle.setLatLng(e.latlng); });
      A.edMarker.on('dragend', function (e) { var ll = e.target.getLatLng(); setEdPoint(ll.lat, ll.lng, false); });
    } else {
      A.edMarker.setLatLng([lat, lng]); A.edCircle.setLatLng([lat, lng]).setRadius(r);
    }
    if (pan) A.edMap.setView([lat, lng], Math.max(A.edMap.getZoom(), 17));
    refreshEdOrig();
  }

  function clearEdExtras() {
    ['edOrigPin', 'edOrigLine', 'edMe', 'edMeAcc'].forEach(function (k) {
      if (A[k] && A.edMap) A.edMap.removeLayer(A[k]);
      A[k] = null;
    });
  }

  // 原本位置（灰色虛線圈＋圖釘）、與目前設定點之間的虛線與距離
  function refreshEdOrig() {
    var info = $('#ms-orig-info'), btn = $('#ms-restore');
    var lat = parseFloat($('#ms-lat').value), lng = parseFloat($('#ms-lng').value);
    var o = A.edOrig;
    if (A.edOrigPin && A.edMap) { A.edMap.removeLayer(A.edOrigPin); A.edOrigPin = null; }
    if (A.edOrigLine && A.edMap) { A.edMap.removeLayer(A.edOrigLine); A.edOrigLine = null; }
    var moved = o && isFinite(lat) && isFinite(lng) && A.edMap &&
      A.edMap.distance([o.lat, o.lng], [lat, lng]) >= 1;
    info.classList.toggle('hidden', !moved);
    btn.classList.toggle('hidden', !moved);
    if (!moved) return;
    var d = Math.round(A.edMap.distance([o.lat, o.lng], [lat, lng]));
    A.edOrigPin = L.layerGroup([
      L.circle([o.lat, o.lng], { radius: o.r, color: '#c1440e', weight: 2, dashArray: '6 5', fillOpacity: .06 }),
      L.marker([o.lat, o.lng], { icon: pinIcon('原', '#c1440e'), interactive: false })
    ]).addTo(A.edMap);
    A.edOrigLine = L.polyline([[o.lat, o.lng], [lat, lng]], { color: '#c1440e', weight: 2, dashArray: '4 6' })
      .addTo(A.edMap).bindTooltip('相距 ' + d + ' 公尺', { permanent: true, direction: 'center', className: 'dist-tip' });
    info.textContent = '紅色虛線圈「原」＝這關原本的位置（' + o.lat + ', ' + o.lng + '），與目前設定相距約 ' + d + ' 公尺。';
  }

  async function useMyLocation() {
    var btn = $('#ms-here');
    btn.disabled = true; btn.textContent = '定位中…';
    try {
      var p = await Q.locate();
      setEdPoint(p.lat, p.lng, false);
      // 另外顯示藍點（我的位置＋誤差圈），並讓地圖同時框住原本位置與新位置
      if (A.edMe) { A.edMap.removeLayer(A.edMe); A.edMap.removeLayer(A.edMeAcc); }
      A.edMeAcc = L.circle([p.lat, p.lng], { radius: p.acc, color: '#2f6690', weight: 1, fillOpacity: .1, interactive: false }).addTo(A.edMap);
      A.edMe = L.circleMarker([p.lat, p.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#2f6690', fillOpacity: 1, interactive: false }).addTo(A.edMap);
      var pts = [[p.lat, p.lng]];
      if (A.edOrig) pts.push([A.edOrig.lat, A.edOrig.lng]);
      if (pts.length > 1) A.edMap.fitBounds(pts, { padding: [50, 50], maxZoom: 18 });
      else A.edMap.setView(pts[0], Math.max(A.edMap.getZoom(), 17));
      var tip = p.acc > 100 ? '（電腦定位通常不準，建議到現場用手機設定，或在地圖上微調）' : '';
      Q.toast('已設定為目前位置，誤差約 ' + Math.round(p.acc) + ' 公尺' + tip, p.acc > 100 ? 'warn' : 'ok', 6000);
    } catch (e) {
      Q.toast(e.message, 'err', 9000);
    } finally {
      btn.disabled = false; btn.textContent = '📍 使用我目前的位置';
    }
  }

  async function saveStage() {
    var s = { project_id: A.pid, title: $('#ms-title-input').value.trim() };
    STAGE_FIELDS.forEach(function (f) {
      var el = $('#ms-' + f);
      s[f] = el.type === 'checkbox' ? el.checked : el.value.trim();
    });
    ['points', 'max_attempts', 'hint_penalty', 'radius_m', 'lat', 'lng'].forEach(function (f) { s[f] = s[f] === '' ? '' : Number(s[f]); });
    if (A.editStage) { s.stage_id = A.editStage.stage_id; s.order = A.editStage.order; }
    // 防呆：位置離原本太遠（可能是電腦定位不準）時先確認
    if (A.edOrig && isFinite(s.lat) && isFinite(s.lng)) {
      var moved = Q.distM(A.edOrig.lat, A.edOrig.lng, s.lat, s.lng);
      if (moved > 500 && !confirm('新位置離原本位置約 ' + Math.round(moved) + ' 公尺，確定要儲存嗎？\n（電腦定位常常不準，可按「還原原本位置」）')) return;
    }
    try {
      var r = await call('adminSaveStage', { stage: s, isNew: !A.editStage });
      $('#m-stage').classList.add('hidden');
      Q.toast('關卡已儲存', 'ok');
      (r.warnings || []).forEach(function (w) { Q.toast('⚠️ ' + w, 'warn', 5000); });
      await selectProject(A.pid);
    } catch (e) { /* */ }
  }

  async function deleteStage() {
    if (!A.editStage || !confirm('確定刪除關卡「' + A.editStage.title + '」？')) return;
    try {
      await call('adminDeleteStage', { projectId: A.pid, stageId: A.editStage.stage_id });
      $('#m-stage').classList.add('hidden');
      Q.toast('已刪除', 'ok');
      await selectProject(A.pid);
    } catch (e) { /* */ }
  }

  /* ---------- 闖關紀錄 ---------- */
  function setMonitorTimer() {
    clearInterval(A.monTimer);
    if ($('#mon-auto').checked && A.tab === 'monitor') {
      A.monTimer = setInterval(function () { loadMonitor(true); }, 20000);
    }
  }

  async function loadMonitor(silent) {
    var pid = $('#mon-project').value;
    if (!pid) return;
    A.pid = pid;
    var run = $('#mon-run').value;
    try {
      var payload = { adminKey: A.key, projectId: pid, runCode: run };
      var fn = function () { return Promise.all([Q.api('adminSessions', payload), Q.api('adminSubmissions', Object.assign({ limit: 100 }, payload))]); };
      var res = silent ? await fn() : await Q.run(fn);
      renderMonitor(res[0], res[1], run);
    } catch (e) { if (silent) Q.toast(e.message, 'err'); }
  }

  function renderMonitor(r, sub, run) {
    var sel = $('#mon-run');
    sel.innerHTML = '<option value="">全部場次</option>' + r.run_codes.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
    sel.value = run;
    var ss = r.sessions;
    $('#mon-teams').textContent = ss.length;
    $('#mon-playing').textContent = ss.filter(function (s) { return s.status === 'playing'; }).length;
    $('#mon-finished').textContent = ss.filter(function (s) { return s.status === 'finished'; }).length;
    $('#mon-subs').textContent = sub.submissions.length;
    $('#mon-updated').textContent = '更新於 ' + Q.fmtTime(new Date());
    var stTxt = { playing: ['進行中', 'amber'], finished: ['完成', 'green'], timeup: ['超時', 'red'] };
    $('#mon-sessions').innerHTML = ss.length ? ss.map(function (s) {
      var t = stTxt[s.status] || [s.status, 'gray'];
      return '<tr><td><b>' + esc(s.team_name) + '</b> <span class="chip gray">' + esc(s.code) + '</span>' +
        (s.members ? '<div class="small muted">' + esc(s.members) + '</div>' : '') + '</td>' +
        '<td>' + esc(s.run_code || '—') + '</td>' +
        '<td><span class="chip ' + t[1] + '">' + t[0] + '</span> ' + s.solved + '/' + s.total + '</td>' +
        '<td><b>' + s.score + '</b></td><td>' + esc(s.current_stage || '—') + '</td>' +
        '<td class="small">' + Q.fmtTime(s.last_active_at) + '</td>' +
        '<td><button class="sm ghost" data-del="' + esc(s.session_id) + '" title="刪除這支隊伍">🗑</button></td></tr>';
    }).join('') : '<tr><td colspan="7" class="muted">還沒有隊伍開始闖關</td></tr>';
    $$('#mon-sessions [data-del]').forEach(function (b) {
      b.onclick = async function () {
        if (!confirm('刪除這支隊伍的進度？（作答紀錄 Submissions 仍會保留）')) return;
        try { await call('adminDeleteSession', { sessionId: b.dataset.del }); loadMonitor(); } catch (e) { /* */ }
      };
    });

    var actTxt = { start: '開始', arrive: '打卡', answer: '作答', hint: '提示', photo: '照片', form: '表單' };
    var resTxt = { ok: '✅ 成功', correct: '✅ 答對', wrong: '❌ 答錯', failed: '⛔ 次數用完', too_far: '📏 太遠', low_accuracy: '📡 定位不準', wrong_code: '❌ 通關碼錯', uploaded: '✅ 已上傳', not_found: '⏳ 未收到' };
    $('#mon-subs-rows').innerHTML = sub.submissions.map(function (x) {
      return '<tr><td class="small">' + Q.fmtTime(x.timestamp) + '</td><td>' + esc(x.team_name) + '</td><td>' + esc(x.stage_title || '') + '</td>' +
        '<td>' + (actTxt[x.action] || esc(x.action)) + '</td><td>' + esc(x.input) + '</td><td>' + (resTxt[x.result] || esc(x.result)) + '</td>' +
        '<td>' + (x.distance_m !== '' && x.distance_m != null ? x.distance_m + 'm' : '') + '</td>' +
        '<td>' + (x.file_url ? '<a href="' + esc(x.file_url) + '" target="_blank" rel="noopener">開啟</a>' : '') + '</td></tr>';
    }).join('') || '<tr><td colspan="8" class="muted">尚無紀錄</td></tr>';

    if (!window.L) return;
    if (!A.monMap) {
      A.monMap = L.map('mon-map').setView([23.7, 121], 7);
      tiles().addTo(A.monMap);
      A.monLayer = L.layerGroup().addTo(A.monMap);
      A.monFitted = false;
    }
    setTimeout(function () { A.monMap.invalidateSize(); }, 60);
    A.monLayer.clearLayers();
    var pts = [];
    r.stages.forEach(function (s, i) {
      if (s.lat == null) return;
      L.circle([s.lat, s.lng], { radius: s.radius_m, color: '#2d6a4f', weight: 1, fillOpacity: .08 }).addTo(A.monLayer);
      L.marker([s.lat, s.lng], { icon: pinIcon(i + 1, '#2d6a4f') }).addTo(A.monLayer).bindTooltip(s.title);
      pts.push([s.lat, s.lng]);
    });
    ss.forEach(function (s) {
      if (s.last_lat == null) return;
      L.circleMarker([s.last_lat, s.last_lng], { radius: 7, color: '#fff', weight: 2, fillColor: '#e09f3e', fillOpacity: 1 })
        .addTo(A.monLayer).bindTooltip(s.team_name + '（' + Q.fmtTime(s.last_active_at) + '）', { permanent: ss.length <= 12, direction: 'top' });
      pts.push([s.last_lat, s.last_lng]);
    });
    if (pts.length && !A.monFitted) { A.monMap.fitBounds(pts, { padding: [30, 30], maxZoom: 17 }); A.monFitted = true; }
  }
})();

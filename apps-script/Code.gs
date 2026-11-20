/**
 * ============================================================
 *  GPS 實境解謎闖關系統 － Apps Script 後端 API
 *  資料存在「綁定的 Google 試算表」，前台放 GitHub Pages。
 *  學生不需登入，只會在背景呼叫這支 API。
 * ============================================================
 *  部署：部署 → 新增部署 → 類型「網頁應用程式」
 *        執行身分：我　／　誰可以存取：所有人
 */

/* ===================== 基本設定 ===================== */
var APP_VERSION = '1.0.0';
var CACHE_SEC = 30;                 // 專案／關卡資料快取秒數
var DEFAULT_GPS_MAX_ACCURACY = 80;  // 定位誤差超過幾公尺就不接受
var GPS_TOLERANCE_CAP = 20;         // 判定範圍最多額外放寬幾公尺（依手機回報的誤差）
var MAX_PHOTO_BYTES = 8 * 1024 * 1024;
var ANSWER_TYPES = ['text', 'number', 'choice', 'photo', 'form', 'none'];
var PROJECT_STATUS = ['active', 'hidden', 'draft', 'closed'];

/* 各工作表欄位（可以在試算表後面自行加欄位，不影響程式） */
var SCHEMA = {
  Projects: ['project_id', 'name', 'status', 'is_default', 'unlock_mode', 'description', 'intro',
    'finish_message', 'cover_url', 'start_at', 'end_at', 'time_limit_min', 'gps_max_accuracy',
    'show_leaderboard', 'require_run_code', 'updated_at'],
  Stages: ['project_id', 'stage_id', 'order', 'enabled', 'title', 'clue', 'image_url', 'lat', 'lng',
    'radius_m', 'show_location', 'require_gps', 'bypass_code', 'question', 'show_question_early', 'answer_type', 'choices',
    'answer', 'points', 'max_attempts', 'hint1', 'hint2', 'hint3', 'hint_penalty', 'success_message',
    'form_url', 'form_verify_sheet', 'updated_at'],
  Sessions: ['session_id', 'code', 'project_id', 'run_code', 'team_name', 'members', 'status', 'score',
    'started_at', 'last_active_at', 'finished_at', 'last_lat', 'last_lng', 'progress_json', 'user_agent'],
  Submissions: ['timestamp', 'session_id', 'code', 'project_id', 'run_code', 'team_name', 'stage_id',
    'stage_title', 'action', 'input', 'result', 'points', 'lat', 'lng', 'accuracy_m', 'distance_m',
    'file_url', 'note']
};

/* 要強制為「純文字」格式的欄位（避免 007 變成 7） */
var TEXT_COLUMNS = {
  Projects: ['project_id'],
  Stages: ['project_id', 'stage_id', 'bypass_code', 'answer', 'choices'],
  Sessions: ['session_id', 'code', 'project_id', 'run_code', 'team_name', 'members'],
  Submissions: ['session_id', 'code', 'project_id', 'run_code', 'team_name', 'stage_id', 'input']
};
var BOOL_COLUMNS = {
  Projects: ['is_default', 'show_leaderboard', 'require_run_code'],
  Stages: ['enabled', 'show_location', 'require_gps', 'show_question_early']
};

/* ===================== API 路由 ===================== */
var ROUTES = {
  ping: function () { return { version: APP_VERSION, time: new Date() }; },
  // 前台（不需登入）
  listProjects: listProjects_,
  getProject: getProject_,
  startSession: startSession_,
  getSession: getSession_,
  arrive: arrive_,
  submitAnswer: submitAnswer_,
  getHint: getHint_,
  uploadPhoto: uploadPhoto_,
  checkForm: checkForm_,
  leaderboard: leaderboard_,
  // 後台（需管理密碼）
  adminLogin: admin_(adminLogin_),
  adminListProjects: admin_(adminListProjects_),
  adminGetProject: admin_(adminGetProject_),
  adminSaveProject: admin_(adminSaveProject_),
  adminDeleteProject: admin_(adminDeleteProject_),
  adminDuplicateProject: admin_(adminDuplicateProject_),
  adminUploadImage: admin_(adminUploadImage_),
  adminSaveStage: admin_(adminSaveStage_),
  adminDeleteStage: admin_(adminDeleteStage_),
  adminReorderStages: admin_(adminReorderStages_),
  adminSessions: admin_(adminSessions_),
  adminSubmissions: admin_(adminSubmissions_),
  adminDeleteSession: admin_(adminDeleteSession_)
};

function doGet(e) {
  return json_({ ok: true, app: 'GPS 實境解謎 API', version: APP_VERSION, time: new Date() });
}

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var fn = ROUTES[body.action];
    if (!fn) throw appError_('不支援的動作：' + body.action, 'BAD_ACTION');
    var result = fn(body) || {};
    result.ok = true;
    return json_(result);
  } catch (err) {
    return json_({ ok: false, error: (err && err.message) || String(err), code: (err && err.code) || 'ERROR' });
  }
}

/* ===================== 前台 API ===================== */

function listProjects_() {
  var now = new Date();
  var list = projects_().filter(function (p) { return p.status === 'active'; })
    .map(function (p) {
      var o = publicProject_(p, stages_(p.project_id));
      o.not_started = !!(p.start_at && new Date(p.start_at) > now);
      o.ended = !!(p.end_at && new Date(p.end_at) < now);
      return o;
    });
  list.sort(function (a, b) { return (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0); });
  return { projects: list };
}

function getProject_(b) {
  var p = findProject_(b.projectId);
  checkPlayable_(p);
  return { project: publicProject_(p, stages_(p.project_id)) };
}

function startSession_(b) {
  return withLock_(function () {
    var p = findProject_(b.projectId);
    checkPlayable_(p);
    var team = str_(b.teamName).slice(0, 30);
    if (!team) throw appError_('請輸入隊伍名稱', 'BAD_INPUT');
    var run = str_(b.runCode).slice(0, 30);
    if (p.require_run_code && !run) throw appError_('請輸入場次代碼（請向關主索取）', 'NEED_RUN_CODE');
    var now = new Date();
    var s = {
      session_id: Utilities.getUuid(),
      code: genCode_(),
      project_id: p.project_id,
      run_code: run,
      team_name: team,
      members: str_(b.members).slice(0, 200),
      status: 'playing',
      score: 0,
      started_at: now,
      last_active_at: now,
      finished_at: '',
      progress_json: '{}',
      user_agent: str_(b.userAgent).slice(0, 200)
    };
    writeRow_('Sessions', null, s);
    var saved = loadSession_(s.session_id);
    var c = { s: saved, p: p, stages: stages_(p.project_id), now: now };
    log_(c, null, 'start', { note: s.members });
    return buildState_(c);
  });
}

function getSession_(b) {
  var c = ctx_(b, false);
  if (c.s.status === 'playing' && isTimeUp_(c)) {
    withLock_(function () { c.s.status = 'timeup'; saveSession_(c); });
  }
  return buildState_(c);
}

/** 抵達關卡：GPS 打卡或輸入現場通關碼 */
function arrive_(b) {
  return withLock_(function () {
    var c = ctx_(b, true);
    var st = getStage_(c, b.stageId);
    var status = statusOf_(c, st);
    var g = prog_(c, st);
    if (status === 'locked') throw appError_('這一關尚未解鎖，請先完成前面的關卡', 'LOCKED');
    if (status === 'solved' || status === 'failed') return buildState_(c, { arrived: true });

    var extra = {};
    if (status === 'open') {
      var code = str_(b.code);
      if (code) {
        if (!st.bypass_code || norm_(code) !== norm_(st.bypass_code)) {
          log_(c, st, 'arrive', { input: code, result: 'wrong_code' });
          throw appError_('通關碼不正確', 'WRONG_CODE');
        }
        extra = { input: code, note: 'code' };
      } else if (st.require_gps) {
        var lat = num_(b.lat, NaN), lng = num_(b.lng, NaN), acc = num_(b.accuracy, 9999);
        if (!isFinite(lat) || !isFinite(lng)) throw appError_('沒有收到定位資料，請允許網頁使用位置資訊', 'NO_GPS');
        if (!isNum_(st.lat) || !isNum_(st.lng)) throw appError_('此關卡尚未設定座標，請通知關主', 'NO_TARGET');
        var d = distM_(lat, lng, st.lat, st.lng);
        var pos = { lat: lat, lng: lng, accuracy_m: Math.round(acc), distance_m: Math.round(d) };
        c.s.last_lat = lat; c.s.last_lng = lng;
        var maxAcc = c.p.gps_max_accuracy || DEFAULT_GPS_MAX_ACCURACY;
        if (acc > maxAcc) {
          saveSession_(c);
          log_(c, st, 'arrive', merge_(pos, { result: 'low_accuracy' }));
          return buildState_(c, {
            arrived: false, distance_m: Math.round(d),
            message: '目前定位誤差約 ' + Math.round(acc) + ' 公尺，太大了。請到空曠處、開啟「精確位置」後再試一次。'
          });
        }
        var tol = Math.min(acc, GPS_TOLERANCE_CAP);
        if (d > st.radius_m + tol) {
          saveSession_(c);
          log_(c, st, 'arrive', merge_(pos, { result: 'too_far' }));
          return buildState_(c, {
            arrived: false, distance_m: Math.round(d),
            message: '還沒到喔！距離目標約 ' + Math.round(d) + ' 公尺，再靠近一點。'
          });
        }
        extra = merge_(pos, { note: 'gps' });
      } else if (st.bypass_code) {
        throw appError_('請輸入現場的通關碼', 'NEED_CODE');
      }
      g.arrivedAt = c.now.toISOString();
    }
    // 打卡型關卡：抵達即過關
    if (st.answer_type === 'none' && !g.solvedAt) solve_(c, st, g);
    finishIfDone_(c);
    saveSession_(c);
    log_(c, st, 'arrive', merge_(extra, { result: 'ok', points: g.points || '' }));
    return buildState_(c, {
      arrived: true,
      message: st.answer_type === 'none' ? (st.success_message || '打卡成功！') : '抵達成功！題目已解鎖。'
    });
  });
}

function submitAnswer_(b) {
  return withLock_(function () {
    var c = ctx_(b, true);
    var st = getStage_(c, b.stageId);
    var status = statusOf_(c, st);
    if (status === 'solved') return buildState_(c, { correct: true, message: '這一關已經完成了' });
    if (status === 'failed') return buildState_(c, { correct: false, message: '這一關的作答次數已用完' });
    if (status !== 'arrived') throw appError_('請先抵達關卡地點', 'NOT_ARRIVED');
    if (['text', 'number', 'choice'].indexOf(st.answer_type) < 0) throw appError_('這一關不需要輸入答案', 'BAD_TYPE');
    var ans = str_(b.answer).slice(0, 500);
    if (!ans) throw appError_('請輸入答案', 'BAD_INPUT');

    var g = prog_(c, st);
    g.attempts = (g.attempts || 0) + 1;
    var ok = checkAnswer_(st, ans);
    var msg;
    if (ok) {
      solve_(c, st, g);
      msg = st.success_message || (str_(st.answer) ? '答對了！' : '已收到你們的答案！');
    } else if (st.max_attempts > 0 && g.attempts >= st.max_attempts) {
      g.failed = true; g.failedAt = c.now.toISOString(); g.points = 0;
      msg = '作答次數已用完，這一關不計分，繼續前進吧！';
    } else {
      var left = st.max_attempts > 0 ? '（還剩 ' + (st.max_attempts - g.attempts) + ' 次機會）' : '';
      msg = '答案不正確，再想想看' + left;
    }
    finishIfDone_(c);
    saveSession_(c);
    log_(c, st, 'answer', { input: ans, result: ok ? 'correct' : (g.failed ? 'failed' : 'wrong'), points: ok ? g.points : '' });
    return buildState_(c, { correct: ok, message: msg });
  });
}

function getHint_(b) {
  return withLock_(function () {
    var c = ctx_(b, true);
    var st = getStage_(c, b.stageId);
    var status = statusOf_(c, st);
    if (status !== 'open' && status !== 'arrived') throw appError_('這一關目前不能使用提示', 'BAD_STATE');
    var hints = hintsOf_(st);
    var g = prog_(c, st);
    var used = g.hints || 0;
    if (used >= hints.length) throw appError_('沒有更多提示了', 'NO_HINT');
    g.hints = used + 1;
    saveSession_(c);
    log_(c, st, 'hint', { input: String(g.hints), note: hints[used] });
    return buildState_(c, { hint: hints[used], message: st.hint_penalty ? '已使用提示：這一關答對可得 ' + Math.max(0, st.points - g.hints * st.hint_penalty) + ' 分（每則提示少 ' + st.hint_penalty + ' 分）' : '' });
  });
}

function uploadPhoto_(b) {
  return withLock_(function () {
    var c = ctx_(b, true);
    var st = getStage_(c, b.stageId);
    var status = statusOf_(c, st);
    if (status === 'solved') return buildState_(c, { message: '這一關已經完成了' });
    if (status !== 'arrived') throw appError_('請先抵達關卡地點', 'NOT_ARRIVED');
    if (st.answer_type !== 'photo') throw appError_('這一關不需要上傳照片', 'BAD_TYPE');
    var m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(String(b.dataUrl || ''));
    if (!m) throw appError_('照片格式不正確', 'BAD_INPUT');
    var bytes = Utilities.base64Decode(m[2]);
    if (bytes.length > MAX_PHOTO_BYTES) throw appError_('照片太大了，請重新拍攝', 'TOO_LARGE');
    var ext = m[1].split('/')[1].replace('jpeg', 'jpg');
    var name = [c.p.project_id, c.s.run_code || 'run', c.s.team_name, st.stage_id,
      Utilities.formatDate(c.now, Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss')].join('_') + '.' + ext;
    var file = folder_(c.p.project_id).createFile(Utilities.newBlob(bytes, m[1], name));
    file.setDescription('隊伍：' + c.s.team_name + '｜代碼：' + c.s.code + '｜關卡：' + st.title + '｜' + str_(b.caption));
    var g = prog_(c, st);
    g.fileUrl = file.getUrl();
    solve_(c, st, g);
    finishIfDone_(c);
    saveSession_(c);
    log_(c, st, 'photo', { input: str_(b.caption).slice(0, 200), result: 'uploaded', points: g.points, file_url: g.fileUrl });
    return buildState_(c, { correct: true, message: st.success_message || '照片上傳成功！' });
  });
}

/** 後台上傳封面／關卡圖片：存到 Drive 的 <專案代碼>/_images，設為「知道連結的人可檢視」，回傳可直接用於 <img> 的網址 */
function adminUploadImage_(b) {
  var pid = str_(b.projectId).trim();
  if (!/^[A-Za-z0-9_-]{1,60}$/.test(pid)) throw appError_('專案代碼不正確（只能用英數字、-、_）', 'BAD_INPUT');
  var kind = b.kind === 'cover' ? 'cover' : 'stage';
  var m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/.exec(String(b.dataUrl || ''));
  if (!m) throw appError_('圖片格式不正確（支援 jpg、png、webp、gif）', 'BAD_INPUT');
  var bytes = Utilities.base64Decode(m[2]);
  if (bytes.length > MAX_PHOTO_BYTES) throw appError_('圖片太大了（上限 8 MB）', 'TOO_LARGE');
  var ext = m[1].split('/')[1].replace('jpeg', 'jpg');
  var name = kind + '_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss') + '.' + ext;
  var parent = folder_(pid), it = parent.getFoldersByName('_images');
  var dir = it.hasNext() ? it.next() : parent.createFolder('_images');
  var file = dir.createFile(Utilities.newBlob(bytes, m[1], name));
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { url: 'https://lh3.googleusercontent.com/d/' + file.getId(), file_id: file.getId() };
}

/** Google 表單關卡：若有設定 form_verify_sheet，會去該工作表找隊伍代碼 */
function checkForm_(b) {
  return withLock_(function () {
    var c = ctx_(b, true);
    var st = getStage_(c, b.stageId);
    var status = statusOf_(c, st);
    if (status === 'solved') return buildState_(c, { correct: true, message: '這一關已經完成了' });
    if (status !== 'arrived') throw appError_('請先抵達關卡地點', 'NOT_ARRIVED');
    if (st.answer_type !== 'form') throw appError_('這一關不是表單關卡', 'BAD_TYPE');
    if (st.form_verify_sheet) {
      var sh = ss_().getSheetByName(st.form_verify_sheet);
      if (!sh) throw appError_('找不到表單回應工作表「' + st.form_verify_sheet + '」，請通知關主', 'CONFIG');
      var found = sh.createTextFinder(c.s.code).matchCase(false).findNext();
      if (!found) {
        log_(c, st, 'form', { result: 'not_found' });
        return buildState_(c, { correct: false, message: '還沒收到你們的表單回覆。送出表單後，請等幾秒再按一次。' });
      }
    }
    var g = prog_(c, st);
    solve_(c, st, g);
    finishIfDone_(c);
    saveSession_(c);
    log_(c, st, 'form', { result: 'ok', points: g.points });
    return buildState_(c, { correct: true, message: st.success_message || '表單已確認，過關！' });
  });
}

function leaderboard_(b) {
  var p = findProject_(b.projectId);
  if (!p) throw appError_('找不到這個闖關專案', 'NOT_FOUND');
  if (!p.show_leaderboard) throw appError_('此專案未開放排行榜', 'DISABLED');
  var run = str_(b.runCode);
  var stages = stages_(p.project_id);
  var rows = readRows_('Sessions').filter(function (r) {
    return str_(r.project_id) === p.project_id && (!run || str_(r.run_code) === run);
  }).map(function (r) {
    var prog = parseJson_(r.progress_json, {});
    var solved = stages.filter(function (s) { return prog[s.stage_id] && prog[s.stage_id].solvedAt; }).length;
    var st = date_(r.started_at), fi = date_(r.finished_at);
    return {
      team_name: str_(r.team_name), score: num_(r.score, 0), solved: solved, total: stages.length,
      status: str_(r.status), duration_sec: st && fi ? Math.round((fi - st) / 1000) : null
    };
  });
  rows.sort(function (a, b2) {
    if (b2.score !== a.score) return b2.score - a.score;
    if (b2.solved !== a.solved) return b2.solved - a.solved;
    var da = a.duration_sec == null ? 1e12 : a.duration_sec, db = b2.duration_sec == null ? 1e12 : b2.duration_sec;
    return da - db;
  });
  return { leaderboard: rows.slice(0, 50) };
}

/* ===================== 後台 API ===================== */

function admin_(fn) {
  return function (b) {
    var key = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
    if (!key || str_(b.adminKey) !== key) {
      Utilities.sleep(800);
      throw appError_('管理密碼錯誤', 'UNAUTHORIZED');
    }
    return fn(b);
  };
}

function adminLogin_() {
  return { spreadsheet_url: ss_().getUrl(), version: APP_VERSION };
}

function adminListProjects_() {
  var stages = readRows_('Stages'), sessions = readRows_('Sessions');
  var list = projects_().map(function (p) {
    p.stage_count = stages.filter(function (s) { return str_(s.project_id) === p.project_id; }).length;
    p.session_count = sessions.filter(function (s) { return str_(s.project_id) === p.project_id; }).length;
    return p;
  });
  return { projects: list };
}

function adminGetProject_(b) {
  var p = findProject_(b.projectId);
  if (!p) throw appError_('找不到專案', 'NOT_FOUND');
  return { project: p, stages: stages_(p.project_id, true) };
}

function adminSaveProject_(b) {
  return withLock_(function () {
    var p = b.project || {};
    var id = str_(p.project_id);
    if (!/^[A-Za-z0-9_-]{2,40}$/.test(id)) throw appError_('專案代碼只能用英文、數字、底線或連字號（2–40 字）', 'BAD_INPUT');
    if (!str_(p.name)) throw appError_('請輸入專案名稱', 'BAD_INPUT');
    if (p.status && PROJECT_STATUS.indexOf(p.status) < 0) throw appError_('狀態不正確', 'BAD_INPUT');
    var rows = readRows_('Projects');
    var ex = find_(rows, function (r) { return str_(r.project_id) === id; });
    if (b.isNew && ex) throw appError_('專案代碼「' + id + '」已經存在', 'DUPLICATE');
    if (!b.isNew && !ex) throw appError_('找不到專案', 'NOT_FOUND');
    var data = pick_(p, SCHEMA.Projects);
    data.project_id = id;
    ['start_at', 'end_at'].forEach(function (k) { if (k in data) data[k] = data[k] ? (date_(data[k]) || '') : ''; });
    data.updated_at = new Date();
    if (bool_(data.is_default)) {
      rows.forEach(function (r) {
        if (str_(r.project_id) !== id && bool_(r.is_default)) writeRow_('Projects', r._row, { is_default: false });
      });
    }
    writeRow_('Projects', ex ? ex._row : null, data);
    bumpCache_();
    return { project_id: id };
  });
}

function adminDeleteProject_(b) {
  return withLock_(function () {
    var id = str_(b.projectId);
    var n = deleteRows_('Projects', function (r) { return str_(r.project_id) === id; });
    var m = deleteRows_('Stages', function (r) { return str_(r.project_id) === id; });
    bumpCache_();
    return { deleted_projects: n, deleted_stages: m };
  });
}

function adminDuplicateProject_(b) {
  return withLock_(function () {
    var src = findProject_(b.projectId);
    if (!src) throw appError_('找不到來源專案', 'NOT_FOUND');
    var newId = str_(b.newId);
    if (!/^[A-Za-z0-9_-]{2,40}$/.test(newId)) throw appError_('新專案代碼格式不正確', 'BAD_INPUT');
    if (findProject_(newId)) throw appError_('專案代碼「' + newId + '」已經存在', 'DUPLICATE');
    var p = merge_(src, {
      project_id: newId, name: str_(b.newName) || (src.name + '（複製）'),
      status: 'draft', is_default: false, updated_at: new Date(),
      start_at: date_(src.start_at) || '', end_at: date_(src.end_at) || ''
    });
    writeRow_('Projects', null, pick_(p, SCHEMA.Projects));
    stages_(src.project_id, true).forEach(function (s) {
      writeRow_('Stages', null, pick_(merge_(s, { project_id: newId, updated_at: new Date() }), SCHEMA.Stages));
    });
    bumpCache_();
    return { project_id: newId };
  });
}

function adminSaveStage_(b) {
  return withLock_(function () {
    var s = b.stage || {};
    var pid = str_(s.project_id);
    if (!findProject_(pid)) throw appError_('找不到專案', 'NOT_FOUND');
    ensureHeaders_('Stages');   // 舊的試算表若缺新欄位（例如 show_question_early），先補上，否則設定不會被存下來
    var id = str_(s.stage_id) || ('st' + rand_(5, 'abcdefghjkmnpqrstuvwxyz23456789'));
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw appError_('關卡代碼格式不正確', 'BAD_INPUT');
    if (!str_(s.title)) throw appError_('請輸入關卡名稱', 'BAD_INPUT');
    var type = str_(s.answer_type) || 'text';
    if (ANSWER_TYPES.indexOf(type) < 0) throw appError_('作答方式不正確', 'BAD_INPUT');
    var rows = readRows_('Stages');
    var mine = rows.filter(function (r) { return str_(r.project_id) === pid; });
    var ex = find_(mine, function (r) { return str_(r.stage_id) === id; });
    if (b.isNew && ex) throw appError_('關卡代碼重複', 'DUPLICATE');
    var data = pick_(s, SCHEMA.Stages);
    data.project_id = pid; data.stage_id = id; data.answer_type = type;
    if (!ex && !num_(data.order, 0)) {
      data.order = mine.reduce(function (m, r) { return Math.max(m, num_(r.order, 0)); }, 0) + 1;
    }
    data.updated_at = new Date();
    writeRow_('Stages', ex ? ex._row : null, data);
    bumpCache_();
    var warnings = [];
    if (bool_(s.require_gps) && (!isFinite(num_(s.lat, NaN)) || !isFinite(num_(s.lng, NaN)))) warnings.push('需要 GPS 但尚未設定座標');
    if (type === 'choice' && !str_(s.choices)) warnings.push('選擇題尚未設定選項');
    if ((type === 'text' || type === 'number' || type === 'choice') && !str_(s.answer)) warnings.push('未設定答案：任何答案都會通過');
    return { stage_id: id, warnings: warnings };
  });
}

function adminDeleteStage_(b) {
  return withLock_(function () {
    var n = deleteRows_('Stages', function (r) {
      return str_(r.project_id) === str_(b.projectId) && str_(r.stage_id) === str_(b.stageId);
    });
    bumpCache_();
    return { deleted: n };
  });
}

function adminReorderStages_(b) {
  return withLock_(function () {
    var order = b.order || [];
    readRows_('Stages').forEach(function (r) {
      if (str_(r.project_id) !== str_(b.projectId)) return;
      var i = order.indexOf(str_(r.stage_id));
      if (i >= 0) writeRow_('Stages', r._row, { order: i + 1 });
    });
    bumpCache_();
    return {};
  });
}

function adminSessions_(b) {
  var p = findProject_(b.projectId);
  if (!p) throw appError_('找不到專案', 'NOT_FOUND');
  var run = str_(b.runCode);
  var stages = stages_(p.project_id);
  var list = readRows_('Sessions').filter(function (r) {
    return str_(r.project_id) === p.project_id && (!run || str_(r.run_code) === run);
  }).map(function (r) {
    var prog = parseJson_(r.progress_json, {});
    var c = { p: p, stages: stages, s: { progress: prog } };
    var sts = stageStatuses_(c);
    var solved = 0, current = '';
    stages.forEach(function (s) {
      if (sts[s.stage_id] === 'solved') solved++;
      else if (!current && (sts[s.stage_id] === 'open' || sts[s.stage_id] === 'arrived')) current = s.title;
    });
    return {
      session_id: str_(r.session_id), code: str_(r.code), team_name: str_(r.team_name), members: str_(r.members),
      run_code: str_(r.run_code), status: str_(r.status), score: num_(r.score, 0), solved: solved, total: stages.length,
      current_stage: current, started_at: r.started_at, last_active_at: r.last_active_at, finished_at: r.finished_at,
      last_lat: num_(r.last_lat, null), last_lng: num_(r.last_lng, null)
    };
  });
  list.sort(function (a, c2) { return (date_(c2.last_active_at) || 0) - (date_(a.last_active_at) || 0); });
  var runs = {};
  readRows_('Sessions').forEach(function (r) { if (str_(r.project_id) === p.project_id && str_(r.run_code)) runs[str_(r.run_code)] = 1; });
  return { sessions: list, run_codes: Object.keys(runs), stages: stages };
}

function adminSubmissions_(b) {
  var pid = str_(b.projectId), run = str_(b.runCode), limit = Math.min(num_(b.limit, 200), 1000);
  var rows = readRows_('Submissions').filter(function (r) {
    return str_(r.project_id) === pid && (!run || str_(r.run_code) === run);
  });
  return {
    submissions: rows.slice(-limit).reverse().map(function (r) { delete r._row; return r; })
  };
}

function adminDeleteSession_(b) {
  return withLock_(function () {
    var n = deleteRows_('Sessions', function (r) { return str_(r.session_id) === str_(b.sessionId); });
    return { deleted: n };
  });
}

/* ===================== 遊戲邏輯 ===================== */

function ctx_(b, mutate) {
  var s = loadSession_(b.sessionId);
  var p = findProject_(s.project_id);
  if (!p) throw appError_('這個闖關專案已被移除', 'NOT_FOUND');
  var c = { s: s, p: p, stages: stages_(p.project_id), now: new Date() };
  if (mutate) {
    checkPlayable_(p);
    if (s.status === 'finished') throw appError_('你們已經完成全部關卡囉！', 'FINISHED');
    if (s.status === 'timeup') throw appError_('闖關時間已到', 'TIMEUP');
    if (isTimeUp_(c)) {
      s.status = 'timeup';
      saveSession_(c);
      throw appError_('闖關時間已到', 'TIMEUP');
    }
  }
  return c;
}

function getStage_(c, id) {
  var st = find_(c.stages, function (x) { return x.stage_id === str_(id); });
  if (!st) throw appError_('找不到這個關卡', 'NOT_FOUND');
  return st;
}

function prog_(c, st) {
  if (!c.s.progress[st.stage_id]) c.s.progress[st.stage_id] = {};
  return c.s.progress[st.stage_id];
}

function stageStatuses_(c) {
  var out = {}, prevDone = true, prog = c.s.progress || {};
  c.stages.forEach(function (st) {
    var g = prog[st.stage_id] || {}, status;
    if (g.solvedAt) status = 'solved';
    else if (g.failed) status = 'failed';
    else if (c.p.unlock_mode === 'sequential' && !prevDone) status = 'locked';
    else if (g.arrivedAt || (!st.require_gps && !st.bypass_code)) status = 'arrived';
    else status = 'open';
    out[st.stage_id] = status;
    if (c.p.unlock_mode === 'sequential') prevDone = prevDone && (status === 'solved' || status === 'failed');
  });
  return out;
}

function statusOf_(c, st) { return stageStatuses_(c)[st.stage_id]; }

function solve_(c, st, g) {
  g.solvedAt = c.now.toISOString();
  g.points = Math.max(0, st.points - (g.hints || 0) * st.hint_penalty);
}

function checkAnswer_(st, ans) {
  var accepted = str_(st.answer).split('|').map(function (x) { return x.trim(); }).filter(String);
  if (!accepted.length) return true; // 沒設答案 = 開放式作答，送出即過關
  if (st.answer_type === 'number') {
    var n = parseFloat(String(ans).normalize('NFKC').replace(/[,\s]/g, ''));
    return accepted.some(function (a) { return Math.abs(parseFloat(a) - n) < 1e-9; });
  }
  var na = norm_(ans);
  return accepted.some(function (a) { return norm_(a) === na; });
}

function hintsOf_(st) { return [st.hint1, st.hint2, st.hint3].filter(function (h) { return !!h; }); }

function isTimeUp_(c) {
  var dl = deadline_(c);
  return !!(dl && c.now > dl && c.s.status === 'playing');
}

function deadline_(c) {
  var st = date_(c.s.started_at);
  return c.p.time_limit_min > 0 && st ? new Date(st.getTime() + c.p.time_limit_min * 60000) : null;
}

function finishIfDone_(c) {
  var sts = stageStatuses_(c);
  var allDone = c.stages.length > 0 && c.stages.every(function (s) {
    return sts[s.stage_id] === 'solved' || sts[s.stage_id] === 'failed';
  });
  if (allDone && c.s.status === 'playing') {
    c.s.status = 'finished';
    c.s.finished_at = c.now;
    c.justFinished = true;
  }
}

function score_(c) {
  var t = 0, prog = c.s.progress;
  Object.keys(prog).forEach(function (k) { t += num_(prog[k].points, 0); });
  return t;
}

function buildState_(c, extra) {
  var sts = stageStatuses_(c), prog = c.s.progress;
  var list = c.stages.map(function (st) { return publicStage_(st, sts[st.stage_id], prog[st.stage_id] || {}, c); });
  var dl = deadline_(c);
  var res = {
    state: {
      session: {
        session_id: c.s.session_id, code: c.s.code, project_id: c.p.project_id, team_name: c.s.team_name,
        members: c.s.members, run_code: c.s.run_code, status: c.s.status, score: score_(c),
        started_at: date_(c.s.started_at), finished_at: date_(c.s.finished_at) || null, deadline: dl,
        server_time: new Date()
      },
      project: publicProject_(c.p, c.stages),
      stages: list,
      summary: {
        total: list.length,
        solved: list.filter(function (x) { return x.status === 'solved'; }).length,
        done: list.filter(function (x) { return x.status === 'solved' || x.status === 'failed'; }).length
      },
      finish_message: c.s.status === 'finished' ? c.p.finish_message : '',
      just_finished: !!c.justFinished
    }
  };
  return merge_(res, extra || {});
}

function publicStage_(st, status, g, c) {
  var hints = hintsOf_(st), used = g.hints || 0;
  var o = {
    stage_id: st.stage_id, order: st.order, title: st.title, status: status, answer_type: st.answer_type,
    points: st.points, earned: g.points || 0, require_gps: st.require_gps, has_bypass: !!st.bypass_code,
    show_location: st.show_location, hints_total: hints.length, hints: hints.slice(0, used),
    hint_penalty: st.hint_penalty, attempts: g.attempts || 0, max_attempts: st.max_attempts
  };
  if (status === 'locked') return o;
  o.clue = st.clue; o.image_url = st.image_url;
  if (st.show_location && isNum_(st.lat) && isNum_(st.lng)) {
    o.lat = st.lat; o.lng = st.lng; o.radius_m = st.radius_m;
  }
  // 「抵達前先顯示題目」：前往中就能先看題目，但仍要抵達後才能作答
  if (status === 'open' && st.show_question_early) o.question = st.question;
  if (status === 'arrived' || status === 'solved' || status === 'failed') {
    o.question = st.question;
    o.choices = st.choices ? st.choices.split('|').map(function (x) { return x.trim(); }).filter(String) : [];
    if (st.form_url) o.form_url = fillTemplate_(st.form_url, c);
  }
  if (status === 'solved') { o.success_message = st.success_message; o.file_url = g.fileUrl || ''; }
  return o;
}

function fillTemplate_(url, c) {
  var map = { code: c.s.code, team: c.s.team_name, project: c.p.project_id, run: c.s.run_code || '' };
  return url.replace(/\{(code|team|project|run)\}/g, function (_, k) { return encodeURIComponent(map[k]); });
}

function publicProject_(p, stages) {
  return {
    project_id: p.project_id, name: p.name, description: p.description, intro: p.intro, cover_url: p.cover_url,
    unlock_mode: p.unlock_mode, time_limit_min: p.time_limit_min, show_leaderboard: p.show_leaderboard,
    require_run_code: p.require_run_code, is_default: p.is_default, start_at: p.start_at || null,
    end_at: p.end_at || null, stage_count: stages.length
  };
}

function checkPlayable_(p) {
  if (!p) throw appError_('找不到這個闖關專案，請確認網址', 'NOT_FOUND');
  if (p.status === 'draft') throw appError_('這個闖關專案還在準備中，尚未開放', 'NOT_OPEN');
  if (p.status === 'closed') throw appError_('這個闖關專案已經結束', 'CLOSED');
  var now = new Date();
  if (p.start_at && new Date(p.start_at) > now) {
    throw appError_('尚未開始，開放時間：' + Utilities.formatDate(new Date(p.start_at), Session.getScriptTimeZone(), 'M/d HH:mm'), 'NOT_OPEN');
  }
  if (p.end_at && new Date(p.end_at) < now) throw appError_('這個闖關專案已經結束', 'CLOSED');
}

/* ===================== 資料讀取（含快取） ===================== */

function projects_() {
  return cached_('projects', function () {
    return readRows_('Projects').map(cleanProject_).filter(function (p) { return p.project_id; });
  });
}

function findProject_(id) {
  id = str_(id);
  return find_(projects_(), function (p) { return p.project_id === id; }) || null;
}

/** includeDisabled=true 給後台用 */
function stages_(pid, includeDisabled) {
  var all = cached_('stages_' + pid, function () {
    return readRows_('Stages').filter(function (r) { return str_(r.project_id) === pid; })
      .map(cleanStage_).sort(function (a, b) { return a.order - b.order; });
  });
  return includeDisabled ? all : all.filter(function (s) { return s.enabled; });
}

function cleanProject_(r) {
  var sd = date_(r.start_at), ed = date_(r.end_at);
  return {
    project_id: str_(r.project_id), name: str_(r.name),
    status: PROJECT_STATUS.indexOf(str_(r.status).toLowerCase()) >= 0 ? str_(r.status).toLowerCase() : 'draft',
    is_default: bool_(r.is_default),
    unlock_mode: str_(r.unlock_mode).toLowerCase() === 'free' ? 'free' : 'sequential',
    description: str_(r.description), intro: str_(r.intro), finish_message: str_(r.finish_message),
    cover_url: str_(r.cover_url), start_at: sd ? sd.toISOString() : '', end_at: ed ? ed.toISOString() : '',
    time_limit_min: num_(r.time_limit_min, 0), gps_max_accuracy: num_(r.gps_max_accuracy, DEFAULT_GPS_MAX_ACCURACY),
    show_leaderboard: bool_(r.show_leaderboard), require_run_code: bool_(r.require_run_code)
  };
}

function cleanStage_(r) {
  var type = str_(r.answer_type).toLowerCase();
  return {
    project_id: str_(r.project_id), stage_id: str_(r.stage_id), order: num_(r.order, 999),
    enabled: defBool_(r.enabled, true), title: str_(r.title), clue: str_(r.clue), image_url: str_(r.image_url),
    lat: num_(r.lat, null), lng: num_(r.lng, null), radius_m: Math.max(5, num_(r.radius_m, 30)),
    show_location: defBool_(r.show_location, true), require_gps: defBool_(r.require_gps, true),
    bypass_code: str_(r.bypass_code), question: str_(r.question),
    show_question_early: defBool_(r.show_question_early, true),
    answer_type: ANSWER_TYPES.indexOf(type) >= 0 ? type : 'text', choices: str_(r.choices), answer: str_(r.answer),
    points: num_(r.points, 10), max_attempts: num_(r.max_attempts, 0),
    hint1: str_(r.hint1), hint2: str_(r.hint2), hint3: str_(r.hint3), hint_penalty: num_(r.hint_penalty, 0),
    success_message: str_(r.success_message), form_url: str_(r.form_url), form_verify_sheet: str_(r.form_verify_sheet)
  };
}

function loadSession_(id) {
  if (!str_(id)) throw appError_('缺少闖關編號', 'SESSION_NOT_FOUND');
  var r = findRowByValue_('Sessions', 'session_id', str_(id));
  if (!r) throw appError_('找不到闖關紀錄，請重新開始', 'SESSION_NOT_FOUND');
  r.session_id = str_(r.session_id); r.code = str_(r.code); r.project_id = str_(r.project_id);
  r.team_name = str_(r.team_name); r.run_code = str_(r.run_code); r.members = str_(r.members);
  r.status = str_(r.status) || 'playing';
  r.progress = parseJson_(r.progress_json, {});
  return r;
}

function saveSession_(c) {
  var s = c.s;
  writeRow_('Sessions', s._row, {
    status: s.status, score: score_(c), progress_json: JSON.stringify(s.progress),
    finished_at: s.finished_at || '', last_active_at: c.now || new Date(),
    last_lat: s.last_lat === undefined ? '' : s.last_lat, last_lng: s.last_lng === undefined ? '' : s.last_lng
  });
}

function log_(c, st, action, extra) {
  writeRow_('Submissions', null, merge_({
    timestamp: new Date(), session_id: c.s.session_id, code: c.s.code, project_id: c.p.project_id,
    run_code: c.s.run_code, team_name: c.s.team_name, stage_id: st ? st.stage_id : '',
    stage_title: st ? st.title : '', action: action
  }, extra || {}));
}

function folder_(pid) {
  var props = PropertiesService.getScriptProperties();
  var root = null, id = props.getProperty('DRIVE_FOLDER_ID');
  if (id) { try { root = DriveApp.getFolderById(id); } catch (e) { root = null; } }
  if (!root) {
    root = DriveApp.createFolder('GPS實境解謎_上傳照片');
    props.setProperty('DRIVE_FOLDER_ID', root.getId());
  }
  var it = root.getFoldersByName(pid);
  return it.hasNext() ? it.next() : root.createFolder(pid);
}

/* ===================== 試算表工具 ===================== */

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function sheet_(name) {
  var ss = ss_(), sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    var h = SCHEMA[name];
    sh.getRange(1, 1, 1, h.length).setValues([h]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function headers_(sh) {
  var lc = sh.getLastColumn();
  if (lc === 0) return [];
  return sh.getRange(1, 1, 1, lc).getValues()[0].map(function (h) { return String(h).trim(); });
}

function ensureHeaders_(name) {
  var sh = sheet_(name), h = headers_(sh);
  var missing = SCHEMA[name].filter(function (k) { return h.indexOf(k) < 0; });
  if (missing.length) sh.getRange(1, h.length + 1, 1, missing.length).setValues([missing]);
  return sh;
}

function readRows_(name) {
  var sh = sheet_(name), lr = sh.getLastRow(), lc = sh.getLastColumn();
  if (lr < 2) return [];
  var vals = sh.getRange(1, 1, lr, lc).getValues();
  var h = vals[0].map(function (x) { return String(x).trim(); });
  var out = [];
  for (var i = 1; i < vals.length; i++) {
    var r = vals[i];
    if (r.every(function (v) { return v === '' || v === null; })) continue;
    var o = { _row: i + 1 };
    h.forEach(function (k, j) { if (k) o[k] = r[j]; });
    out.push(o);
  }
  return out;
}

function writeRow_(name, rowIndex, obj) {
  var sh = sheet_(name), h = headers_(sh);
  if (rowIndex) {
    var existing = sh.getRange(rowIndex, 1, 1, h.length).getValues()[0];
    var merged = h.map(function (k, j) { return (k && k in obj) ? toCell_(obj[k]) : existing[j]; });
    sh.getRange(rowIndex, 1, 1, h.length).setValues([merged]);
  } else {
    sh.appendRow(h.map(function (k) { return (k && k in obj) ? toCell_(obj[k]) : ''; }));
  }
}

function deleteRows_(name, pred) {
  var sh = sheet_(name);
  var rows = readRows_(name).filter(pred).map(function (r) { return r._row; }).sort(function (a, b) { return b - a; });
  rows.forEach(function (r) { sh.deleteRow(r); });
  return rows.length;
}

function findRowByValue_(name, col, value) {
  var sh = sheet_(name), h = headers_(sh), ci = h.indexOf(col) + 1, lr = sh.getLastRow();
  if (!ci || lr < 2) return null;
  var cell = sh.getRange(2, ci, lr - 1, 1).createTextFinder(String(value)).matchEntireCell(true).findNext();
  if (!cell) return null;
  var row = cell.getRow(), vals = sh.getRange(row, 1, 1, h.length).getValues()[0], o = { _row: row };
  h.forEach(function (k, j) { if (k) o[k] = vals[j]; });
  return o;
}

function toCell_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' && !isFinite(v)) return '';
  if (typeof v === 'object' && !(v instanceof Date)) return JSON.stringify(v);
  return v;
}

/* ===================== 快取 ===================== */

function cacheVer_() { return PropertiesService.getScriptProperties().getProperty('CACHE_VER') || '1'; }

function bumpCache_() {
  PropertiesService.getScriptProperties().setProperty('CACHE_VER', String(Date.now()));
}

function cached_(key, fn) {
  var cache = CacheService.getScriptCache(), k = 'v' + cacheVer_() + '_' + key;
  var hit = cache.get(k);
  if (hit) { try { return JSON.parse(hit); } catch (e) { /* ignore */ } }
  var val = fn();
  try { cache.put(k, JSON.stringify(val), CACHE_SEC); } catch (e) { /* 超過 100KB 就不快取 */ }
  return JSON.parse(JSON.stringify(val));
}

/* ===================== 小工具 ===================== */

function appError_(msg, code) { var e = new Error(msg); e.code = code || 'ERROR'; return e; }

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw appError_('目前人數較多，請再按一次', 'BUSY');
  try { return fn(); } finally { lock.releaseLock(); }
}

function distM_(lat1, lng1, lat2, lng2) {
  var R = 6371000, t = Math.PI / 180;
  var dLat = (lat2 - lat1) * t, dLng = (lng2 - lng1) * t;
  var x = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(lat1 * t) * Math.cos(lat2 * t) * Math.pow(Math.sin(dLng / 2), 2);
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** 答案正規化：全形轉半形、忽略大小寫、空白與常見標點 */
function norm_(s) {
  return String(s == null ? '' : s).normalize('NFKC').toLowerCase()
    .replace(/[\s.,!?'"`~\-_:;()\[\]{}<>\/\\，。、！？「」『』（）《》〈〉：；…‧·]/g, '');
}

function str_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}
function isNum_(v) { return typeof v === 'number' && isFinite(v); }
function num_(v, d) { if (v === '' || v === null || v === undefined) return d; var n = Number(v); return isFinite(n) ? n : d; }
function bool_(v) {
  if (typeof v === 'boolean') return v;
  return ['true', '1', 'yes', 'y', '是', 'v', 'o', '✓', '✔'].indexOf(String(v).trim().toLowerCase()) >= 0;
}
function defBool_(v, d) { return (v === '' || v === null || v === undefined) ? d : bool_(v); }
function date_(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  var d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}
function parseJson_(s, d) { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } }
function merge_(a, b) { var o = {}; [a, b].forEach(function (x) { Object.keys(x || {}).forEach(function (k) { o[k] = x[k]; }); }); return o; }
function pick_(obj, keys) { var o = {}; keys.forEach(function (k) { if (obj[k] !== undefined) o[k] = obj[k]; }); return o; }
function find_(arr, fn) { for (var i = 0; i < arr.length; i++) if (fn(arr[i])) return arr[i]; return undefined; }
function rand_(n, chars) {
  chars = chars || 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var s = '';
  for (var i = 0; i < n; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}
/** 隊伍代碼：第一碼一定是英文字母，避免被試算表當成數字 */
function genCode_() { return rand_(1, 'ABCDFGHJKLMNPQRSTUVWXYZ') + rand_(5); }

/* ===================== 試算表選單與初始化 ===================== */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🧩 實境解謎')
    .addItem('初始化／修復工作表', 'setup')
    .addItem('顯示管理密碼', 'showAdminKey')
    .addItem('重設管理密碼', 'resetAdminKey')
    .addItem('套用修改（清除快取）', 'clearCacheMenu')
    .addToUi();
}

/** 手動編輯試算表時，讓前台馬上讀到新資料 */
function onEdit() { try { bumpCache_(); } catch (e) { /* ignore */ } }

function setup() {
  Object.keys(SCHEMA).forEach(function (n) { ensureHeaders_(n); });
  applyFormats_();
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('ADMIN_KEY');
  if (!key) { key = rand_(12, 'abcdefghjkmnpqrstuvwxyz23456789'); props.setProperty('ADMIN_KEY', key); }
  if (readRows_('Projects').length === 0) seedDemo_();
  // 刪除預設的空白工作表
  ['工作表1', 'Sheet1'].forEach(function (n) {
    var sh = ss_().getSheetByName(n);
    if (sh && sh.getLastRow() === 0 && ss_().getSheets().length > 1) ss_().deleteSheet(sh);
  });
  bumpCache_();
  var msg = '初始化完成！\n\n管理密碼：' + key + '\n\n請記下來，登入後台 admin.html 時要用。';
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* 從編輯器執行時沒有 UI */ }
  Logger.log(msg);
  return key;
}

function showAdminKey() {
  var key = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY') || '（尚未初始化）';
  try { SpreadsheetApp.getUi().alert('管理密碼：' + key); } catch (e) { Logger.log(key); }
}

function resetAdminKey() {
  var key = rand_(12, 'abcdefghjkmnpqrstuvwxyz23456789');
  PropertiesService.getScriptProperties().setProperty('ADMIN_KEY', key);
  try { SpreadsheetApp.getUi().alert('新的管理密碼：' + key); } catch (e) { Logger.log(key); }
}

function clearCacheMenu() {
  bumpCache_();
  try { SpreadsheetApp.getUi().alert('已套用，前台會讀到最新資料。'); } catch (e) { /* ignore */ }
}

function applyFormats_() {
  Object.keys(SCHEMA).forEach(function (name) {
    var sh = sheet_(name), h = headers_(sh), maxRows = Math.max(sh.getMaxRows(), 2);
    (TEXT_COLUMNS[name] || []).forEach(function (col) {
      var ci = h.indexOf(col) + 1;
      if (ci) sh.getRange(2, ci, maxRows - 1, 1).setNumberFormat('@');
    });
    (BOOL_COLUMNS[name] || []).forEach(function (col) {
      var ci = h.indexOf(col) + 1;
      if (ci) sh.getRange(2, ci, Math.min(maxRows, 500) - 1, 1).insertCheckboxes();
    });
    var lists = {
      Projects: { status: PROJECT_STATUS, unlock_mode: ['sequential', 'free'] },
      Stages: { answer_type: ANSWER_TYPES }
    }[name] || {};
    Object.keys(lists).forEach(function (col) {
      var ci = h.indexOf(col) + 1;
      if (!ci) return;
      var rule = SpreadsheetApp.newDataValidation().requireValueInList(lists[col], true).setAllowInvalid(false).build();
      sh.getRange(2, ci, Math.min(maxRows, 500) - 1, 1).setDataValidation(rule);
    });
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, h.length).setFontWeight('bold').setBackground('#1f3b4d').setFontColor('#ffffff');
  });
}

function seedDemo_() {
  writeRow_('Projects', null, {
    project_id: 'demo', name: '示範：公園尋寶任務', status: 'active', is_default: true, unlock_mode: 'sequential',
    description: '三個關卡的示範專案，可以直接修改成你的場地。',
    intro: '歡迎來到尋寶任務！依照線索找到每個地點，抵達後按「我到了」打卡，就能解鎖題目。',
    finish_message: '恭喜完成所有任務！請回到集合點找關主領取獎勵。',
    time_limit_min: 60, gps_max_accuracy: 80, show_leaderboard: true, require_run_code: false, updated_at: new Date()
  });
  var base = { project_id: 'demo', enabled: true, show_location: true, require_gps: true, radius_m: 40, points: 10, hint_penalty: 2, updated_at: new Date() };
  [
    { stage_id: 's1', order: 1, title: '第一站：大門口', clue: '從公園的大門開始，找找入口旁的告示牌。', lat: 25.0326, lng: 121.5355,
      bypass_code: '1111', question: '告示牌上寫的開放時間，幾點開始？（輸入數字）', answer_type: 'number', answer: '6',
      hint1: '看看告示牌最上面一行', success_message: '答對！前往下一站。' },
    { stage_id: 's2', order: 2, title: '第二站：大樹下', clue: '找到公園裡最大的那棵樹。', lat: 25.0297, lng: 121.5363,
      bypass_code: '2222', question: '這棵樹的葉子是什麼形狀？', answer_type: 'choice', choices: '圓形|心形|針狀|掌狀', answer: '掌狀',
      max_attempts: 2, hint1: '撿一片落葉看看', hint2: '像一隻張開的手' },
    { stage_id: 's3', order: 3, title: '第三站：團體照', clue: '到水池旁邊集合。', lat: 25.0311, lng: 121.5341,
      bypass_code: '3333', question: '全隊在水池前拍一張團體照上傳。', answer_type: 'photo', points: 20, success_message: '照片收到了！' }
  ].forEach(function (s) { writeRow_('Stages', null, merge_(base, s)); });
}

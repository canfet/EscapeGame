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
var APP_VERSION = '1.1.0';
// 前台至少要是這個版本（前台每次呼叫都會帶自己的版本 fv）；太舊時回傳 front_stale，前台會提示重新整理
var MIN_FRONT = '1.1.0';
var CACHE_SEC = 30;                 // 專案／關卡資料快取秒數
var DEFAULT_GPS_MAX_ACCURACY = 80;  // 定位誤差超過幾公尺就不接受
var GPS_TOLERANCE_CAP = 20;         // 判定範圍最多額外放寬幾公尺（依手機回報的誤差）
var MAX_PHOTO_BYTES = 8 * 1024 * 1024;
var ANSWER_TYPES = ['text', 'number', 'choice', 'photo', 'form', 'none'];
var PROJECT_STATUS = ['active', 'hidden', 'draft', 'closed'];
var AVATARS = ['🦊', '🐼', '🐯', '🐸', '🦉', '🐙', '🦄', '🐳', '🦖', '🐧', '🐝', '🦋', '🐢', '🐬', '🦁', '🐰'];   // 隊伍造型
var RARITIES = ['normal', 'rare', 'legend'];
var DECK_KINDS = ['nature', 'place', 'custom'];       // 圖鑑類型：荒野自然名角色／在地景點與代表物／自訂
var DECK_STYLES = ['foil', 'classic', 'watercolor', 'pixel'];   // 卡面畫風：閃卡／古典標本／水彩／像素
var CARD_TYPES = ['forest', 'water', 'sky', 'mountain', 'grass', 'ocean', 'night', 'earth'];   // 卡牌屬性
var THEMES = ['retro', 'history', 'sport', 'mist', 'forest', 'neon', 'campus', 'ocean'];   // 前台畫面風格

/* 各工作表欄位（可以在試算表後面自行加欄位，不影響程式） */
var SCHEMA = {
  Projects: ['project_id', 'name', 'status', 'is_default', 'unlock_mode', 'description', 'intro',
    'finish_message', 'cover_url', 'theme', 'routes', 'teams', 'start_at', 'end_at', 'time_limit_min', 'gps_max_accuracy',
    'show_leaderboard', 'leaderboard_live', 'require_run_code', 'wrong_lock_after', 'wrong_lock_sec', 'collect_message', 'deck_id', 'updated_at'],
  Stages: ['project_id', 'stage_id', 'order', 'enabled', 'title', 'clue', 'image_url', 'lat', 'lng',
    'radius_m', 'show_location', 'require_gps', 'bypass_code', 'question', 'show_question_early', 'require_photo', 'reward_code', 'reward_order', 'final_from_fragments', 'coop_final', 'item_name', 'item_icon', 'item_rarity', 'item_story', 'card_id', 'card_random', 'routes', 'answer_type', 'choices',
    'answer', 'points', 'max_attempts', 'hint1', 'hint2', 'hint3', 'hint_penalty', 'success_message',
    'form_url', 'form_verify_sheet', 'updated_at'],
  Sessions: ['session_id', 'code', 'project_id', 'run_code', 'team_name', 'avatar', 'route', 'test', 'status', 'score',
    'started_at', 'last_active_at', 'finished_at', 'last_lat', 'last_lng', 'progress_json', 'user_agent'],
  Decks: ['deck_id', 'title', 'kind', 'style', 'cards', 'updated_at'],
  Submissions: ['timestamp', 'session_id', 'code', 'project_id', 'run_code', 'team_name', 'route', 'stage_id',
    'stage_title', 'action', 'input', 'result', 'points', 'lat', 'lng', 'accuracy_m', 'distance_m',
    'file_url', 'note']
};

/* 要強制為「純文字」格式的欄位（避免 007 變成 7） */
var TEXT_COLUMNS = {
  Projects: ['project_id', 'name', 'description', 'intro', 'finish_message', 'cover_url', 'collect_message', 'deck_id', 'routes', 'teams'],
  Decks: ['deck_id', 'title', 'cards'],
  Stages: ['project_id', 'stage_id', 'title', 'clue', 'image_url', 'bypass_code', 'question', 'answer', 'choices', 'hint1', 'hint2', 'hint3',
    'success_message', 'form_url', 'form_verify_sheet', 'reward_code', 'item_name', 'item_icon', 'item_story', 'card_id', 'routes'],
  Sessions: ['session_id', 'code', 'project_id', 'run_code', 'team_name', 'avatar', 'route', 'user_agent'],
  Submissions: ['session_id', 'code', 'project_id', 'run_code', 'team_name', 'stage_id', 'stage_title', 'input', 'result', 'note']
};
/* 要強制成「數字」格式的欄位（避免試算表把 1、2 當成日期或時間） */
var NUMBER_COLUMNS = {
  Projects: ['time_limit_min', 'gps_max_accuracy', 'wrong_lock_after', 'wrong_lock_sec'],
  Stages: ['order', 'lat', 'lng', 'radius_m', 'points', 'max_attempts', 'hint_penalty', 'reward_order', 'card_random']
};
var BOOL_COLUMNS = {
  Projects: ['is_default', 'show_leaderboard', 'leaderboard_live', 'require_run_code'],
  Stages: ['enabled', 'show_location', 'require_gps', 'show_question_early', 'require_photo', 'final_from_fragments', 'coop_final']
};

/* ===================== API 路由 ===================== */
var ROUTES = {
  ping: function () { return { version: APP_VERSION, time: new Date() }; },
  // 前台（不需登入）
  listProjects: listProjects_,
  getProject: getProject_,
  startSession: startSession_,
  getSession: getSession_,
  resumeSession: resumeSession_,
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
  adminDeleteSession: admin_(adminDeleteSession_),
  adminSetRoute: admin_(adminSetRoute_),
  adminResetFailed: admin_(adminResetFailed_),
  adminSaveDeck: admin_(adminSaveDeck_),
  adminImportImage: admin_(adminImportImage_),
  adminGetTestToken: admin_(adminGetTestToken_),
  adminClearTests: admin_(adminClearTests_),
  adminCheckProject: admin_(adminCheckProject_),
  adminListDecks: admin_(adminListDecks_),
  adminDeleteDeck: admin_(adminDeleteDeck_)
};

/** 版本比較："1.10.0" vs "1.9.0"，回傳 -1／0／1 */
function cmpVer_(a, b) {
  var x = String(a).split('.'), y = String(b).split('.');
  for (var i = 0; i < Math.max(x.length, y.length); i++) {
    var m = parseInt(x[i] || '0', 10) || 0, n = parseInt(y[i] || '0', 10) || 0;
    if (m !== n) return m < n ? -1 : 1;
  }
  return 0;
}

function doGet(e) {
  return json_({ ok: true, app: '實境解謎', version: APP_VERSION, time: new Date() });
}

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var fn = ROUTES[body.action];
    if (!fn) throw appError_('不支援的動作：' + body.action, 'BAD_ACTION');
    var result = fn(body) || {};
    result.ok = true;
    // 版本資訊：前台比對後端是否過舊；後端也回報前台是否過舊
    result.version = APP_VERSION;
    result.front_stale = cmpVer_(body.fv || '0', MIN_FRONT) < 0;
    return json_(result);
  } catch (err) {
    return json_({ ok: false, error: (err && err.message) || String(err), code: (err && err.code) || 'ERROR', version: APP_VERSION });
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
  checkPlayable_(p, isTestToken_(b.tt));
  // 專屬 QR Code 帶來的隊伍／路線：回傳可顯示的名稱，或標示代碼不正確（不暴露其他路線的代碼）
  var info = null, team = str_(b.team), route = str_(b.route);
  if (team && p.teams.length) {
    var t = find_(p.teams, function (x) { return x.name === team; });
    var rt0 = t ? routeById_(p, t.route) : null;
    info = t ? { team: t.name, route_name: rt0 ? rt0.name : '', color: rt0 ? rt0.color : '' } : { bad: 'team' };
  } else if (route && p.routes.length) {
    var rt1 = routeById_(p, route);
    info = rt1 ? { route_name: rt1.name, color: rt1.color } : { bad: 'route' };
  }
  return { project: publicProject_(p, stages_(p.project_id)), link_info: info };
}

function startSession_(b) {
  return withLock_(function () {
    var p = findProject_(b.projectId);
    var isTest = bool_(b.test) && isTestToken_(b.tt);   // 試玩：需要後台給的金鑰，不會計入排行榜與正式人數
    checkPlayable_(p, isTest);
    var team = noFormula_(b.teamName).trim().slice(0, 30);
    if (!team) throw appError_('請輸入隊伍名稱（不能以 = + - @ 開頭）', 'BAD_INPUT');
    if (rateHit_('st_' + p.project_id, RATE.startPerMin, 60)) throw appError_('現在太多人同時開始了，請稍等幾秒再按一次', 'RATE');
    var run = str_(b.runCode).slice(0, 30);
    if (p.require_run_code && !run) throw appError_('請輸入場次代碼（請向關主索取）', 'NEED_RUN_CODE');
    var now = new Date();
    // 隊伍與路線：
    //  ‧ 專案有「預設隊伍名單」：只能選名單內的隊伍，路線由名單決定（網址上的 route 一律不採用，避免被改）
    //  ‧ 沒有名單、但有路線：用連結（專屬 QR Code）帶的路線代碼，沒帶就平均分配
    var route = '', preset = null, avatarWant = str_(b.avatar);
    if (p.teams.length) {
      preset = find_(p.teams, function (t) { return t.name === team; });
      if (!preset) throw appError_('請從名單中選擇隊伍名稱', 'BAD_TEAM');
      team = preset.name;
      // 同一場次、同一個隊伍名稱已經開始：直接接續（同隊的其他手機也能加入）
      var dup = find_(readRows_('Sessions'), function (r) {
        return str_(r.project_id) === p.project_id && str_(r.run_code) === run && str_(r.team_name) === team && bool_(r.test) === isTest;
      });
      if (dup) {
        var st0 = buildState_(ctx_({ sessionId: str_(dup.session_id) }, false));
        st0.resumed = true;
        return st0;
      }
      route = preset.route;
      avatarWant = preset.avatar || avatarWant;
    }
    if (p.routes.length) {
      if (!route) {
        var want = str_(b.route).slice(0, 20);
        if (want && !preset) {
          if (!routeById_(p, want)) throw appError_('連結裡的路線代碼不正確，請向關主確認 QR Code', 'BAD_ROUTE');
          route = want;
        } else {
          route = pickRoute_(p, run);
        }
      }
      ensureHeaders_('Sessions');
    }
    ensureHeaders_('Sessions');
    // 隊伍造型：玩家挑的（或名單指定的）；沒挑就依目前隊伍數輪流分配
    var avatar = AVATARS.indexOf(avatarWant) >= 0 ? avatarWant : AVATARS[readRows_('Sessions').filter(function (r) { return str_(r.project_id) === p.project_id; }).length % AVATARS.length];
    var s = {
      session_id: Utilities.getUuid(),
      code: uniqueCode_(p.project_id),
      project_id: p.project_id,
      run_code: run,
      team_name: team,
      avatar: avatar,
      route: route,
      test: isTest,
      status: 'playing',
      score: 0,
      started_at: now,
      last_active_at: now,
      finished_at: '',
      progress_json: '{}',
      user_agent: noFormula_(b.userAgent).slice(0, 200)
    };
    writeRow_('Sessions', null, s);
    var saved = loadSession_(s.session_id);
    var c = { s: saved, p: p, stages: routeStages_(p, stages_(p.project_id), saved.route), now: now };
    log_(c, null, 'start', {});
    return buildState_(c);
  });
}

/** 用隊伍代碼接續進度：瀏覽器資料被清掉、換手機時用 */
function resumeSession_(b) {
  var p = findProject_(b.projectId);
  if (!p) throw appError_('找不到這個闖關專案', 'NOT_FOUND');
  var code = str_(b.code).toUpperCase().replace(/\s+/g, '');
  if (rateBlocked_('res_' + p.project_id, RATE.resumeFail)) throw appError_('輸入錯誤次數過多，請 10 分鐘後再試', 'TOO_MANY');
  var row = code ? find_(readRows_('Sessions'), function (r) {
    return str_(r.project_id) === p.project_id && str_(r.code).toUpperCase() === code && (!bool_(r.test) || isTestToken_(b.tt));
  }) : null;
  if (!row) { rateHit_('res_' + p.project_id, RATE.resumeFail, 600); Utilities.sleep(600); throw appError_('找不到這個隊伍代碼，請確認有沒有輸入正確', 'NO_CODE'); }
  return buildState_(ctx_({ sessionId: str_(row.session_id) }, false));
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
        var cwait = lockLeft_(c, g, 'code');
        if (cwait > 0) throw appError_('通關碼輸錯太多次了，請等 ' + cwait + ' 秒後再試', 'WAIT');
        if (!st.bypass_code || norm_(code) !== norm_(st.bypass_code)) {
          var csec = lockFail_(c, g, 'code');
          saveSession_(c);   // 先存下輸錯次數，下面才丟錯誤
          log_(c, st, 'arrive', { input: code, result: 'wrong_code' });
          throw appError_('通關碼不正確' + (csec ? '，連續輸錯，請等 ' + csec + ' 秒後再試' : ''), 'WRONG_CODE');
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
    var g = prog_(c, st);
    var wait = lockLeft_(c, g, 'ans');
    if (wait > 0) throw appError_('答錯太多次了，請等 ' + wait + ' 秒後再試', 'WAIT');
    var ans = str_(b.answer).slice(0, 500);
    if (!ans) throw appError_('請輸入答案', 'BAD_INPUT');
    if (st.require_photo) checkPhoto_(b.dataUrl);   // 要求附照片：沒附就不計入作答次數
    if (st.final_from_fragments || st.coop_final) {   // 最後一關：沒集齊碎片不能作答（也不計入次數）
      var miss = fragmentList_(c).filter(function (f) { return !f.got; }).length;
      if (miss > 0) throw appError_('還差 ' + miss + ' 個密碼碎片，請先完成其他關卡', 'NEED_FRAGMENTS');
    }

    g.attempts = (g.attempts || 0) + 1;
    var ok = st.coop_final ? checkCoop_(c, st, ans) : st.final_from_fragments ? checkFragments_(c, st, ans) : checkAnswer_(st, ans);
    var msg;
    if (ok) {
      if (st.require_photo) g.fileUrl = savePhoto_(c, st, b.dataUrl, ans);
      solve_(c, st, g);
      g.ansStreak = 0;
      msg = st.success_message || (str_(st.answer) ? '答對了！' : '已收到你們的答案！');
    } else if (st.max_attempts > 0 && g.attempts >= st.max_attempts) {
      g.failed = true; g.failedAt = c.now.toISOString(); g.points = 0;
      msg = '作答次數已用完，這一關不計分，繼續前進吧！';
    } else {
      var left = st.max_attempts > 0 ? '（還剩 ' + (st.max_attempts - g.attempts) + ' 次機會）' : '';
      var lockSec = lockFail_(c, g, 'ans');
      msg = '答案不正確，再想想看' + left + (lockSec ? '。連續答錯，暫停作答 ' + lockSec + ' 秒' : '');
    }
    finishIfDone_(c);
    saveSession_(c);
    log_(c, st, 'answer', { input: ans, result: ok ? 'correct' : (g.failed ? 'failed' : 'wrong'), points: ok ? g.points : '', file_url: ok && g.fileUrl ? g.fileUrl : '' });
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

/** 驗證並把 dataUrl 照片存進雲端硬碟，回傳檔案網址 */
function savePhoto_(c, st, dataUrl, caption) {
  var m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m) throw appError_('照片格式不正確', 'BAD_INPUT');
  var bytes = Utilities.base64Decode(m[2]);
  if (bytes.length > MAX_PHOTO_BYTES) throw appError_('照片太大了，請重新拍攝', 'TOO_LARGE');
  var ext = m[1].split('/')[1].replace('jpeg', 'jpg');
  var name = [c.p.project_id, c.s.run_code || 'run', c.s.team_name, st.stage_id,
    Utilities.formatDate(c.now, Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss')].join('_') + '.' + ext;
  var file = folder_(c.p.project_id).createFile(Utilities.newBlob(bytes, m[1], name));
  file.setDescription('隊伍：' + c.s.team_name + '｜代碼：' + c.s.code + '｜關卡：' + st.title + '｜' + str_(caption));
  return file.getUrl();
}

/** 先檢查照片格式與大小（不存檔），避免答案送出後才發現照片有問題 */
function checkPhoto_(dataUrl) {
  var m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m) throw appError_('這一關需要同時上傳照片，請先選擇一張照片', 'NEED_PHOTO');
  if (m[2].length * 0.75 > MAX_PHOTO_BYTES) throw appError_('照片太大了，請重新拍攝', 'TOO_LARGE');
}

function uploadPhoto_(b) {
  return withLock_(function () {
    var c = ctx_(b, true);
    var st = getStage_(c, b.stageId);
    var status = statusOf_(c, st);
    if (status === 'solved') return buildState_(c, { message: '這一關已經完成了' });
    if (status !== 'arrived') throw appError_('請先抵達關卡地點', 'NOT_ARRIVED');
    if (st.answer_type !== 'photo') throw appError_('這一關不需要上傳照片', 'BAD_TYPE');
    var fileUrl = savePhoto_(c, st, b.dataUrl, b.caption);
    var g = prog_(c, st);
    g.fileUrl = fileUrl;
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

/**
 * 後台：把網路上的圖片（只允許維基媒體 upload.wikimedia.org）下載後存到雲端硬碟，回傳雲端硬碟網址。
 * 這樣活動當天不用依賴外部網站，也不會因為很多人同時看圖而被擋。
 */
function adminImportImage_(b) {
  var url = str_(b.url);
  if (!/^https:\/\/upload\.wikimedia\.org\/[A-Za-z0-9_\-.\/%()~,+:;@!'*]+$/.test(url)) throw appError_('只能匯入維基媒體（upload.wikimedia.org）的圖片', 'BAD_INPUT');
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true, headers: { 'User-Agent': 'GPS-Quest-Deck/1.0 (educational event tool)' } });
  if (res.getResponseCode() !== 200) throw appError_('下載圖片失敗（' + res.getResponseCode() + '）', 'FETCH_FAILED');
  var type = String(res.getHeaders()['Content-Type'] || res.getHeaders()['content-type'] || '');
  if (!/^image\/(jpeg|png|webp|gif)/.test(type)) throw appError_('下載到的不是圖片', 'FETCH_FAILED');
  var bytes = res.getContent();
  if (bytes.length > 5 * 1024 * 1024) throw appError_('圖片太大（上限 5 MB）', 'TOO_LARGE');
  var ext = type.split('/')[1].split(';')[0].replace('jpeg', 'jpg');
  var parent = folder_('decks'), it = parent.getFoldersByName('_images');
  var dir = it.hasNext() ? it.next() : parent.createFolder('_images');
  var file = dir.createFile(Utilities.newBlob(bytes, type.split(';')[0], 'wm_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss') + '_' + rand_(4, 'abcdefghjkmnpqrstuvwxyz23456789') + '.' + ext));
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

/**
 * 排行榜。
 *  ‧ 一般（完成頁）：專案開啟「完成後顯示排行榜」才能看。
 *  ‧ board:true（即時排行榜／大螢幕頁面）：專案開啟「即時排行榜」才能看，會列出所有隊伍與目前進度。
 *  只回傳路線「名稱與顏色」，不回傳路線代碼；也不會透露目前關卡的名稱或位置。
 */
function leaderboard_(b) {
  var p = findProject_(b.projectId);
  if (!p) throw appError_('找不到這個闖關專案', 'NOT_FOUND');
  var nowLb = new Date(), fmtLb = function (d) { return Utilities.formatDate(new Date(d), Session.getScriptTimeZone(), 'M/d HH:mm'); };
  if (p.start_at && new Date(p.start_at) > nowLb) throw appError_('排行榜尚未開放（活動 ' + fmtLb(p.start_at) + ' 開始）', 'NOT_OPEN');
  if (p.end_at && new Date(p.end_at) < nowLb) throw appError_('活動已經結束，排行榜已關閉', 'CLOSED');
  if (b.board) {
    if (!p.leaderboard_live) throw appError_('關主尚未開放即時排行榜', 'DISABLED');
  } else if (!p.show_leaderboard) {
    throw appError_('此專案未開放排行榜', 'DISABLED');
  }
  var run = str_(b.runCode), onlyRoute = str_(b.route);
  // 同一份排行榜結果快取 10 秒（上面的開放與時間檢查每次都會做，不受快取影響）
  var lbKey = 'v' + cacheVer_() + '_lb_' + p.project_id + '_' + run + '_' + onlyRoute, lbCache = CacheService.getScriptCache();
  var lbHit = lbCache.get(lbKey);
  if (lbHit) { try { return JSON.parse(lbHit); } catch (e) { /* 壞掉就重算 */ } }
  var allStages = stages_(p.project_id);
  var now = new Date();
  var rows = readRows_('Sessions').filter(function (r) {
    return str_(r.project_id) === p.project_id && !bool_(r.test) && (!run || str_(r.run_code) === run) && (!onlyRoute || str_(r.route) === onlyRoute);
  }).map(function (r) {
    var prog = parseJson_(r.progress_json, {});
    var rt = routeById_(p, r.route);
    var stages = routeStages_(p, allStages, str_(r.route));
    var solved = 0, done = 0;
    stages.forEach(function (s) {
      var g0 = prog[s.stage_id] || {};
      if (g0.solvedAt) { solved++; done++; } else if (g0.failed) done++;
    });
    var st = date_(r.started_at), fi = date_(r.finished_at), la = date_(r.last_active_at);
    var lbBadges = badgesOf_({ p: p, stages: stages, s: { progress: prog, status: str_(r.status), started_at: r.started_at, finished_at: r.finished_at } }).map(function (x) { return { icon: x.icon, name: x.name }; });
    return {
      team_name: str_(r.team_name), route_name: rt ? rt.name : '', route_color: rt ? rt.color : '',
      avatar: str_(r.avatar), badges: lbBadges, title: titleOf_(lbBadges.length),
      score: num_(r.score, 0), solved: solved, done: done, total: stages.length,
      status: str_(r.status), duration_sec: st && fi ? Math.round((fi - st) / 1000) : null,
      elapsed_sec: st ? Math.round(((fi || now) - st) / 1000) : null,
      last_active_at: la ? la.toISOString() : ''
    };
  });
  rows.sort(function (a, b2) {
    if (b2.score !== a.score) return b2.score - a.score;
    if (b2.solved !== a.solved) return b2.solved - a.solved;
    var da = a.duration_sec == null ? 1e12 : a.duration_sec, db = b2.duration_sec == null ? 1e12 : b2.duration_sec;
    return da - db;
  });
  var lbOut = {
    leaderboard: rows.slice(0, 100), server_time: now.toISOString(),
    routes: p.routes.map(function (r) { return { name: r.name, color: r.color }; })
  };
  try { lbCache.put(lbKey, JSON.stringify(lbOut), 10); } catch (e) { /* 太大就不快取 */ }
  return lbOut;
}

/* ===================== 後台 API ===================== */

function admin_(fn) {
  return function (b) {
    var key = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
    // 防止暴力猜密碼：15 分鐘內錯 10 次就整個鎖住（連正確密碼也暫時不收），15 分鐘後自動解除
    if (rateBlocked_('adm', RATE.adminFail)) {
      Utilities.sleep(800);
      throw appError_('密碼錯誤次數過多，已暫時鎖定，請 15 分鐘後再試', 'TOO_MANY');
    }
    if (!key || str_(b.adminKey) !== key) {
      rateHit_('adm', RATE.adminFail, 900);
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
    p.session_count = sessions.filter(function (s) { return str_(s.project_id) === p.project_id && !bool_(s.test); }).length;
    // 「正在玩」：狀態是進行中，而且 6 小時內有操作過（昨天沒玩完的不算）
    var recent = Date.now() - 6 * 3600 * 1000;
    p.playing_count = sessions.filter(function (s) {
      var la = date_(s.last_active_at);
      return str_(s.project_id) === p.project_id && !bool_(s.test) && str_(s.status) === 'playing' && la && la.getTime() >= recent;
    }).length;
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
    if (p.theme && THEMES.indexOf(p.theme) < 0) throw appError_('畫面風格不正確', 'BAD_INPUT');
    ensureHeaders_('Projects');   // 舊試算表若缺新欄位（例如 theme），先補上，設定才會被存下來
    var rows = readRows_('Projects');
    var ex = find_(rows, function (r) { return str_(r.project_id) === id; });
    if (b.isNew && ex) throw appError_('專案代碼「' + id + '」已經存在', 'DUPLICATE');
    if (!b.isNew && !ex) throw appError_('找不到專案', 'NOT_FOUND');
    var data = pick_(p, SCHEMA.Projects);
    data.project_id = id;
    var routesNow = ex ? parseRoutes_(ex.routes) : [];
    if ('routes' in data) {
      var rts = parseRoutes_(data.routes);
      var seenR = {};
      rts.forEach(function (r) {
        var nm = str_(r.name).trim();
        if (nm && seenR[nm]) throw appError_('路線名稱「' + nm + '」重複了，請修改後再儲存', 'BAD_INPUT');
        seenR[nm] = 1;
      });
      rts.forEach(function (r) {
        if (!/^[A-Za-z0-9_-]{4,20}$/.test(r.id)) throw appError_('路線代碼格式不正確（4–20 字，英數字、底線、連字號）：' + r.id, 'BAD_INPUT');
      });
      data.routes = rts.length ? JSON.stringify(rts) : '';
      routesNow = rts;
    }
    if ('deck_id' in data && str_(data.deck_id) && !find_(decks_(), function (d) { return d.deck_id === str_(data.deck_id); })) throw appError_('找不到這本圖鑑', 'BAD_INPUT');
    if ('teams' in data) {
      var rawTeams = Array.isArray(data.teams) ? data.teams : parseJson_(data.teams, []);
      var seenT = {};
      (Array.isArray(rawTeams) ? rawTeams : []).forEach(function (x) {
        var nm = str_(x && x.name).trim().slice(0, 30);
        if (!nm) return;
        if (seenT[nm]) throw appError_('隊伍名單裡「' + nm + '」重複了，請修改後再儲存', 'BAD_INPUT');
        seenT[nm] = 1;
      });
      var tms = parseTeams_(data.teams, routesNow);
      data.teams = tms.length ? JSON.stringify(tms) : '';
    }
    ['start_at', 'end_at'].forEach(function (k) { if (k in data) data[k] = data[k] ? (date_(data[k]) || '') : ''; });
    data.updated_at = new Date();
    if (bool_(data.is_default)) {
      rows.forEach(function (r) {
        if (str_(r.project_id) !== id && bool_(r.is_default)) writeRow_('Projects', r._row, { is_default: false });
      });
    }
    writeRow_('Projects', ex ? ex._row : null, data);
    bumpCache_();
    // 從「非開放」改成「開放中」前先檢查：有嚴重錯誤就退回「準備中」（除非關主確認仍要開放 force）
    var res = { project_id: id };
    if (str_(data.status) === 'active' && (!ex || str_(ex.status) !== 'active') && !bool_(b.force)) {
      var chk = checkProject_(findProject_(id));
      var errs = chk.items.filter(function (x) { return x.level === 'error'; });
      if (errs.length) {
        var saved = find_(readRows_('Projects'), function (r) { return str_(r.project_id) === id; });
        if (saved) writeRow_('Projects', saved._row, { status: 'draft' });
        bumpCache_();
        res.blocked = true;
        res.errors = errs.map(function (x) { return x.text; });
      }
    }
    return res;
  });
}

function adminDeleteProject_(b) {
  return withLock_(function () {
    var id = str_(b.projectId);
    // 刪整個專案：一定要在請求裡帶一次專案代碼確認（前台會要求輸入），避免誤觸或亂呼叫
    if (!id || str_(b.confirmId) !== id) throw appError_('刪除專案需要輸入專案代碼確認', 'NEED_CONFIRM');
    var bk = backupSheets_('刪專案', ['Projects', 'Stages']);
    var n = deleteRows_('Projects', function (r) { return str_(r.project_id) === id; });
    var m = deleteRows_('Stages', function (r) { return str_(r.project_id) === id; });
    bumpCache_();
    return { deleted_projects: n, deleted_stages: m, backup: bk };
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
      start_at: date_(src.start_at) || '', end_at: date_(src.end_at) || '',
      routes: src.routes && src.routes.length ? JSON.stringify(src.routes) : '',
      teams: src.teams && src.teams.length ? JSON.stringify(src.teams) : ''
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
    var latN = num_(s.lat, NaN), lngN = num_(s.lng, NaN);
    if (isFinite(latN) && Math.abs(latN) > 90) throw appError_('緯度要在 -90～90 之間（台灣約 21～26）。看起來經度和緯度填反了嗎？', 'BAD_INPUT');
    if (isFinite(lngN) && Math.abs(lngN) > 180) throw appError_('經度要在 -180～180 之間（台灣約 119～123）', 'BAD_INPUT');
    var rows = readRows_('Stages');
    var mine = rows.filter(function (r) { return str_(r.project_id) === pid; });
    var ex = find_(mine, function (r) { return str_(r.stage_id) === id; });
    if (b.isNew && ex) throw appError_('關卡代碼重複', 'DUPLICATE');
    var data = pick_(s, SCHEMA.Stages);
    data.project_id = pid; data.stage_id = id; data.answer_type = type;
    if ('routes' in data) data.routes = str_(data.routes).split('|').map(function (t) { return t.trim(); }).filter(function (t) { return /^[A-Za-z0-9_-]{1,20}(:\d+(\.\d+)?)?$/.test(t); }).join('|');
    if (!ex && !num_(data.order, 0)) {
      data.order = mine.reduce(function (m, r) { return Math.max(m, num_(r.order, 0)); }, 0) + 1;
    }
    data.updated_at = new Date();
    writeRow_('Stages', ex ? ex._row : null, data);
    bumpCache_();
    var warnings = [];
    if (bool_(s.require_gps) && (!isFinite(num_(s.lat, NaN)) || !isFinite(num_(s.lng, NaN)))) warnings.push('需要 GPS 但尚未設定座標');
    if (type === 'choice' && !str_(s.choices)) warnings.push('選擇題尚未設定選項');
    if (bool_(s.final_from_fragments) && str_(s.reward_code)) warnings.push('最後一關不需要設定「過關碎片」，已忽略');
    if (str_(s.reward_code) && !bool_(s.final_from_fragments)) {
      var myRoutes = Object.keys(stageRouteMap_({ routes: data.routes }));
      var dup = mine.filter(function (r) {
        if (str_(r.stage_id) === id || !str_(r.reward_code) || bool_(r.final_from_fragments)) return false;
        if (num_(r.reward_order, null) !== num_(s.reward_order, null)) return false;
        var o = Object.keys(stageRouteMap_(r));
        return !myRoutes.length || !o.length || o.some(function (k) { return myRoutes.indexOf(k) >= 0; });
      });
      if (dup.length) warnings.push('「碎片順序」與關卡「' + str_(dup[0].title) + '」重複，碎片會依關卡順序排列');
    }
    if ((type === 'text' || type === 'number' || type === 'choice') && !str_(s.answer)) warnings.push('未設定答案：任何答案都會通過');
    return { stage_id: id, warnings: warnings };
  });
}

function adminDeleteStage_(b) {
  return withLock_(function () {
    var bk = backupSheets_('刪關卡', ['Stages']);
    var n = deleteRows_('Stages', function (r) {
      return str_(r.project_id) === str_(b.projectId) && str_(r.stage_id) === str_(b.stageId);
    });
    bumpCache_();
    return { deleted: n, backup: bk };
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
  var allStages = stages_(p.project_id);
  var list = readRows_('Sessions').filter(function (r) {
    return str_(r.project_id) === p.project_id && (!run || str_(r.run_code) === run);
  }).map(function (r) {
    var prog = parseJson_(r.progress_json, {});
    var stages = routeStages_(p, allStages, str_(r.route));
    var c = { p: p, stages: stages, s: { progress: prog } };
    var sts = stageStatuses_(c);
    var solved = 0, current = '', failedN = 0;
    stages.forEach(function (s) {
      if (sts[s.stage_id] === 'failed') failedN++;
      if (sts[s.stage_id] === 'solved') solved++;
      else if (!current && (sts[s.stage_id] === 'open' || sts[s.stage_id] === 'arrived')) current = s.title;
    });
    return {
      session_id: str_(r.session_id), code: str_(r.code), team_name: str_(r.team_name), avatar: str_(r.avatar), route: str_(r.route), test: bool_(r.test),
      run_code: str_(r.run_code), status: str_(r.status), score: num_(r.score, 0), solved: solved, failed: failedN, total: stages.length,
      current_stage: current, started_at: r.started_at, last_active_at: r.last_active_at, finished_at: r.finished_at,
      last_lat: num_(r.last_lat, null), last_lng: num_(r.last_lng, null)
    };
  });
  list.sort(function (a, c2) { return (date_(c2.last_active_at) || 0) - (date_(a.last_active_at) || 0); });
  var runs = {};
  readRows_('Sessions').forEach(function (r) { if (str_(r.project_id) === p.project_id && str_(r.run_code)) runs[str_(r.run_code)] = 1; });
  return { sessions: list, run_codes: Object.keys(runs), stages: allStages, routes: p.routes };
}

function adminSubmissions_(b) {
  var pid = str_(b.projectId), run = str_(b.runCode), limit = Math.min(num_(b.limit, 200), 1000);
  var rows = readTailRows_('Submissions', 3000).filter(function (r) {
    return str_(r.project_id) === pid && (!run || str_(r.run_code) === run);
  });
  return {
    submissions: rows.slice(-limit).reverse().map(function (r) { delete r._row; return r; })
  };
}

function adminDeleteSession_(b) {
  return withLock_(function () {
    var sid = str_(b.sessionId);
    if (!sid) throw appError_('缺少隊伍編號', 'BAD_INPUT');
    var bk = backupSheets_('刪隊伍', ['Sessions', 'Submissions']);
    var n = deleteRows_('Sessions', function (r) { return str_(r.session_id) === sid; });
    // 連同這支隊伍的作答紀錄（打卡、答題、提示、照片…）一併刪除
    var m = deleteRows_('Submissions', function (r) { return str_(r.session_id) === sid; });
    bumpCache_();
    return { deleted: n, deleted_submissions: m, backup: bk };
  });
}

/* ===================== 遊戲邏輯 ===================== */

function ctx_(b, mutate) {
  var s = loadSession_(b.sessionId);
  var p = findProject_(s.project_id);
  if (!p) throw appError_('這個闖關專案已被移除', 'NOT_FOUND');
  var c = { s: s, p: p, stages: routeStages_(p, stages_(p.project_id), s.route), now: new Date() };
  // 隊伍已「完賽」之後，後台又新增了還沒完成的關卡：重新開放闖關（否則新關卡無法作答）
  if (s.status === 'finished' && c.stages.length) {
    var sts0 = stageStatuses_(c);
    var pending0 = c.stages.some(function (x) { return sts0[x.stage_id] !== 'solved' && sts0[x.stage_id] !== 'failed'; });
    if (pending0) { s.status = 'playing'; s.finished_at = ''; }
  }
  if (mutate) {
    if (rateHit_('s_' + s.session_id, RATE.sessionPerMin, 60)) throw appError_('操作太頻繁了，請稍等幾秒再試', 'RATE');
    checkPlayable_(p, bool_(s.test));
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
  if (!g.cards) g.cards = pickCards_(c, st);
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
        run_code: c.s.run_code, route: c.s.route || '', avatar: c.s.avatar || '', test: !!c.s.test, status: c.s.status, score: score_(c),
        started_at: date_(c.s.started_at), finished_at: date_(c.s.finished_at) || null, deadline: dl,
        server_time: new Date()
      },
      project: ownProject_(c),
      stages: list,
      fragments: fragmentList_(c),
      collection: collectionList_(c),
      badges: badgesOf_(c),
      title: titleOf_(badgesOf_(c).length),
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
    show_location: st.show_location, require_photo: !!st.require_photo, uses_fragments: !!(st.final_from_fragments || st.coop_final), coop: !!st.coop_final, hints_total: hints.length, hints: hints.slice(0, used),
    hint_penalty: st.hint_penalty, attempts: g.attempts || 0, max_attempts: st.max_attempts
  };
  if (st.final_from_fragments || st.coop_final) o.fragments_missing = fragmentList_(c).filter(function (f) { return !f.got; }).length;
  if (st.coop_final) o.coop_parts = coopParts_(c).map(function (x) { return { route_name: x.route_name, color: x.color, own: x.own, count: x.count }; });
  if (status === 'locked') return o;
  o.wait_sec = lockLeft_(c, g, 'ans');
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
  if (status === 'solved') { o.success_message = st.success_message; o.file_url = g.fileUrl || ''; if (str_(st.reward_code) && !st.final_from_fragments && !st.coop_final) o.reward_code = str_(st.reward_code);
    if (g.cards && g.cards.length) {
      var deckNow = c.p.cards || [];
      o.cards_new = g.cards.map(function (id) {
        for (var di = 0; di < deckNow.length; di++) if (deckNow[di].id === id) return cardFull_(deckNow[di], di + 1);
        return null;
      }).filter(function (x) { return x; });
    }
    if (str_(st.item_name) || str_(st.item_icon)) o.item = { name: str_(st.item_name) || '收藏品', icon: str_(st.item_icon), rarity: RARITIES.indexOf(st.item_rarity) >= 0 ? st.item_rarity : 'normal', story: str_(st.item_story) }; }
  return o;
}

function fillTemplate_(url, c) {
  var map = { code: c.s.code, team: c.s.team_name, project: c.p.project_id, run: c.s.run_code || '' };
  return url.replace(/\{(code|team|project|run)\}/g, function (_, k) { return encodeURIComponent(map[k]); });
}

/** 闖關中的專案資訊：只帶這支隊伍自己的路線（含代碼），不暴露其他路線 */
function ownProject_(c) {
  var o = publicProject_(c.p, c.stages);
  var rt = routeById_(c.p, c.s.route);
  o.routes = rt ? [rt] : [];
  delete o.teams;
  return o;
}

function publicProject_(p, stages) {
  return {
    project_id: p.project_id, name: p.name, description: p.description, intro: p.intro, cover_url: p.cover_url, theme: p.theme,
    restrict_teams: !!(p.teams && p.teams.length),
    teams: (p.teams || []).map(function (t) { var rt = routeById_(p, t.route); return { name: t.name, route_name: rt ? rt.name : '', color: rt ? rt.color : '', avatar: t.avatar || '' }; }),
    avatars: AVATARS, collect_message: p.collect_message || '', deck_title: p.deck_title || '', deck_size: (p.cards || []).length, deck_kind: p.deck_kind || 'nature', deck_style: p.deck_style || 'foil',
    unlock_mode: p.unlock_mode, time_limit_min: p.time_limit_min, show_leaderboard: p.show_leaderboard, leaderboard_live: !!p.leaderboard_live,
    require_run_code: p.require_run_code, is_default: p.is_default, start_at: p.start_at || null,
    end_at: p.end_at || null, stage_count: stages.length
  };
}

function checkPlayable_(p, bypass) {
  if (!p) throw appError_('找不到這個闖關專案，請確認網址', 'NOT_FOUND');
  if (bypass) return;   // 試玩模式（帶有效的試玩金鑰）可以不受開放狀態與時間限制
  if (p.status === 'draft') throw appError_('這個闖關專案還在準備中，尚未開放', 'NOT_OPEN');
  if (p.status === 'closed') throw appError_('這個闖關專案已經結束', 'CLOSED');
  var now = new Date();
  if (p.start_at && new Date(p.start_at) > now) {
    throw appError_('尚未開始，開放時間：' + Utilities.formatDate(new Date(p.start_at), Session.getScriptTimeZone(), 'M/d HH:mm'), 'NOT_OPEN');
  }
  if (p.end_at && new Date(p.end_at) < now) throw appError_('這個闖關專案已經結束', 'CLOSED');
}

/* ===================== 試玩模式 ===================== */

function getTestToken_() {
  var props = PropertiesService.getScriptProperties(), t = props.getProperty('TEST_TOKEN');
  if (!t) { t = rand_(16, 'abcdefghjkmnpqrstuvwxyz23456789'); props.setProperty('TEST_TOKEN', t); }
  return t;
}
function isTestToken_(t) { return !!str_(t) && str_(t) === getTestToken_(); }
function adminGetTestToken_() { return { token: getTestToken_() }; }

/** 後台：清除某專案所有試玩隊伍與它們的作答紀錄 */
function adminClearTests_(b) {
  return withLock_(function () {
    var pid = str_(b.projectId), ids = {};
    var bk = backupSheets_('清試玩', ['Sessions', 'Submissions']);
    readRows_('Sessions').forEach(function (r) { if (str_(r.project_id) === pid && bool_(r.test)) ids[str_(r.session_id)] = 1; });
    var n = deleteRows_('Sessions', function (r) { return str_(r.project_id) === pid && bool_(r.test); });
    var m = deleteRows_('Submissions', function (r) { return !!ids[str_(r.session_id)]; });
    bumpCache_();
    return { deleted: n, deleted_submissions: m, backup: bk };
  });
}

/** 後台：活動前檢查——列出會出問題或容易漏設的地方（error 必須處理、warn 建議處理、info 提醒） */
function adminCheckProject_(b) {
  var p = findProject_(b.projectId);
  if (!p) throw appError_('找不到專案', 'NOT_FOUND');
  return checkProject_(p);
}

function checkProject_(p) {
  var all = stages_(p.project_id, true), stages = all.filter(function (s) { return s.enabled; }), items = [];
  var add = function (level, text, where) { items.push({ level: level, text: text, where: where || '' }); };
  var now = new Date();
  // 專案
  if (!stages.length) add('error', '還沒有啟用中的關卡', 'stages');
  if (p.status === 'draft') add('info', '專案狀態是「準備中」，玩家目前還不能進入（活動前記得改成開放中）', 'project');
  if (p.status === 'closed') add('warn', '專案狀態是「已結束」，玩家無法進入', 'project');
  if (p.start_at && p.end_at && new Date(p.end_at) <= new Date(p.start_at)) add('error', '結束時間早於（或等於）開放時間', 'project');
  if (p.start_at && new Date(p.start_at) > now) add('info', '還沒到開放時間：玩家要等到開放後才能開始', 'project');
  if (p.end_at && new Date(p.end_at) < now) add('warn', '已經過了結束時間：玩家無法進入，排行榜也已關閉', 'project');
  if ((p.show_leaderboard || p.leaderboard_live) && !p.start_at && !p.end_at) add('info', '排行榜沒有設定開放／結束時間，會一直開放', 'project');
  if (p.require_run_code) add('info', '需要場次代碼：記得把場次代碼放進連結，或告訴玩家', 'project');
  // 關卡
  stages.forEach(function (s, i) {
    var tag = '第 ' + (i + 1) + ' 關「' + s.title + '」', w = 'stage:' + s.stage_id;
    if (s.require_gps && (s.lat === null || s.lng === null)) add('error', tag + '需要 GPS 打卡，但還沒設定座標', w);
    if (s.lat !== null && s.lng !== null && (Math.abs(s.lat) > 90 || Math.abs(s.lng) > 180)) add('error', tag + '的座標不合理（緯度要在 -90～90、經度要在 -180～180，可能填反了）', w);
    else if (s.require_gps && s.lat === 0 && s.lng === 0) add('error', tag + '的座標是 0, 0（在非洲外海），應該是忘了設定', w);
    if (s.require_gps && s.radius_m < 15) add('warn', tag + '範圍只有 ' + s.radius_m + ' 公尺，GPS 誤差容易讓玩家打不到卡（建議 30 公尺以上）', w);
    if (['text', 'number', 'choice'].indexOf(s.answer_type) >= 0 && !s.final_from_fragments && !s.coop_final && !str_(s.answer)) add('warn', tag + '沒有設定正確答案：任何答案都會過關', w);
    if (s.answer_type === 'choice' && !str_(s.choices)) add('error', tag + '是選擇題，但沒有設定選項', w);
    if (s.answer_type === 'form' && !str_(s.form_url)) add('error', tag + '是表單關卡，但沒有設定表單網址', w);
    if (str_(s.reward_code) && s.max_attempts > 0) add('warn', tag + '會給密碼碎片，但作答次數有限：玩家用完次數就拿不到碎片，最後一關會卡住（關主可在「闖關紀錄」按 🔄 還原）', w);
    if (s.card_id && !(p.cards || []).some(function (c) { return c.id === s.card_id; })) add('error', tag + '指定的卡牌不在目前使用的圖鑑裡', w);
    if ((s.card_id || s.card_random) && !(p.cards || []).length) add('warn', tag + '設了給卡牌，但專案沒有使用圖鑑本，不會有效果', w);
  });
  // 路線與隊伍
  (p.routes || []).forEach(function (r) {
    if (!routeStages_(p, all.filter(function (s) { return s.enabled; }), r.id).length) add('error', '路線「' + r.name + '」沒有任何關卡', 'project');
  });
  all.forEach(function (s) {
    Object.keys(stageRouteMap_(s)).forEach(function (k) { if (!routeById_(p, k)) add('warn', '關卡「' + s.title + '」指定了已經不存在的路線，這一關不會出現在任何路線', 'stage:' + s.stage_id); });
  });
  var tn = {};
  (p.teams || []).forEach(function (t) { if (tn[t.name]) add('error', '隊伍名單有重複的名稱「' + t.name + '」', 'project'); tn[t.name] = 1; });
  var rn = {};
  (p.routes || []).forEach(function (r) { if (rn[r.name]) add('error', '有兩條路線都叫「' + r.name + '」', 'project'); rn[r.name] = 1; });
  (p.teams || []).forEach(function (t) { if ((p.routes || []).length && !t.route) add('info', '隊伍「' + t.name + '」沒有指定路線，會自動平均分配', 'project'); });
  // 碎片與最後一關
  var finals = stages.filter(function (s) { return s.final_from_fragments || s.coop_final; });
  var groups = (p.routes || []).length ? p.routes.map(function (r) { return { name: r.name, stages: routeStages_(p, stages, r.id) }; }) : [{ name: '', stages: stages }];
  groups.forEach(function (gp) {
    var frs = fragmentListRaw_({ stages: gp.stages, s: { progress: {} } });
    var orders = frs.map(function (x) { return x.s.reward_order; }).filter(function (o) { return o !== null; });
    if (orders.some(function (o, i) { return orders.indexOf(o) !== i; })) add('warn', (gp.name ? '路線「' + gp.name + '」' : '') + '有重複的「碎片順序」，會依關卡順序排列', 'stages');
    if (gp.stages.some(function (s) { return s.final_from_fragments || s.coop_final; }) && !frs.length) add('error', (gp.name ? '路線「' + gp.name + '」' : '') + '有「最後一關」，但沒有任何關卡設定密碼碎片', 'stages');
  });
  if (finals.some(function (s) { return s.coop_final; }) && (p.routes || []).length < 2) add('warn', '有「合作最後關」，但專案少於 2 條路線，會當作一般最後一關', 'stages');
  // 圖鑑
  if (p.deck_id && !(p.cards || []).length) add('error', '選用的圖鑑本不存在或沒有卡牌', 'project');
  if ((p.cards || []).length) {
    var fixed = {}, rnd = 0;
    stages.forEach(function (s) { if (s.card_id) fixed[s.card_id] = 1; rnd += s.card_random || 0; });
    var can = Math.min(p.cards.length, Object.keys(fixed).length + rnd);
    if (can < p.cards.length) add('warn', '圖鑑《' + p.deck_title + '》共 ' + p.cards.length + ' 張，但關卡最多只能給 ' + can + ' 張，玩家無法全收集', 'stages');
  }
  var sum = { error: 0, warn: 0, info: 0 };
  items.forEach(function (x) { sum[x.level]++; });
  return { items: items, summary: sum, stage_count: stages.length };
}

/* ===================== 卡牌圖鑑（自然名角色閃卡） ===================== */

/** 碎片順序只接受 0–9999，其餘（例如被誤讀成日期的大數字）視為沒設定 */
function saneOrder_(n) { return n !== null && isFinite(n) && n >= 0 && n <= 9999 ? n : null; }

function clampStat_(v) { var n = Math.round(num_(v, 0)); return Math.max(0, Math.min(999, n)); }

/** 專案的卡牌清單：[{id, name, type, rarity, art, hp, atk, def, skill_name, skill_desc, story}]，最多 80 張 */
function parseDeck_(s) {
  var a = Array.isArray(s) ? s : parseJson_(s, []);
  if (!Array.isArray(a)) return [];
  var seen = {}, out = [];
  a.slice(0, 80).forEach(function (x) {
    var name = str_(x && x.name).slice(0, 20);
    if (!name) return;
    var id = str_(x.id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12);
    if (!id || seen[id]) { id = 'c' + (out.length + 1); while (seen[id]) id += 'x'; }
    seen[id] = 1;
    out.push({
      id: id, name: name,
      type: CARD_TYPES.indexOf(str_(x.type)) >= 0 ? str_(x.type) : 'forest',
      rarity: RARITIES.indexOf(str_(x.rarity)) >= 0 ? str_(x.rarity) : 'normal',
      art: str_(x.art).slice(0, 600), art_credit: str_(x.art_credit).slice(0, 160),
      art_fit: str_(x.art_fit) === 'cover' ? 'cover' : 'contain', art_pos: ['top', 'bottom'].indexOf(str_(x.art_pos)) >= 0 ? str_(x.art_pos) : 'center', hp: clampStat_(x.hp), atk: clampStat_(x.atk), def: clampStat_(x.def),
      skill_name: str_(x.skill_name).slice(0, 16), skill_desc: str_(x.skill_desc).slice(0, 80), story: str_(x.story).slice(0, 200)
    });
  });
  return out;
}

function cardFull_(d, number) {
  return { id: d.id, number: number, name: d.name, type: d.type, rarity: d.rarity, art: d.art, art_credit: d.art_credit || '', art_fit: d.art_fit || 'contain', art_pos: d.art_pos || 'center', hp: d.hp, atk: d.atk, def: d.def, skill_name: d.skill_name, skill_desc: d.skill_desc, story: d.story };
}

/** 所有圖鑑本 */
function decks_() {
  return readRows_('Decks').map(function (r) {
    return {
      deck_id: str_(r.deck_id), title: str_(r.title), cards: parseDeck_(r.cards), updated_at: r.updated_at,
      kind: DECK_KINDS.indexOf(str_(r.kind)) >= 0 ? str_(r.kind) : 'nature', style: DECK_STYLES.indexOf(str_(r.style)) >= 0 ? str_(r.style) : 'foil'
    };
  }).filter(function (d) { return d.deck_id; });
}

function adminListDecks_() {
  var projects = projects_();
  return {
    decks: decks_().map(function (d) {
      d.used_by = projects.filter(function (p) { return p.deck_id === d.deck_id; }).map(function (p) { return p.name; });
      return d;
    })
  };
}

/** 後台：新增或修改一本圖鑑（deckId 空白＝新增） */
function adminSaveDeck_(b) {
  return withLock_(function () {
    var title = str_(b.title).slice(0, 40);
    if (!title) throw appError_('請輸入圖鑑名稱', 'BAD_INPUT');
    ensureHeaders_('Decks');
    var rows = readRows_('Decks'), id = str_(b.deckId).slice(0, 20);
    var ex = id ? find_(rows, function (r) { return str_(r.deck_id) === id; }) : null;
    if (!ex) id = 'd' + rand_(5, 'abcdefghjkmnpqrstuvwxyz23456789');
    var deck = parseDeck_(b.cards);
    if (JSON.stringify(deck).length > 45000) throw appError_('圖鑑資料太大（試算表一格最多 5 萬字）。請減少卡牌張數，或縮短技能說明、故事與圖片授權文字。', 'TOO_LARGE');
    var kind = DECK_KINDS.indexOf(str_(b.kind)) >= 0 ? str_(b.kind) : 'nature', style = DECK_STYLES.indexOf(str_(b.style)) >= 0 ? str_(b.style) : 'foil';
    writeRow_('Decks', ex ? ex._row : null, { deck_id: id, title: title, kind: kind, style: style, cards: deck.length ? JSON.stringify(deck) : '', updated_at: new Date() });
    bumpCache_();
    return { deck_id: id, title: title, kind: kind, style: style, cards: deck };
  });
}

/** 後台：刪除圖鑑本；使用它的專案會變成「不使用圖鑑」（玩家已拿到的卡不會再顯示） */
function adminDeleteDeck_(b) {
  return withLock_(function () {
    var id = str_(b.deckId);
    var bk = backupSheets_('刪圖鑑', ['Decks', 'Projects']);
    var n = deleteRows_('Decks', function (r) { return str_(r.deck_id) === id; });
    readRows_('Projects').forEach(function (r) { if (str_(r.deck_id) === id) writeRow_('Projects', r._row, { deck_id: '' }); });
    bumpCache_();
    return { deleted: n, backup: bk };
  });
}

/** 這支隊伍已經拿到的卡牌代碼 */
function ownedCardIds_(c) {
  var o = {}, prog = c.s.progress || {};
  Object.keys(prog).forEach(function (k) { (prog[k] && prog[k].cards || []).forEach(function (id) { o[id] = 1; }); });
  return o;
}

/**
 * 過關時給的卡牌：先給關卡指定的那一張，再依稀有度機率（普通 70／稀有 25／傳說 5）隨機抽 N 張。
 * 不會重複；其他關卡「指定給的卡」不會被隨機抽走。
 */
function pickCards_(c, st) {
  var deck = c.p.cards || [];
  if (!deck.length) return [];
  var owned = ownedCardIds_(c), out = [], byId = {}, reserved = {};
  deck.forEach(function (d) { byId[d.id] = d; });
  c.stages.forEach(function (s) { if (s.stage_id !== st.stage_id && s.card_id) reserved[s.card_id] = 1; });
  var fixed = str_(st.card_id);
  if (fixed && byId[fixed] && !owned[fixed]) { out.push(fixed); owned[fixed] = 1; }
  var n = Math.max(0, Math.min(5, num_(st.card_random, 0))), W = { normal: 70, rare: 25, legend: 5 };
  for (var i = 0; i < n; i++) {
    var pool = deck.filter(function (d) { return !owned[d.id] && !reserved[d.id]; });
    if (!pool.length) break;
    var total = pool.reduce(function (s0, d) { return s0 + W[d.rarity]; }, 0), r = Math.random() * total, pick = pool[pool.length - 1];
    for (var k = 0; k < pool.length; k++) { r -= W[pool[k].rarity]; if (r <= 0) { pick = pool[k]; break; } }
    owned[pick.id] = 1; out.push(pick.id);
  }
  return out;
}

/* ===================== 收藏冊、成就徽章 ===================== */

/** 這支隊伍的收藏冊：過關才算收集到；沒收集到的只給圖示（前台顯示成剪影），名稱與故事不外洩 */
function collectionList_(c) {
  var prog = c.s.progress || {}, list = [];
  var deck = c.p && c.p.cards || [];
  if (deck.length) {   // 卡牌圖鑑：每一張卡就是一格；沒拿到的只給剪影需要的資訊（編號、屬性、稀有度、圖），名稱與數值不外洩
    var owned = ownedCardIds_(c);
    return deck.map(function (d, i) {
      var got = !!owned[d.id], num = i + 1;
      return {
        kind: 'card', id: d.id, number: num, got: got, icon: d.art, rarity: d.rarity,
        name: got ? d.name : '', story: got ? d.story : '',
        card: got ? cardFull_(d, num) : { number: num, type: d.type, rarity: d.rarity, art: d.art, art_fit: d.art_fit || 'contain' }
      };
    });
  }
  c.stages.forEach(function (s, i) {
    if (!str_(s.item_name) && !str_(s.item_icon)) return;
    var got = !!(prog[s.stage_id] && prog[s.stage_id].solvedAt);
    list.push({
      stage_id: s.stage_id, stage_no: i + 1, stage_title: s.title, got: got, icon: str_(s.item_icon),
      rarity: RARITIES.indexOf(s.item_rarity) >= 0 ? s.item_rarity : 'normal',
      name: got ? (str_(s.item_name) || '收藏品') : '', story: got ? str_(s.item_story) : ''
    });
  });
  return list;
}

/** 成就徽章（由進度即時算出，不另外儲存） */
function badgesOf_(c) {
  var prog = c.s.progress || {}, out = [];
  var solvedN = 0, hintsUsed = 0, firstTry = 0, hardWon = false;
  c.stages.forEach(function (s) {
    var g0 = prog[s.stage_id];
    if (!g0) return;
    hintsUsed += g0.hints || 0;
    if (!g0.solvedAt) return;
    solvedN++;
    if (['text', 'number', 'choice'].indexOf(s.answer_type) >= 0) {
      if ((g0.attempts || 0) === 1) firstTry++;
      if ((g0.attempts || 0) >= 4) hardWon = true;
    }
  });
  var add = function (id, icon, name, desc) { out.push({ id: id, icon: icon, name: name, desc: desc }); };
  if (solvedN >= 1) add('first', '🌱', '初試啼聲', '完成第一個挑戰');
  if (firstTry >= 3) add('sharp', '🎯', '一擊必中', '3 個關卡第一次就答對');
  if (solvedN >= 3 && hintsUsed === 0) add('nohint', '💡', '不靠提示', '完成 3 關以上，一次提示都沒用');
  if (hardWon) add('persist', '💪', '越挫越勇', '答錯 3 次以上，仍然堅持答對');
  var coll = collectionList_(c), gotN = coll.filter(function (x) { return x.got; }).length;
  if (coll.length >= 3 && gotN * 2 > coll.length && gotN < coll.length) add('collector', '📖', '收藏家', '收集超過一半的收藏品');
  if (coll.length && gotN === coll.length) add('complete', '🏅', '全收集', '收集完所有收藏品');
  var coopDone = c.stages.some(function (s) { return s.coop_final && prog[s.stage_id] && prog[s.stage_id].solvedAt; });
  if (coopDone) add('coop', '🤝', '合作達人', '和其他隊伍合作解開了密碼');
  if (c.s.status === 'finished') {
    add('finisher', '🏁', '完賽', '完成全部關卡');
    var st = date_(c.s.started_at), fi = date_(c.s.finished_at);
    if (c.p.time_limit_min > 0 && st && fi && (fi - st) <= c.p.time_limit_min * 30000) add('fast', '⚡', '閃電隊', '在限時的一半時間內完成');
  }
  return out;
}

function titleOf_(n) { return n >= 6 ? '探險大師' : n >= 4 ? '傳奇探險家' : n >= 2 ? '熟練探險家' : '新手探險家'; }

/* ===================== 合作任務（多隊同時）：答案＝各路線的碎片接起來，要和其他路線的隊伍交換 ===================== */

function routeFragmentCodes_(p, allStages, routeId) {
  var fake = { stages: routeStages_(p, allStages, routeId), s: { progress: {} } };
  return fragmentListRaw_(fake).map(function (x) { return str_(x.s.reward_code); });
}

/** 各路線的碎片資訊（依專案路線順序）。codes 只在後端使用 */
function coopParts_(c) {
  var all = stages_(c.p.project_id);
  return (c.p.routes || []).map(function (r) {
    var codes = routeFragmentCodes_(c.p, all, r.id);
    return { route_id: r.id, route_name: r.name, color: r.color, own: r.id === c.s.route, count: codes.length, codes: codes };
  });
}

function checkCoop_(c, st, ans) {
  var parts = coopParts_(c);
  if (parts.length < 2) return checkFragments_(c, st, ans);   // 只有一條路線：當作一般「最後一關」
  var expected = parts.map(function (x) { return x.codes.join(''); }).join('');
  if (!expected) return checkAnswer_(st, ans);
  if (st.answer_type === 'number') {
    var n = parseFloat(String(ans).normalize('NFKC').replace(/[,\s]/g, '')), e = parseFloat(expected);
    return isFinite(n) && isFinite(e) ? Math.abs(n - e) < 1e-9 : norm_(ans) === norm_(expected);
  }
  return norm_(ans) === norm_(expected);
}

/* ===================== 猜題冷卻（防止亂猜） ===================== */

/** 還要等幾秒才能再試（0＝可以作答）。key：'ans'（答案）或 'code'（現場通關碼） */
function lockLeft_(c, g, key) {
  var until = g[key + 'LockUntil'];
  if (!until) return 0;
  var left = Math.ceil((new Date(until).getTime() - c.now.getTime()) / 1000);
  return left > 0 ? left : 0;
}

/** 記一次答錯：連續答錯達門檻就暫停作答，每鎖定一次時間加倍（最久 10 分鐘）。回傳這次鎖定的秒數（0＝沒鎖） */
function lockFail_(c, g, key) {
  var after = c.p.wrong_lock_after, base = c.p.wrong_lock_sec;
  if (!(after > 0) || !(base > 0)) return 0;
  g[key + 'Streak'] = (g[key + 'Streak'] || 0) + 1;
  if (g[key + 'Streak'] < after) return 0;
  g[key + 'Streak'] = 0;
  g[key + 'Locks'] = (g[key + 'Locks'] || 0) + 1;
  var sec = Math.min(600, base * Math.pow(2, g[key + 'Locks'] - 1));
  g[key + 'LockUntil'] = new Date(c.now.getTime() + sec * 1000).toISOString();
  return sec;
}

/* ===================== 密碼碎片（每關過關給一碼，最後一關依順序組成答案） ===================== */

/**
 * 這支隊伍的碎片清單（依「碎片順序」排好）。
 * 只有「過關」的關卡才算取得；作答次數用完（未通過）的關卡不給碎片。
 * 沒取得的碎片不帶內容（code 空白），避免偷看。
 */
function fragmentList_(c) {
  var prog = c.s.progress || {}, list = [];
  c.stages.forEach(function (s, i) {
    if (str_(s.reward_code) && !s.final_from_fragments && !s.coop_final) list.push({ s: s, i: i });
  });
  list.sort(function (a, b) {
    var oa = a.s.reward_order === null ? 9999 : a.s.reward_order, ob = b.s.reward_order === null ? 9999 : b.s.reward_order;
    return oa - ob || a.i - b.i;
  });
  return list.map(function (x, k) {
    var got = !!(prog[x.s.stage_id] && prog[x.s.stage_id].solvedAt);
    return { order: k + 1, stage_id: x.s.stage_id, stage_title: x.s.title, stage_no: x.i + 1, got: got, code: got ? str_(x.s.reward_code) : '' };
  });
}

/** 最終密碼：全部碎片依順序接起來（正確答案，只在後端使用，不會傳給前台） */
function fragmentAnswer_(c) {
  return fragmentListRaw_(c).map(function (x) { return str_(x.s.reward_code); }).join('');
}

function fragmentListRaw_(c) {
  var list = [];
  c.stages.forEach(function (s, i) {
    if (str_(s.reward_code) && !s.final_from_fragments && !s.coop_final) list.push({ s: s, i: i });
  });
  list.sort(function (a, b) {
    var oa = a.s.reward_order === null ? 9999 : a.s.reward_order, ob = b.s.reward_order === null ? 9999 : b.s.reward_order;
    return oa - ob || a.i - b.i;
  });
  return list;
}

function checkFragments_(c, st, ans) {
  var expected = fragmentAnswer_(c);
  if (!expected) return checkAnswer_(st, ans);   // 沒設定任何碎片：退回一般答案
  if (st.answer_type === 'number') {
    var n = parseFloat(String(ans).normalize('NFKC').replace(/[,\s]/g, '')), e = parseFloat(expected);
    return isFinite(n) && isFinite(e) ? Math.abs(n - e) < 1e-9 : norm_(ans) === norm_(expected);
  }
  return norm_(ans) === norm_(expected);
}

/** 後台：把這隊「未通過」的關卡還原成可重新挑戰（作答次數歸零），用於補救缺少碎片卡關的隊伍 */
function adminResetFailed_(b) {
  return withLock_(function () {
    var c = ctx_({ sessionId: b.sessionId }, false);
    var n = 0;
    Object.keys(c.s.progress).forEach(function (k) {
      if (c.s.progress[k] && c.s.progress[k].failed) { delete c.s.progress[k]; n++; }
    });
    if (n && c.s.status !== 'playing') { c.s.status = 'playing'; c.s.finished_at = ''; }
    c.now = new Date();
    saveSession_(c);
    bumpCache_();
    return { reset: n };
  });
}

/* ===================== 路線（同一專案、不同隊伍走不同關卡） ===================== */

/** 專案的路線清單：[{id, name, color}] */
function parseRoutes_(s) {
  var a = Array.isArray(s) ? s : parseJson_(s, []);
  if (!Array.isArray(a)) return [];
  var seen = {}, out = [];
  a.forEach(function (x) {
    var id = str_(x && x.id).slice(0, 20);
    if (!id || seen[id]) return;
    seen[id] = 1;
    out.push({ id: id, name: str_(x.name).slice(0, 30) || id, color: str_(x.color).slice(0, 20) });
  });
  return out;
}

/** 預設隊伍名單：[{name, route}]（route 是路線代碼，空白＝自動平均分配）。有名單＝玩家只能從名單選隊伍 */
function parseTeams_(s, routes) {
  var a = Array.isArray(s) ? s : parseJson_(s, []);
  if (!Array.isArray(a)) return [];
  var ids = {};
  (routes || []).forEach(function (r) { ids[r.id] = 1; });
  var seen = {}, out = [];
  a.forEach(function (x) {
    var name = str_(x && x.name).slice(0, 30);
    if (!name || seen[name]) return;
    seen[name] = 1;
    var rt = str_(x.route);
    out.push({ name: name, route: ids[rt] ? rt : '', avatar: AVATARS.indexOf(str_(x.avatar)) >= 0 ? str_(x.avatar) : '' });
  });
  return out;
}

function routeById_(p, id) {
  id = str_(id);
  return id ? (find_(p.routes || [], function (r) { return r.id === id; }) || null) : null;
}

/** 關卡的 routes 欄位："A:2|B|C:1" → { A: 2, B: null, C: 1 }（冒號後是該路線裡的順序；空白＝所有路線共用） */
function stageRouteMap_(st) {
  var out = {};
  str_(st.routes).split('|').forEach(function (t) {
    t = t.trim();
    if (!t) return;
    var m = t.split(':'), id = m[0].trim();
    if (!id) return;
    out[id] = (m[1] !== undefined && m[1].trim() !== '') ? num_(m[1], null) : null;
  });
  return out;
}

/** 這支隊伍的關卡：沒有設定路線的專案／隊伍＝全部；有路線＝共用關卡＋屬於該路線的關卡，依路線內順序排列 */
function routeStages_(p, all, route) {
  if (!p.routes || !p.routes.length || !route) return all;
  if (!find_(p.routes, function (r) { return r.id === route; })) return all;
  var picked = [];
  all.forEach(function (s, i) {
    var m = stageRouteMap_(s), keys = Object.keys(m);
    if (keys.length && !(route in m)) return;
    var o = (route in m && m[route] !== null) ? m[route] : s.order;
    picked.push({ s: s, o: o, i: i });
  });
  picked.sort(function (a, b) { return a.o - b.o || a.i - b.i; });
  return picked.map(function (x) { return x.s; });
}

/** 沒有指定路線時，分到目前隊伍最少的路線（同場次內平均分配） */
function pickRoute_(p, run) {
  var count = {};
  p.routes.forEach(function (r) { count[r.id] = 0; });
  readRows_('Sessions').forEach(function (r) {
    if (str_(r.project_id) !== p.project_id || bool_(r.test)) return;
    if (run && str_(r.run_code) !== run) return;
    var id = str_(r.route);
    if (id in count) count[id]++;
  });
  var best = p.routes[0].id;
  p.routes.forEach(function (r) { if (count[r.id] < count[best]) best = r.id; });
  return best;
}

/** 後台：更換某隊的路線（已有的進度會保留，分數照舊計算） */
function adminSetRoute_(b) {
  return withLock_(function () {
    var s = loadSession_(b.sessionId);
    var p = findProject_(s.project_id);
    if (!p) throw appError_('找不到專案', 'NOT_FOUND');
    var route = str_(b.route);
    if (route && !find_(p.routes, function (r) { return r.id === route; })) throw appError_('路線不存在', 'BAD_INPUT');
    ensureHeaders_('Sessions');
    writeRow_('Sessions', s._row, { route: route });
    return { route: route };
  });
}

/* ===================== 資料讀取（含快取） ===================== */

function projects_() {
  var list = cached_('projects', function () {
    return readRows_('Projects').map(cleanProject_).filter(function (p) { return p.project_id; });
  });
  return list.map(function (p) {
    var d = p.deck_id ? deckById_(p.deck_id) : null;   // 專案使用的那一本圖鑑（每本各自快取）
    p.cards = d ? d.cards : [];
    p.deck_title = d ? d.title : '';
    p.deck_kind = d ? d.kind : 'nature';
    p.deck_style = d ? d.style : 'foil';
    return p;
  });
}

function deckById_(id) {
  return cached_('deck_' + id, function () {
    var r = find_(readRows_('Decks'), function (x) { return str_(x.deck_id) === id; });
    if (!r) return null;
    return {
      title: str_(r.title), cards: parseDeck_(r.cards),
      kind: DECK_KINDS.indexOf(str_(r.kind)) >= 0 ? str_(r.kind) : 'nature', style: DECK_STYLES.indexOf(str_(r.style)) >= 0 ? str_(r.style) : 'foil'
    };
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
  var sd = date_(r.start_at), ed = date_(r.end_at), routes0 = parseRoutes_(r.routes);
  return {
    project_id: str_(r.project_id), name: str_(r.name),
    status: PROJECT_STATUS.indexOf(str_(r.status).toLowerCase()) >= 0 ? str_(r.status).toLowerCase() : 'draft',
    is_default: bool_(r.is_default),
    unlock_mode: str_(r.unlock_mode).toLowerCase() === 'free' ? 'free' : 'sequential',
    description: str_(r.description), intro: str_(r.intro), finish_message: str_(r.finish_message),
    routes: routes0, teams: parseTeams_(r.teams, routes0),
    cover_url: str_(r.cover_url), theme: THEMES.indexOf(str_(r.theme).toLowerCase()) >= 0 ? str_(r.theme).toLowerCase() : 'retro',
    start_at: sd ? sd.toISOString() : '', end_at: ed ? ed.toISOString() : '',
    time_limit_min: num_(r.time_limit_min, 0), gps_max_accuracy: num_(r.gps_max_accuracy, DEFAULT_GPS_MAX_ACCURACY),
    show_leaderboard: bool_(r.show_leaderboard), leaderboard_live: bool_(r.leaderboard_live), require_run_code: bool_(r.require_run_code),
    wrong_lock_after: Math.max(0, num_(r.wrong_lock_after, 3)), wrong_lock_sec: Math.max(0, num_(r.wrong_lock_sec, 30)),
    collect_message: str_(r.collect_message).slice(0, 300),
    deck_id: str_(r.deck_id).slice(0, 20), deck_title: '', deck_kind: 'nature', deck_style: 'foil', cards: []
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
    show_question_early: defBool_(r.show_question_early, true), require_photo: bool_(r.require_photo), routes: str_(r.routes),
    reward_code: str_(r.reward_code).slice(0, 40), reward_order: saneOrder_(num_(r.reward_order, null)), final_from_fragments: bool_(r.final_from_fragments), coop_final: bool_(r.coop_final),
    card_id: str_(r.card_id).slice(0, 12), card_random: Math.max(0, Math.min(5, num_(r.card_random, 0))),
    item_name: str_(r.item_name).slice(0, 30), item_icon: str_(r.item_icon).slice(0, 300),
    item_rarity: RARITIES.indexOf(str_(r.item_rarity).toLowerCase()) >= 0 ? str_(r.item_rarity).toLowerCase() : 'normal', item_story: str_(r.item_story).slice(0, 300),
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
  r.team_name = str_(r.team_name); r.run_code = str_(r.run_code); r.route = str_(r.route); r.avatar = str_(r.avatar); r.test = bool_(r.test);
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
    run_code: c.s.run_code, team_name: c.s.team_name, route: c.s.route || '', stage_id: st ? st.stage_id : '',
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
  if (missing.length) {
    sh.getRange(1, h.length + 1, 1, missing.length).setValues([missing]);
    // 新加的數字欄位，立刻設成數字格式（否則可能繼承左邊「更新時間」欄的日期格式）
    missing.forEach(function (k, i) {
      var fmt = (NUMBER_COLUMNS[name] || []).indexOf(k) >= 0 ? '0.########' : ((TEXT_COLUMNS[name] || []).indexOf(k) >= 0 ? '@' : '');
      if (fmt) sh.getRange(2, h.length + 1 + i, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat(fmt);
    });
  }
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
  // 由下往上刪，並把連續的列合併成一次刪除（紀錄很多時比逐列刪快很多）
  var i = 0;
  while (i < rows.length) {
    var j = i;
    while (j + 1 < rows.length && rows[j + 1] === rows[j] - 1) j++;
    sh.deleteRows(rows[j], j - i + 1);
    i = j + 1;
  }
  return rows.length;
}

/** 只讀最後 n 列（含 _row），給很大的工作表（作答紀錄）用 */
function readTailRows_(name, n) {
  var sh = sheet_(name), lr = sh.getLastRow(), lc = sh.getLastColumn();
  if (lr < 2) return [];
  var h = sh.getRange(1, 1, 1, lc).getValues()[0].map(function (x) { return String(x).trim(); });
  var start = Math.max(2, lr - n + 1), vals = sh.getRange(start, 1, lr - start + 1, lc).getValues(), out = [];
  vals.forEach(function (r, i) {
    if (r.every(function (v) { return v === '' || v === null; })) return;
    var o = { _row: start + i };
    h.forEach(function (k, j) { if (k) o[k] = r[j]; });
    out.push(o);
  });
  return out;
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

/* ===================== 頻率限制 ===================== */

// 用 CacheService 計次（Apps Script 拿不到使用者 IP，所以以「專案」「隊伍」「後台」為單位限制）
var RATE = { adminFail: 10, resumeFail: 20, startPerMin: 300, sessionPerMin: 60 };

/** 已超過上限就回傳 true（不計次） */
function rateBlocked_(key, limit) {
  try { return (parseInt(CacheService.getScriptCache().get('rl_' + key) || '0', 10) || 0) >= limit; } catch (e) { return false; }
}
/** 計一次；超過上限回傳 true。快取出問題時不限制，避免誤擋正常玩家 */
function rateHit_(key, limit, windowSec) {
  try {
    var c = CacheService.getScriptCache(), k = 'rl_' + key, n = parseInt(c.get(k) || '0', 10) || 0;
    if (n >= limit) return true;
    c.put(k, String(n + 1), windowSec);
  } catch (e) { /* 忽略 */ }
  return false;
}

/* ===================== 自動備份 ===================== */

var BACKUP_MAX_ROWS = 20000;   // 太大的工作表不備份（複製太慢）
var BACKUP_KEEP = 24;          // 最多保留幾張備份分頁

/**
 * 危險操作（刪除）之前，把相關工作表複製一份成「備份_時間_原因_表名」（隱藏）。
 * ‧ 在試算表選單「檢視 → 隱藏的工作表」可以顯示出來，要還原就把資料複製回去。
 * ‧ 同一張表 10 分鐘內只備份一次（連續刪好幾支隊伍時不會每次都複製）。
 * ‧ 備份失敗不影響原本的操作。回傳這次建立的備份分頁名稱。
 */
function backupSheets_(reason, names) {
  var made = [];
  try {
    var ss = ss_(), cache = CacheService.getScriptCache();
    var ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMdd_HHmmss');
    names.forEach(function (n) {
      var sh = ss.getSheetByName(n);
      if (!sh || sh.getLastRow() <= 1 || sh.getLastRow() > BACKUP_MAX_ROWS) return;
      var ck = 'bk_' + n;
      try { if (cache.get(ck)) return; } catch (e) { /* */ }
      var cp = sh.copyTo(ss);
      cp.setName(('備份_' + ts + '_' + reason + '_' + n).slice(0, 99));
      try { cp.hideSheet(); } catch (e) { /* */ }
      try { cache.put(ck, '1', 600); } catch (e) { /* */ }
      made.push(cp.getName());
    });
    // 只保留最新的幾張備份
    var baks = ss.getSheets().filter(function (s) { return s.getName().indexOf('備份_') === 0; })
      .sort(function (a, b) { return a.getName() < b.getName() ? 1 : -1; });
    baks.slice(BACKUP_KEEP).forEach(function (s) { try { ss.deleteSheet(s); } catch (e) { /* */ } });
  } catch (e) { /* 備份失敗不擋操作 */ }
  return made;
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

/** 玩家自己輸入的文字：去掉開頭的 = + - @（避免被試算表當成公式） */
function noFormula_(s) { return String(s == null ? '' : s).replace(/^[=+\-@\t\r\n ]+/, ''); }

function str_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}
function isNum_(v) { return typeof v === 'number' && isFinite(v); }
/** 試算表日期（Date）轉回它原本的「序列值」：1899-12-30 為 0，隔天為 1…（儲存格被誤設成日期格式時，數字會被讀成 Date） */
function dateToSerial_(d) {
  var tz = Session.getScriptTimeZone();
  var ymd = Utilities.formatDate(d, tz, 'yyyy-MM-dd').split('-'), hms = Utilities.formatDate(d, tz, 'HH:mm:ss').split(':');
  var days = (Date.UTC(+ymd[0], +ymd[1] - 1, +ymd[2]) - Date.UTC(1899, 11, 30)) / 86400000;
  return days + (+hms[0] * 3600 + +hms[1] * 60 + +hms[2]) / 86400;
}
function num_(v, d) {
  if (v === '' || v === null || v === undefined) return d;
  if (v instanceof Date) { try { var s = dateToSerial_(v); return isFinite(s) ? Math.round(s * 1e6) / 1e6 : d; } catch (e) { return d; } }
  var n = Number(v); return isFinite(n) ? n : d;
}
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
function uniqueCode_(pid) {
  var used = {};
  readRows_('Sessions').forEach(function (r) { if (str_(r.project_id) === pid) used[str_(r.code).toUpperCase()] = 1; });
  var c = genCode_();
  for (var i = 0; i < 20 && used[c]; i++) c = genCode_();
  return c;
}
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

/** 移除 Sessions 工作表裡舊的「members（成員）」欄位；沒有這個欄位就什麼都不做。回傳是否有刪除 */
function removeMembersColumn_() {
  var sh = ss_().getSheetByName('Sessions');
  if (!sh || sh.getLastColumn() === 0) return false;
  var idx = headers_(sh).indexOf('members');
  if (idx < 0) return false;
  sh.deleteColumn(idx + 1);
  bumpCache_();
  return true;
}

function setup() {
  removeMembersColumn_();
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
    (NUMBER_COLUMNS[name] || []).forEach(function (col) {
      var ci = h.indexOf(col) + 1;
      if (ci) sh.getRange(2, ci, maxRows - 1, 1).setNumberFormat('0.########');
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

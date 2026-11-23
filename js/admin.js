/* ========== 管理後台 ========== */
(function () {
  'use strict';
  var $ = Q.$, $$ = Q.$$, esc = Q.esc;
  // 從主畫面圖示開啟時，標記一下：前台與排行榜頁面會顯示「← 回後台」（同一個視窗內跳轉沒有返回鍵）
  try { if ((window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone) sessionStorage.setItem('escapegame-from-admin', '1'); } catch (e) { /* */ }
  var KEY_STORE = 'escapegame-admin-key';
  var REMEMBER_STORE = 'escapegame-admin-remember';   // 「記住這台裝置」：存在本機，30 天內免重新輸入
  var REMEMBER_DAYS = 30;
  var PROJECT_FIELDS = ['project_id', 'name', 'status', 'unlock_mode', 'description', 'intro', 'finish_message', 'cover_url', 'theme',
    'start_at', 'end_at', 'time_limit_min', 'gps_max_accuracy', 'wrong_lock_after', 'wrong_lock_sec', 'is_default', 'show_leaderboard', 'leaderboard_live', 'require_run_code', 'collect_message', 'deck_id'];
  var STAGE_FIELDS = ['stage_id', 'enabled', 'clue', 'image_url', 'require_gps', 'show_location', 'bypass_code', 'question', 'show_question_early', 'require_photo', 'reward_code', 'reward_order', 'final_from_fragments', 'coop_final', 'item_name', 'item_icon', 'item_rarity', 'item_story', 'card_id', 'card_random',
    'answer_type', 'points', 'choices', 'answer', 'max_attempts', 'form_url', 'form_verify_sheet', 'success_message',
    'hint1', 'hint2', 'hint3', 'hint_penalty', 'lat', 'lng', 'radius_m'];
  var STATUS_TXT = { active: ['開放中', 'green'], hidden: ['連結可玩', 'blue'], draft: ['準備中', 'gray'], closed: ['已結束', 'red'] };

  var A = {
    key: '', decks: [], projects: [], pid: '', stages: [], editStage: null, editProjectNew: false,
    stagesMap: null, stagesLayer: null, edMap: null, edMarker: null, edCircle: null, edOthers: null,
    monMap: null, monLayer: null, monTimer: null, tab: 'live'
  };

  function call(action, payload) {
    return Q.run(function () { return Q.api(action, Object.assign({ adminKey: A.key }, payload || {})); })
      .catch(function (e) { if (e.code === 'UNAUTHORIZED') logout(); throw e; });
  }

  /** 這個專案現在有幾支「正在玩」的正式隊伍（6 小時內有操作） */
  async function liveCount(pid) {
    try { return (await call('adminLiveCount', { projectId: pid })).playing_count || 0; }   // 輕量路由：只讀隊伍表
    catch (e) { return 0; }
  }

  /**
   * 活動進行中的危險操作守門：有隊伍正在玩時，要輸入專案代碼才能繼續。
   * 確認過一次後，同一個專案 10 分鐘內不再重複詢問（例如連續調整關卡順序）。
   */
  async function guardLive(pid, what) {
    A.liveOk = A.liveOk || {};
    if ((A.liveOk[pid] || 0) > Date.now()) return true;
    var n = await liveCount(pid);
    if (!n) return true;
    var typed = prompt('⚠️ 目前有 ' + n + ' 支隊伍正在闖關！\n\n' + what + '\n\n確定要繼續，請輸入專案代碼「' + pid + '」：');
    if (typed !== pid) { if (typed !== null) Q.toast('代碼不符，已取消', 'warn'); return false; }
    A.liveOk[pid] = Date.now() + 10 * 60 * 1000;
    return true;
  }

  function showBackup(r) {
    if (r && r.backup && r.backup.length) Q.toast('🛟 已自動備份 ' + r.backup.length + ' 張工作表（試算表「檢視 → 隱藏的工作表」可找回）', 'ok', 6000);
  }

  document.addEventListener('DOMContentLoaded', function () {
    $('#btn-login').onclick = login;
    $('#login-key').addEventListener('keydown', function (e) { if (e.key === 'Enter') login(); });
    $('#btn-logout').onclick = logout;
    $$('.tabs button').forEach(function (b) { b.onclick = function () { setTab(b.dataset.tab); }; });
    $('#live-project').onchange = function () { A.pid = this.value; loadLive(); };
    $('#live-refresh').onclick = function () { loadLive(); };
    $('#live-auto').onchange = setLiveTimer;
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
    $('#mp-theme').onchange = renderThemePrev;
    bindDeckUi();
    ['#ms-reward_code', '#ms-reward_order', '#ms-final_from_fragments', '#ms-coop_final', '#ms-title-input'].forEach(function (sel) {
      $(sel).addEventListener('input', renderFragPreview); $(sel).addEventListener('change', renderFragPreview);
    });
    $('#ms-routes').addEventListener('change', renderFragPreview);
    $('#ms-item_icon').addEventListener('input', function () { refreshImgPrev('ms-item_icon'); });
    $('#mp-route-add').onclick = addRoute;
    $('#mp-team-add').onclick = function () { A.editTeams.push({ name: '', route: '' }); renderTeamEditor(); var ins = $$('#mp-teams [data-f="name"]'); if (ins.length) ins[ins.length - 1].focus(); };
    $('#mp-team-bulk').onclick = function () { $('#mp-team-bulk-box').classList.toggle('hidden'); };
    $('#mp-team-bulk-ok').onclick = addTeamsFromText;
    $('#stage-route').onchange = function () { A.stageRoute = this.value; renderStages(); };
    $('#mon-route').onchange = function () { A.monRoute = this.value; loadMonitor(); };
    $('#ml-team-select').onchange = updateLink; $('#ml-team-input').addEventListener('input', updateLink); $('#ml-route').onchange = updateLink;
    $('#ml-sheet').onclick = openQrSheet;
    $('#ck-rerun').onclick = function () { openCheck(A.checkPid); };
    $('#btn-clear-tests').onclick = async function () {
      var pid = $('#mon-project').value;
      if (!confirm('清除這個專案所有「試玩」隊伍與它們的作答紀錄？\n（正式隊伍不受影響）')) return;
      try { var r = await call('adminClearTests', { projectId: pid }); Q.toast('已清除 ' + r.deleted + ' 支試玩隊伍', 'ok'); showBackup(r); loadMonitor(); } catch (e) { /* */ }
    };
    $('#qs-print').onclick = function () {
      document.body.classList.add('printing-qr');
      var done = function () { document.body.classList.remove('printing-qr'); window.removeEventListener('afterprint', done); };
      window.addEventListener('afterprint', done);
      window.print();
    };
    bindImageField('mp-cover_url', 'cover', function () { return $('#mp-project_id').value.trim(); });
    bindImageField('ms-image_url', 'stage', function () { return A.pid; });
    bindImageField('ms-item_icon', 'stage', function () { return A.pid; });
    $('#ms-restore').onclick = function () {
      if (A.edOrig) { setEdPoint(A.edOrig.lat, A.edOrig.lng, true); Q.toast('已還原為原本位置', 'ok'); }
    };
    // 貼上座標或 Google 地圖網址。手機「分享」複製的常是「地名＋網址」兩行文字，所以先從文字裡把網址挑出來
    $('#ms-paste').addEventListener('input', async function (ev) {
      var box = this, raw = box.value.trim();
      if (!raw) return;
      var pasted = !ev.inputType || /paste|drop/i.test(ev.inputType) || raw.length >= 12;   // 一個字一個字打的時候不要一直跳提示
      var url = Q.firstUrl(raw), v = url || raw;
      var ll = Q.parseLatLng(v);
      if (!ll && url && Q.isMapShortLink(url)) {   // 短網址：請後端展開成完整網址再解析
        box.disabled = true; Q.toast('轉換網址中…', 'warn', 1500);
        try {
          var rr = await Q.run(function () { return Q.api('adminResolveMapUrl', { adminKey: A.key, url: url }); }, { noToast: true });
          ll = (rr.lat != null && rr.lng != null) ? { lat: rr.lat, lng: rr.lng } : Q.parseLatLng(rr.url);
        } catch (e) { /* 下面統一提示 */ }
        box.disabled = false;
        if (!ll) return Q.toast('短網址轉不出座標。如果還沒更新後端程式，請先更新；或到 Google 地圖長按地點，複製最上面的座標。', 'warn', 8000);
      }
      if (ll) { setEdPoint(ll.lat, ll.lng, true); box.value = ''; Q.toast('已套用座標 ' + ll.lat.toFixed(6) + ', ' + ll.lng.toFixed(6), 'ok'); }
      else if (pasted) Q.toast(url ? '網址裡找不到座標。請改貼「地點」的網址，或長按地點複製座標。' : '看不出座標。請貼 Google 地圖的網址，或像 25.0330, 121.5654 這樣的座標。', 'warn', 6000);
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
    $('#sub-team').onchange = function () { A.subTeam = this.value; renderSubs(); };
    $$('#sub-chips [data-f]').forEach(function (b) { b.onclick = function () { A.subFilter = b.dataset.f; renderSubs(); }; });

    var saved = '';
    try { saved = sessionStorage.getItem(KEY_STORE) || ''; } catch (e) { /* */ }
    var fromRemember = false;
    if (!saved) {
      try {
        var rm = JSON.parse(localStorage.getItem(REMEMBER_STORE) || 'null');
        if (rm && rm.k && rm.exp > Date.now()) { saved = rm.k; fromRemember = true; } else localStorage.removeItem(REMEMBER_STORE);
      } catch (e) { /* */ }
    }
    // 從主畫面圖示開啟時預設勾選「記住這台裝置」
    var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
    var chk = $('#login-remember'); if (chk) chk.checked = !!standalone || fromRemember;
    if (saved) { A.key = saved; enter(); }
  });

  /* ---------- 前台畫面風格預覽 ---------- */
  var THEME_INFO = {
    retro:   ['羊皮紙、棕色邊框、古地圖濾鏡，像尋寶地圖。', ['#3b2d17', '#f3ead4', '#a12d1f', '#265f46']],
    history: ['宣紙底、墨黑邊框、朱紅印章色，適合古蹟、老街、文史導覽。', ['#1c1c1c', '#efe9dc', '#9b1c1c', '#8c1d1d']],
    sport:   ['白底、深藍與橘紅、粗斜體標題，適合體能、校慶、運動會闖關。', ['#0f172a', '#f4f7fb', '#ff4d1a', '#16a34a']],
    mist:    ['深色背景、冷色調、薄霧與暗化地圖，適合夜間或懸疑主題。', ['#0a1118', '#0f1720', '#7dd3fc', '#1f8a8f']],
    forest:  ['深綠與大地色，適合公園、步道、自然生態導覽。', ['#1f3a26', '#eef3e6', '#b4531a', '#2f6f3e']],
    neon:    ['深紫底、青色與洋紅螢光，適合夜市、科技、電玩風格。', ['#07041a', '#0b0720', '#22d3ee', '#c026d3']],
    campus:  ['馬卡龍粉紫與薄荷綠、全圓角、可愛字體，適合校園、親子、社團活動。', ['#7c6cd9', '#fff8f3', '#e0577f', '#17977a']],
    ocean:   ['藍白條紋頂欄、船錨圖示、海軍藍與救生圈紅，適合港口、海岸、航海主題。', ['#0b2545', '#eef6fb', '#d62839', '#1d5fa8']]
  };
  function renderThemePrev() {
    var t = $('#mp-theme').value, info = THEME_INFO[t] || THEME_INFO.retro;
    $('#mp-theme-prev').innerHTML = info[1].map(function (c) { return '<i style="background:' + c + '"></i>'; }).join('') + '<span>' + info[0] + '</span>';
  }

  /* ---------- 圖鑑本（卡牌製作） ---------- */
  var KIND_INFO = {
    nature: {
      types: { forest: '森林', water: '溪流', sky: '天空', mountain: '山岳', grass: '草原', ocean: '海洋', night: '夜行', earth: '大地' },
      stats: ['HP', '攻擊', '防禦'],
      emoji: { forest: ['🌲', '🦌', '🐿️', '🍄'], water: ['💧', '🐟', '🦆', '🐸'], sky: ['🦅', '🕊️', '🦋', '☁️'], mountain: ['⛰️', '🐐', '🦅', '🪨'],
        grass: ['🌾', '🐇', '🌼', '🦗'], ocean: ['🌊', '🐢', '🐬', '🦀'], night: ['🌙', '🦉', '🦇', '✨'], earth: ['🪨', '🐛', '🌱', '🦎'] },
      skills: {
        forest: ['森林守望', '綠蔭庇護', '落葉飛舞'], water: ['溪流輕唱', '水花連擊', '潮汐之歌'], sky: ['振翅高飛', '雲端俯衝', '風之信使'], mountain: ['山嵐呼喚', '岩石守護', '稜線漫步'],
        grass: ['草原奔馳', '螢火閃爍', '花粉飛揚'], ocean: ['浪花拍擊', '珊瑚庇佑', '深海迴聲'], night: ['月下潛行', '星光閃耀', '夜鶯低語'], earth: ['大地脈動', '泥土擁抱', '岩縫生根']
      },
      effects: ['讓夥伴恢復活力。', '守護這片荒野的安寧。', '悄悄記錄大自然的變化。', '帶來一陣清爽的風。', '召喚附近的小生命來幫忙。'],
      stories: ['{n}是荒野裡的{t}系夥伴，總是第一個發現環境的小變化。', '大家都說{n}擁有{t}的力量，只要牠出現，森林就安靜下來。', '{n}喜歡在{t}一帶巡邏，是荒野巡守隊的好幫手。']
    },
    place: {
      types: { forest: '自然景觀', water: '水岸風光', sky: '地標高處', mountain: '山林步道', grass: '田園農特', ocean: '海岸港灣', night: '夜市美食', earth: '古蹟人文' },
      stats: ['人氣', '歷史', '美景'],
      emoji: { forest: ['🌳', '🏞️', '🍃'], water: ['⛲', '🚣', '🌉'], sky: ['🗼', '🎡', '🏙️'], mountain: ['⛰️', '🥾', '🌄'],
        grass: ['🌾', '🚜', '🍊'], ocean: ['⛵', '🐚', '🏖️'], night: ['🍢', '🏮', '🍜'], earth: ['🏯', '⛩️', '🏛️'] },
      skills: {
        forest: ['綠意療癒', '芬多精洗禮', '林間漫步'], water: ['水岸漫遊', '波光閃爍', '倒影成畫'], sky: ['登高望遠', '地標打卡', '城市全景'], mountain: ['步道健行', '雲海奇觀', '山風迎面'],
        grass: ['在地好滋味', '農家體驗', '產地直送'], ocean: ['海風迎面', '潮間帶探索', '港灣日落'], night: ['人氣美食', '夜市巡禮', '排隊也值得'], earth: ['古蹟巡禮', '歷史回望', '老街故事']
      },
      effects: ['來訪的人都忍不住拍照留念。', '是當地人推薦給朋友的第一站。', '藏著這片土地的獨特記憶。', '一定要親自走一趟才知道。', '每個季節都有不同的風貌。'],
      stories: ['來到這裡別錯過{n}，它是這片土地獨特的{t}印記。', '{n}是當地的{t}代表，老老少少都有自己的回憶。', '提到這個地方，大家第一個想到的就是{n}。']
    }
  };
  KIND_INFO.custom = KIND_INFO.nature;


  /** 依名稱的關鍵字猜屬性（猜不到才用名稱雜湊決定） */
  var TYPE_HINTS = [
    ['grass', /海芋|荔枝|橘|李子|葡萄|豌豆|豆$|兔/], ['night', /星|極光|辰/], ['ocean', /海|鯨|鯊|魚|龜|企鵝|蛞蝓|花枝/],
    ['earth', /龍|T-REX|蜈蚣|馬陸|地鼠|袋鼠|狐獴|峽谷|翼竜/], ['mountain', /山|嵐|雲豹/], ['sky', /鳥|雕|鴞|風|雲|鷹|雀/], ['forest', /樹|橡|林|貓熊|相思/]
  ];
  function guessType(name) {
    for (var i = 0; i < TYPE_HINTS.length; i++) if (TYPE_HINTS[i][1].test(name)) return TYPE_HINTS[i][0];
    return '';
  }

  function hash32(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function seeded(seed) {
    var a = seed >>> 0;
    return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function pickOf(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

  /** 依名稱自動產生一張卡（同名同結果；reroll 時換一個種子） */
  function genCard(name, kind, salt) {
    var info = KIND_INFO[kind] || KIND_INFO.nature, rng = seeded(hash32(name) + (salt || 0) * 7919);
    var keys = Object.keys(info.types), type = pickOf(rng, keys), r = rng();
    if (kind !== 'place') type = guessType(name) || type;
    var rarity = r < 0.62 ? 'normal' : r < 0.90 ? 'rare' : 'legend';
    var base = { normal: 30, rare: 50, legend: 70 }[rarity];
    var stat = function () { return base + Math.floor(rng() * 31); };
    var skill = pickOf(rng, info.skills[type]), eff = pickOf(rng, info.effects), tl = info.types[type];
    return {
      id: '', name: name, type: type, rarity: rarity, art: pickOf(rng, info.emoji[type]), art_fit: 'contain', art_pos: 'center',
      hp: stat(), atk: stat(), def: stat(), skill_name: skill,
      skill_desc: (kind === 'place' ? name + '：' : name + '使出「' + skill + '」，') + eff,
      story: pickOf(rng, info.stories).replace('{n}', name).replace('{t}', tl)
    };
  }

  function parseNames(text) {
    var seen = {}, out = [];
    String(text || '').split(/[\n\r\t,，、;；]+/).forEach(function (n) {
      n = n.trim().slice(0, 20);
      if (n && !seen[n]) { seen[n] = 1; out.push(n); }
    });
    return out;
  }

  async function loadDecks() {
    try {
      var r = await call('adminListDecks');
      A.decks = r.decks;
      renderDecks();
    } catch (e) { /* */ }
  }

  function deckKindLabel(k) { return { nature: '🌿 荒野自然名', place: '🏯 在地景點', custom: '✏️ 自訂' }[k] || k; }
  function deckStyleLabel(k) { return { foil: '✨ 閃卡', classic: '📜 古典標本', watercolor: '🎨 水彩', pixel: '👾 像素' }[k] || k; }

  function renderDecks() {
    var box = $('#deck-grid');
    if (!box) return;
    if (!A.decks.length) { box.innerHTML = '<div class="card muted">還沒有圖鑑本。按「新增」貼上名稱即可建立。</div>'; return; }
    box.innerHTML = A.decks.map(function (d) {
      var first = d.cards.slice(0, 3).map(function (c, i) { return '<div class="dk-thumb">' + Q.cardHtml(Object.assign({ number: i + 1 }, c), { kind: d.kind, style: d.style, mini: true }) + '</div>'; }).join('');
      return '<div class="card stack" data-did="' + esc(d.deck_id) + '">' +
        '<div class="row"><b class="grow">' + esc(d.title) + '</b><span class="chip">' + d.cards.length + ' 張</span></div>' +
        '<div class="small muted">' + deckKindLabel(d.kind) + '・' + deckStyleLabel(d.style) + '</div>' +
        '<div class="dk-thumbs">' + first + '</div>' +
        '<div class="small">' + (d.used_by.length ? '使用中：' + d.used_by.map(esc).join('、') : '<span class="muted">還沒有專案使用</span>') + '</div>' +
        '<div class="row wrap"><button class="sm" data-dact="edit">編輯</button><button class="sm ghost" data-dact="dup">複製</button></div></div>';
    }).join('');
    $$('#deck-grid [data-dact]').forEach(function (b) {
      b.onclick = function () {
        var d = A.decks.filter(function (x) { return x.deck_id === b.closest('[data-did]').dataset.did; })[0];
        if (b.dataset.dact === 'edit') openDeck(d);
        if (b.dataset.dact === 'dup') duplicateDeck(d);
      };
    });
  }

  async function duplicateDeck(d) {
    var title = prompt('複製「' + d.title + '」，新圖鑑名稱：', d.title + '（副本）');
    if (!title) return;
    try { await call('adminSaveDeck', { title: title.trim(), kind: d.kind, style: d.style, cards: d.cards }); Q.toast('已複製', 'ok'); loadDecks(); } catch (e) { /* */ }
  }

  function openDeck(d) {
    A.editDeck = d ? { deck_id: d.deck_id, title: d.title, kind: d.kind, style: d.style, cards: d.cards.map(function (c) { return Object.assign({}, c); }) }
      : { deck_id: '', title: '', kind: 'nature', style: 'foil', cards: [] };
    A.deckSel = A.editDeck.cards.length ? 0 : -1;
    $('#dk-heading').textContent = d ? '編輯圖鑑本' : '新增圖鑑本';
    $('#dk-title').value = A.editDeck.title; $('#dk-kind').value = A.editDeck.kind; $('#dk-style').value = A.editDeck.style;
    $('#dk-names').value = '';
    $('#dk-delete-deck').classList.toggle('hidden', !d);
    renderDeckEditor();
    $('#m-deck').classList.remove('hidden');
  }

  function dkOpts() { return { kind: A.editDeck.kind, style: A.editDeck.style }; }

  function renderDeckEditor() {
    var dk = A.editDeck, info = KIND_INFO[dk.kind] || KIND_INFO.nature;
    // 類型相關：屬性選單與數值名稱
    $('#dk-type').innerHTML = Object.keys(info.types).map(function (k) { return '<option value="' + k + '">' + info.types[k] + '</option>'; }).join('');
    $('#dk-l-hp').textContent = info.stats[0]; $('#dk-l-atk').textContent = info.stats[1]; $('#dk-l-def').textContent = info.stats[2];
    $('#dk-count').textContent = '卡牌　共 ' + dk.cards.length + ' 張（上限 80）';
    $('#dk-list').innerHTML = dk.cards.map(function (c, i) {
      return '<button type="button" class="dk-item' + (i === A.deckSel ? ' sel' : '') + '" data-i="' + i + '">' + Q.cardHtml(Object.assign({ number: i + 1 }, c), Object.assign(dkOpts(), { mini: true })) + '</button>';
    }).join('') || '<div class="help">還沒有卡牌。在左邊貼上名稱，按「產生卡牌」。</div>';
    $$('#dk-list [data-i]').forEach(function (b) { b.onclick = function () { readDeckForm(); A.deckSel = +b.dataset.i; renderDeckEditor(); }; });
    var c = dk.cards[A.deckSel];
    $('#dk-editor').classList.toggle('hidden', !c);
    if (c) {
      $('#dk-pos').textContent = (A.deckSel + 1) + ' / ' + dk.cards.length + '　' + (c.name || '');
      $('#dk-prev').disabled = A.deckSel <= 0; $('#dk-next').disabled = A.deckSel >= dk.cards.length - 1;
      $('#dk-name').value = c.name; $('#dk-rarity').value = c.rarity; $('#dk-type').value = c.type; $('#dk-art').value = c.art || '';
      $('#dk-art_fit').value = c.art_fit || 'contain'; $('#dk-art_pos').value = c.art_pos || 'center';
      $('#dk-hp').value = c.hp; $('#dk-atk').value = c.atk; $('#dk-def').value = c.def;
      $('#dk-skill_name').value = c.skill_name || ''; $('#dk-skill_desc').value = c.skill_desc || ''; $('#dk-story').value = c.story || '';
      refreshImgPrev('dk-art');
      $('#dk-credit').textContent = c.art_credit ? '圖片來源：' + c.art_credit : '';
    }
    renderDeckPreview();
  }

  function renderDeckPreview() {
    var c = A.editDeck.cards[A.deckSel];
    $('#dk-preview').innerHTML = c ? Q.cardHtml(Object.assign({ number: A.deckSel + 1 }, c), Object.assign(dkOpts(), { big: true, tilt: true })) : '';
    Q.bindTilt($('#dk-preview'));
  }

  /** 表單 → 目前這張卡 */
  function readDeckForm() {
    var c = A.editDeck.cards[A.deckSel];
    if (!c) return;
    var newArt = $('#dk-art').value.trim();
    if (newArt !== (c.art || '')) { c.art_credit = ''; $('#dk-credit').textContent = ''; }   // 換了別張圖：舊圖的授權資訊不再適用
    c.name = $('#dk-name').value.trim().slice(0, 20) || c.name; c.rarity = $('#dk-rarity').value; c.type = $('#dk-type').value; c.art = newArt;
    c.art_fit = $('#dk-art_fit').value; c.art_pos = $('#dk-art_pos').value;
    c.hp = Number($('#dk-hp').value) || 0; c.atk = Number($('#dk-atk').value) || 0; c.def = Number($('#dk-def').value) || 0;
    c.skill_name = $('#dk-skill_name').value.trim(); c.skill_desc = $('#dk-skill_desc').value.trim(); c.story = $('#dk-story').value.trim();
  }

  function genDeckFromNames() {
    var names = parseNames($('#dk-names').value), dk = A.editDeck, have = {};
    dk.cards.forEach(function (c) { have[c.name] = 1; });
    var added = 0;
    names.forEach(function (n) {
      if (have[n] || dk.cards.length >= 80) return;
      have[n] = 1; dk.cards.push(genCard(n, dk.kind, 0)); added++;
    });
    if (!names.length) return Q.toast('請先貼上名稱（一行一個）', 'warn');
    $('#dk-names').value = '';
    if (A.deckSel < 0 && dk.cards.length) A.deckSel = 0;
    Q.toast('已產生 ' + added + ' 張卡牌' + (names.length > added ? '（' + (names.length - added) + ' 個名稱重複或超過上限，已略過）' : ''), added ? 'ok' : 'warn');
    renderDeckEditor();
  }

  function rerollCard(i) {
    var dk = A.editDeck, c = dk.cards[i];
    var n = genCard(c.name, dk.kind, Math.floor(Math.random() * 1e6) + 1);
    n.id = c.id; n.art = /^(https?:|data:)/i.test(c.art || '') ? c.art : n.art; n.art_credit = n.art === c.art ? (c.art_credit || '') : '';   // 上傳的圖保留
    dk.cards[i] = n;
  }

  async function saveDeck() {
    readDeckForm();
    var dk = A.editDeck;
    dk.title = $('#dk-title').value.trim();
    if (!dk.title) return Q.toast('請輸入圖鑑名稱', 'warn');
    if (!dk.cards.length) return Q.toast('至少要有一張卡牌', 'warn');
    try {
      var sr = await call('adminSaveDeck', { deckId: dk.deck_id, title: dk.title, kind: dk.kind, style: dk.style, cards: dk.cards });
      var lost = [];
      (sr.cards || []).forEach(function (sc, i) { if (dk.cards[i] && String(dk.cards[i].art || '') !== String(sc.art || '')) lost.push(i + 1); });
      $('#m-deck').classList.add('hidden');
      Q.toast('圖鑑已儲存', 'ok');
      if (lost.length) Q.toast('⚠️ 第 ' + lost.slice(0, 8).join('、') + ' 張卡的圖片網址沒有完整存下來（網址太長？），請改用「⬆ 上傳」或重新搜尋', 'warn', 9000);
      await Promise.all([loadDecks(), loadProjects()]);
    } catch (e) { /* */ }
  }

  async function deleteDeck() {
    var dk = A.editDeck;
    if (!dk.deck_id) return;
    var used = (A.decks.filter(function (x) { return x.deck_id === dk.deck_id; })[0] || { used_by: [] }).used_by;
    if (!confirm('刪除圖鑑「' + dk.title + '」？' + (used.length ? '\n\n正在使用它的專案（' + used.join('、') + '）會變成不使用圖鑑。' : '') + '\n此動作無法復原。')) return;
    try {
      var dkr = await call('adminDeleteDeck', { deckId: dk.deck_id });
      $('#m-deck').classList.add('hidden');
      Q.toast('已刪除', 'ok'); showBackup(dkr);
      await Promise.all([loadDecks(), loadProjects()]);
    } catch (e) { /* */ }
  }

  /* ---------- 搜尋圖片（維基共享資源，只收可自由使用的授權） ---------- */
  function stripHtml(x) { var d = document.createElement('div'); d.innerHTML = x || ''; return (d.textContent || '').replace(/\s+/g, ' ').trim(); }

  async function searchCommons(q, limit) {
    var url = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrnamespace=6&gsrlimit=' + (limit || 24) +
      '&gsrsearch=' + encodeURIComponent(q + ' filetype:bitmap') + '&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=400&iiextmetadatafilter=LicenseShortName|Artist|Credit';
    var res = await fetch(url);
    if (!res.ok) throw new Error('搜尋失敗（' + res.status + '）');
    var data = await res.json(), pages = (data.query && data.query.pages) || {};
    return Object.keys(pages).map(function (k) { return pages[k]; }).sort(function (a, b) { return a.index - b.index; }).map(function (pg) {
      var ii = (pg.imageinfo || [])[0];
      if (!ii || !/^image\/(jpeg|png|webp)/.test(ii.mime || '') || (ii.width || 0) < 300) return null;
      var md = ii.extmetadata || {}, lic = stripHtml((md.LicenseShortName || {}).value);
      if (!lic || /fair use|non-free/i.test(lic)) return null;
      var artist = stripHtml((md.Artist || {}).value) || stripHtml((md.Credit || {}).value) || '作者不詳';
      return { title: String(pg.title || '').replace(/^File:/, ''), thumb: ii.thumburl || ii.url, license: lic, artist: artist.slice(0, 60), page: ii.descriptionurl };
    }).filter(function (x) { return x; });
  }

  /** 用中文維基百科找出這個名稱對應的英文條目名稱（物種通常有），拿來補充搜尋，中文名稱圖片少時很有用 */
  async function resolveEnglishName(q) {
    try {
      var url = 'https://zh.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrlimit=1&gsrsearch=' + encodeURIComponent(q) + '&prop=langlinks&lllang=en&lllimit=1';
      var res = await fetch(url), data = await res.json(), pages = (data.query && data.query.pages) || {}, k = Object.keys(pages)[0];
      var ll = k && pages[k].langlinks && pages[k].langlinks[0];
      return ll ? (ll['*'] || ll.title || '') : '';
    } catch (e) { return ''; }
  }

  /** 先用原名稱搜；結果太少就再用對應的英文名稱補充搜尋 */
  async function searchSmart(q, limit) {
    var res = await searchCommons(q, limit), via = '';
    if (res.length < 4) {
      var eng = await resolveEnglishName(q);
      if (eng && eng.toLowerCase() !== q.toLowerCase()) {
        var more = await searchCommons(eng, limit), seen = {};
        res.forEach(function (r) { seen[r.title] = 1; });
        more.forEach(function (r) { if (!seen[r.title]) res.push(r); });
        via = eng;
      }
    }
    res.via = via;
    return res;
  }

  function creditOf(r) { return (r.artist + '／' + r.license + '／維基共享資源').slice(0, 160); }

  /** 把遠端圖片存到雲端硬碟；失敗就沿用原網址 */
  async function mirrorUrl(url) {
    if (!/^https:\/\/upload\.wikimedia\.org\//.test(url)) return url;
    try { var r = await Q.api('adminImportImage', { adminKey: A.key, url: url }); return r.url || url; } catch (e) { return url; }
  }

  function openImgSearch() {
    var c = A.editDeck.cards[A.deckSel];
    if (!c) return;
    $('#is-q').value = c.name; $('#is-grid').innerHTML = ''; $('#is-status').textContent = '';
    $('#m-imgsearch').classList.remove('hidden');
    runImgSearch();
  }

  async function runImgSearch() {
    var q = $('#is-q').value.trim();
    if (!q) return;
    $('#is-status').textContent = '搜尋中…'; $('#is-grid').innerHTML = '';
    try {
      var list = await searchSmart(q, 30);
      $('#is-status').textContent = list.length ? '找到 ' + list.length + ' 張可自由使用的圖片' + (list.via ? '（已用英文名稱「' + list.via + '」補充搜尋）' : '') + '，點一張就會套用到這張卡。' : '沒有找到合適的圖片，可以換個關鍵字（英文、學名、更完整的名稱）。';
      $('#is-grid').innerHTML = list.map(function (r, i) {
        return '<button type="button" class="is-item" data-i="' + i + '"><img src="' + esc(r.thumb) + '" alt="" loading="lazy"><small>' + esc(r.license) + '</small><small class="is-by">' + esc(r.artist) + '</small></button>';
      }).join('');
      $$('#is-grid [data-i]').forEach(function (b) {
        b.onclick = async function () {
          var r = list[+b.dataset.i], c = A.editDeck.cards[A.deckSel];
          if (!c) return;
          $('#is-status').textContent = '套用中，並存到雲端硬碟…';
          c.art = await mirrorUrl(r.thumb); c.art_credit = creditOf(r);
          $('#m-imgsearch').classList.add('hidden');
          renderDeckEditor();
          Q.toast('已套用圖片，授權資訊已記在卡片上', 'ok');
        };
      });
    } catch (e) { $('#is-status').textContent = e.message || '搜尋失敗，請檢查網路'; }
  }

  /** 為還沒有圖片（只有 emoji）的卡牌自動找第一張合適的圖，之後可再逐張更換 */
  async function autoFindImages() {
    var cards = A.editDeck.cards.filter(function (c) { return !/^(https?:|data:image)/i.test(c.art || ''); });
    if (!cards.length) return Q.toast('每張卡都已經有圖片了', 'ok');
    if (!confirm('要為 ' + cards.length + ' 張還沒有圖片的卡，自動搜尋第一張合適的圖嗎？\n\n• 依名稱搜尋，找到的圖不一定符合，完成後請逐張檢查、不滿意的可以按 🔍 換圖。\n• 約需 ' + Math.ceil(cards.length * 0.7 / 60 * 10) / 10 + ' 分鐘，可以隨時關閉視窗中斷。')) return;
    var btn = $('#dk-auto-img'), old = btn.textContent, found = 0, i = 0;
    btn.disabled = true;
    A.stopAuto = false;
    for (; i < cards.length && !A.stopAuto && !$('#m-deck').classList.contains('hidden'); i++) {
      btn.textContent = '搜尋中 ' + (i + 1) + ' / ' + cards.length + '…';
      try {
        var list = await searchSmart(cards[i].name, 8);
        if (list.length) { cards[i].art = list[0].thumb; cards[i].art_credit = creditOf(list[0]); found++; }
      } catch (e) { /* 這張找不到就略過 */ }
      await new Promise(function (r) { setTimeout(r, 350); });
    }
    btn.disabled = false; btn.textContent = old;
    renderDeckEditor();
    Q.toast('完成：' + found + ' / ' + cards.length + ' 張找到圖片。請逐張檢查，再按「圖片存到雲端硬碟」與「儲存圖鑑」。', found ? 'ok' : 'warn', 7000);
  }

  /** 把圖鑑裡所有維基媒體的遠端圖片，存到自己的雲端硬碟（活動當天比較穩定） */
  async function mirrorAllImages() {
    var cards = A.editDeck.cards.filter(function (c) { return /^https:\/\/upload\.wikimedia\.org\//.test(c.art || ''); });
    if (!cards.length) return Q.toast('沒有需要存到雲端硬碟的圖片', 'ok');
    if (!confirm('把 ' + cards.length + ' 張圖片存到你的雲端硬碟？（約 ' + Math.ceil(cards.length * 2.5 / 60) + ' 分鐘，過程中請不要關閉視窗）')) return;
    var btn = $('#dk-mirror'), old = btn.textContent, ok = 0;
    btn.disabled = true;
    for (var i = 0; i < cards.length && !$('#m-deck').classList.contains('hidden'); i++) {
      btn.textContent = '存檔中 ' + (i + 1) + ' / ' + cards.length + '…';
      var u = await mirrorUrl(cards[i].art);
      if (u !== cards[i].art) { cards[i].art = u; ok++; }
    }
    btn.disabled = false; btn.textContent = old;
    renderDeckEditor();
    Q.toast('已存到雲端硬碟 ' + ok + ' / ' + cards.length + ' 張。記得按「儲存圖鑑」。', ok ? 'ok' : 'warn', 6000);
  }

  function bindDeckUi() {
    $('#btn-new-deck').onclick = function () { openDeck(null); };
    $('#dk-art-search').onclick = function () { readDeckForm(); openImgSearch(); };
    $('#is-go').onclick = runImgSearch;
    $('#is-q').addEventListener('keydown', function (e) { if (e.key === 'Enter') runImgSearch(); });
    $('#dk-auto-img').onclick = function () { readDeckForm(); autoFindImages(); };
    $('#dk-mirror').onclick = mirrorAllImages;
    $('#dk-gen').onclick = genDeckFromNames;
    $('#dk-save').onclick = saveDeck;
    $('#dk-delete-deck').onclick = deleteDeck;
    $('#dk-kind').onchange = function () {
      if (A.editDeck.cards.length && !confirm('改變類型會換掉屬性名稱與數值名稱，已經產生的卡牌內容不會自動改變。要繼續嗎？')) { this.value = A.editDeck.kind; return; }
      readDeckForm(); A.editDeck.kind = this.value; renderDeckEditor();
    };
    $('#dk-style').onchange = function () { A.editDeck.style = this.value; renderDeckEditor(); };
    $('#dk-reroll-all').onclick = function () {
      if (!A.editDeck.cards.length) return;
      if (!confirm('全部卡牌重新隨機屬性、數值、技能與故事？（名稱與你上傳的圖會保留）')) return;
      A.editDeck.cards.forEach(function (c, i) { rerollCard(i); });
      renderDeckEditor();
    };
    var dkStep = function (dir) {   // 上一張／下一張：先把目前這張的修改存起來，再換
      var j = A.deckSel + dir;
      if (j < 0 || j >= A.editDeck.cards.length) return false;
      readDeckForm(); A.deckSel = j; renderDeckEditor();
      return true;
    };
    $('#dk-prev').onclick = function () { dkStep(-1); };
    $('#dk-next').onclick = function () { dkStep(1); };
    // 手機：在編輯區或卡片預覽上左右滑動換張（輸入欄位、按鈕上不觸發；要明顯的橫向滑動才算，不影響上下捲動）
    (function () {
      var x0 = null, y0 = 0, t0 = 0;
      var begin = function (e) {
        if (e.touches.length !== 1 || (e.target.closest && e.target.closest('input, textarea, select, button, label, a'))) { x0 = null; return; }
        x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now();
      };
      var finish = function (e) {
        if (x0 == null) return;
        var dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0, fast = Date.now() - t0 < 900;
        x0 = null;
        if (!fast || Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
        var dir = dx < 0 ? 1 : -1, changed = dkStep(dir);
        if (!changed) { swipeBadge(dir > 0 ? '已經是最後一張' : '已經是第一張', true); return; }
        ['#dk-editor', '#dk-preview'].forEach(function (s) {   // 編輯欄位與卡片預覽都滑一下，看得出有換張
          var el = $(s); el.classList.remove('slide-l', 'slide-r'); void el.offsetWidth; el.classList.add(dx < 0 ? 'slide-l' : 'slide-r');
        });
        swipeBadge('‹ ' + (A.deckSel + 1) + ' / ' + A.editDeck.cards.length + '　' + (A.editDeck.cards[A.deckSel].name || '') + ' ›');
        try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) { /* */ }
      };
      // 換張提示：畫面中央短暫顯示「第幾張／共幾張＋名稱」（編輯欄位和卡片不一定同時在畫面上，要有明顯回饋）
      var badgeT = null;
      var swipeBadge = function (text, warn) {
        var b = document.getElementById('dk-swipe-badge');
        if (!b) { b = document.createElement('div'); b.id = 'dk-swipe-badge'; b.setAttribute('role', 'status'); document.body.appendChild(b); }
        b.textContent = text; b.className = 'dk-swipe-badge show' + (warn ? ' warn' : '');
        clearTimeout(badgeT); badgeT = setTimeout(function () { b.classList.remove('show'); }, 1100);
      };
      ['#dk-editor', '#dk-preview'].forEach(function (s) {
        var el = $(s);
        el.addEventListener('touchstart', begin, { passive: true });
        el.addEventListener('touchend', finish, { passive: true });
      });
    })();
    $('#dk-del').onclick = function () {
      if (A.deckSel < 0) return;
      A.editDeck.cards.splice(A.deckSel, 1);
      A.deckSel = Math.min(A.deckSel, A.editDeck.cards.length - 1);
      renderDeckEditor();
    };
    ['#dk-name', '#dk-rarity', '#dk-type', '#dk-art', '#dk-art_fit', '#dk-art_pos', '#dk-hp', '#dk-atk', '#dk-def', '#dk-skill_name', '#dk-skill_desc', '#dk-story'].forEach(function (sel) {
      var ev = function () {
        readDeckForm(); renderDeckPreview();
        var item = $('#dk-list .dk-item.sel'); if (item && A.deckSel >= 0) item.innerHTML = Q.cardHtml(Object.assign({ number: A.deckSel + 1 }, A.editDeck.cards[A.deckSel]), Object.assign(dkOpts(), { mini: true }));
      };
      $(sel).addEventListener('input', ev); $(sel).addEventListener('change', ev);
    });
    $('#dk-art').addEventListener('input', function () { refreshImgPrev('dk-art'); });
    bindImageField('dk-art', 'stage', function () { return 'decks'; });
  }

  /** 專案設定：選用哪一本圖鑑 */
  function renderDeckSelect(cur) {
    $('#mp-deck_id').innerHTML = '<option value="">（不使用圖鑑）</option>' + (A.decks || []).map(function (d) {
      return '<option value="' + esc(d.deck_id) + '">' + esc(d.title) + '（' + d.cards.length + ' 張・' + deckKindLabel(d.kind).replace(/^\S+ /, '') + '）</option>';
    }).join('');
    $('#mp-deck_id').value = cur || '';
  }

  /** 關卡設定：這一關給哪些卡 */
  function renderStageCards(d) {
    var p = A.projects.filter(function (x) { return x.project_id === A.pid; })[0], cards = (p && p.cards) || [];
    $('#ms-card-wrap').classList.toggle('hidden', !cards.length);
    $('#ms-card_id').innerHTML = '<option value="">（不固定給）</option>' + cards.map(function (c, i) {
      return '<option value="' + esc(c.id) + '">No.' + ('00' + (i + 1)).slice(-3) + ' ' + esc(c.name) + '（' + ({ normal: '普通', rare: '稀有', legend: '傳說' }[c.rarity]) + '）</option>';
    }).join('');
    $('#ms-card_id').value = (d && d.card_id) || '';
  }

  /** 關卡列表上方：圖鑑張數與關卡最多可給幾張 */
  function renderDeckCover() {
    var box = $('#deck-cover'), p = A.projects.filter(function (x) { return x.project_id === A.pid; })[0];
    if (!box) return;
    var cards = (p && p.cards) || [];
    box.classList.toggle('hidden', !cards.length);
    if (!cards.length) return;
    var ids = {}, rnd = 0;
    A.stages.filter(function (s) { return s.enabled; }).forEach(function (s) { if (s.card_id) ids[s.card_id] = 1; rnd += s.card_random || 0; });
    var fixed = Object.keys(ids).filter(function (id) { return cards.some(function (c) { return c.id === id; }); }).length, can = Math.min(cards.length, fixed + rnd);
    box.innerHTML = '🃏《' + esc(p.deck_title) + '》' + cards.length + ' 張，關卡最多可給 <b>' + can + '</b> 張' +
      (can < cards.length ? ' <span style="color:var(--red)">⚠️ 無法全收集，請增加關卡的卡牌數。</span>' : ' ✅ 可全收集');
  }

  /* ---------- 圖片上傳（封面／關卡圖） ---------- */
  function compressImage(file, max, quality) {
    max = max || 1600; quality = quality || 0.82;
    return new Promise(function (resolve, reject) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var s = Math.min(1, max / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        var cx = c.getContext('2d');
        URL.revokeObjectURL(url);
        // PNG（可能有透明背景）：盡量保留成 PNG；太大才轉 JPEG
        if (file.type === 'image/png') {
          cx.drawImage(img, 0, 0, c.width, c.height);
          var png = c.toDataURL('image/png');
          if (png.length * 0.75 <= 2 * 1024 * 1024) return resolve(png);
        }
        // 轉 JPEG：先鋪白底，否則透明的地方會變成黑色
        cx.fillStyle = '#fff'; cx.fillRect(0, 0, c.width, c.height);
        cx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error(/heic|heif/i.test(file.type + file.name) ? '這個瀏覽器無法處理 HEIC 圖片。iPhone 請到「設定 → 相機 → 格式」改選「最相容」，或改用 JPG／PNG。' : '無法讀取這張圖片，請換一張'));
      };
      img.src = url;
    });
  }

  function refreshImgPrev(id) {
    var url = $('#' + id).value.trim(), prev = $('#' + id + '-prev');
    if ((id === 'ms-item_icon' || id === 'dk-art') && !/^(https?:|data:image)/i.test(url)) url = '';
    prev.classList.toggle('hidden', !url);
    if (url) prev.src = url; else prev.removeAttribute('src');
  }

  /** id 是網址輸入框；旁邊有 -pick / -clear / -file / -prev。kind: cover | stage */
  function bindImageField(id, kind, getProjectId) {
    var input = $('#' + id), file = $('#' + id + '-file'), pick = $('#' + id + '-pick');
    input.addEventListener('input', function () { refreshImgPrev(id); });
    var fire = function () { refreshImgPrev(id); input.dispatchEvent(new Event('input', { bubbles: true })); };
    $('#' + id + '-clear').onclick = function () { input.value = ''; fire(); };
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
        input.value = r.url; fire();
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
      try {
        var chk = $('#login-remember');
        if (chk && chk.checked) localStorage.setItem(REMEMBER_STORE, JSON.stringify({ k: A.key, exp: Date.now() + REMEMBER_DAYS * 86400000 }));
        else if (chk) localStorage.removeItem(REMEMBER_STORE);
      } catch (e) { /* */ }
      $('#link-sheet').href = r.spreadsheet_url;
      $('#v-login').classList.add('hidden');
      $('#v-app').classList.remove('hidden');
      await Promise.all([loadDecks(), loadProjects()]);   // 兩份清單同時讀，登入比較快
      setTab('live');   // 預設進「現場」：手機上最常用的畫面
    } catch (e) { /* toast 已顯示 */ }
  }

  function logout() {
    try { sessionStorage.removeItem(KEY_STORE); localStorage.removeItem(REMEMBER_STORE); } catch (e) { /* */ }
    A.key = '';
    clearInterval(A.monTimer);
    $('#v-app').classList.add('hidden');
    $('#v-login').classList.remove('hidden');
  }

  function setTab(tab) {
    A.tab = tab;
    window.scrollTo(0, 0);   // 換分頁一律回到最上面
    $$('.tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === tab); });
    ['live', 'projects', 'stages', 'decks', 'monitor'].forEach(function (t) { $('#t-' + t).classList.toggle('hidden', t !== tab); });
    if (tab === 'decks') loadDecks();
    clearInterval(A.monTimer);
    if (tab === 'stages') { if (A.pid) selectProject(A.pid); else if (A.projects[0]) selectProject(A.projects[0].project_id); }
    if (tab === 'monitor') { if (A.pid) $('#mon-project').value = A.pid; loadMonitor(); setMonitorTimer(); }
    if (tab === 'live') { if (A.pid) $('#live-project').value = A.pid; loadLive(); setLiveTimer(); }
  }

  /* ---------- 現場模式：關主手機上最常用的畫面 ---------- */
  function setLiveTimer() {
    clearInterval(A.monTimer);
    if ($('#live-auto').checked && A.tab === 'live') A.monTimer = setInterval(function () { loadLive(true); }, 20000);
  }
  async function loadLive(silent) {
    var pid = $('#live-project').value;
    if (!pid) { $('#live-list').innerHTML = '<div class="card muted">還沒有專案，請先到「專案」新增。</div>'; return; }
    A.pid = pid;
    try {
      var fn = function () { return Q.api('adminSessions', { adminKey: A.key, projectId: pid, runCode: '' }); };
      renderLive(silent ? await fn() : await Q.run(fn));
    } catch (e) { if (silent) Q.toast(e.message, 'err'); }
  }
  function renderLive(r) {
    var ss = r.sessions.filter(function (s) { return !s.test; }), now = Date.now(), rts = r.routes || [];
    var routeName = function (id) { var x = rts.filter(function (y) { return y.id === id; })[0]; return x ? x.name : ''; };
    var stale = function (s) { return s.status === 'playing' && s.last_active_at && now - new Date(s.last_active_at).getTime() > 10 * 60000; };
    ss.sort(function (a, b) { return (stale(b) - stale(a)) || (a.status === 'playing' ? 0 : 1) - (b.status === 'playing' ? 0 : 1) || String(b.last_active_at).localeCompare(String(a.last_active_at)); });
    $('#live-playing').textContent = ss.filter(function (s) { return s.status === 'playing'; }).length;
    $('#live-finished').textContent = ss.filter(function (s) { return s.status === 'finished'; }).length;
    $('#live-stale').textContent = ss.filter(stale).length;
    $('#live-updated').textContent = '更新於 ' + Q.fmtTime(new Date());
    var stTxt = { playing: ['進行中', 'amber'], finished: ['完成', 'green'], timeup: ['超時', 'red'] };
    $('#live-list').innerHTML = ss.length ? ss.map(function (s) {
      var t = stTxt[s.status] || [s.status, 'gray'], mins = s.last_active_at ? Math.round((now - new Date(s.last_active_at).getTime()) / 60000) : null;
      var pct = s.total ? Math.round(s.solved / s.total * 100) : 0;
      return '<div class="live-card ' + esc(s.status) + (stale(s) ? ' stale' : '') + '">' +
        '<div class="lc-head">' + (s.avatar ? esc(s.avatar) + ' ' : '') + '<b>' + esc(s.team_name) + '</b><span class="chip ' + t[1] + '">' + t[0] + '</span>' +
        (routeName(s.route) ? '<span class="chip gray">' + esc(routeName(s.route)) + '</span>' : '') + '<span class="grow"></span><b>' + s.score + ' 分</b></div>' +
        '<div class="bar" role="img" aria-label="完成 ' + s.solved + ' / ' + s.total + ' 關"><i style="width:' + pct + '%"></i></div>' +
        '<div class="small">' + s.solved + ' / ' + s.total + ' 關' + (s.current_stage ? '・目前：' + esc(s.current_stage) : '') + '</div>' +
        '<div class="small ' + (stale(s) ? '' : 'muted') + '">' + (mins == null ? '' : (stale(s) ? '⚠️ ' : '') + (mins < 1 ? '剛剛' : mins + ' 分鐘前') + '有動作') + '・代碼 ' + esc(s.code) + '</div>' +
        '<div class="lc-act">' +
          (s.last_lat != null ? '<a class="btn ghost" target="_blank" rel="noopener" href="https://www.google.com/maps?q=' + s.last_lat + ',' + s.last_lng + '">📍 看位置</a>' : '') +
          (s.failed ? '<button class="ghost" type="button" data-live-reset="' + esc(s.session_id) + '">🔄 還原未通過（' + s.failed + '）</button>' : '') +
        '</div></div>';
    }).join('') : '<div class="card muted">還沒有隊伍開始闖關。</div>';
    $$('#live-list [data-live-reset]').forEach(function (b) {
      b.onclick = async function () {
        if (!confirm('還原這支隊伍所有「未通過」的關卡？\n\n作答次數會歸零，讓他們重新挑戰。')) return;
        try { var rr = await call('adminResetFailed', { sessionId: b.dataset.liveReset }); Q.toast('已還原 ' + rr.reset + ' 個關卡', 'ok'); loadLive(); } catch (e) { /* */ }
      };
    });
  }

  function playerUrl(pid, run, route, team) {
    var base = location.href.replace(/admin\.html.*$/, '').replace(/[?#].*$/, '');
    return base + 'index.html?p=' + encodeURIComponent(pid) + (run ? '&run=' + encodeURIComponent(run) : '') +
      (team ? '&team=' + encodeURIComponent(team) : '') + (route ? '&route=' + encodeURIComponent(route) : '');
  }

  /* ---------- 專案 ---------- */
  async function loadProjects() {
    var r = await call('adminListProjects');
    A.projects = r.projects;
    var opts = A.projects.map(function (p) { return '<option value="' + esc(p.project_id) + '">' + esc(p.name) + '（' + esc(p.project_id) + '）</option>'; }).join('');
    $('#stage-project').innerHTML = opts;
    $('#mon-project').innerHTML = opts;
    $('#live-project').innerHTML = opts;
    if (A.pid) { $('#stage-project').value = A.pid; $('#mon-project').value = A.pid; $('#live-project').value = A.pid; }
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
        '<button class="sm ghost" data-act="check">✅ 活動前檢查</button>' +
        (p.leaderboard_live ? '<button class="sm ghost" data-act="board">🏆 排行榜</button>' : '') +
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
        if (act === 'check') openCheck(pid);
        if (act === 'board') window.open(playerUrl(pid, '').replace('index.html', 'board.html'), '_blank');
        if (act === 'dup') duplicateProject(p);
        if (act === 'del') deleteProject(p);
      };
    });
  }

  /* ---------- 路線與隊伍名單 ---------- */
  var AVATARS = ['🦊', '🐼', '🐯', '🐸', '🦉', '🐙', '🦄', '🐳', '🦖', '🐧', '🐝', '🦋', '🐢', '🐬', '🦁', '🐰'];
  var ROUTE_COLORS = ['#e63946', '#1d5fa8', '#2f9e44', '#f59f00', '#7048e8', '#0ca678', '#d6336c', '#495057'];
  function newToken() {
    var chars = 'abcdefghjkmnpqrstuvwxyz23456789', out = '', buf = new Uint8Array(8);
    (window.crypto || window.msCrypto).getRandomValues(buf);
    for (var i = 0; i < 8; i++) out += chars.charAt(buf[i] % chars.length);
    return out;
  }
  function projRoutes(pid) {
    var p = A.projects.filter(function (x) { return x.project_id === pid; })[0];
    return (p && p.routes) || [];
  }
  function projTeams(pid) {
    var p = A.projects.filter(function (x) { return x.project_id === pid; })[0];
    return (p && p.teams) || [];
  }
  function routeLabel(pid, token) {
    var r = projRoutes(pid).filter(function (x) { return x.id === token; })[0];
    return r ? r.name : '';
  }
  function routeChip(pid, token) {
    var r = projRoutes(pid).filter(function (x) { return x.id === token; })[0];
    if (!r) return '';
    return '<span class="chip" style="background:' + esc(r.color || '#e6e3dc') + ';color:' + (r.color ? '#fff' : 'inherit') + '">' + esc(r.name) + '</span>';
  }

  function renderRouteEditor() {
    var box = $('#mp-routes');
    box.innerHTML = A.editRoutes.length ? A.editRoutes.map(function (r, i) {
      return '<div class="route-row" data-i="' + i + '">' +
        '<input type="color" data-f="color" value="' + esc(r.color || '#1d5fa8') + '" title="路線顏色">' +
        '<input data-f="name" placeholder="路線名稱，例如：月眉路線" maxlength="30" value="' + esc(r.name) + '">' +
        '<code class="route-token" title="路線代碼（隨機產生，放在 QR Code 裡）">' + esc(r.id) + '</code>' +
        '<button type="button" class="sm ghost" data-regen title="重新產生代碼（舊的 QR Code 會失效）">🔄</button>' +
        '<button type="button" class="sm ghost" data-del title="刪除這條路線">🗑</button></div>';
    }).join('') : '<div class="help" style="margin:0 0 6px">還沒有路線。</div>';
    $$('#mp-routes [data-f]').forEach(function (inp) {
      inp.oninput = function () { A.editRoutes[+inp.closest('.route-row').dataset.i][inp.dataset.f] = inp.value; if (inp.dataset.f === 'name') renderTeamEditor(); };
    });
    $$('#mp-routes [data-regen]').forEach(function (b) {
      b.onclick = function () {
        if (!confirm('重新產生這條路線的代碼？\n舊的 QR Code 會失效，需要重新列印。（隊伍名單裡的路線會自動跟著換）')) return;
        var r = A.editRoutes[+b.closest('.route-row').dataset.i], old = r.id;
        r.id = newToken();
        A.editTeams.forEach(function (t) { if (t.route === old) t.route = r.id; });
        renderRouteEditor(); renderTeamEditor();
      };
    });
    $$('#mp-routes [data-del]').forEach(function (b) {
      b.onclick = function () {
        var r = A.editRoutes[+b.closest('.route-row').dataset.i];
        if (!confirm('刪除路線「' + (r.name || r.id) + '」？\n已經指定到這條路線的隊伍與關卡設定會失效。')) return;
        A.editRoutes = A.editRoutes.filter(function (x) { return x !== r; });
        A.editTeams.forEach(function (t) { if (t.route === r.id) t.route = ''; });
        renderRouteEditor(); renderTeamEditor();
      };
    });
  }

  function renderTeamEditor() {
    var box = $('#mp-teams');
    var opts = '<option value="">（自動平均分配）</option>' + A.editRoutes.map(function (r) { return '<option value="' + esc(r.id) + '">' + esc(r.name || r.id) + '</option>'; }).join('');
    box.innerHTML = A.editTeams.length ? A.editTeams.map(function (t, i) {
      return '<div class="route-row" data-i="' + i + '">' +
        '<input data-f="name" placeholder="隊伍名稱" maxlength="30" value="' + esc(t.name) + '">' +
        '<select data-f="avatar" title="隊伍造型"><option value="">造型：玩家自選</option>' + AVATARS.map(function (a) { return '<option value="' + a + '">' + a + '</option>'; }).join('') + '</select>' +
        (A.editRoutes.length ? '<select data-f="route">' + opts + '</select>' : '') +
        '<button type="button" class="sm ghost" data-del title="刪除這支隊伍">🗑</button></div>';
    }).join('') : '<div class="help" style="margin:0 0 6px">還沒有隊伍名單（玩家可自己輸入隊伍名稱）。</div>';
    $$('#mp-teams .route-row').forEach(function (row) {
      var t = A.editTeams[+row.dataset.i], sel = row.querySelector('select[data-f="route"]'), av = row.querySelector('select[data-f="avatar"]');
      if (sel) sel.value = t.route || '';
      if (av) av.value = t.avatar || '';
    });
    $$('#mp-teams [data-f]').forEach(function (inp) {
      inp.oninput = inp.onchange = function () { A.editTeams[+inp.closest('.route-row').dataset.i][inp.dataset.f] = inp.value; };
    });
    $$('#mp-teams [data-del]').forEach(function (b) {
      b.onclick = function () { A.editTeams.splice(+b.closest('.route-row').dataset.i, 1); renderTeamEditor(); };
    });
  }

  function addRoute() {
    var n = A.editRoutes.length + 1;
    A.editRoutes.push({ id: newToken(), name: '路線 ' + n, color: ROUTE_COLORS[(n - 1) % ROUTE_COLORS.length] });
    renderRouteEditor(); renderTeamEditor();
  }

  function addTeamsFromText() {
    var names = $('#mp-team-bulk-text').value.split(/\r?\n/).map(function (x) { return x.trim(); }).filter(String);
    var have = {};
    A.editTeams.forEach(function (t) { have[t.name] = 1; });
    names.forEach(function (n) { if (!have[n]) { have[n] = 1; A.editTeams.push({ name: n.slice(0, 30), route: '' }); } });
    $('#mp-team-bulk-text').value = '';
    $('#mp-team-bulk-box').classList.add('hidden');
    renderTeamEditor();
  }

  function openProject(p) {
    A.editProjectNew = !p;
    p = p || { status: 'draft', theme: 'retro', unlock_mode: 'sequential', gps_max_accuracy: 80, time_limit_min: 0, show_leaderboard: true };
    $('#mp-title').textContent = A.editProjectNew ? '新增專案' : '專案設定';
    PROJECT_FIELDS.forEach(function (f) {
      var el = $('#mp-' + f);
      if (el.type === 'checkbox') el.checked = !!p[f];
      else if (el.type === 'datetime-local') el.value = Q.toLocalInput(p[f]);
      else el.value = p[f] == null ? '' : p[f];
    });
    renderDeckSelect(p.deck_id || '');
    if (!p.theme) $('#mp-theme').value = 'retro';
    A.editRoutes = (p.routes || []).map(function (r) { return { id: r.id, name: r.name, color: r.color }; });
    A.editTeams = (p.teams || []).map(function (t) { return { name: t.name, route: t.route || '', avatar: t.avatar || '' }; });
    $('#mp-team-bulk-box').classList.add('hidden');
    renderRouteEditor(); renderTeamEditor();
    renderThemePrev();
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
    ['time_limit_min', 'gps_max_accuracy', 'wrong_lock_after', 'wrong_lock_sec'].forEach(function (f) { p[f] = p[f] === '' ? '' : Number(p[f]); });
    p.routes = A.editRoutes.filter(function (r) { return r.id; }).map(function (r) { return { id: r.id, name: (r.name || '').trim() || r.id, color: r.color || '' }; });
    p.teams = A.editTeams.map(function (t) { return { name: (t.name || '').trim(), route: t.route || '', avatar: t.avatar || '' }; }).filter(function (t) { return t.name; });
    var seenTeam = {};
    for (var ti = 0; ti < p.teams.length; ti++) {
      if (seenTeam[p.teams[ti].name]) return Q.toast('隊伍名稱重複：' + p.teams[ti].name, 'warn');
      seenTeam[p.teams[ti].name] = 1;
    }
    var seenRoute = {};
    for (var ri = 0; ri < p.routes.length; ri++) {
      if (seenRoute[p.routes[ri].name]) return Q.toast('路線名稱重複：' + p.routes[ri].name, 'warn');
      seenRoute[p.routes[ri].name] = 1;
    }
    // 活動進行中：改路線、隊伍名單、或把專案關閉／改回準備中，會影響正在玩的隊伍
    var orig = !A.editProjectNew && A.projects.filter(function (x) { return x.project_id === p.project_id; })[0];
    if (orig) {
      var sig = function (routes, teams) {
        return JSON.stringify([(routes || []).map(function (r) { return [r.id, r.name]; }), (teams || []).map(function (t) { return [t.name, t.route || '']; })]);
      };
      var changedStruct = sig(orig.routes, orig.teams) !== sig(p.routes, p.teams);
      var closing = orig.status === 'active' && (p.status === 'draft' || p.status === 'closed');
      if ((changedStruct || closing) && !(await guardLive(p.project_id, closing ? '把專案改成「準備中／已結束」後，玩家就無法繼續進入。' : '修改路線或隊伍名單，可能讓正在玩的隊伍進度對不上。'))) return;
    }
    try {
      var r = await call('adminSaveProject', { project: p, isNew: A.editProjectNew });
      // 要開放的專案若有嚴重錯誤，後端會先把狀態退回「準備中」
      if (r.blocked) {
        var go = confirm('這個專案還有以下問題，所以暫時維持「準備中」：\n\n• ' + r.errors.join('\n• ') + '\n\n建議先到「活動前檢查」修正。\n要忽略這些問題、仍然改成開放嗎？（不建議）');
        if (go) { r = await call('adminSaveProject', { project: p, isNew: false, force: true }); }
        else Q.toast('已儲存，狀態維持「準備中」；修正後再改成開放', 'warn', 7000);
      }
      $('#m-project').classList.add('hidden');
      if (!r.blocked) Q.toast('已儲存', 'ok');
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
      var dpr = await call('adminDeleteProject', { projectId: p.project_id, confirmId: typed });
      Q.toast('已刪除', 'ok'); showBackup(dpr);
      if (A.pid === p.project_id) A.pid = '';
      await loadProjects();
    } catch (e) { /* */ }
  }

  /* ---------- 活動前檢查 ---------- */
  async function openCheck(pid) {
    A.checkPid = pid;
    var p = A.projects.filter(function (x) { return x.project_id === pid; })[0];
    $('#ck-title').textContent = '活動前檢查：' + (p ? p.name : pid);
    $('#m-check').classList.remove('hidden');
    $('#ck-list').innerHTML = '<div class="muted">檢查中…</div>';
    try {
      var r = await call('adminCheckProject', { projectId: pid });
      renderCheck(r);
    } catch (e) { $('#ck-list').innerHTML = '<div class="muted">檢查失敗</div>'; }
  }

  function renderCheck(r) {
    var sm = r.summary, icon = { error: '❌', warn: '⚠️', info: 'ℹ️' }, lab = { error: '必須處理', warn: '建議處理', info: '提醒' };
    $('#ck-summary').innerHTML = (sm.error ? '<span class="chip red">❌ ' + sm.error + ' 個必須處理</span>' : '<span class="chip green">✅ 沒有必須處理的問題</span>') +
      (sm.warn ? '<span class="chip amber">⚠️ ' + sm.warn + ' 個建議處理</span>' : '') + (sm.info ? '<span class="chip">ℹ️ ' + sm.info + ' 個提醒</span>' : '') +
      '<span class="chip gray">啟用關卡 ' + r.stage_count + ' 個</span>';
    var order = { error: 0, warn: 1, info: 2 };
    r.items.sort(function (a, b) { return order[a.level] - order[b.level]; });
    $('#ck-list').innerHTML = r.items.length ? r.items.map(function (x, i) {
      return '<div class="ck-item ' + x.level + '"><span class="ck-ic">' + icon[x.level] + '</span><div class="grow"><b>' + lab[x.level] + '</b><div>' + esc(x.text) + '</div></div>' +
        (x.where ? '<button class="sm ghost" data-ck="' + i + '">前往</button>' : '') + '</div>';
    }).join('') : '<div class="ck-item info"><span class="ck-ic">✅</span><div class="grow">所有項目都沒有問題，可以開始活動了！</div></div>';
    $$('#ck-list [data-ck]').forEach(function (b) {
      b.onclick = function () {
        var w = r.items[+b.dataset.ck].where, pid = A.checkPid;
        $('#m-check').classList.add('hidden');
        if (w === 'project') { var p = A.projects.filter(function (x) { return x.project_id === pid; })[0]; if (p) openProject(p); }
        else { A.pid = pid; setTab('stages'); if (w.indexOf('stage:') === 0) setTimeout(function () { var st = findStage(w.slice(6)); if (st) openStage(st); }, 700); }
      };
    });
  }

  /* ---------- 連結／QR ---------- */
  function openLink(pid) {
    A.linkPid = pid;
    $('#ml-run').value = '';
    var teams = projTeams(pid), routes = projRoutes(pid);
    // 有隊伍名單：選隊伍（路線由名單決定）；沒有名單但有路線：選路線；都沒有：只有一般連結
    $('#ml-team-wrap').classList.remove('hidden');
    $('#ml-team-select').classList.toggle('hidden', !teams.length);
    $('#ml-team-input').classList.toggle('hidden', !!teams.length);
    $('#ml-team-select').innerHTML = '<option value="">（不指定：玩家自己從名單選）</option>' + teams.map(function (t) {
      return '<option value="' + esc(t.name) + '">' + esc(t.name) + (t.route ? '（' + esc(routeLabel(pid, t.route)) + '）' : '') + '</option>';
    }).join('');
    $('#ml-team-input').value = '';
    $('#ml-team-help').textContent = teams.length ? '選一支隊伍，QR Code 會自動帶入隊伍名稱和它的路線，玩家掃了不用再選。' : '選填：預先帶入隊伍名稱，玩家掃了就不用自己打。';
    $('#ml-route-wrap').classList.toggle('hidden', !routes.length || !!teams.length);
    $('#ml-route').innerHTML = '<option value="">（不指定：系統平均分配）</option>' + routes.map(function (r) { return '<option value="' + esc(r.id) + '">' + esc(r.name) + '</option>'; }).join('');
    updateLink();
    $('#m-link').classList.remove('hidden');
  }

  /** 目前選擇對應的 { team, route } */
  function linkChoice() {
    var pid = A.linkPid, teams = projTeams(pid);
    if (teams.length) {
      var name = $('#ml-team-select').value, t = teams.filter(function (x) { return x.name === name; })[0];
      return { team: t ? t.name : '', route: t ? t.route : '' };
    }
    return { team: $('#ml-team-input').value.trim(), route: $('#ml-route').value };
  }

  function updateLink() {
    var ch = linkChoice();
    var url = playerUrl(A.linkPid, $('#ml-run').value.trim(), ch.route, ch.team);
    $('#ml-url').value = url;
    $('#ml-open').href = url;
    drawQr($('#ml-qr'), url, 220);
  }

  function drawQr(box, url, size) {
    box.innerHTML = '';
    if (window.QRCode) new QRCode(box, { text: url, width: size, height: size, correctLevel: QRCode.CorrectLevel.M });
    else box.innerHTML = '<span class="small muted">QR Code 元件載入失敗，可複製連結到任一 QR 產生器</span>';
  }

  /** 一次產生全部 QR：有隊伍名單＝每隊一張；沒有名單但有路線＝每條路線一張；都沒有＝一張 */
  function openQrSheet() {
    var pid = A.linkPid, run = $('#ml-run').value.trim();
    var proj = A.projects.filter(function (x) { return x.project_id === pid; })[0] || {};
    var teams = projTeams(pid), routes = projRoutes(pid), cards = [];
    if (teams.length) {
      teams.forEach(function (t) { cards.push({ title: t.name, route: t.route, url: playerUrl(pid, run, t.route, t.name) }); });
    } else if (routes.length) {
      routes.forEach(function (r) { cards.push({ title: r.name, route: r.id, url: playerUrl(pid, run, r.id, '') }); });
    } else {
      cards.push({ title: proj.name || pid, route: '', url: playerUrl(pid, run, '', '') });
    }
    $('#qs-title').textContent = (proj.name || pid) + '：' + (teams.length ? '各隊 QR Code' : routes.length ? '各路線 QR Code' : 'QR Code');
    $('#qs-note').textContent = '共 ' + cards.length + ' 張' + (run ? '・場次 ' + run : '') + '。請用「列印」輸出，每張卡片剪下來發給對應的隊伍。';
    $('#qs-grid').innerHTML = cards.map(function (c, i) {
      return '<div class="qs-card"><div class="qs-title">' + esc(c.title) + '</div>' +
        (c.route ? '<div>' + routeChip(pid, c.route) + '</div>' : '') +
        '<div class="qs-qr" id="qs-qr-' + i + '"></div>' +
        '<div class="qs-proj">' + esc(proj.name || '') + '</div></div>';
    }).join('');
    cards.forEach(function (c, i) { drawQr($('#qs-qr-' + i), c.url, 170); });
    $('#m-qrsheet').classList.remove('hidden');
  }

  /* ---------- 關卡 ---------- */
  /** 目前列表要顯示的關卡（選了路線＝共用關卡＋該路線關卡，依該路線順序） */
  function visibleStages() {
    var route = A.stageRoute || '';
    if (!route) return A.stages;
    var picked = [];
    A.stages.forEach(function (st, i) {
      var m = parseStageRoutes(st.routes), keys = Object.keys(m);
      if (keys.length && !(route in m)) return;
      picked.push({ s: st, o: (route in m && m[route] !== null) ? m[route] : st.order, i: i });
    });
    picked.sort(function (a, b) { return a.o - b.o || a.i - b.i; });
    return picked.map(function (x) { return x.s; });
  }

  function parseStageRoutes(str) {
    var o = {};
    String(str || '').split('|').forEach(function (t) {
      t = t.trim();
      if (!t) return;
      var m = t.split(':');
      o[m[0].trim()] = (m[1] !== undefined && m[1].trim() !== '') ? Number(m[1]) : null;
    });
    return o;
  }

  async function selectProject(pid) {
    if (A.pid !== pid) A.stageRoute = '';
    A.pid = pid;
    $('#stage-project').value = pid;
    try {
      var r = await call('adminGetProject', { projectId: pid });
      A.stages = r.stages;
      var rts = projRoutes(pid), rsel = $('#stage-route');
      rsel.classList.toggle('hidden', !rts.length);
      rsel.innerHTML = '<option value="">全部關卡</option>' + rts.map(function (x) { return '<option value="' + esc(x.id) + '">只看「' + esc(x.name) + '」</option>'; }).join('');
      rsel.value = A.stageRoute || '';
      renderStages();
    } catch (e) { /* */ }
  }

  function renderStages() {
    var list = visibleStages(), filtered = !!A.stageRoute, hasRoutes = projRoutes(A.pid).length > 0;
    var n = list.length;
    $('#stage-rows').innerHTML = n ? list.map(function (s, i) {
      var gps = s.require_gps ? (s.lat != null ? '📍 ' + s.radius_m + 'm' : '<span class="chip red">未設座標</span>') : '—';
      if (s.bypass_code) gps += ' <span class="chip">碼</span>';
      if (!s.show_location) gps += ' <span class="chip gray">隱藏</span>';
      return '<tr data-sid="' + esc(s.stage_id) + '"' + (s.enabled ? '' : ' style="opacity:.5"') + '>' +
        '<td data-l="順序"><b>' + (i + 1) + '</b></td>' +
        '<td><b>' + esc(s.title) + '</b>' + (s.enabled ? '' : ' <span class="chip gray">停用</span>') + fragChip(s) + stageRouteChips(s, hasRoutes) + '<div class="small muted">' + esc(s.stage_id) + '・' + s.points + ' 分</div></td>' +
        '<td data-l="作答">' + Q.TYPE_LABEL[s.answer_type] + '</td><td data-l="定位">' + gps + '</td>' +
        '<td class="td-act"><div class="row"><button class="sm ghost" data-mv="-1" ' + (i && !filtered ? '' : 'disabled') + '>⬆</button>' +
        '<button class="sm ghost" data-mv="1" ' + (i < n - 1 && !filtered ? '' : 'disabled') + '>⬇</button>' +
        '<button class="sm" data-edit>編輯</button></div></td></tr>';
    }).join('') : '<tr><td colspan="5" class="muted">這個專案還沒有關卡，按右上角「新增關卡」。</td></tr>';
    $$('#stage-rows [data-edit]').forEach(function (b) {
      b.onclick = function () { openStage(findStage(b.closest('tr').dataset.sid)); };
    });
    $$('#stage-rows [data-mv]').forEach(function (b) {
      b.onclick = function () { moveStage(b.closest('tr').dataset.sid, +b.dataset.mv); };
    });
    renderDeckCover();
    drawStagesMap();
  }

  function fragChip(st) {
    var cardChip = (st.card_id || st.card_random) ? ' <span class="chip blue">🃏 ' + (st.card_id ? '固定' : '') + (st.card_random ? (st.card_id ? '＋' : '') + '隨機×' + st.card_random : '') + '</span>' : '';
    var item = cardChip + st.item_name || st.item_icon ? ' <span class="chip blue">' + (/^(https?:|data:)/i.test(st.item_icon || '') ? '🎁' : esc(st.item_icon || '🎁')) + ' ' + esc(st.item_name || '收藏品') + '</span>' : '';
    if (st.coop_final) return ' <span class="chip amber">🤝 合作最後關</span>' + item;
    if (st.final_from_fragments) return ' <span class="chip amber">🔐 最終關</span>' + item;
    if (st.reward_code) return ' <span class="chip green">🧩 第' + (st.reward_order != null ? st.reward_order : '?') + '碼＝' + esc(st.reward_code) + '</span>' + item;
    return item;
  }

  function stageRouteChips(st, hasRoutes) {
    if (!hasRoutes) return '';
    var m = parseStageRoutes(st.routes), keys = Object.keys(m);
    if (!keys.length) return ' <span class="chip gray">全部路線</span>';
    return ' ' + keys.map(function (k) {
      var chip = routeChip(A.pid, k) || '<span class="chip red">失效路線</span>';
      return chip + (m[k] !== null ? '<span class="small muted">#' + m[k] + '</span>' : '');
    }).join(' ');
  }

  function findStage(id) { return A.stages.filter(function (s) { return s.stage_id === id; })[0]; }

  async function moveStage(id, dir) {
    var ids = A.stages.map(function (s) { return s.stage_id; });
    var i = ids.indexOf(id), j = i + dir;
    if (j < 0 || j >= ids.length) return;
    ids[i] = ids[j]; ids[j] = id;
    if (!(await guardLive(A.pid, '調整關卡順序會改變正在玩的隊伍的下一關。'))) return;
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
    visibleStages().forEach(function (s, i) {
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
    var d = s || { enabled: true, require_gps: true, show_location: true, show_question_early: true, answer_type: 'text', points: 10, radius_m: 40, max_attempts: 0, hint_penalty: 0 };
    $('#ms-title').textContent = s ? '編輯關卡' : '新增關卡';
    $('#ms-title-input').value = d.title || '';
    STAGE_FIELDS.forEach(function (f) {
      var el = $('#ms-' + f);
      if (el.type === 'checkbox') el.checked = !!d[f];
      else el.value = d[f] == null ? '' : d[f];
    });
    refreshImgPrev('ms-image_url');
    refreshImgPrev('ms-item_icon');
    renderStageCards(d);
    if (!$('#ms-item_rarity').value) $('#ms-item_rarity').value = 'normal';
    renderStageRoutes(s);
    renderFragPreview();
    $('#ms-stage_id').disabled = !!s;
    $('#ms-delete').classList.toggle('hidden', !s);
    toggleTypeFields();
    $('#m-stage').classList.remove('hidden');
    setTimeout(initEdMap, 30);
  }

  /** 最終密碼預覽：每條路線（沒有路線就一條）把有碎片的關卡依「第幾碼」接起來 */
  function renderFragPreview() {
    var box = $('#ms-frag-preview'), isCoop = $('#ms-coop_final').checked, isFinal = $('#ms-final_from_fragments').checked || isCoop;
    $('#ms-reward_code').disabled = isFinal; $('#ms-reward_order').disabled = isFinal;
    var cur = {
      stage_id: A.editStage ? A.editStage.stage_id : '(新關卡)', title: $('#ms-title-input').value || '這一關',
      reward_code: $('#ms-reward_code').value.trim(), reward_order: $('#ms-reward_order').value.trim() === '' ? null : Number($('#ms-reward_order').value),
      final_from_fragments: isFinal, coop_final: isCoop, routes: collectStageRoutes(), order: A.editStage ? A.editStage.order : 9999
    };
    var all = A.stages.filter(function (x) { return !A.editStage || x.stage_id !== A.editStage.stage_id; }).concat([cur]);
    var rts = projRoutes(A.pid), groups = rts.length ? rts.map(function (r) { return { id: r.id, name: r.name }; }) : [{ id: '', name: '' }];
    var lines = [], any = false;
    groups.forEach(function (gp) {
      var list = all.filter(function (x) {
        if (!x.reward_code || x.final_from_fragments || x.coop_final) return false;
        if (!gp.id) return true;
        var m = parseStageRoutes(x.routes), keys = Object.keys(m);
        return !keys.length || (gp.id in m);
      }).map(function (x, i) { return { x: x, i: i }; });
      list.sort(function (a, b) {
        var oa = a.x.reward_order == null ? 9999 : a.x.reward_order, ob = b.x.reward_order == null ? 9999 : b.x.reward_order;
        return oa - ob || a.i - b.i;
      });
      if (!list.length) return;
      any = true;
      var orders = list.map(function (y) { return y.x.reward_order; }).filter(function (o) { return o != null; });
      var dup = orders.some(function (o, i) { return orders.indexOf(o) !== i; });
      lines.push((gp.name ? '【' + esc(gp.name) + '】' : '') + '最終密碼：<b>' + esc(list.map(function (y) { return y.x.reward_code; }).join('')) + '</b>（' +
        list.map(function (y, k) { return '第' + (k + 1) + '碼＝' + esc(y.x.title) + ' ' + esc(y.x.reward_code); }).join('、') + '）' + (dup ? ' <span style="color:var(--red)">⚠️ 有重複的順序</span>' : ''));
    });
    var coopLine = '';
    if (isCoop) {
      coopLine = rts.length < 2 ? '<br><span style="color:var(--red)">⚠️ 合作關需要至少 2 條路線，目前會當作一般最後一關。</span>'
        : '<br>🤝 合作最後關的答案＝' + groups.map(function (gp) {
          var codes = all.filter(function (x) {
            if (!x.reward_code || x.final_from_fragments || x.coop_final) return false;
            var m = parseStageRoutes(x.routes), keys = Object.keys(m);
            return !keys.length || (gp.id in m);
          }).map(function (x, i) { return { x: x, i: i }; }).sort(function (a, b) {
            var oa = a.x.reward_order == null ? 9999 : a.x.reward_order, ob = b.x.reward_order == null ? 9999 : b.x.reward_order;
            return oa - ob || a.i - b.i;
          }).map(function (y) { return y.x.reward_code; }).join('');
          return esc(gp.name) + '「' + esc(codes) + '」';
        }).join(' ＋ ');
    }
    box.innerHTML = (any ? '目前組成的最終密碼預覽：<br>' + lines.join('<br>') : '還沒有任何關卡設定碎片。') + coopLine;
  }

  function renderStageRoutes(s) {
    var rts = projRoutes(A.pid), wrap = $('#ms-routes-wrap');
    wrap.classList.toggle('hidden', !rts.length);
    if (!rts.length) return;
    var m = parseStageRoutes(s && s.routes);
    $('#ms-routes').innerHTML = rts.map(function (r) {
      return '<div class="route-pick"><label class="check"><input type="checkbox" data-r="' + esc(r.id) + '"' + (r.id in m ? ' checked' : '') + '> ' +
        '<span class="route-dot" style="background:' + esc(r.color || '#999') + '"></span>' + esc(r.name) + '</label>' +
        '<input type="number" step="any" data-ro="' + esc(r.id) + '" placeholder="順序" value="' + (m[r.id] != null ? esc(m[r.id]) : '') + '"></div>';
    }).join('');
  }

  /** 回傳 routes 欄位字串："a|b:2"；都不勾，或全部勾且沒填順序＝空白（所有路線共用） */
  function collectStageRoutes() {
    var rts = projRoutes(A.pid);
    if (!rts.length) return (A.editStage && A.editStage.routes) || '';
    var parts = [], all = true;
    rts.forEach(function (r) {
      var cb = $$('#ms-routes [data-r]').filter(function (x) { return x.dataset.r === r.id; })[0];
      var od = $$('#ms-routes [data-ro]').filter(function (x) { return x.dataset.ro === r.id; })[0];
      if (cb && cb.checked) { var o = od ? od.value.trim() : ''; parts.push(r.id + (o !== '' ? ':' + o : '')); }
      else all = false;
    });
    var anyOrder = parts.some(function (x) { return x.indexOf(':') >= 0; });
    if (!parts.length || (all && !anyOrder)) return '';
    return parts.join('|');
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
    ['points', 'max_attempts', 'hint_penalty', 'radius_m', 'lat', 'lng', 'reward_order', 'card_random'].forEach(function (f) { s[f] = s[f] === '' ? '' : Number(s[f]); });
    if (s.final_from_fragments || s.coop_final) { s.reward_code = ''; s.reward_order = ''; }
    s.routes = collectStageRoutes();
    if (A.editStage) { s.stage_id = A.editStage.stage_id; s.order = A.editStage.order; }
    // 防呆：位置離原本太遠（可能是電腦定位不準）時先確認
    if (A.edOrig && isFinite(s.lat) && isFinite(s.lng)) {
      var moved = Q.distM(A.edOrig.lat, A.edOrig.lng, s.lat, s.lng);
      if (moved > 500 && !confirm('新位置離原本位置約 ' + Math.round(moved) + ' 公尺，確定要儲存嗎？\n（電腦定位常常不準，可按「還原原本位置」）')) return;
    }
    // 防呆：座標、範圍
    if (isFinite(s.lat) && isFinite(s.lng)) {
      if (Math.abs(s.lat) > 90) return Q.toast('緯度要在 -90～90 之間（台灣約 21～26），看起來經度和緯度填反了？', 'err', 7000);
      if (s.lat === 0 && s.lng === 0) return Q.toast('座標是 0, 0，應該是忘了設定', 'err', 6000);
      // 離專案裡其他關卡太遠（常見於座標打錯一個數字）
      var others = A.stages.filter(function (x) { return (!A.editStage || x.stage_id !== A.editStage.stage_id) && x.lat !== null && x.lng !== null && isFinite(x.lat) && isFinite(x.lng); });
      if (others.length) {
        var near = Math.min.apply(null, others.map(function (x) { return Q.distM(x.lat, x.lng, s.lat, s.lng); }));
        if (near > 20000 && !confirm('這一關離專案裡其他關卡至少 ' + Math.round(near / 1000) + ' 公里遠。\n\n座標沒有打錯嗎？（例如少打或多打一個數字）\n確定要儲存嗎？')) return;
      }
    }
    if (s.require_gps && isFinite(s.radius_m) && s.radius_m > 0 && s.radius_m < 15 &&
      !confirm('抵達範圍只有 ' + s.radius_m + ' 公尺。\n\n手機 GPS 常有十幾公尺的誤差，範圍太小玩家可能怎麼走都打不到卡（建議 30 公尺以上）。\n仍要儲存嗎？')) return;
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
    if (!(await guardLive(A.pid, '刪除關卡會讓已經玩到這一關的隊伍進度、分數對不上。'))) return;
    try {
      var dsr = await call('adminDeleteStage', { projectId: A.pid, stageId: A.editStage.stage_id });
      $('#m-stage').classList.add('hidden');
      Q.toast('已刪除', 'ok'); showBackup(dsr);
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
      var fn = function () { return Promise.all([Q.api('adminSessions', payload), Q.api('adminSubmissions', Object.assign({ limit: 300 }, payload))]); };
      var res = silent ? await fn() : await Q.run(fn);
      renderMonitor(res[0], res[1], run);
    } catch (e) { if (silent) Q.toast(e.message, 'err'); }
  }

  /* ---------- 作答紀錄：手機用卡片，可以選一隊看「做到哪裡」 ---------- */
  var SUB_ACT = { start: '開始', arrive: '打卡', answer: '作答', hint: '看提示', photo: '上傳照片', form: '表單' };
  var SUB_RES = { ok: '✅ 成功', correct: '✅ 答對', wrong: '❌ 答錯', failed: '⛔ 次數用完', too_far: '📏 太遠', low_accuracy: '📡 定位不準', wrong_code: '❌ 通關碼錯', uploaded: '✅ 已上傳', not_found: '⏳ 未收到' };
  var SUB_BAD = ['wrong', 'failed', 'too_far', 'low_accuracy', 'wrong_code', 'not_found'];
  function subRel(ts) {
    var t = new Date(ts).getTime();
    if (!t) return '';
    var m = Math.round((Date.now() - t) / 60000);
    return m < 1 ? '剛剛' : m < 60 ? m + ' 分鐘前' : m < 1440 ? Math.floor(m / 60) + ' 小時前' : Q.fmtTime(ts);
  }
  function subTone(x) { return SUB_BAD.indexOf(x.result) >= 0 ? 'bad' : (x.result === 'correct' || x.result === 'uploaded' || x.result === 'ok') ? 'good' : ''; }

  /** 某一隊每一關的進度：完成、已打卡、答錯幾次、看了幾次提示 */
  function teamProgress(team, subs, stages, ses) {
    var mine = subs.filter(function (x) { return x.team_name === team; });
    var first = true;
    var rows = stages.map(function (st, i) {
      var rs = mine.filter(function (x) { return x.stage_id === st.stage_id; });
      var solved = rs.some(function (x) { return ['answer', 'photo', 'form'].indexOf(x.action) >= 0 && ['correct', 'uploaded', 'ok'].indexOf(x.result) >= 0; });
      var arrived = rs.some(function (x) { return x.action === 'arrive' && x.result === 'ok'; });
      var wrong = rs.filter(function (x) { return x.result === 'wrong' || x.result === 'wrong_code'; }).length;
      var hints = rs.filter(function (x) { return x.action === 'hint'; }).length;
      var state = solved ? 'done' : (rs.length ? 'doing' : 'todo'), here = false;
      if (!solved && first) { here = true; first = false; }
      if (here && !rs.length) state = 'doing';
      var txt = solved ? '✅ 完成' : arrived ? '📍 已打卡，作答中' : rs.length ? '🕐 進行中' : (here ? '👉 目前' : '—');
      var bits = [];
      if (wrong) bits.push('答錯 ' + wrong + ' 次');
      if (hints) bits.push('看提示 ' + hints + ' 次');
      if (rs.length) bits.push(subRel(rs[0].timestamp));
      return '<div class="tp-row ' + state + (here ? ' here' : '') + '"><span class="tp-no">' + (i + 1) + '</span><div class="tp-main"><b>' + esc(st.title) + '</b>' +
        '<small>' + bits.join('・') + '</small></div><span class="tp-st">' + txt + '</span></div>';
    }).join('');
    var s = ses.filter(function (x) { return x.team_name === team; })[0];
    var head = s ? '<div class="tp-head"><b>' + esc(team) + '</b><span>完成 ' + s.solved + ' / ' + s.total + ' 關・' + s.score + ' 分' + (s.last_active_at ? '・' + subRel(s.last_active_at) + '有動作' : '') + '</span></div>' : '<div class="tp-head"><b>' + esc(team) + '</b></div>';
    return head + rows;
  }

  function renderSubs() {
    var c = A.monCache;
    if (!c) return;
    var subs = c.sub.submissions || [], team = A.subTeam || '', f = A.subFilter || 'all';
    var names = {};
    c.ss.forEach(function (s) { names[s.team_name] = 1; });
    subs.forEach(function (x) { if (x.team_name) names[x.team_name] = 1; });
    var list = Object.keys(names).sort();
    if (team && !names[team]) team = A.subTeam = '';
    $('#sub-team').innerHTML = '<option value="">全部隊伍</option>' + list.map(function (n) { return '<option>' + esc(n) + '</option>'; }).join('');
    $('#sub-team').value = team;
    $$('#sub-chips [data-f]').forEach(function (b) { b.classList.toggle('on', b.dataset.f === f); });
    var pg = $('#sub-progress');
    pg.classList.toggle('hidden', !team);
    if (team) pg.innerHTML = teamProgress(team, subs, c.r.stages || [], c.ss);
    var shown = subs.filter(function (x) {
      if (team && x.team_name !== team) return false;
      if (f === 'wrong') return SUB_BAD.indexOf(x.result) >= 0;
      if (f === 'file') return !!x.file_url;
      return true;
    });
    $('#sub-cards').innerHTML = shown.length ? shown.map(function (x) {
      var dist = x.distance_m !== '' && x.distance_m != null ? '・距離目標 ' + x.distance_m + 'm' : '';
      return '<div class="sub-card ' + subTone(x) + '">' +
        '<div class="sc-l1"><b>' + (SUB_RES[x.result] || esc(x.result)) + '</b>' + (team ? '' : ' <span>' + esc(x.team_name) + '</span>') + '<em>' + esc(x.stage_title || '') + '</em></div>' +
        '<div class="sc-l2">' + (SUB_ACT[x.action] || esc(x.action)) + (x.input ? '「' + esc(x.input) + '」' : '') + '</div>' +
        '<div class="sc-l3">' + subRel(x.timestamp) + dist + (x.file_url ? '・<a href="' + esc(x.file_url) + '" target="_blank" rel="noopener">📎 開啟檔案</a>' : '') + '</div></div>';
    }).join('') : '<div class="card muted">沒有符合的紀錄。</div>';
    $('#mon-subs-rows').innerHTML = shown.map(function (x) {
      return '<tr><td class="small">' + Q.fmtTime(x.timestamp) + '</td><td>' + esc(x.team_name) + '</td><td>' + esc(x.stage_title || '') + '</td>' +
        '<td>' + (SUB_ACT[x.action] || esc(x.action)) + '</td><td>' + esc(x.input) + '</td><td>' + (SUB_RES[x.result] || esc(x.result)) + '</td>' +
        '<td>' + (x.distance_m !== '' && x.distance_m != null ? x.distance_m + 'm' : '') + '</td>' +
        '<td>' + (x.file_url ? '<a href="' + esc(x.file_url) + '" target="_blank" rel="noopener">開啟</a>' : '') + '</td></tr>';
    }).join('') || '<tr><td colspan="8" class="muted">沒有符合的紀錄</td></tr>';
  }

  function renderMonitor(r, sub, run) {
    var sel = $('#mon-run');
    sel.innerHTML = '<option value="">全部場次</option>' + r.run_codes.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
    sel.value = run;
    var rts = r.routes || [], rsel = $('#mon-route');
    rsel.classList.toggle('hidden', !rts.length);
    rsel.innerHTML = '<option value="">全部路線</option>' + rts.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.name) + '</option>'; }).join('');
    rsel.value = A.monRoute || '';
    var ss = r.sessions;
    if (A.monRoute) ss = ss.filter(function (x) { return x.route === A.monRoute; });
    var routeSelectHtml = function (cur, sid) {
      if (!rts.length) return '—';
      return '<select class="sm-select" data-route-sess="' + esc(sid) + '"><option value="">（無）</option>' + rts.map(function (x) {
        return '<option value="' + esc(x.id) + '"' + (x.id === cur ? ' selected' : '') + '>' + esc(x.name) + '</option>';
      }).join('') + '</select>';
    };
    $('#btn-clear-tests').classList.toggle('hidden', !r.sessions.some(function (x) { return x.test; }));
    $('#mon-teams').textContent = ss.filter(function (x) { return !x.test; }).length;
    $('#mon-playing').textContent = ss.filter(function (s) { return s.status === 'playing'; }).length;
    $('#mon-finished').textContent = ss.filter(function (s) { return s.status === 'finished'; }).length;
    $('#mon-subs').textContent = sub.submissions.length;
    $('#mon-updated').textContent = '更新於 ' + Q.fmtTime(new Date());
    var stTxt = { playing: ['進行中', 'amber'], finished: ['完成', 'green'], timeup: ['超時', 'red'] };
    $('#mon-sessions').innerHTML = ss.length ? ss.map(function (s) {
      var t = stTxt[s.status] || [s.status, 'gray'];
      return '<tr><td>' + (s.avatar ? esc(s.avatar) + ' ' : '') + '<b>' + esc(s.team_name) + '</b> <span class="chip gray">' + esc(s.code) + '</span>' + (s.test ? ' <span class="chip blue">🧪 試玩</span>' : '') + '</td>' +
        '<td data-l="場次">' + esc(s.run_code || '—') + '</td>' +
        '<td data-l="路線">' + routeSelectHtml(s.route, s.session_id) + '</td>' +
        '<td data-l="進度"><span class="chip ' + t[1] + '">' + t[0] + '</span> ' + s.solved + '/' + s.total + '</td>' +
        '<td data-l="分數"><b>' + s.score + '</b></td><td data-l="目前關卡">' + esc(s.current_stage || '—') + '</td>' +
        '<td class="small" data-l="最後活動">' + Q.fmtTime(s.last_active_at) + '</td>' +
        '<td class="td-act">' + (s.failed ? '<button class="sm ghost" data-resetfail="' + esc(s.session_id) + '" title="還原這隊未通過（作答次數用完）的關卡，讓他們重新挑戰">🔄 ' + s.failed + '</button> ' : '') +
        '<button class="sm ghost" data-del="' + esc(s.session_id) + '" title="刪除這支隊伍">🗑</button></td></tr>';
    }).join('') : '<tr><td colspan="8" class="muted">還沒有隊伍開始闖關</td></tr>';
    $$('#mon-sessions [data-resetfail]').forEach(function (b) {
      b.onclick = async function () {
        if (!confirm('還原這支隊伍所有「未通過」的關卡？\n\n作答次數會歸零，讓他們重新挑戰（用於補救因失敗而缺少密碼碎片、無法解最後一關的隊伍）。')) return;
        try { var rr = await call('adminResetFailed', { sessionId: b.dataset.resetfail }); Q.toast('已還原 ' + rr.reset + ' 個關卡', 'ok'); loadMonitor(); } catch (e) { /* */ }
      };
    });
    $$('#mon-sessions [data-route-sess]').forEach(function (sel) {
      sel.onchange = async function () {
        if (!confirm('更換這支隊伍的路線？\n\n它已經完成的關卡進度和分數會保留，但接下來會依新路線的關卡進行。')) { loadMonitor(); return; }
        try { await call('adminSetRoute', { sessionId: sel.dataset.routeSess, route: sel.value }); Q.toast('已更換路線', 'ok'); loadMonitor(); } catch (e) { loadMonitor(); }
      };
    });
    $$('#mon-sessions [data-del]').forEach(function (b) {
      b.onclick = async function () {
        var warn = '確定刪除這支隊伍？\n\n會一併刪除它的闖關進度和全部作答紀錄（打卡、答題、提示、照片紀錄），無法復原。\n（已上傳到雲端硬碟的照片檔案不會被刪除）';
        if (!confirm(warn)) return;
        try {
          var dr = await call('adminDeleteSession', { sessionId: b.dataset.del });
          Q.toast('已刪除隊伍，並刪除 ' + (dr.deleted_submissions || 0) + ' 筆作答紀錄', 'ok'); showBackup(dr);
          loadMonitor();
        } catch (e) { /* */ }
      };
    });

    A.monCache = { r: r, sub: sub, ss: ss };
    renderSubs();

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

/* ---------- 手機版：表單分段收合、儲存列固定在底部、危險操作分開放 ---------- */
(function () {
  var mq = window.matchMedia ? matchMedia('(max-width: 760px)') : { matches: false };
  // 1. 儲存／取消那一列固定在畫面底部（不用捲到最下面）；刪除按鈕移到最下面的「危險區」
  document.querySelectorAll('.modal-body').forEach(function (mb) {
    var last = mb.lastElementChild;
    if (!last || !last.classList.contains('row') || !last.querySelector('button')) return;
    last.classList.add('modal-actions');
    var dg = last.querySelector('button.danger');
    if (dg) {
      var zone = document.createElement('div');
      zone.className = 'danger-zone';
      zone.innerHTML = '<div class="small muted">危險操作（刪除後無法復原）</div>';
      zone.appendChild(dg);
      mb.appendChild(zone);
    }
  });
  // 2. 手機上把長表單依小標題分段，次要的段落預設收起來
  var OPEN = /基本|抵達|題目|地點|卡牌|編輯這張/;
  document.querySelectorAll('#m-stage .section-title, #m-deck .section-title').forEach(function (t) {
    if (t.parentNode.classList && t.parentNode.classList.contains('sec-body')) return;
    var kids = [], n = t.nextElementSibling;
    while (n && !n.classList.contains('section-title')) { kids.push(n); n = n.nextElementSibling; }
    if (!kids.length) return;
    var d = document.createElement('details');
    d.className = 'sec';
    if (OPEN.test(t.textContent)) d.open = true;
    var s = document.createElement('summary');
    s.innerHTML = t.innerHTML;
    if (t.id) { s.id = t.id; t.removeAttribute('id'); }
    var body = document.createElement('div');
    body.className = 'sec-body';
    t.parentNode.insertBefore(d, t);
    d.appendChild(s); d.appendChild(body);
    kids.forEach(function (k) { body.appendChild(k); });
    t.remove();
  });
})();

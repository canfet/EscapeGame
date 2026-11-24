/* ========== 體驗套版註冊表（純函式，可在 Node 載入測試） ========== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.Q = root.Q || {}; root.Q.Tpl = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var IDS = ['classic', 'rpg', 'detective', 'agent', 'pirate', 'academy'];

  var CLASSIC_VOCAB = {
    nextLabel: '下一站',
    stageListTitle: '探險關卡進度表',
    avatarLabel: '隊伍造型',
    startBtn: '開始闖關',
    solvedTitle: '第 {n} 關完成！',
    goNext: '前往下一關',
    finishTitle: '任務完成！',
    introHeading: '建立隊伍',
    stageTitle: '第 {n} 關',
    clueHeading: '線索',
    questionHeading: '題目',
    arriveBtn: '📍 我到了，定位打卡',
    submitBtn: '送出答案',
    hintBtn: '💡 需要提示？',
    hintTitle: '要看提示嗎？',
    hpLabel: '體力'
  };

  var TEMPLATES = {
    classic: {
      id: 'classic', name: '經典探險', icon: '🧭', desc: '原本的探險風格，不加任何特效與對話。',
      theme: 'retro', avatars: [], dialogue: false, fx: '', hud: '', npc: null,
      vocab: CLASSIC_VOCAB
    },
    rpg: {
      id: 'rpg', name: '角色扮演 RPG', icon: '⚔️', desc: '選擇職業、累積 EXP、升級，酒館老闆發布任務。',
      theme: 'forest',
      avatars: ['⚔️', '🧙', '🏹', '🗡️', '🛡️', '🩺', '🎻', '🐉'],
      avatarNames: { '⚔️': '戰士', '🧙': '法師', '🏹': '弓手', '🗡️': '盜賊', '🛡️': '騎士', '🩺': '牧師', '🎻': '吟遊詩人', '🐉': '龍騎士' },
      dialogue: true, fx: 'fireflies', hud: 'rpg',
      npc: { name: '酒館老闆', avatar: '🧙' },
      vocab: {
        nextLabel: '下一個任務',
        stageListTitle: '冒險任務表',
        avatarLabel: '選擇職業',
        startBtn: '出發冒險',
        solvedTitle: '任務 {n} 完成！',
        goNext: '接下一個任務',
        finishTitle: '冒險成功！',
        introHeading: '組成冒險小隊',
        stageTitle: '任務 {n}',
        clueHeading: '委託內容',
        questionHeading: '試煉',
        arriveBtn: '📍 抵達目的地',
        submitBtn: '發動解答',
        hintBtn: '💡 求助神諭？',
        hintTitle: '要求助神諭嗎？',
        hpLabel: '體力'
      },
      lines: {arrive:'你們找到了！把試煉解開吧。',wrong:['差一點，勇者！再想想看。','別氣餒，冒險者總是屢敗屢戰。','神諭說：答案就藏在線索裡。'],hint:'嗯……老夫給你們一點提示吧。'}
    },
    detective: {
      id: 'detective', name: '偵探推理', icon: '🕵️', desc: '蒐集線索、破解案件，局長交辦任務。',
      theme: 'history',
      avatars: ['🕵️', '🔍', '🧐', '📜', '🗝️', '🎩', '🔦', '🧤'],
      dialogue: true, fx: 'ink', hud: '',
      npc: { name: '局長', avatar: '🕵️' },
      vocab: {
        nextLabel: '下一條線索',
        stageListTitle: '案件卷宗',
        avatarLabel: '選擇身分',
        startBtn: '開始辦案',
        solvedTitle: '線索 {n} 已破解',
        goNext: '追查下一條線索',
        finishTitle: '結案！',
        introHeading: '組成偵查小組',
        stageTitle: '案件 {n}',
        clueHeading: '現場描述',
        questionHeading: '推理題',
        arriveBtn: '📍 我到現場了',
        submitBtn: '提出推理',
        hintBtn: '💡 調閱檔案？',
        hintTitle: '要調閱檔案嗎？',
        hpLabel: '專注力'
      },
      lines: {arrive:'很好，你們到現場了。仔細觀察，別漏掉任何細節。',wrong:['這個推理有破綻，再檢查一次。','別急，真相往往藏在細節裡。','換個角度想想看，探員。'],hint:'我調出了一份檔案，看看有沒有幫助。'}
    },
    agent: {
      id: 'agent', name: '特務任務', icon: '🛰️', desc: '代號行動，指揮官從總部下達指令。',
      theme: 'neon',
      avatars: ['🛰️', '🤖', '👾', '🦾', '🔒', '💾', '📡', '🕶️'],
      dialogue: true, fx: 'stream', hud: '',
      npc: { name: '指揮官', avatar: '🛰️' },
      vocab: {
        nextLabel: '下一個目標',
        stageListTitle: '任務檔案',
        avatarLabel: '選擇代號',
        startBtn: '啟動任務',
        solvedTitle: '目標 {n} 達成',
        goNext: '前往下一個目標',
        finishTitle: '任務達成！',
        introHeading: '登錄行動小組',
        stageTitle: '目標 {n}',
        clueHeading: '情報',
        questionHeading: '解碼題',
        arriveBtn: '📍 抵達座標',
        submitBtn: '提交密碼',
        hintBtn: '💡 請求支援？',
        hintTitle: '要請求支援嗎？',
        hpLabel: '電量'
      },
      lines: {arrive:'座標確認。解開密碼，繼續任務。',wrong:['密碼錯誤。重新解碼。','驗證失敗，請再試一次，特務。','總部提醒：仔細檢查情報。'],hint:'總部傳來支援情報，請查收。'}
    },
    pirate: {
      id: 'pirate', name: '海盜尋寶', icon: '🏴‍☠️', desc: '揚帆出海，跟著船長尋找寶藏。',
      theme: 'ocean',
      avatars: ['⚓', '🏴‍☠️', '🦜', '🗺️', '🧭', '💰', '🦑', '🚢'],
      dialogue: true, fx: 'bubbles', hud: '',
      npc: { name: '船長', avatar: '🏴‍☠️' },
      vocab: {
        nextLabel: '下一個航段',
        stageListTitle: '航海日誌',
        avatarLabel: '選擇船員身分',
        startBtn: '揚帆出發',
        solvedTitle: '航段 {n} 完成！',
        goNext: '駛向下一個航段',
        finishTitle: '寶藏到手！',
        introHeading: '招募船員',
        stageTitle: '航段 {n}',
        clueHeading: '藏寶線索',
        questionHeading: '寶箱謎題',
        arriveBtn: '📍 上岸尋寶',
        submitBtn: '開啟寶箱',
        hintBtn: '💡 請教老水手？',
        hintTitle: '要請教老水手嗎？',
        hpLabel: '士氣'
      },
      lines: {arrive:'上岸啦！寶箱就在眼前，快動腦筋！',wrong:['哈，打不開！再想一想。','別洩氣，水手！','老水手說：答案就在線索裡。'],hint:'好吧，老水手偷偷告訴你們一點訣竅。'}
    },
    academy: {
      id: 'academy', name: '魔法學院', icon: '🧙‍♀️', desc: '入學修習魔法課程，院長親自授課。',
      theme: 'campus',
      avatars: ['🧙‍♀️', '📚', '🪄', '🦉', '🔮', '⭐', '🧪', '🎓'],
      dialogue: true, fx: 'stars', hud: '',
      npc: { name: '院長', avatar: '🧙‍♀️' },
      vocab: {
        nextLabel: '下一堂課',
        stageListTitle: '課程表',
        avatarLabel: '選擇學院身分',
        startBtn: '開始上課',
        solvedTitle: '第 {n} 課完成！',
        goNext: '前往下一堂課',
        finishTitle: '順利畢業！',
        introHeading: '編入學習小組',
        stageTitle: '第 {n} 課',
        clueHeading: '課堂說明',
        questionHeading: '隨堂測驗',
        arriveBtn: '📍 抵達教室',
        submitBtn: '交卷',
        hintBtn: '💡 請教助教？',
        hintTitle: '要請教助教嗎？',
        hpLabel: '專注'
      },
      lines: {arrive:'歡迎來到教室，同學們！開始隨堂測驗吧。',wrong:['再仔細想想，你們可以的！','錯了也沒關係，學習就是不斷嘗試。','翻翻課堂說明，答案就在裡面。'],hint:'助教悄悄給你們一點提示。'}
    }
  };

  function norm(id) {
    id = String(id == null ? '' : id).replace(/^\s+|\s+$/g, '').toLowerCase();
    return IDS.indexOf(id) >= 0 ? id : 'classic';
  }

  function get(id) { return TEMPLATES[norm(id)]; }

  function fill(str, vars) {
    return String(str).replace(/\{(\w+)\}/g, function (m, k) {
      return vars && vars[k] != null ? String(vars[k]) : m;
    });
  }

  /** 取用語；缺鍵時 fallback 到 classic；{n} {title} 等以 vars 代入 */
  function vocab(id, key, vars) {
    var v = get(id).vocab;
    var s = v && v[key] != null ? v[key] : CLASSIC_VOCAB[key];
    return s == null ? '' : fill(s, vars);
  }

  /** 該套版的造型清單；classic 回傳 fallback（後端給的清單） */
  function avatars(id, fallback) {
    var t = get(id);
    return t.avatars.length ? t.avatars.slice() : (fallback || []);
  }

  /** NPC：專案設定優先，其次套版預設；classic（無對話）回 null */
  function npcOf(id, project) {
    var t = get(id);
    if (!t.dialogue) return null;
    var pj = project || {}, d = t.npc || {};
    var name = pj.npc_name != null ? String(pj.npc_name).replace(/^\s+|\s+$/g, '') : '';
    var av = pj.npc_avatar != null ? String(pj.npc_avatar).replace(/^\s+|\s+$/g, '') : '';
    return { name: name || d.name || '', avatar: av || d.avatar || '' };
  }

  /** 等級資訊：Lv = 1 + 已完成關卡數；EXP = 隊伍分數；EXP 上限 = 全部關卡配分總和 */
  function levelInfo(state) {
    var s = state || {}, stages = s.stages || [], solved = 0, max = 0, i;
    for (i = 0; i < stages.length; i++) {
      var st = stages[i] || {};
      if (st.status === 'solved') solved++;
      var p = Number(st.points);
      if (p > 0 && isFinite(p)) max += p;
    }
    var exp = Number(s.session && s.session.score);
    if (!(exp > 0) || !isFinite(exp)) exp = 0;
    var expMax = Math.max(1, max);
    return { lv: 1 + solved, exp: exp, expMax: expMax, pct: Math.min(100, Math.round(exp / expMax * 100)) };
  }

  /** NPC 在關卡中的台詞：關卡自訂（npc_arrive／npc_wrong／npc_hint）優先，否則套版預設；classic 回空字串。idx 供答錯台詞輪替 */
  function npcLine(id, kind, st, idx) {
    var t = get(id), ln = t.lines;
    if (!t.dialogue || !ln) return '';
    var own = st && st['npc_' + kind] != null ? String(st['npc_' + kind]).replace(/^\s+|\s+$/g, '') : '';
    if (own) return own;
    var d = ln[kind];
    if (Object.prototype.toString.call(d) === '[object Array]') return d.length ? d[Math.abs(idx || 0) % d.length] : '';
    return d || '';
  }

  /** 純視覺的「體力」：愛心總數 = max_attempts>0 ? max_attempts : 3（上限 5）；lost = 已用掉的作答次數（不超過總數） */
  function hearts(st) {
    var m = Number(st && st.max_attempts), total = m > 0 ? Math.min(5, Math.floor(m)) : 3;
    var a = Number(st && st.attempts);
    var lost = a > 0 && isFinite(a) ? Math.min(total, Math.floor(a)) : 0;
    return { total: total, lost: lost };
  }

  function themeHint(id) { return get(id).theme; }

  return { IDS: IDS, TEMPLATES: TEMPLATES, norm: norm, get: get, vocab: vocab, avatars: avatars, npcOf: npcOf, npcLine: npcLine, hearts: hearts, levelInfo: levelInfo, themeHint: themeHint };
});

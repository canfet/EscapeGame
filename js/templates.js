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
    introHeading: '建立隊伍'
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
        introHeading: '組成冒險小隊'
      }
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
        introHeading: '組成偵查小組'
      }
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
        introHeading: '登錄行動小組'
      }
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
        introHeading: '招募船員'
      }
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
        introHeading: '編入學習小組'
      }
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

  function themeHint(id) { return get(id).theme; }

  return { IDS: IDS, TEMPLATES: TEMPLATES, norm: norm, get: get, vocab: vocab, avatars: avatars, npcOf: npcOf, levelInfo: levelInfo, themeHint: themeHint };
});

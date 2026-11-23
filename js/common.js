/* ========== 共用工具：API 呼叫、提示訊息、格式化 ========== */
(function (global) {
  'use strict';

  /** 呼叫 Apps Script API（text/plain 可避免 CORS 預檢） */
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  /**
   * 呼叫 Apps Script API（text/plain 可避免 CORS 預檢）。
   * ‧ 30 秒沒回應就視為連線失敗（NETWORK），前台會出現「重試」。
   * ‧ 後端回「BUSY」（很多人同時操作、排隊太久）代表這個動作還沒執行，自動等一下再試，最多 3 次。
   */
  // 前台版本：後端會檢查它（太舊會叫玩家重新整理）；後端版本太舊時，後台會提示重新部署 Code.gs
  var FRONT_VERSION = '1.1.0', MIN_BACKEND = '1.1.0';

  function cmpVer(a, b) {
    var x = String(a || '0').split('.'), y = String(b || '0').split('.');
    for (var i = 0; i < Math.max(x.length, y.length); i++) {
      var m = parseInt(x[i] || '0', 10) || 0, n = parseInt(y[i] || '0', 10) || 0;
      if (m !== n) return m < n ? -1 : 1;
    }
    return 0;
  }

  /** 頁面最上方的提醒列（重新整理、重新部署…）；同一種提醒只顯示一次 */
  function topBanner(id, html) {
    if (document.getElementById(id)) return;
    var d = document.createElement('div');
    d.id = id; d.className = 'ver-banner'; d.setAttribute('role', 'alert');
    d.innerHTML = html;
    // 版本提醒：文字一行（點一下展開），按鈕固定在右側，不佔太多手機畫面
    var txt = document.createElement('div'); txt.className = 'vb-text';
    var btns = document.createElement('div'); btns.className = 'vb-btns';
    Array.prototype.slice.call(d.querySelectorAll('button')).forEach(function (b) { btns.appendChild(b); });
    while (d.firstChild) txt.appendChild(d.firstChild);
    d.appendChild(txt); d.appendChild(btns);
    d.classList.add('clamp');
    txt.onclick = function () { d.classList.toggle('clamp'); };
    var stack = document.getElementById('ver-stack');
    if (!stack) { stack = document.createElement('div'); stack.id = 'ver-stack'; document.body.appendChild(stack); }
    stack.appendChild(d);
    var b = d.querySelector('[data-reload]');
    if (b) b.onclick = function () { location.reload(); };
    var x = d.querySelector('[data-close]');
    if (x) x.onclick = function () { d.remove(); };
  }

  function checkVersions(data) {
    if (!data) return;
    var isAdmin = /admin/i.test(location.pathname);
    // 後端太舊（沒帶 version 的舊後端也算）：只有管理者看得懂也處理得了
    if (isAdmin && cmpVer(data.version || '0', MIN_BACKEND) < 0) {
      topBanner('ver-backend', '⚠️ 後端程式版本過舊（目前 ' + esc(data.version || '更舊') + '，需要 ' + MIN_BACKEND + ' 以上），部分功能可能無法使用。' +
        '請把最新的 <b>apps-script/Code.gs</b> 貼到 Apps Script，再「部署 → 管理部署作業 → 編輯 → 新版本」。<button type="button" data-close class="sm ghost">我知道了</button>');
    }
    // 前台太舊：玩家與管理者都請重新整理
    if (data.front_stale) {
      topBanner('ver-front', '🔄 網站有新版本了，請重新整理頁面以取得最新功能。<button type="button" data-reload class="sm">重新整理</button>');
    }
  }

  async function api(action, payload) {
    var url = global.APP_CONFIG && global.APP_CONFIG.API_URL;
    if (!url) {
      var ce = new Error('這個網站還沒有設定後端網址。如果你是管理者：到 GitHub repo 的 Settings → Secrets and variables → Actions → Variables 設定 APPS_SCRIPT_URL 後重新部署；本機測試請複製 config.example.js 成 config.js 並填入網址（詳見 README 步驟 3）。');
      ce.code = 'NO_CONFIG';
      throw ce;
    }
    var t00 = Date.now();
    for (var attempt = 0; ; attempt++) {
      var res, ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = ctl ? setTimeout(function () { ctl.abort(); }, 30000) : null;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(Object.assign({ action: action, fv: FRONT_VERSION }, payload || {})),
          redirect: 'follow',
          signal: ctl ? ctl.signal : undefined
        });
      } catch (e) {
        if (timer) clearTimeout(timer);
        var ne = new Error('連線失敗，請檢查網路後再試一次');
        ne.code = 'NETWORK';
        throw ne;
      }
      if (timer) clearTimeout(timer);
      var text = await res.text(), data;
      try { data = JSON.parse(text); } catch (e) {
        throw new Error('伺服器回應格式錯誤。請確認 Apps Script 部署時「誰可以存取」選擇「所有人」。');
      }
      try { checkVersions(data); } catch (e) { /* 版本檢查不能影響遊戲 */ }
      // 耗時記錄：開發者工具 Console 可以看到每個動作「後端處理多久／整體多久」，用來找出慢在哪
      try { if (global.console && console.debug) console.debug('[api] ' + action + '：後端 ' + (data.ms == null ? '?' : data.ms) + ' ms／整體 ' + (Date.now() - t00) + ' ms'); } catch (e) { /* */ }
      if (!data.ok) {
        if (data.code === 'BUSY' && attempt < 4) { await sleep(1200 * (attempt + 1) + Math.random() * 1500); continue; }   // 加亂數：避免大家同一秒一起重試又撞在一起
        var err = new Error(data.error || '發生錯誤');
        err.code = data.code;
        throw err;
      }
      return data;
    }
  }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** 網址轉成可點的連結（給線索、說明用） */
  function linkify(s) {
    return esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  }

  function toast(msg, type, ms) {
    if (!msg) return;
    var box = document.getElementById('toast');
    if (!box) { box = document.createElement('div'); box.id = 'toast'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    var t = document.createElement('div');
    t.className = 'toast ' + (type || '');
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(function () { t.remove(); }, ms || (type === 'err' ? 4500 : 3000));
  }

  var loadingCount = 0;
  function loading(on) {
    loadingCount += on ? 1 : -1;
    if (loadingCount < 0) loadingCount = 0;
    var el = document.getElementById('loading');
    if (!el) {
      el = document.createElement('div'); el.id = 'loading';
      el.innerHTML = '<div class="spinner"></div>';
      document.body.appendChild(el);
    }
    el.classList.toggle('hidden', loadingCount === 0);
  }

  /** 包一層：顯示讀取中、錯誤跳提示 */
  async function run(fn, opt) {
    opt = opt || {};
    if (!opt.silent) loading(true);
    try { return await fn(); }
    catch (e) { if (!opt.noToast) toast(e.message, 'err'); throw e; }
    finally { if (!opt.silent) loading(false); }
  }

  function distM(lat1, lng1, lat2, lng2) {
    var R = 6371000, t = Math.PI / 180;
    var dLat = (lat2 - lat1) * t, dLng = (lng2 - lng1) * t;
    var x = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(lat1 * t) * Math.cos(lat2 * t) * Math.pow(Math.sin(dLng / 2), 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }

  function fmtDist(m) {
    if (m == null || !isFinite(m)) return '—';
    return m >= 1000 ? (m / 1000).toFixed(1) + ' 公里' : Math.round(m) + ' 公尺';
  }

  function fmtDuration(sec) {
    if (sec == null || !isFinite(sec)) return '—';
    sec = Math.max(0, Math.round(sec));
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return h ? h + ':' + pad(m) + ':' + pad(s) : pad(m) + ':' + pad(s);
  }

  function fmtTime(v) {
    if (!v) return '';
    var d = new Date(v);
    if (isNaN(d)) return String(v);
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /** Date → <input type="datetime-local"> 用的字串 */
  function toLocalInput(v) {
    if (!v) return '';
    var d = new Date(v);
    if (isNaN(d)) return '';
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function llOk(lat, lng) { return isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat: lat, lng: lng } : null; }

  /**
   * 解析座標，支援：
   *  ‧ 從 Google 地圖複製的「25.0330, 121.5654」
   *  ‧ Google 地圖網址：地點頁的 !3d緯度!4d經度（標記位置，最準）、?q= / ?ll= / @緯度,經度 / place/緯度,經度
   */
  function parseLatLng(s) {
    s = String(s || '').trim();
    var m;
    if (/^https?:\/\//i.test(s)) {
      try { s = decodeURIComponent(s); } catch (e) { /* 保持原樣 */ }
      var N = '(-?\\d+(?:\\.\\d+)?)';
      var pats = [
        new RegExp('!3d' + N + '!4d' + N),
        new RegExp('[?&](?:q|ll|query|destination|daddr|center|sll)=(?:loc:)?\\s*' + N + '\\s*,\\s*' + N),
        new RegExp('/(?:place|search|dir)/+' + N + ',[+\\s]*' + N),
        new RegExp('/@' + N + ',' + N)   // 畫面中心（沒有標記時的備用）
      ];
      for (var i = 0; i < pats.length; i++) {
        m = s.match(pats[i]);
        if (m) return llOk(parseFloat(m[1]), parseFloat(m[2]));
      }
      return null;
    }
    // 純文字座標：兩個數字都要有小數點（Google 地圖複製的座標一定有），避免把地址裡的「102 號 3 樓」誤當成座標
    m = s.match(/(-?\d{1,3}\.\d+)\s*[,，\s]\s*(-?\d{1,3}\.\d+)/);
    return m ? llOk(parseFloat(m[1]), parseFloat(m[2])) : null;
  }

  /** 是 Google 地圖的短網址（手機「分享」產生的 maps.app.goo.gl/…）嗎？這種要請後端展開 */
  /** 從一段貼上的文字裡找出第一個網址（Google 地圖「分享」複製的常是「地名＋換行＋網址」，不是單純網址） */
  function firstUrl(s) { var m = String(s || '').match(/https?:\/\/[^\s<>"']+/i); return m ? m[0].replace(/[)\].,;，。]+$/, '') : ''; }

  function isMapShortLink(s) { return /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs)\//i.test(String(s || '').trim()); }

  /**
   * 取得一次定位：先試高精度（GPS），逾時或失敗再改用一般精度（Wi-Fi／網路）重試。
   * 失敗時回傳具體原因與解決方法。
   */
  function locate(opt) {
    opt = opt || {};
    return new Promise(function (resolve, reject) {
      if (!window.isSecureContext) {
        return reject(new Error('定位只能在 https 網頁使用。請用 GitHub Pages 的 https 網址開啟，不要直接開電腦裡的檔案。'));
      }
      if (!('geolocation' in navigator)) return reject(new Error('這個瀏覽器不支援定位'));
      var done = function (p) {
        resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, t: Date.now() });
      };
      navigator.geolocation.getCurrentPosition(done, function (err) {
        if (err.code === 1) return reject(locateError(err));
        // 高精度失敗（電腦沒有 GPS、室內收不到）→ 改用一般精度再試一次
        navigator.geolocation.getCurrentPosition(done, function (err2) { reject(locateError(err2)); },
          { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 });
      }, { enableHighAccuracy: true, timeout: opt.timeout || 12000, maximumAge: opt.maximumAge || 0 });
    });
  }

  function locateError(err) {
    var ua = navigator.userAgent, msg;
    if (err.code === 1) {
      if (/iPhone|iPad/.test(ua)) msg = '定位權限被拒絕。請到 iPhone「設定 → 隱私權與安全性 → 定位服務」確認已開啟，並把 Safari 網站設為「使用 App 期間」，再重新整理頁面。';
      else if (/Android/.test(ua)) msg = '定位權限被拒絕。請點網址列左邊的圖示 → 權限 → 位置 → 允許，並確認手機的「定位」已開啟，再重新整理。';
      else if (/Mac/.test(ua)) msg = '定位權限被拒絕。請點網址列左邊的圖示允許位置，並到「系統設定 → 隱私權與安全性 → 定位服務」開啟並允許瀏覽器，再重新整理。';
      else msg = '定位權限被拒絕。請點網址列左邊的圖示允許位置，並到 Windows「設定 → 隱私權與安全性 → 位置」開啟位置服務並允許桌面應用程式存取，再重新整理。';
    } else if (err.code === 3) {
      msg = '定位逾時。請移到窗邊或戶外再試一次；電腦沒有 GPS 時建議改用地圖點選或貼上座標。';
    } else {
      msg = '目前無法判斷位置（裝置的定位服務可能關閉，或沒有連上 Wi-Fi）。可以改用地圖點選或貼上座標。';
    }
    var e = new Error(msg); e.code = err.code;
    return e;
  }

  var STATUS_LABEL = {
    locked: ['未解鎖', 'gray'], open: ['前往中', 'amber'], arrived: ['作答中', 'blue'],
    solved: ['已完成', 'green'], failed: ['未通過', 'red']
  };
  var TYPE_LABEL = { text: '文字作答', number: '數字作答', choice: '選擇題', photo: '拍照上傳', form: 'Google 表單', none: '打卡即過關' };
  var STATUS_COLOR = { locked: '#9a9486', open: '#e09f3e', arrived: '#2f6690', solved: '#2d6a4f', failed: '#b5452f' };

  /** 排行榜列表 HTML：名次、隊伍、路線、進度條、狀態、分數、時間、最近活動 */
  function boardHtml(rows, o) {
    o = o || {};
    var now = o.now ? new Date(o.now).getTime() : Date.now();
    var ST = { playing: ['進行中', 'amber'], finished: ['已完成', 'green'], timeup: ['超時', 'red'] };
    if (!rows.length) return '<div class="lb-empty">還沒有隊伍開始闖關</div>';
    return rows.map(function (x, i) {
      var pct = x.total ? Math.round(x.done / x.total * 100) : 0;
      var medal = ['🥇', '🥈', '🥉'][i] || (i + 1);
      var st = ST[x.status] || [x.status, 'gray'];
      var t = x.status === 'finished' ? x.duration_sec : x.elapsed_sec;
      var ago = '';
      if (x.status === 'playing' && x.last_active_at) {
        var m = Math.max(0, Math.round((now - new Date(x.last_active_at).getTime()) / 60000));
        ago = m < 1 ? '剛剛有動作' : m + ' 分鐘前有動作';
      }
      var route = x.route_name ? '<span class="chip" style="background:' + esc(x.route_color || '#e6e3dc') + ';color:' + (x.route_color ? '#fff' : 'inherit') + '">' + esc(x.route_name) + '</span>' : '';
      return '<div class="lb-row' + (i < 3 ? ' top' : '') + (o.me && x.team_name === o.me ? ' me' : '') + (x.status === 'finished' ? ' fin' : '') + '">' +
        '<div class="lb-rank">' + medal + '</div>' +
        '<div class="lb-main"><div class="lb-name">' + (x.avatar ? '<span class="lb-avatar">' + esc(x.avatar) + '</span>' : '') + '<b>' + esc(x.team_name) + '</b> ' + route +
        (x.title ? ' <span class="lb-title">' + esc(x.title) + '</span>' : '') +
        ((x.badges || []).length ? ' <span class="lb-badges">' + x.badges.map(function (b) { return '<span title="' + esc(b.name) + '">' + esc(b.icon) + '</span>'; }).join('') + '</span>' : '') + '</div>' +
        '<div class="lb-bar"><i style="width:' + pct + '%"></i></div>' +
        '<div class="lb-meta"><span class="chip ' + st[1] + '">' + st[0] + '</span> 進度 ' + x.done + '/' + x.total +
        (t != null ? '・⏱ ' + fmtDuration(t) : '') + (ago ? '・' + ago : '') + '</div></div>' +
        '<div class="lb-score"><b>' + x.score + '</b><span>分</span></div></div>';
    }).join('');
  }

  /* ---------- 卡牌（自然名角色閃卡／在地景點卡）---------- */
  var CARD_TYPE_LABEL = {
    nature: { forest: '森林', water: '溪流', sky: '天空', mountain: '山岳', grass: '草原', ocean: '海洋', night: '夜行', earth: '大地' },
    place: { forest: '自然景觀', water: '水岸風光', sky: '地標高處', mountain: '山林步道', grass: '田園農特', ocean: '海岸港灣', night: '夜市美食', earth: '古蹟人文' }
  };
  var CARD_STAT_LABEL = { nature: ['HP', '攻擊', '防禦'], place: ['人氣', '歷史', '美景'], custom: ['HP', '攻擊', '防禦'] };
  var RARITY_STARS = { normal: '★', rare: '★★', legend: '★★★' };
  var RARITY_LABEL = { normal: '普通', rare: '稀有', legend: '傳說' };

  /** 卡面圖片區：預設「完整顯示」（不裁切），空白處用同一張圖放大模糊填滿；也可選「填滿裁切」並指定對焦位置 */
  function cardArtBox(card) {
    var art = String(card.art || ''), isUrl = /^(https?:|data:image)/i.test(art);
    if (!isUrl) return '<div class="tcg-art">' + cardArt(art) + '</div>';
    var fit = card.art_fit === 'cover' ? 'cover' : 'contain', pos = { top: 'center top', bottom: 'center bottom' }[card.art_pos] || 'center center';
    return '<div class="tcg-art has-img fit-' + fit + '" style="--art:url(&quot;' + esc(art.replace(/"/g, '%22')) + '&quot;);--pos:' + pos + '">' + cardArt(art) + '</div>';
  }

  function cardArt(art, fallback) {
    art = String(art || '');
    if (/^(https?:|data:image)/i.test(art)) return '<img src="' + esc(art) + '" alt="" onerror="this.replaceWith(document.createTextNode(\'' + (fallback || '🎴') + '\'))">';
    return esc(art || fallback || '🎴');
  }

  /**
   * 一張卡的 HTML。card：{number, name, type, rarity, art, hp, atk, def, skill_name, skill_desc, story}
   * 沒有 name（尚未收集）時顯示剪影。o：{ kind: nature|place|custom, style: foil|classic|watercolor|pixel, mini, big, tilt }
   */
  function cardHtml(card, o) {
    o = o || {};
    var kind = o.kind || 'nature', style = o.style || 'foil';
    var types = CARD_TYPE_LABEL[kind] || CARD_TYPE_LABEL.nature, stats = CARD_STAT_LABEL[kind] || CARD_STAT_LABEL.nature;
    var locked = !card.name, num = ('00' + (card.number || 0)).slice(-3);
    var cls = 'tcg s-' + esc(style) + ' t-' + esc(card.type || 'forest') + ' r-' + esc(card.rarity || 'normal') + (locked ? ' locked' : '') + (o.mini ? ' mini' : '') + (o.big ? ' big' : '');
    var tl = '<span>' + esc(types[card.type] || '') + '</span><span>No.' + num + '　' + (RARITY_STARS[card.rarity] || '★') + '</span>';
    if (locked) {
      return '<div class="' + cls + '"><div class="tcg-in"><div class="tcg-head"><b class="tcg-name">？？？</b></div>' +
        cardArtBox(card) + '<div class="tcg-typeline">' + tl + '</div></div></div>';
    }
    return '<div class="' + cls + '"' + (o.tilt ? ' data-tilt="1"' : '') + '><div class="tcg-in">' +
      '<div class="tcg-head"><b class="tcg-name">' + esc(card.name) + '</b><span class="tcg-hp"><small>' + esc(stats[0]) + '</small>' + esc(card.hp) + '</span></div>' +
      cardArtBox(card) +
      '<div class="tcg-typeline">' + tl + '</div>' +
      '<div class="tcg-skill">' + (card.skill_name ? '<b>' + esc(card.skill_name) + '</b>' : '') + esc(card.skill_desc || '') + '</div>' +
      '<div class="tcg-stats"><span>' + esc(stats[1]) + ' ' + esc(card.atk) + '</span><span>' + esc(stats[2]) + ' ' + esc(card.def) + '</span></div>' +
      (card.story ? '<div class="tcg-story">' + esc(card.story) + '</div>' : '') + '</div></div>';
  }

  /** 卡片背面（開卡動畫用） */
  function cardBackHtml(title, o) {
    o = o || {};
    return '<div class="tcg tcg-back s-' + esc(o.style || 'foil') + '"><div class="tcg-in"><div class="tcg-back-mark">🎴</div><div class="tcg-back-title">' + esc(title || '圖鑑') + '</div></div></div>';
  }

  /** 讓卡片跟著手指／滑鼠傾斜，閃光跟著移動 */
  function bindTilt(root) {
    $$('.tcg[data-tilt]', root).forEach(function (el) {
      if (el._tilt) return;
      el._tilt = true;
      var move = function (e) {
        var r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        el.style.setProperty('--mx', (x * 100).toFixed(1) + '%'); el.style.setProperty('--my', (y * 100).toFixed(1) + '%');
        el.style.transform = 'perspective(700px) rotateY(' + ((x - .5) * 24).toFixed(1) + 'deg) rotateX(' + ((.5 - y) * 24).toFixed(1) + 'deg)';
      };
      var reset = function () { el.style.transform = ''; el.style.setProperty('--mx', '50%'); el.style.setProperty('--my', '50%'); };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerleave', reset);
      el.addEventListener('pointercancel', reset);
    });
  }

  /** 任何視窗、面板、浮層「打開」的那一刻（hidden 被拿掉），內容一律從最上面開始看，不要停在上次捲到的位置 */
  (function () {
    var SEL = '.modal, .solved-overlay, .sheet';
    var reset = function (el) {
      el.scrollTop = 0;
      Array.prototype.forEach.call(el.querySelectorAll('.sheet-body, .board-card, .modal-body, .card-view-box'), function (x) { x.scrollTop = 0; });
    };
    var start = function () {
      if (!window.MutationObserver) return;
      var mo = new MutationObserver(function (list) {
        list.forEach(function (m) {
          var el = m.target, was = (m.oldValue || '').split(/\s+/).indexOf('hidden') >= 0, now = el.classList.contains('hidden');
          if (was && !now) reset(el);
        });
      });
      Array.prototype.forEach.call(document.querySelectorAll(SEL), function (el) { mo.observe(el, { attributes: true, attributeFilter: ['class'], attributeOldValue: true }); });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  })();

  /**
   * 從後台跳到前台／排行榜時（網址帶 from=admin，或從主畫面圖示開啟的後台），左下角固定一顆「← 回後台」。
   * 後台加到主畫面後，點開前台會直接在同一個視窗裡跳轉，沒有返回鍵，所以要自己放一顆。
   * from=admin 只用在後台自己的「開啟」按鈕；複製給玩家的連結、QR Code 都不會帶。
   */
  (function () {
    var fromAdmin = false;
    try {
      var q = new URLSearchParams(location.search);
      if (q.get('from') === 'admin') {
        fromAdmin = true;
        sessionStorage.setItem('escapegame-from-admin', '1');
        q.delete('from');   // 網址列不要留著，避免被複製給玩家
        history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q.toString() : '') + location.hash);
      }
    } catch (e) { /* */ }
    var show = function () {
      try {
        if (!/index\.html$|board\.html$|\/$/.test(location.pathname)) return;
        if (!fromAdmin && sessionStorage.getItem('escapegame-from-admin') !== '1') return;
        if (document.getElementById('back-admin')) return;
        var a = document.createElement('a');
        a.id = 'back-admin'; a.className = 'back-admin'; a.href = 'admin.html'; a.textContent = '← 回後台';
        document.body.appendChild(a);
      } catch (e) { /* */ }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show); else show();
  })();

  global.Q = {
    cardHtml: cardHtml, cardBackHtml: cardBackHtml, bindTilt: bindTilt, cardArt: cardArt,
    CARD_TYPE_LABEL: CARD_TYPE_LABEL, CARD_STAT_LABEL: CARD_STAT_LABEL, RARITY_LABEL: RARITY_LABEL,
    boardHtml: boardHtml,
    api: api, FRONT_VERSION: FRONT_VERSION, $: $, $$: $$, esc: esc, linkify: linkify, toast: toast, loading: loading, run: run,
    distM: distM, fmtDist: fmtDist, fmtDuration: fmtDuration, fmtTime: fmtTime, toLocalInput: toLocalInput,
    parseLatLng: parseLatLng, firstUrl: firstUrl, isMapShortLink: isMapShortLink, locate: locate, STATUS_LABEL: STATUS_LABEL, TYPE_LABEL: TYPE_LABEL, STATUS_COLOR: STATUS_COLOR
  };
})(window);

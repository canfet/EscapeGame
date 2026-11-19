/* ========== 共用工具：API 呼叫、提示訊息、格式化 ========== */
(function (global) {
  'use strict';

  /** 呼叫 Apps Script API（text/plain 可避免 CORS 預檢） */
  async function api(action, payload) {
    var url = global.APP_CONFIG && global.APP_CONFIG.API_URL;
    if (!url || url.indexOf('PASTE_') === 0) throw new Error('尚未設定 API 網址，請編輯 config.js');
    var res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ action: action }, payload || {})),
        redirect: 'follow'
      });
    } catch (e) {
      throw new Error('連線失敗，請檢查網路後再試一次');
    }
    var text = await res.text(), data;
    try { data = JSON.parse(text); } catch (e) {
      throw new Error('伺服器回應格式錯誤。請確認 Apps Script 部署時「誰可以存取」選擇「所有人」。');
    }
    if (!data.ok) {
      var err = new Error(data.error || '發生錯誤');
      err.code = data.code;
      throw err;
    }
    return data;
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
    if (!box) { box = document.createElement('div'); box.id = 'toast'; document.body.appendChild(box); }
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

  /** 從 Google 地圖複製的「25.0330, 121.5654」解析成座標 */
  function parseLatLng(s) {
    var m = String(s || '').match(/(-?\d+(?:\.\d+)?)\s*[,，\s]\s*(-?\d+(?:\.\d+)?)/);
    if (!m) return null;
    var lat = parseFloat(m[1]), lng = parseFloat(m[2]);
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat: lat, lng: lng };
  }

  var STATUS_LABEL = {
    locked: ['未解鎖', 'gray'], open: ['前往中', 'amber'], arrived: ['作答中', 'blue'],
    solved: ['已完成', 'green'], failed: ['未通過', 'red']
  };
  var TYPE_LABEL = { text: '文字作答', number: '數字作答', choice: '選擇題', photo: '拍照上傳', form: 'Google 表單', none: '打卡即過關' };
  var STATUS_COLOR = { locked: '#9a9486', open: '#e09f3e', arrived: '#2f6690', solved: '#2d6a4f', failed: '#b5452f' };

  global.Q = {
    api: api, $: $, $$: $$, esc: esc, linkify: linkify, toast: toast, loading: loading, run: run,
    distM: distM, fmtDist: fmtDist, fmtDuration: fmtDuration, fmtTime: fmtTime, toLocalInput: toLocalInput,
    parseLatLng: parseLatLng, STATUS_LABEL: STATUS_LABEL, TYPE_LABEL: TYPE_LABEL, STATUS_COLOR: STATUS_COLOR
  };
})(window);

/* ========== 離線：進度快照、關卡內容預載、Service Worker 註冊（從 player.js 拆出） ==========
 * 對外：EGOffline = { save, load, remove, prefetch, registerSw, tileXY }
 */
(function (root) {
  'use strict';
  function snapKey(sid) { return 'escapegame:snap:' + sid; }
  /** 每次拿到最新進度就存一份在手機上（含已解鎖關卡的線索與題目）；容量不足就放棄，不影響遊戲 */
  function save(sid, state) {
    try {
      if (!sid || !state || !state.session) return;
      localStorage.setItem(snapKey(sid), JSON.stringify({ t: Date.now(), state: state }));
    } catch (e) { /* 無痕模式或容量不足 */ }
  }
  function load(sid) {
    try {
      var o = JSON.parse(localStorage.getItem(snapKey(sid)) || 'null');
      return o && o.state && o.state.session && o.state.session.session_id === sid ? o.state : null;
    } catch (e) { return null; }
  }
  function remove(sid) { try { if (sid) localStorage.removeItem(snapKey(sid)); } catch (e) { /* */ } }
  function tileXY(lat, lng, z) {
    var n = Math.pow(2, z), x = Math.floor((lng + 180) / 360 * n), s = Math.sin(lat * Math.PI / 180);
    var y = Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n);
    return { x: x, y: y };
  }
  /** 進行中的關卡：預先抓關卡圖片與周邊地圖圖磚（由 sw.js 存起來），到了現場訊號差也看得到；省流量模式或慢速網路不預載。memo 記錄已抓過的網址 */
  function prefetch(state, memo) {
    try {
      var conn = navigator.connection || {};
      if (!navigator.onLine || conn.saveData || /(^|-)2g$/.test(conn.effectiveType || '')) return;
      var cur = (state.stages || []).filter(function (s) { return s.status === 'open' || s.status === 'arrived'; }).slice(0, 2);
      var queue = [];
      cur.forEach(function (st) {
        if (st.image_url && !memo[st.image_url]) { memo[st.image_url] = 1; var im = new Image(); im.src = st.image_url; }
        if (st.lat == null || st.lng == null) return;
        [16, 17].forEach(function (z) {
          var c = tileXY(st.lat, st.lng, z);
          for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) {
            var url = 'https://a.tile.openstreetmap.org/' + z + '/' + (c.x + dx) + '/' + (c.y + dy) + '.png';
            if (!memo[url]) { memo[url] = 1; queue.push(url); }
          }
        });
      });
      // 分批慢慢抓（每 250 毫秒 3 張），不跟玩家的操作搶頻寬
      (function next() {
        var batch = queue.splice(0, 3);
        batch.forEach(function (u) { try { fetch(u, { mode: 'no-cors' }).catch(function () { /* */ }); } catch (e) { /* */ } });
        if (queue.length) setTimeout(next, 250);
      })();
    } catch (e) { /* */ }
  }
  function registerSw() {
    try {
      if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
        navigator.serviceWorker.register('sw.js').catch(function () { /* 註冊失敗只是少了離線快取 */ });
      }
    } catch (e) { /* */ }
  }
  root.EGOffline = { save: save, load: load, remove: remove, prefetch: prefetch, registerSw: registerSw, tileXY: tileXY };
})(window);

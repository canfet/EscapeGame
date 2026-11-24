/* ========== 無障礙輔助（前台／後台共用） ==========
 * - Q.announce(msg)：用螢幕閱讀器專用的 live 區域通報（避免對逐字輸出的文字重複朗讀）
 * - 彈窗焦點管理：開啟時焦點移入、Tab 圈在彈窗內、關閉時焦點還給原本的按鈕；後台彈窗按 Esc 可關閉
 * - 按鈕開頭的表情符號標成 aria-hidden（不讓螢幕閱讀器唸「定位圖釘」之類的符號名稱）
 * 全部包 try/catch：失敗只是沒有加強，不影響原本功能。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.A11y = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var EMOJI_LEAD = /^(\s*)((?:[←-⇿⌀-⏿■-➿⬀-⯿️‍]|[\uD83C-\uD83E][\uDC00-\uDFFF])+)(\s*)([\s\S]*)$/;

  /** 把字串開頭的表情符號分出來；沒有（或整串都是符號）回傳 null */
  function splitLeadingEmoji(s) {
    var m = EMOJI_LEAD.exec(String(s == null ? '' : s));
    if (!m || !m[4] || !m[4].replace(/\s/g, '')) return null;
    return { lead: m[1], emoji: m[2], gap: m[3], rest: m[4] };
  }

  if (typeof document === 'undefined') return { splitLeadingEmoji: splitLeadingEmoji };

  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), summary';
  var OVERLAY = '[role="dialog"][aria-modal="true"], [role="alertdialog"], .modal, .sheet';

  function isShown(el) {
    if (!el || el.classList.contains('hidden')) return false;
    var cs = window.getComputedStyle ? window.getComputedStyle(el) : null;
    return !cs || (cs.display !== 'none' && cs.visibility !== 'hidden');
  }
  function z(el) { var v = parseInt(window.getComputedStyle(el).zIndex, 10); return isNaN(v) ? 0 : v; }

  /** 目前最上層的彈窗（z-index 最高；同層取 DOM 較後面的） */
  function topOverlay() {
    var best = null, bz = -1, list = document.querySelectorAll(OVERLAY);
    for (var i = 0; i < list.length; i++) {
      if (!isShown(list[i])) continue;
      var v = z(list[i]);
      if (v >= bz) { best = list[i]; bz = v; }
    }
    return best;
  }
  function focusables(box) {
    var out = [], list = box.querySelectorAll(FOCUSABLE);
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el.tabIndex < 0 && el.tagName !== 'SUMMARY') continue;
      if (el.offsetWidth || el.offsetHeight || el.getClientRects().length) out.push(el);
    }
    return out;
  }

  /* ---------- 通報 ---------- */
  function announce(msg) {
    try {
      var box = document.getElementById('sr-live');
      if (!box) {
        box = document.createElement('div');
        box.id = 'sr-live'; box.className = 'sr-only';
        box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); box.setAttribute('aria-atomic', 'true');
        document.body.appendChild(box);
      }
      box.textContent = '';
      setTimeout(function () { box.textContent = String(msg || ''); }, 60);   // 先清空再填，同一句話也會重新朗讀
    } catch (e) { /* */ }
  }

  /* ---------- Tab 圈在最上層彈窗內 ---------- */
  document.addEventListener('keydown', function (e) {
    try {
      var top = topOverlay();
      if (!top) return;
      if (e.key === 'Escape' && top.classList.contains('modal')) {
        var x = top.querySelector('[data-close]');
        if (x) { e.preventDefault(); x.click(); }
        return;
      }
      if (e.key !== 'Tab') return;
      var f = focusables(top);
      if (!f.length) { e.preventDefault(); top.setAttribute('tabindex', '-1'); top.focus(); return; }
      var first = f[0], last = f[f.length - 1], a = document.activeElement;
      if (!top.contains(a)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && (a === first || a === top)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
    } catch (err) { /* */ }
  }, true);

  /* ---------- 開啟時焦點移入、關閉時還原 ---------- */
  var shownBefore = [], lastOutside = null;
  /** 記住彈窗外最後操作的元素（面板開啟時焦點會立刻被移走，之後才輪到這裡處理） */
  function track(e) {
    var t = e.target && e.target.closest ? e.target.closest('button, a, summary, [tabindex], input, select, textarea') : null;
    if (t && !t.closest(OVERLAY)) lastOutside = t;
  }
  document.addEventListener('focusin', track, true);
  document.addEventListener('pointerdown', track, true);
  document.addEventListener('click', track, true);
  /** 為重繪後找回元素記下選擇器（id 或 data-id） */
  function selOf(el) {
    if (el.id) return '#' + el.id;
    var d = el.getAttribute && el.getAttribute('data-id');
    return d ? el.tagName.toLowerCase() + (el.classList.length ? '.' + el.classList[0] : '') + '[data-id="' + d.replace(/"/g, '') + '"]' : '';
  }
  function syncOverlays() {
    var list = document.querySelectorAll(OVERLAY), now = [];
    for (var i = 0; i < list.length; i++) {
      var el = list[i], on = isShown(el);
      if (on) now.push(el);
      if (on && shownBefore.indexOf(el) < 0) {
        var pa = lastOutside && document.contains(lastOutside) ? lastOutside : (document.activeElement && !el.contains(document.activeElement) ? document.activeElement : null);
        el.__a11yPrev = pa; el.__a11ySel = pa ? selOf(pa) : '';
        if (el.id !== 'sheet' && !el.contains(document.activeElement)) {   // #sheet 由 player.js 自己處理焦點
          var f = focusables(el);
          try { (f[0] || el).focus({ preventScroll: true }); } catch (e) { /* */ }
          if (!f.length) { el.setAttribute('tabindex', '-1'); }
        }
      } else if (!on && shownBefore.indexOf(el) >= 0) {
        var prev = el.__a11yPrev, psel = el.__a11ySel; el.__a11yPrev = null; el.__a11ySel = '';
        if (prev && !document.contains(prev) && psel) { try { prev = document.querySelector(psel); } catch (e) { prev = null; } }   // 列表重繪後原本的按鈕已被換掉
        var ae = document.activeElement;
        if (prev && document.contains(prev) && (!ae || ae === document.body || el.contains(ae))) {
          try { prev.focus({ preventScroll: true }); } catch (e) { /* */ }
        }
      }
    }
    shownBefore = now;
  }

  /* ---------- 表情符號不朗讀 ---------- */
  function hideEmoji(root) {
    var list = (root.querySelectorAll ? root.querySelectorAll('button, a.btn, summary, .chip, .ns-label') : []);
    for (var i = 0; i < list.length; i++) {
      var n = list[i].firstChild;
      if (!n || n.nodeType !== 3) continue;
      var p = splitLeadingEmoji(n.nodeValue);
      if (!p) continue;
      var span = document.createElement('span');
      span.setAttribute('aria-hidden', 'true'); span.textContent = p.emoji;
      var t = document.createTextNode(p.gap + p.rest);
      n.parentNode.insertBefore(document.createTextNode(p.lead), n);
      n.parentNode.insertBefore(span, n);
      n.parentNode.replaceChild(t, n);
    }
  }

  /* ---------- 彈窗語意補齊（後台 .modal 沒有 role） ---------- */
  function labelModals() {
    var list = document.querySelectorAll('.modal');
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (!m.getAttribute('role')) m.setAttribute('role', 'dialog');
      if (!m.getAttribute('aria-modal')) m.setAttribute('aria-modal', 'true');
      if (!m.getAttribute('aria-label') && !m.getAttribute('aria-labelledby')) {
        var h = m.querySelector('h1, h2, h3');
        if (h && h.textContent.trim()) m.setAttribute('aria-label', h.textContent.trim().replace(/^[^\w一-鿿]+/, ''));
      }
    }
  }

  var pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    (window.requestAnimationFrame || setTimeout)(function () {
      pending = false;
      try { syncOverlays(); hideEmoji(document.body); } catch (e) { /* */ }
    });
  }
  function start() {
    try {
      labelModals();
      syncOverlays(); hideEmoji(document.body);
      new MutationObserver(function (recs) {
        // 逐字輸出、提示訊息、特效畫布的變動不需要重新掃描
        for (var i = 0; i < recs.length; i++) {
          var r = recs[i], t = r.target;
          if (r.type === 'attributes' || !(t && t.closest && t.closest('.nb-text, .dlg-text, #toast, #fx-canvas, #sr-live'))) { schedule(); return; }
        }
      }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    } catch (e) { /* */ }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  var api = { splitLeadingEmoji: splitLeadingEmoji, announce: announce, topOverlay: topOverlay };
  try { if (window.Q) window.Q.announce = announce; else window.__qAnnounce = announce; } catch (e) { /* */ }
  return api;
});

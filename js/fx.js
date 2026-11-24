/* ========== 特效：環境粒子、爆發、彩帶、逐字輸出（無相依；Node 可載入純函式） ========== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else { root.Q = root.Q || {}; root.Fx = root.Q.Fx = factory(root); }
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var LS_KEY = 'escapegame:fx';
  var MAX_PARTICLES = 40;
  var mem = null;   // localStorage 不能用時，暫存玩家的開關

  /* ---------- 純函式 ---------- */
  var SPECS = {
    fireflies: { kind: 'fireflies', count: 22, speed: 0.25, size: [1.5, 3.5], color: '255,226,120', shape: 'glow' },
    ink:       { kind: 'ink',       count: 14, speed: 0.35, size: [2, 6],     color: '40,30,25',    shape: 'drop' },
    stream:    { kind: 'stream',    count: 26, speed: 1.3,  size: [11, 15],   color: '60,255,140',  shape: 'glyph' },
    bubbles:   { kind: 'bubbles',   count: 22, speed: 0.55, size: [3, 10],    color: '190,230,255', shape: 'ring' },
    stars:     { kind: 'stars',     count: 24, speed: 0.15, size: [2, 5],     color: '255,235,150', shape: 'star' }
  };

  /** 粒子設定（未知種類回 null）；count 一定 ≤ 40 */
  function particleSpec(kind) {
    var s = SPECS[kind];
    if (!s) return null;
    return { kind: s.kind, count: Math.min(MAX_PARTICLES, s.count), speed: s.speed, size: s.size.slice(), color: s.color, shape: s.shape };
  }

  /** 逐字輸出的單位（用 Array.from，emoji 不會被拆開） */
  function typeSteps(text) {
    var t = text == null ? '' : String(text);
    var raw = typeof Array.from === 'function' ? Array.from(t) : (t.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\s\S]/g) || []);
    // 零寬連接符（ZWJ）、異體選擇符、膚色修飾符要和前一個字元黏在一起，避免 👨‍👩‍👧、🏴‍☠️ 逐字時被拆開
    var out = [], i, c, glue = false;
    for (i = 0; i < raw.length; i++) {
      c = raw[i];
      if (out.length && (glue || c === '‍' || c === '️' || c === '︎' || /^[\uD83C][\uDFFB-\uDFFF]$/.test(c))) out[out.length - 1] += c;
      else out.push(c);
      glue = c === '‍';
    }
    return out;
  }

  /* ---------- 開關 ---------- */
  function reducedMotion() {
    try { return !!(typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (e) { return false; }
  }
  function lsGet() {
    try { return typeof localStorage !== 'undefined' ? localStorage.getItem(LS_KEY) : null; } catch (e) { return null; }
  }
  function enabled() {
    if (reducedMotion()) return false;
    var v = lsGet();
    if (v !== null && v !== undefined) return v !== '0';
    return mem !== false;
  }
  function setEnabled(on) {
    mem = !!on;
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(LS_KEY, on ? '1' : '0'); } catch (e) { /* */ }
    if (!on) stop();
    else if (ambientKind) start(ambientKind);
  }
  function supported() {
    try {
      if (typeof document === 'undefined' || typeof requestAnimationFrame !== 'function') return false;
      var c = document.getElementById('fx-canvas');
      return !!(c && c.getContext);
    } catch (e) { return false; }
  }

  /* ---------- Canvas 動畫 ---------- */
  var cv = null, g = null, W = 0, H = 0, dpr = 1;
  var ambientKind = '', ambient = [], bursts = [], raf = 0, running = false, lastT = 0, bound = false;

  function rnd(a, b) { return a + Math.random() * (b - a); }

  function sizeCanvas() {
    if (!cv) return;
    dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    W = window.innerWidth || 360; H = window.innerHeight || 640;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    if (g) g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function bind() {
    if (bound) return;
    bound = true;
    try {
      window.addEventListener('resize', function () { if (cv && !cv.classList.contains('hidden')) sizeCanvas(); });
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) { cancelAnimationFrame(raf); running = false; }
        else if (ambient.length || bursts.length) loop0();
      });
    } catch (e) { /* */ }
  }

  function grab() {
    if (!supported()) return false;
    if (!cv) {
      cv = document.getElementById('fx-canvas');
      g = cv.getContext('2d');
      if (!g) { cv = null; return false; }
      bind();
    }
    return true;
  }

  function makeAmbient(spec) {
    var list = [], i;
    for (i = 0; i < spec.count; i++) {
      var p = { x: rnd(0, W), y: rnd(0, H), r: rnd(spec.size[0], spec.size[1]), ph: rnd(0, 6.28), vx: 0, vy: 0, ch: Math.random() < 0.5 ? '0' : '1' };
      if (spec.kind === 'fireflies') { p.vx = rnd(-1, 1) * spec.speed; p.vy = rnd(-1, 1) * spec.speed; }
      else if (spec.kind === 'ink') { p.vy = rnd(0.4, 1) * spec.speed; p.y = rnd(-H * 0.3, H); }
      else if (spec.kind === 'stream') { p.vy = rnd(0.5, 1) * spec.speed; }
      else if (spec.kind === 'bubbles') { p.vy = -rnd(0.5, 1) * spec.speed; p.vx = rnd(-0.1, 0.1); }
      else { p.vx = rnd(-0.05, 0.05); p.vy = rnd(-0.05, 0.05); }
      list.push(p);
    }
    return list;
  }

  function drawStar(x, y, r) {
    g.beginPath();
    g.moveTo(x, y - r * 2); g.lineTo(x + r * 0.5, y - r * 0.5); g.lineTo(x + r * 2, y); g.lineTo(x + r * 0.5, y + r * 0.5);
    g.lineTo(x, y + r * 2); g.lineTo(x - r * 0.5, y + r * 0.5); g.lineTo(x - r * 2, y); g.lineTo(x - r * 0.5, y - r * 0.5);
    g.closePath(); g.fill();
  }

  function stepAmbient(spec, dt, t) {
    var i, p, a;
    for (i = 0; i < ambient.length; i++) {
      p = ambient[i];
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (spec.kind === 'fireflies') { p.vx += rnd(-0.02, 0.02); p.vy += rnd(-0.02, 0.02); p.vx = Math.max(-0.5, Math.min(0.5, p.vx)); p.vy = Math.max(-0.5, Math.min(0.5, p.vy)); }
      if (p.x < -20) p.x = W + 10; else if (p.x > W + 20) p.x = -10;
      if (p.y < -30) p.y = H + 10; else if (p.y > H + 30) { p.y = -10; p.ch = Math.random() < 0.5 ? '0' : '1'; }
      a = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t / 700 + p.ph));
      g.fillStyle = 'rgba(' + spec.color + ',' + a.toFixed(3) + ')';
      if (spec.shape === 'glow') {
        g.shadowColor = 'rgba(' + spec.color + ',.9)'; g.shadowBlur = 10;
        g.beginPath(); g.arc(p.x, p.y, p.r, 0, 6.2832); g.fill(); g.shadowBlur = 0;
      } else if (spec.shape === 'drop') {
        g.beginPath(); g.arc(p.x, p.y, p.r * 0.6, 0, 6.2832); g.fill();
        g.fillRect(p.x - 0.5, p.y - p.r * 3, 1, p.r * 3);
      } else if (spec.shape === 'glyph') {
        g.font = p.r + 'px monospace'; g.fillText(p.ch, p.x, p.y);
      } else if (spec.shape === 'ring') {
        g.strokeStyle = 'rgba(' + spec.color + ',' + (a + 0.1).toFixed(3) + ')'; g.lineWidth = 1;
        g.beginPath(); g.arc(p.x, p.y, p.r, 0, 6.2832); g.stroke();
      } else { drawStar(p.x, p.y, p.r * (0.6 + 0.4 * Math.sin(t / 500 + p.ph))); }
    }
  }

  function stepBursts(dt) {
    var i, p, keep = [];
    for (i = 0; i < bursts.length; i++) {
      p = bursts[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      g.globalAlpha = Math.max(0, Math.min(1, p.life / 400));
      if (p.ch) { g.font = p.size + 'px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(p.ch, p.x, p.y); }
      else {
        g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.fillStyle = p.color;
        g.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); g.restore();
      }
      keep.push(p);
    }
    g.globalAlpha = 1;
    bursts = keep;
  }

  function frame(t) {
    raf = 0;
    if (!running) return;
    var dt = Math.min(48, t - (lastT || t)) / 16.7;
    var dms = Math.min(48, t - (lastT || t));
    lastT = t;
    g.clearRect(0, 0, W, H);
    var spec = ambientKind ? particleSpec(ambientKind) : null;
    if (spec && ambient.length) { g.textAlign = 'start'; g.textBaseline = 'alphabetic'; stepAmbient(spec, dt, t); }
    if (bursts.length) stepBursts(dms);
    if (!ambient.length && !bursts.length) { running = false; g.clearRect(0, 0, W, H); cv.classList.add('hidden'); return; }
    raf = requestAnimationFrame(frame);
  }

  function loop0() {
    if (running && raf) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    running = true; lastT = 0;
    cv.classList.remove('hidden');
    raf = requestAnimationFrame(frame);
  }

  /** 開始環境粒子；關閉特效或不支援時直接略過 */
  function start(kind) {
    try {
      if (!enabled() || !kind || !particleSpec(kind) || !grab()) return;
      ambientKind = kind;
      sizeCanvas();
      ambient = makeAmbient(particleSpec(kind));
      loop0();
    } catch (e) { /* 特效失敗不影響闖關 */ }
  }

  function stop() {
    ambientKind = ''; ambient = []; bursts = [];
    try {
      if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
      raf = 0; running = false;
      if (cv) { if (g) g.clearRect(0, 0, W, H); cv.classList.add('hidden'); }
    } catch (e) { /* */ }
  }

  function addBurst(list) {
    var room = MAX_PARTICLES - ambient.length - bursts.length;
    if (room <= 0) room = Math.max(0, MAX_PARTICLES - bursts.length);   // 環境粒子已滿時，仍保留少量空間給爆發
    bursts = bursts.concat(list.slice(0, Math.min(room, MAX_PARTICLES)));
    if (bursts.length) { if (!running) sizeCanvas(); loop0(); }
  }

  /** 在 (x, y)（視窗座標）爆出 coin（金幣）、star（星光）或預設的星花 */
  function burst(x, y, kind) {
    try {
      if (!enabled() || !grab()) return;
      var ch = kind === 'coin' ? '🪙' : kind === 'star' ? '✨' : '⭐', list = [], i, n = 14, a, sp;
      for (i = 0; i < n; i++) {
        a = (i / n) * 6.2832 + rnd(-0.2, 0.2); sp = rnd(2, 6);
        list.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2, g: 0.012, size: rnd(16, 26), life: rnd(700, 1200), rot: 0, vr: 0, ch: ch });
      }
      addBurst(list);
    } catch (e) { /* */ }
  }

  /** 彩帶：從畫面上緣灑落 */
  function confetti() {
    try {
      if (!enabled() || !grab()) return;
      if (!running) sizeCanvas();
      var cols = ['#f94144', '#f9c74f', '#90be6d', '#43aa8b', '#577590', '#f3722c', '#c77dff'], list = [], i;
      for (i = 0; i < MAX_PARTICLES; i++) {
        list.push({ x: rnd(0, W || 360), y: rnd(-40, 0), vx: rnd(-1.5, 1.5), vy: rnd(1, 3), g: 0.004, size: rnd(7, 12), life: rnd(1400, 2400), rot: rnd(0, 6), vr: rnd(-0.01, 0.01) * 6, color: cols[i % cols.length], ch: '' });
      }
      addBurst(list.map(function (p) { return p; }));
    } catch (e) { /* */ }
  }

  /** 逐字輸出；關閉特效／減少動態時直接顯示全文。回傳 {skip(), done} */
  function typewriter(el, text, opts) {
    opts = opts || {};
    var steps = typeSteps(text), full = steps.join(''), i = 0, timer = null;
    var h = { done: false, skip: function () { finish(); } };
    function finish() {
      if (h.done) return;
      if (timer) { clearTimeout(timer); timer = null; }
      if (el) el.textContent = full;
      h.done = true;
      if (typeof opts.onDone === 'function') { try { opts.onDone(); } catch (e) { /* */ } }
    }
    if (!el || !enabled() || !steps.length) { if (el) el.textContent = full; h.done = true; if (typeof opts.onDone === 'function') { try { opts.onDone(); } catch (e) { /* */ } } return h; }
    var speed = opts.speed > 0 ? opts.speed : 32;
    el.textContent = '';
    (function next() {
      if (h.done) return;
      i++;
      el.textContent = steps.slice(0, i).join('');
      if (i >= steps.length) return finish();
      timer = setTimeout(next, speed);
    })();
    return h;
  }

  return {
    supported: supported, enabled: enabled, setEnabled: setEnabled,
    start: start, stop: stop, burst: burst, confetti: confetti,
    typewriter: typewriter, particleSpec: particleSpec, typeSteps: typeSteps
  };
});

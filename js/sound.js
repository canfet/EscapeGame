/* ========== 音效與震動（從 player.js 拆出） ==========
 * 對外：EGSound = { Snd, unlockAudio, sfx }
 *  Snd.on  是否開啟（記在 localStorage 'escapegame:sound'）；sfx(kind) 播放音效並震動；unlockAudio() 在手指操作時解鎖音訊。
 */
(function (root) {
  'use strict';
  var Snd = { on: true, ctx: null };
  try { Snd.on = localStorage.getItem('escapegame:sound') !== '0'; } catch (e) { /* */ }

  /**
   * 解鎖音訊：手機瀏覽器（尤其 iPhone）規定要在「手指操作的當下」啟動音訊，否則之後的音效都會被靜音。
   * 音效多半在網路回應或定位更新時才觸發（不是手指操作），所以在第一次觸碰時先把音訊啟動好。
   * 另外讓 iPhone 的音效不被靜音鍵擋掉（Safari 16.4 以上）。
   */
  function unlockAudio() {
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      Snd.ctx = Snd.ctx || new AC();
      if (Snd.ctx.state === 'suspended') Snd.ctx.resume();
      var b = Snd.ctx.createBuffer(1, 1, 22050), s = Snd.ctx.createBufferSource();   // 播一段無聲的音，iOS 才算解鎖
      s.buffer = b; s.connect(Snd.ctx.destination); s.start(0);
    } catch (e) { /* 不支援就略過 */ }
  }
  ['touchend', 'pointerup', 'click', 'keydown'].forEach(function (ev) {
    var once = function () { unlockAudio(); if (Snd.ctx && Snd.ctx.state === 'running') document.removeEventListener(ev, once, true); };
    document.addEventListener(ev, once, true);
  });

  function sfx(kind) {
    if (!Snd.on) return;
    try {
      if (kind === 'blip' && !Snd.ctx) return;   // 逐字 blip 不主動建立音訊（需先被手勢解鎖）
      var vib = { ok: [60], win: [80, 50, 80, 50, 120], bad: [200], arrive: [60, 40, 60], near: [40] }[kind];
      if (vib && navigator.vibrate) navigator.vibrate(vib);
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      Snd.ctx = Snd.ctx || new AC();
      if (Snd.ctx.state === 'suspended') Snd.ctx.resume();
      var seq = { ok: [[660, .12], [880, .18]], win: [[523, .12], [659, .12], [784, .26]], bad: [[220, .28]], arrive: [[587, .1], [784, .18]], near: [[740, .14], [988, .14]],
        levelup: [[392, .09], [494, .09], [587, .09], [784, .09], [988, .09], [1175, .26]], stamp: [[150, .07], [75, .16]],
        coin: [[1319, .06], [1760, .22]], blip: [[1040, .03]], chime: [[1568, .14], [2093, .34]] }[kind] || [];
      var wave = { bad: 'sawtooth', stamp: 'square', blip: 'square', coin: 'triangle' }[kind] || 'sine';
      var vol = kind === 'blip' ? .07 : kind === 'stamp' ? .45 : .3;
      var t = Snd.ctx.currentTime;
      seq.forEach(function (n) {
        var o = Snd.ctx.createOscillator(), g = Snd.ctx.createGain();
        o.type = wave; o.frequency.value = n[0];
        g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + .02); g.gain.exponentialRampToValueAtTime(.0001, t + n[1]);
        o.connect(g); g.connect(Snd.ctx.destination); o.start(t); o.stop(t + n[1] + .02);
        t += n[1];
      });
    } catch (e) { /* 不支援就略過 */ }
  }


  root.EGSound = { Snd: Snd, unlockAudio: unlockAudio, sfx: sfx };
})(window);

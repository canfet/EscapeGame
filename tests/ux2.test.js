'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const lum = (h) => { h = h.replace('#', ''); const v = [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

test('high-contrast mode: every pair meets WCAG AAA (7:1) and the toggle is wired', () => {
  const css = read('css/style.css');
  const m = css.match(/html\.hc body\.quest \{([^}]*)\}/);
  assert.ok(m, 'html.hc body.quest block exists');
  const v = {}; m[1].replace(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g, (_, k, c) => { v[k] = c; });
  const bad = [];
  const chk = (name, a, b) => { if (cr(v[a], v[b]) < 7) bad.push(name + ' ' + cr(v[a], v[b]).toFixed(2)); };
  chk('ink/bg', 'ink', 'bg'); chk('muted/bg', 'muted', 'bg'); chk('accent/bg', 'accent', 'bg'); chk('red/bg', 'red', 'bg'); chk('blue/bg', 'blue', 'bg');
  chk('btn/forest', 'btn-text', 'forest'); chk('btn/forest-dark', 'btn-text', 'forest-dark'); chk('ink/chip', 'ink', 'chip');
  ['c-green-fg', 'c-amber-fg', 'c-red-fg', 'c-blue-fg', 'c-gray-fg'].forEach((k) => { if (cr(v[k], '#ffffff') < 7) bad.push(k + ' ' + cr(v[k], '#ffffff').toFixed(2)); });
  assert.deepStrictEqual(bad, []);
  assert.ok(read('index.html').includes('id="btn-hc"') && /escapegame:hc/.test(read('js/player.js')));
});

test('attempts counter, idle nudge, teammate sync, slow-network photo compression', () => {
  const p = read('js/player.js');
  assert.ok(/class=\\?"attempts' \+ \(rem <= 2 \? ' low' : ''\)/.test(p) || /attempts' \+ \(rem <= 2/.test(p), 'low-attempts warning');
  assert.ok(/function idleNudge\(\)/.test(p) && /180000/.test(p) && /setInterval\(idleNudge, 15000\)/.test(p));
  assert.ok(/function notifyTeammate\(prev, next\)/.test(p) && /P\.selfUntil/.test(p));
  assert.ok(/visibilityState === 'visible' && P\.state && P\.state\.session\.status === 'playing'\) \{ keepAwake\(\); if \(!P\.busy\) refresh\(\)/.test(p), 'refresh when returning to foreground');
  assert.ok(/\}, 60000\);/.test(p), 'periodic state sync');
  assert.ok(/slow \? \[\[1024, 0\.7\]/.test(p) && /slow \? 0\.8 : 1\.5/.test(p), 'smaller photos on slow networks');
  // 補送離線紀錄時才設定「自己的操作」窗口（沒有待送資料時不能吃掉隊友通知）
  const qf = p.match(/async function queueFlush\(\) \{[\s\S]*?P\.selfUntil[\s\S]*?\n/)[0];
  assert.ok(qf.indexOf('if (!q.length) return;') < qf.indexOf('P.selfUntil'), 'selfUntil only after confirming there is a queue');
});

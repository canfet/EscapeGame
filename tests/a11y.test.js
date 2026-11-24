'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const A = require('../js/a11y.js');

test('splitLeadingEmoji: separates the leading symbol only', () => {
  assert.deepStrictEqual(A.splitLeadingEmoji('📍 我到了'), { lead: '', emoji: '📍', gap: ' ', rest: '我到了' });
  assert.strictEqual(A.splitLeadingEmoji('🏴‍☠️ 出航').emoji, '🏴‍☠️');
  assert.strictEqual(A.splitLeadingEmoji('送出答案'), null);
  assert.strictEqual(A.splitLeadingEmoji('✕'), null, 'icon-only buttons keep their aria-label');
  assert.strictEqual(A.splitLeadingEmoji(''), null);
});

test('landmarks, skip link, heading and script wiring', () => {
  const index = read('index.html'), board = read('board.html'), admin = read('admin.html');
  assert.ok(/<a class="skip-link" href="#main">/.test(index) && /<main id="main"/.test(index) && /<\/main>/.test(index));
  assert.ok(/<h1 class="title" id="g-title">/.test(index), 'game screen has an h1');
  assert.ok(/<main[^>]*id="main"/.test(board) && /skip-link/.test(board));
  [index, board, admin].forEach((h) => assert.ok(h.includes('js/a11y.js?v='), 'a11y.js loaded'));
  assert.ok(/id="g-map"[^>]*aria-label=/.test(index), 'map has a text alternative');
});

test('NPC bubble is not a live region (typewriter would be read char by char); announced once instead', () => {
  const player = read('js/player.js');
  const fn = player.match(/function npcBubbleHtml\(npc, text\) \{[\s\S]*?\r?\n  \}\r?\n/);
  assert.ok(fn && !/aria-live=|role="status"/.test(fn[0]));
  assert.ok(/function say\(text, name\)/.test(player) && /say\(b\.text/.test(player));
});

// 主題色對比：次要文字／強調色／按鈕文字都要達 WCAG AA 4.5:1
test('theme colour tokens meet WCAG AA contrast', () => {
  const css = read('css/style.css');
  const lum = (h) => { h = h.replace('#', ''); const v = [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const blocks = [...css.matchAll(/(body\.theme-\w+|:root)\s*\{([^}]*)\}/g)];
  assert.ok(blocks.length >= 8);
  const bad = [];
  blocks.forEach((m) => {
    const v = {}; m[2].replace(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g, (_, k, c) => { v[k] = c; });
    const bg = v.bg || v.paper, card = v.card;
    const chk = (name, fg, back) => { if (fg && back && cr(fg, back) < 4.5) bad.push(m[1] + ' ' + name + ' ' + cr(fg, back).toFixed(2)); };
    chk('muted/bg', v.muted, bg); chk('muted/card', v.muted, card); chk('accent/bg', v.accent, bg);
    chk('button', v['btn-text'] || '#ffffff', v.forest);
  });
  assert.deepStrictEqual(bad, []);
});

test('no tiny font sizes below .75rem', () => {
  ['css/style.css', 'css/templates.css'].forEach((f) => assert.ok(!/font-size: ?\.(6[0-9]|7[0-4])rem/.test(read(f)), f));
});

'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const index = read('index.html'), player = read('js/player.js'), admin = read('admin.html'), adminJs = read('js/admin.js'), board = read('board.html');

test('script order and cache version', () => {
  const i = (s) => index.indexOf(s);
  assert.ok(i('js/templates.js') > 0 && i('js/templates.js') < i('js/fx.js') && i('js/fx.js') < i('js/player.js'));
  assert.ok(i('css/templates.css') > i('css/style.css'));
  [index, admin, board].forEach((h) => {
    const vs = new Set(h.match(/\?v=[0-9a-z]+/g) || []);
    assert.strictEqual(vs.size, 1, 'one ?v= per page: ' + [...vs]);
  });
  assert.ok(board.indexOf('js/templates.js') > 0);
});

test('new UI hidden by default', () => {
  ['fx-canvas', 'btn-fx', 'hud-exp', 'dialog', 'levelup', 'stamp'].forEach((id) => {
    const m = index.match(new RegExp('<[^>]*id="' + id + '"[^>]*>'));
    assert.ok(m, id + ' exists');
    assert.match(m[0], /hidden|aria-hidden/, id + ' hidden');
  });
});

test('ids referenced via $("#x") in player.js exist in index.html', () => {
  const ids = new Set([...player.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map((m) => m[1]));
  const missing = [...ids].filter((id) => index.indexOf('id="' + id + '"') < 0 && player.indexOf('id="' + id + '"') < 0 && !/^(s-|cmp)/.test(id));
  assert.deepStrictEqual(missing, []);
});

test('admin wiring', () => {
  ['mp-template', 'mp-npc_name', 'mp-npc_avatar'].forEach((id) => assert.ok(admin.includes('id="' + id + '"'), id));
  ['template', 'npc_name', 'npc_avatar'].forEach((f) => assert.ok(adminJs.includes("'" + f + "'"), f));
});

test('versions', () => {
  assert.match(read('js/common.js'), /FRONT_VERSION = '1\.2\.0'/);
  assert.match(read('apps-script/Code.gs'), /APP_VERSION = '1\.2\.0'/);
});

test('player.js no longer hard-codes strings replaced by vocab; classic vocab keeps them', () => {
  const T = require('../js/templates.js');
  const old = {
    stageTitle: ["'<div class=\"sheet-sub\">第 '", "' 關</div>"],
    questionHeading: ['📝 題目（'],
    arriveBtn: ["'📍 我到了，定位打卡'"],
    submitBtn: ["'送出答案'"],
    hintBtn: ['💡 需要提示？'],
    hintTitle: ["'要看提示嗎？'"]
  };
  Object.keys(old).forEach((k) => old[k].forEach((s) => assert.ok(player.indexOf(s) < 0, 'player.js still hard-codes ' + s)));
  assert.strictEqual(T.vocab('classic', 'arriveBtn'), '📍 我到了，定位打卡');
  assert.strictEqual(T.vocab('classic', 'submitBtn'), '送出答案');
  assert.strictEqual(T.vocab('classic', 'hintTitle'), '要看提示嗎？');
  assert.strictEqual(T.vocab('classic', 'hintBtn'), '💡 需要提示？');
  assert.strictEqual(T.vocab('classic', 'questionHeading'), '題目');
  assert.strictEqual(T.vocab('classic', 'stageTitle', { n: 2 }), '第 2 關');
  ['stageTitle', 'questionHeading', 'arriveBtn', 'submitBtn', 'hintBtn', 'hintTitle'].forEach((k) => assert.ok(player.indexOf("V('" + k + "'") > 0, 'uses V(' + k + ')'));
});

test('stage-panel NPC/battle code is guarded and gated to non-classic', () => {
  assert.ok(/function npcBubbleHtml\(npc, text\)/.test(player));
  assert.ok(/function npcArriveShow\(sid, ns, delay\)/.test(player) && !/escapegame:npcseen:/.test(player));
  assert.ok(/function isThemed\(\)/.test(player) && /if \(themed\) h\.push\(sheetStatusHtml/.test(player));
  assert.ok(read('css/templates.css').indexOf('prefers-reduced-motion') > 0 && /#sheet\.shake/.test(read('css/templates.css')));
});

test('admin has allow_tpl_switch checkbox and deploy workflow runs tests / strips docs', () => {
  assert.ok(admin.indexOf('id="mp-allow_tpl_switch"') > 0);
  assert.ok(/allow_tpl_switch/.test(adminJs));
  const y = read('.github/workflows/deploy.yml');
  assert.ok(y.indexOf('rm -rf tools .github docs tests') > 0 && y.indexOf('node --test') > 0);
});

test('player template switch, inline arrive bubble and new sfx', () => {
  const m = index.match(/<[^>]*id="btn-tpl"[^>]*>/);
  assert.ok(m && /\bhidden\b/.test(m[0]), 'btn-tpl exists and hidden by default');
  assert.ok(player.includes('escapegame:tpl:'));
  const fn = player.match(/function npcArriveShow\([^)]*\) \{[\s\S]*?\r?\n  \}\r?\n/);
  assert.ok(fn, 'npcArriveShow found');
  assert.ok(fn[0].indexOf('showDialog') < 0, 'npcArriveShow must not use showDialog');
  ['levelup', 'stamp', 'coin', 'blip', 'chime'].forEach((k) => assert.ok(player.includes(k + ': [['), 'sfx ' + k));
  assert.ok(/#fx-canvas\.fx-top/.test(read('css/templates.css')));
});

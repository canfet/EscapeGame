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

'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const stub = new Proxy(function () {}, { get: () => stub, apply: () => stub, construct: () => stub });
const ctx = vm.createContext({ SpreadsheetApp: stub, CacheService: stub, LockService: stub, PropertiesService: stub, Utilities: stub, ContentService: stub, Logger: stub, Session: stub, console });
const src = fs.readFileSync(path.join(root, 'apps-script/Code.gs'), 'utf8');
vm.runInContext(src + '\n;this.__x={TEMPLATES:TEMPLATES,AV:AVATARS,ABT:AVATARS_BY_TEMPLATE,normTemplate_:normTemplate_,avatarsFor_:avatarsFor_,allAvatars_:allAvatars_,cleanProject_:cleanProject_,publicProject_:publicProject_};', ctx);
const B = ctx.__x;
const T = require('../js/templates.js');

test('normTemplate_', () => {
  assert.strictEqual(B.normTemplate_('RPG'), 'rpg');
  assert.strictEqual(B.normTemplate_('zzz'), 'classic');
  assert.strictEqual(B.normTemplate_(''), 'classic');
  assert.deepStrictEqual(Array.from(B.TEMPLATES), T.IDS);
});

test('cleanProject_ defaults (old row without template)', () => {
  const p = B.cleanProject_({ project_id: 'a', name: 'n' });
  assert.strictEqual(p.template, 'classic');
  assert.strictEqual(p.npc_name, '');
  const q = B.cleanProject_({ project_id: 'a', name: 'n', template: 'rpg', npc_name: 'x'.repeat(40) });
  assert.strictEqual(q.template, 'rpg');
  assert.strictEqual(q.npc_name.length, 20);
});

test('publicProject_ exposes template and avatars', () => {
  const p = B.cleanProject_({ project_id: 'a', name: 'n', template: 'pirate' });
  const o = B.publicProject_(p, []);
  assert.strictEqual(o.template, 'pirate');
  assert.deepStrictEqual(Array.from(o.avatars), Array.from(B.ABT.pirate));
  const c = B.publicProject_(B.cleanProject_({ project_id: 'a', name: 'n' }), []);
  assert.strictEqual(c.template, 'classic');
  assert.deepStrictEqual(Array.from(c.avatars), Array.from(B.AV));
});

test('avatars match frontend', () => {
  ['rpg', 'detective', 'agent', 'pirate', 'academy'].forEach((id) => {
    assert.deepStrictEqual(Array.from(B.avatarsFor_(id)), T.avatars(id, null), id);
  });
  assert.ok(B.allAvatars_().indexOf('⚔️') >= 0);
});

test('rejects invalid template (adminSaveProject_ guard exists)', () => {
  assert.match(src, /p\.template && TEMPLATES\.indexOf\(str_\(p\.template\)\.toLowerCase\(\)\) < 0\) throw appError_\('[^']+', 'BAD_INPUT'\)/);
});

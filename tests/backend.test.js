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
vm.runInContext(src + '\n;this.__x={TEMPLATES:TEMPLATES,AV:AVATARS,ABT:AVATARS_BY_TEMPLATE,normTemplate_:normTemplate_,avatarsFor_:avatarsFor_,allAvatars_:allAvatars_,cleanProject_:cleanProject_,publicProject_:publicProject_,cleanStage_:cleanStage_,publicStage_:publicStage_};', ctx);
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

test('allow_tpl_switch defaults false and passes through when true', () => {
  const d = B.cleanProject_({ project_id: 'a', name: 'n' });
  assert.strictEqual(d.allow_tpl_switch, false);
  assert.strictEqual(B.publicProject_(d, []).allow_tpl_switch, false);
  const t = B.cleanProject_({ project_id: 'a', name: 'n', allow_tpl_switch: true });
  assert.strictEqual(t.allow_tpl_switch, true);
  assert.strictEqual(B.publicProject_(t, []).allow_tpl_switch, true);
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

test('cleanStage_ truncates npc lines to 200 chars', () => {
  const s = B.cleanStage_({ project_id: 'a', stage_id: 's1', npc_arrive: ' ' + 'a'.repeat(300), npc_wrong: 'b'.repeat(250), npc_hint: 'c'.repeat(201) });
  assert.strictEqual(s.npc_arrive.length, 200);
  assert.strictEqual(s.npc_wrong.length, 200);
  assert.strictEqual(s.npc_hint.length, 200);
  const e = B.cleanStage_({ project_id: 'a', stage_id: 's1' });
  assert.strictEqual(e.npc_arrive, '');
});

test('publicStage_ npc lines: hidden when locked, shown when set, omitted when empty', () => {
  const c = { now: new Date(), p: {} };
  const st = B.cleanStage_({ project_id: 'a', stage_id: 's1', npc_arrive: 'hi', npc_wrong: 'no', npc_hint: 'psst' });
  const locked = B.publicStage_(st, 'locked', {}, c);
  ['npc_arrive', 'npc_wrong', 'npc_hint'].forEach(k => assert.ok(!(k in locked)));
  const open = B.publicStage_(st, 'open', {}, c);
  assert.strictEqual(open.npc_arrive, 'hi');
  assert.strictEqual(open.npc_wrong, 'no');
  assert.strictEqual(open.npc_hint, 'psst');
  const empty = B.publicStage_(B.cleanStage_({ project_id: 'a', stage_id: 's2' }), 'open', {}, c);
  ['npc_arrive', 'npc_wrong', 'npc_hint'].forEach(k => assert.ok(!(k in empty)));
});

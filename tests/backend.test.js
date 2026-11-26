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
vm.runInContext(src + '\n;this.__x={TEMPLATES:TEMPLATES,AV:AVATARS,ABT:AVATARS_BY_TEMPLATE,RATE:RATE,SCHEMA:SCHEMA,normTemplate_:normTemplate_,avatarsFor_:avatarsFor_,allAvatars_:allAvatars_,cleanProject_:cleanProject_,publicProject_:publicProject_,cleanStage_:cleanStage_,publicStage_:publicStage_,parseRunCodes_:parseRunCodes_,matchRunCode_:matchRunCode_,checkPhoto_:checkPhoto_};', ctx);
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

test('parseRunCodes_ and matchRunCode_', () => {
  assert.deepStrictEqual(Array.from(B.parseRunCodes_('2026A, 2026b、2026a\n上午場；下午場')), ['2026A', '2026b', '上午場', '下午場']);
  assert.deepStrictEqual(Array.from(B.parseRunCodes_('=EVIL, +bad, ok1')), ['EVIL', 'bad', 'ok1']);
  assert.strictEqual(B.matchRunCode_(['2026A', '上午場'], '2026a'), '2026A');
  assert.strictEqual(B.matchRunCode_(['2026A'], '9999'), '');
  assert.strictEqual(B.matchRunCode_(['2026A'], ''), '');
});

test('allowed_run_codes and max_teams: sanitized, hidden from publicProject_', () => {
  const p = B.cleanProject_({ project_id: 'a', name: 'n', allowed_run_codes: '2026A、2026B', max_teams: '25' });
  assert.strictEqual(p.allowed_run_codes, '2026A, 2026B');
  assert.strictEqual(p.max_teams, 25);
  const pub = B.publicProject_(p, []);
  assert.ok(!('allowed_run_codes' in pub), 'publicProject_ must never expose allowed_run_codes');
  assert.strictEqual(pub.require_run_code, true);
  assert.strictEqual(pub.has_run_whitelist, true);

  const open = B.cleanProject_({ project_id: 'b', name: 'n', max_teams: -5 });
  assert.strictEqual(open.allowed_run_codes, '');
  assert.strictEqual(open.max_teams, 0);
  const openPub = B.publicProject_(open, []);
  assert.strictEqual(openPub.has_run_whitelist, false);
  assert.strictEqual(openPub.require_run_code, false);
});

test('checkPhoto_ allows raster images and rejects svg/non-images', () => {
  assert.doesNotThrow(() => B.checkPhoto_('data:image/jpeg;base64,AAAA'));
  assert.doesNotThrow(() => B.checkPhoto_('data:image/png;base64,AAAA'));
  assert.doesNotThrow(() => B.checkPhoto_('data:image/webp;base64,AAAA'));
  assert.throws(() => B.checkPhoto_('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='), /NEED_PHOTO|照片/);
  assert.throws(() => B.checkPhoto_('data:text/html;base64,AAAA'), /NEED_PHOTO|照片/);
});

test('startSession_ enforces run code whitelist, rate lock, and max_teams', () => {
  const store = { cache: {}, sessions: [], stages: [], project: null };
  const fakeCache = {
    get: (k) => store.cache[k] || null,
    put: (k, v) => { store.cache[k] = String(v); },
    remove: (k) => { delete store.cache[k]; }
  };
  const fakeProps = { getProperty: (k) => (k === 'TEST_TOKEN' ? 'tok123' : null), setProperty: () => {} };
  const fakeLock = { tryLock: () => true, releaseLock: () => {} };
  let uuidN = 0;
  const ctx2 = vm.createContext({
    SpreadsheetApp: stub,
    CacheService: { getScriptCache: () => fakeCache },
    LockService: { getScriptLock: () => fakeLock },
    PropertiesService: { getScriptProperties: () => fakeProps },
    Utilities: { getUuid: () => 'sid-' + (++uuidN), sleep: () => {}, formatDate: () => '1/1 00:00' },
    ContentService: stub, Logger: stub, Session: { getScriptTimeZone: () => 'Asia/Taipei' }, console
  });
  vm.runInContext(src + `
    findProject_ = function () { return __store.project; };
    stages_ = function () { return __store.stages; };
    readRows_ = function (name) { return name === 'Sessions' ? __store.sessions : []; };
    ensureHeaders_ = function () {};
    writeRow_ = function (name, row, obj) { if (name === 'Sessions') __store.sessions.push(Object.assign({ _row: __store.sessions.length + 2 }, obj)); };
    loadSession_ = function (sid) { var r = __store.sessions.filter(function (x) { return x.session_id === sid; })[0]; r.progress = {}; return r; };
    log_ = function () {};
    buildState_ = function (c) { return { state: { session: c.s } }; };
    ctx_ = function (b) { return { s: loadSession_(b.sessionId), p: __store.project, stages: [], now: new Date() }; };
  `, ctx2);
  ctx2.__store = store;
  store.project = ctx2.cleanProject_({ project_id: 'p1', name: 'Demo', status: 'active', allowed_run_codes: '2026A, 2026B', max_teams: 2 });

  // Missing run code -> NEED_RUN_CODE
  assert.throws(() => ctx2.startSession_({ projectId: 'p1', teamName: 'T1' }), (e) => e.code === 'NEED_RUN_CODE');
  // Wrong run code -> BAD_RUN_CODE
  assert.throws(() => ctx2.startSession_({ projectId: 'p1', teamName: 'T1', runCode: 'WRONG' }), (e) => e.code === 'BAD_RUN_CODE');
  // Valid run code (lowercase normalized to canonical 2026A)
  const r1 = ctx2.startSession_({ projectId: 'p1', teamName: 'T1', runCode: '2026a' });
  assert.strictEqual(r1.state.session.run_code, '2026A');
  // Second team allowed
  ctx2.startSession_({ projectId: 'p1', teamName: 'T2', runCode: '2026B' });
  // Third team blocked by max_teams = 2
  assert.throws(() => ctx2.startSession_({ projectId: 'p1', teamName: 'T3', runCode: '2026A' }), (e) => e.code === 'FULL');
  // Test mode with valid token bypasses whitelist & max_teams
  const rt = ctx2.startSession_({ projectId: 'p1', teamName: 'Tester', test: true, tt: 'tok123' });
  assert.strictEqual(rt.state.session.test, true);
  // Brute force run code lock after RATE.runCodeFail failures
  store.cache['rl_rc_p1'] = String(ctx2.RATE.runCodeFail);
  assert.throws(() => ctx2.startSession_({ projectId: 'p1', teamName: 'T4', runCode: '2026A' }), (e) => e.code === 'TOO_MANY');
});

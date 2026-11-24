'use strict';
const test = require('node:test');
const assert = require('node:assert');
const T = require('../js/templates.js');

const VOCAB_KEYS = ['nextLabel', 'stageListTitle', 'avatarLabel', 'startBtn', 'solvedTitle', 'goNext', 'finishTitle', 'introHeading'];

test('norm falls back to classic', () => {
  assert.strictEqual(T.norm('nope'), 'classic');
  assert.strictEqual(T.norm(''), 'classic');
  assert.strictEqual(T.norm(undefined), 'classic');
  assert.strictEqual(T.norm('rpg'), 'rpg');
  assert.strictEqual(T.IDS.length, 6);
});

test('rpg classes: at least 6 and classic uses fallback', () => {
  assert.ok(T.avatars('rpg', ['x']).length >= 6);
  assert.deepStrictEqual(T.avatars('classic', ['a', 'b']), ['a', 'b']);
});

test('levelInfo', () => {
  const st = (n, solved) => ({ session: { score: 0 }, stages: Array.from({ length: n }, (_, i) => ({ status: i < solved ? 'solved' : 'open', points: 10 })) });
  assert.strictEqual(T.levelInfo(st(3, 0)).lv, 1);
  assert.strictEqual(T.levelInfo(st(3, 2)).lv, 3);
  const big = { session: { score: 999 }, stages: [{ status: 'open', points: 10 }] };
  assert.strictEqual(T.levelInfo(big).pct, 100);
  const none = T.levelInfo({});
  assert.strictEqual(none.lv, 1);
  assert.ok(Number.isFinite(none.pct));
  assert.strictEqual(T.levelInfo({ session: { score: -5 }, stages: [] }).exp, 0);
});

test('npcOf', () => {
  assert.strictEqual(T.npcOf('classic', { npc_name: 'x' }), null);
  assert.deepStrictEqual(T.npcOf('rpg', { npc_name: '老王', npc_avatar: '🐲' }), { name: '老王', avatar: '🐲' });
  const d = T.npcOf('pirate', {});
  assert.ok(d && d.name && d.avatar);
});

test('vocab complete for every template', () => {
  T.IDS.forEach((id) => VOCAB_KEYS.forEach((k) => {
    const v = T.vocab(id, k, { n: 3 });
    assert.ok(typeof v === 'string' && v.length > 0, id + '.' + k);
    assert.ok(v.indexOf('{n}') < 0, id + '.' + k + ' unreplaced');
  }));
  assert.strictEqual(T.vocab('classic', 'nextLabel'), '下一站');
  assert.strictEqual(T.vocab('classic', 'solvedTitle', { n: 2 }), '第 2 關完成！');
});

test('fx and theme hints', () => {
  const fx = { classic: '', rpg: 'fireflies', detective: 'ink', agent: 'stream', pirate: 'bubbles', academy: 'stars' };
  const th = { classic: 'retro', rpg: 'forest', detective: 'history', agent: 'neon', pirate: 'ocean', academy: 'campus' };
  T.IDS.forEach((id) => {
    assert.strictEqual(T.get(id).fx, fx[id], id + ' fx');
    assert.strictEqual(T.themeHint(id), th[id], id + ' theme');
  });
});

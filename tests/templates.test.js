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

const NEW_KEYS = ['stageTitle', 'clueHeading', 'questionHeading', 'arriveBtn', 'submitBtn', 'hintBtn', 'hintTitle', 'hpLabel'];

test('stage-panel vocab keys: every template has values; classic equals the old hard-coded strings', () => {
  T.IDS.forEach((id) => NEW_KEYS.forEach((k) => {
    const v = T.vocab(id, k, { n: 3, title: 'T' });
    assert.ok(typeof v === 'string' && v.length > 0, id + '.' + k);
    assert.ok(v.indexOf('{n}') < 0 && v.indexOf('{title}') < 0, id + '.' + k + ' unreplaced');
    assert.ok(T.get(id).vocab[k], id + '.' + k + ' defined on the template itself');
  }));
  assert.strictEqual(T.vocab('classic', 'stageTitle', { n: 4 }), '第 4 關');
  assert.strictEqual(T.vocab('classic', 'questionHeading'), '題目');
  assert.strictEqual(T.vocab('classic', 'arriveBtn'), '📍 我到了，定位打卡');
  assert.strictEqual(T.vocab('classic', 'submitBtn'), '送出答案');
  assert.strictEqual(T.vocab('classic', 'hintBtn'), '💡 需要提示？');
  assert.strictEqual(T.vocab('classic', 'hintTitle'), '要看提示嗎？');
  const flavour = { rpg: ['委託內容', '試煉', '發動解答', '體力'], detective: ['現場描述', '推理題', '提出推理', '專注力'], agent: ['情報', '解碼題', '提交密碼', '電量'], pirate: ['藏寶線索', '寶箱謎題', '開啟寶箱', '士氣'], academy: ['課堂說明', '隨堂測驗', '交卷', '專注'] };
  Object.keys(flavour).forEach((id) => {
    const v = T.get(id).vocab;
    assert.deepStrictEqual([v.clueHeading, v.questionHeading, v.submitBtn, v.hpLabel], flavour[id], id);
  });
});

test('npcLine: stage override wins, defaults rotate, classic is silent', () => {
  assert.strictEqual(T.npcLine('classic', 'arrive', {}), '');
  assert.strictEqual(T.npcLine('rpg', 'arrive', {}), '冒險者，這就是你們的下一個任務。仔細看看線索吧！');
  assert.strictEqual(T.npcLine('rpg', 'arrive', { npc_arrive: ' 自訂 ' }), '自訂');
  T.IDS.filter((i) => i !== 'classic').forEach((id) => {
    ['arrive', 'hint'].forEach((k) => assert.ok(T.npcLine(id, k, {}), id + k));
    const set = new Set([0, 1, 2, 3].map((i) => T.npcLine(id, 'wrong', {}, i)));
    assert.ok(set.size >= 2 && set.size <= 3, id + ' wrong rotation');
    assert.strictEqual(T.npcLine(id, 'wrong', {}, 0), T.npcLine(id, 'wrong', {}, 3));
  });
});

test('hearts: max_attempts>0 ? max_attempts : 3, capped at 5, lost = attempts', () => {
  assert.deepStrictEqual(T.hearts({ max_attempts: 0, attempts: 1 }), { total: 3, lost: 1 });
  assert.deepStrictEqual(T.hearts({ max_attempts: 9, attempts: 2 }), { total: 5, lost: 2 });
  assert.deepStrictEqual(T.hearts({ max_attempts: 2, attempts: 7 }), { total: 2, lost: 2 });
  assert.deepStrictEqual(T.hearts({}), { total: 3, lost: 0 });
});

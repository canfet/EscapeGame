'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Fx = require('../js/fx.js');

test('particles cap', () => {
  ['fireflies', 'ink', 'stream', 'bubbles', 'stars'].forEach((k) => {
    const s = Fx.particleSpec(k);
    assert.ok(s && s.count > 0 && s.count <= 40, k);
  });
});

test('typeSteps keeps emoji intact', () => {
  const steps = Fx.typeSteps('a🏴‍☠️b');
  assert.deepStrictEqual(steps, ['a', '🏴‍☠️', 'b']);
});

test('typewriter without DOM fills text / skip is safe', () => {
  const el = { textContent: '' };
  const h = Fx.typewriter(el, '你好世界', {});
  h.skip();
  assert.strictEqual(el.textContent, '你好世界');
  assert.strictEqual(h.done, true);
});

test('disabled: setEnabled(false) persists and start/burst are no-ops', () => {
  const store = {};
  global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  Fx.setEnabled(false);
  assert.strictEqual(store['escapegame:fx'], '0');
  assert.strictEqual(Fx.enabled(), false);
  assert.doesNotThrow(() => { Fx.start('stars'); Fx.burst(1, 1, 'coin'); Fx.confetti(); Fx.stop(); });
  Fx.setEnabled(true);
  assert.notStrictEqual(store['escapegame:fx'], '0');
  delete global.localStorage;
});

'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const stub = new Proxy(function () {}, { get: () => stub, apply: () => stub, construct: () => stub });
const ctx = vm.createContext({ SpreadsheetApp: stub, CacheService: stub, LockService: stub, PropertiesService: stub, Utilities: stub, ContentService: stub, Logger: stub, Session: stub, console });
const code = read('apps-script/Code.gs');
vm.runInContext(code + '\n;this.__x={submitFeedback_:submitFeedback_,ROUTES:ROUTES,SCHEMA:SCHEMA,buildStateSrc:buildState_.toString()};', ctx);
const B = ctx.__x;

test('feedback: route registered, columns exist, rating validated before touching the sheet', () => {
  assert.strictEqual(typeof B.ROUTES.submitFeedback, 'function');
  assert.ok(B.SCHEMA.Sessions.includes('rating') && B.SCHEMA.Sessions.includes('feedback'));
  [0, 6, -1, 'x', '', null].forEach((n) => assert.throws(() => B.submitFeedback_({ sessionId: 's', rating: n }), (e) => e.code === 'BAD_INPUT', 'rating ' + n));
  assert.ok(/rating: num_\(c\.s\.rating, 0\)/.test(code), 'state exposes rating');
  assert.ok(/rating: num_\(r\.rating, 0\) \|\| 0, feedback: str_\(r\.feedback\)/.test(code), 'admin list exposes rating + feedback');
});

test('feedback UI: finish page stars are a radiogroup with labels; admin shows average', () => {
  const index = read('index.html');
  assert.ok(/id="fb-stars"[^>]*role="radiogroup"/.test(index));
  assert.strictEqual((index.match(/data-n="[1-5]"[^>]*aria-label=/g) || []).length, 5);
  assert.ok(read('admin.html').includes('id="mon-rating"') && /mon-rating/.test(read('js/admin.js')));
  assert.ok(/function setupFeedback\(se\)/.test(read('js/player.js')) && /submitFeedback/.test(read('js/player.js')));
});

test('onboarding: font prompt is part of the tutorial, not a separate confirm; extras merged into one page', () => {
  const p = read('js/player.js');
  assert.ok(!/askConfirm\('文字大小'/.test(p), 'no separate font confirm');
  assert.ok(read('index.html').includes('id="tut-font"'));
  assert.ok(/title: '小提醒'/.test(p));
});

test('arrival prompt, direction arrow, short hint confirm', () => {
  const p = read('js/player.js'), index = read('index.html');
  assert.ok(/function showArrivePrompt\(st\)/.test(p) && /function arrivePromptGo\(\)/.test(p));
  assert.ok(/id="arrive-prompt"[^>]*hidden/.test(index) && index.includes('id="ap-go"'));
  assert.ok(/function arrowOf\(b\)/.test(p) && /arrowOf\(bb\)/.test(p));
  assert.ok(!/看提示會扣分！/.test(p), 'old long hint warning removed');
});

test('stage panel: question and answer come before the (collapsed) clue while answering', () => {
  const p = read('js/player.js');
  assert.ok(/var answering = st\.status === 'arrived' && playing && !!st\.question/.test(p));
  assert.ok(/再看一次線索/.test(p) && /data-ck=/.test(p));
  assert.ok(!/目前總分 '/.test(p.split('function renderStage')[1].split('function bindStage')[0] || ''), 'duplicate score chip removed');
});

test('offline: service worker, snapshot fallback, tile prefetch, map skeleton', () => {
  const sw = read('sw.js'), p = read('js/player.js');
  assert.ok(/networkFirst\(req, 3000\)/.test(sw) && /tileFirst/.test(sw) && /TILE_MAX/.test(sw));
  assert.ok(/openstreetmap\\\.org/.test(sw));
  assert.ok(/\/\\\/__\//.test(sw), 'skips test endpoints');
  assert.ok(/register\('sw\.js'\)/.test(p) && /function saveSnapshot\(state\)/.test(p) && /function prefetchStages\(state\)/.test(p));
  assert.ok(/e\.code === 'NETWORK' && loadSnapshot\(sid\)/.test(p));
  assert.ok(/function mapSkeleton\(layer, el\)/.test(p) && /\.map\.map-skel/.test(read('css/style.css')));
  // 登出／換隊伍時要清掉快照，避免留下別隊的資料
  assert.ok(/removeItem\(snapKey\(P\.sid\)\)/.test(p));
  new vm.Script(sw);   // 語法正確
});

test('tile math used for prefetch matches the standard slippy-map formula', () => {
  const m = read('js/player.js').match(/function tileXY\(lat, lng, z\) \{[\s\S]*?\n  \}\n/);
  assert.ok(m);
  const tileXY = new Function(m[0] + '; return tileXY;')();
  assert.deepStrictEqual(tileXY(0, 0, 1), { x: 1, y: 1 });
  // 與教科書公式（lat→asinh(tan)）交叉比對：台北 101 附近、多個縮放層級
  const ref = (lat, lng, z) => {
    const n = 2 ** z, r = lat * Math.PI / 180;
    return { x: Math.floor((lng + 180) / 360 * n), y: Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n) };
  };
  [16, 17].forEach((z) => assert.deepStrictEqual(tileXY(25.033, 121.5654, z), ref(25.033, 121.5654, z)));
  assert.deepStrictEqual(tileXY(25.033, 121.5654, 16), { x: 54898, y: 28058 });
});

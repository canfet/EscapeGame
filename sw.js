/* ========== 離線快取（Service Worker） ==========
 * 只用在玩家頁（index.html）。目的：訊號差的場地也能開起頁面、地圖不會整片空白。
 *  - 頁面與程式（同網域 GET）：網路優先，3 秒沒回應或離線就用上次快取的版本；永遠不會比網路新的內容舊。
 *  - 地圖圖磚（OpenStreetMap）：快取優先，最多留 500 張；快取鍵不含 a/b/c 子網域，預載與地圖共用。
 *  - 後端 API（Apps Script）是跨網域 POST，完全不經過這裡。
 */
var SHELL = 'escapegame-shell-1.3.0';
var TILES = 'escapegame-tiles-v1';
var TILE_RE = /^https:\/\/[a-c]?\.?tile\.openstreetmap\.org\/(\d+)\/(\d+)\/(\d+)\.png$/;
var TILE_MAX = 500;

function tileKey(url) {
  var m = TILE_RE.exec(url);
  return m ? 'https://tile.openstreetmap.org/' + m[1] + '/' + m[2] + '/' + m[3] + '.png' : null;
}

self.addEventListener('install', function (e) {
  e.waitUntil((async function () {
    try {
      var cache = await caches.open(SHELL);
      var res = await fetch('index.html', { cache: 'no-cache' });
      var html = await res.clone().text();
      await cache.put('index.html', res);
      // 從 index.html 讀出要載入的 css／js／圖示（連 ?v= 版本一起），整批先放進快取
      var urls = [];
      html.replace(/(?:src|href)="((?!https?:|data:|#)[^"]+)"/g, function (_, u) { if (urls.indexOf(u) < 0) urls.push(u); return ''; });
      await Promise.all(urls.map(function (u) { return cache.add(u).catch(function () { /* 單一檔案失敗不影響安裝 */ }); }));
    } catch (err) { /* 離線安裝失敗就算了，下次再試 */ }
    self.skipWaiting();
  })());
});

self.addEventListener('activate', function (e) {
  e.waitUntil((async function () {
    var keys = await caches.keys();
    await Promise.all(keys.filter(function (k) { return k.indexOf('escapegame-shell-') === 0 && k !== SHELL; }).map(function (k) { return caches.delete(k); }));
    await self.clients.claim();
  })());
});

async function networkFirst(req, ms) {
  var cache = await caches.open(SHELL);
  try {
    var res = await Promise.race([
      fetch(req),
      new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout')); }, ms); })
    ]);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    var hit = await cache.match(req, { ignoreSearch: false }) || (req.mode === 'navigate' ? await cache.match('index.html') : null);
    if (hit) return hit;
    throw err;
  }
}

async function tileFirst(req, key) {
  var cache = await caches.open(TILES);
  var hit = await cache.match(key);
  if (hit) return hit;
  var res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) {
    cache.put(key, res.clone());
    trim(cache);
  }
  return res;
}

var trimming = false;
async function trim(cache) {
  if (trimming) return;
  trimming = true;
  try {
    var keys = await cache.keys();
    for (var i = 0; i < keys.length - TILE_MAX; i++) await cache.delete(keys[i]);   // 最舊的先刪
  } finally { trimming = false; }
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var key = tileKey(req.url);
  if (key) { e.respondWith(tileFirst(req, key).catch(function () { return Response.error(); })); return; }
  var u = new URL(req.url);
  if (u.origin !== self.location.origin || /\/__/.test(u.pathname)) return;   // 其他網域與測試用端點不處理
  if (/\/(admin|board)\.html$|\/js\/admin\.js$/.test(u.pathname)) return;     // 後台與排行榜大螢幕永遠走網路
  e.respondWith(networkFirst(req, 3000));
});

#!/usr/bin/env node
/**
 * 部署時產生 config.js：後端網址從 GitHub repo 的 Repository variable（APPS_SCRIPT_URL）讀取，
 * 不放在原始碼裡。由 .github/workflows/pages.yml 呼叫。
 *
 * 注意：產生出來的 config.js 會跟著網站一起公開（瀏覽器需要它才能呼叫後端），
 * 這個做法只是讓「原始碼 / fork / clone」看不到你的網址，不是讓網站使用者看不到。
 */
'use strict';
const fs = require('fs');

const url = (process.env.APPS_SCRIPT_URL || '').trim();
const name = (process.env.SITE_NAME || '').trim() || '實境解謎';

if (!url) {
  console.error('::error title=缺少 APPS_SCRIPT_URL::請到 repo 的 Settings → Secrets and variables → Actions → Variables，新增 Repository variable：APPS_SCRIPT_URL（Apps Script 網頁應用程式網址，結尾是 /exec）');
  process.exit(1);
}
if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url)) {
  console.error('::error title=APPS_SCRIPT_URL 格式不正確::應該像 https://script.google.com/macros/s/AKfy.../exec（結尾是 /exec，不要多空白或引號）');
  process.exit(1);
}

const body =
  '/* 由 GitHub Actions 在部署時自動產生，請勿手動修改（本機測試請複製 config.example.js 成 config.js） */\n' +
  'window.APP_CONFIG = ' + JSON.stringify({ API_URL: url, SITE_NAME: name }, null, 2) + ';\n';
fs.writeFileSync('config.js', body, 'utf8');
console.log('已產生 config.js（API_URL 已設定，網站名稱：' + name + '）');

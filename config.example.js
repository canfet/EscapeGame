/**
 * 前台設定檔範本
 *
 * 【本機測試用】複製這個檔案成 config.js（config.js 已加入 .gitignore，不會被提交），
 * 並把 API_URL 換成「你自己」部署的 Apps Script 網頁應用程式網址。
 *
 * 【正式上線】不需要 config.js：GitHub Actions 部署時會依 repo 的 Repository variable
 * APPS_SCRIPT_URL 自動產生（見 README 步驟 3）。
 * （網址長得像：https://script.google.com/macros/s/AKfy.../exec）
 *
 * 注意：不改的話，網站會連不上任何後端。
 * 請不要直接使用別人的 API_URL，那會把資料寫進別人的試算表。
 */
window.APP_CONFIG = {
  API_URL: '',
  SITE_NAME: '實境解謎'
};

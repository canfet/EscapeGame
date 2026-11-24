# 實境解謎

手機定位打卡的戶外實境解謎遊戲。設計、日常使用與疑難排解請看 [DESIGN.md](DESIGN.md)。

## 1. 建立後端（Google Apps Script）

建議用**個人 Gmail** 操作。

1. 新增一份 **Google 試算表**。
2. **擴充功能 → Apps Script**，貼上 [apps-script/Code.gs](apps-script/Code.gs) 並儲存。
3. 函式選 `setup` → **執行**，完成授權。「執行記錄」會顯示**管理密碼**，請記下來。
4. **部署 → 新增部署作業 → 網頁應用程式**
   - 執行身分：**我**
   - 誰可以存取：**所有人**
5. 複製網頁應用程式網址（結尾是 `/exec`）。

之後修改 `Code.gs`，要到「部署 → 管理部署作業 → ✏️ 編輯 → 版本：新版本 → 部署」才會生效。

## 2. 部署前台（GitHub Pages）

1. 推送到 `main`。
2. **Settings → Secrets and variables → Actions → Variables**，新增 Repository variable：
   - `APPS_SCRIPT_URL`：步驟 1 複製的網址
3. **Settings → Pages**，Source 選 **GitHub Actions**。
4. 到 **Actions** 頁面執行 **Deploy to GitHub Pages**（或再推送一次 commit）。
5. 完成後：
   - 前台：`https://<帳號>.github.io/EscapeGame/`
   - 後台：`https://<帳號>.github.io/EscapeGame/admin.html`

## 3. 開始使用

1. 開後台，輸入管理密碼。
2. 示範專案的三關通關碼是 `1111`、`2222`、`3333`，人不在現場也能測試。
3. 「複製」示範專案，改成自己的關卡與座標。
4. 「連結／QR」產生各隊連結。

## 本機測試

```bash
cp config.example.js config.js   # 填入步驟 1 的網址
python -m http.server 8000       # 開 http://localhost:8000/
```

## 體驗套版（畫面與玩法氛圍）

後台編輯專案時可選「體驗套版」：經典、RPG 角色冒險（職業、Lv／EXP、升級動畫）、偵探案件（SOLVED 印章）、特務任務（終端機風）、海盜寶藏、魔法學院。套版會改變用語、隊伍造型、NPC 對話、特效，並可搭配原本 8 種色彩主題。NPC 名稱與頭像可自訂；玩家可用右上 ✨ 關閉特效。升級後請重新部署 `Code.gs`（版本 1.2.0）。

自動測試：`node --test tests/*.test.js`

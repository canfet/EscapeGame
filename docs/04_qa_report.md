# QA 報告：體驗套版

## 測試結果（`node --test tests/*.test.js`，Node 24）
27 項全數通過（含關卡面板用語、npcLine、hearts、R8 後端欄位測試）。`node --check js/*.js` 全部通過。

| P0 | 狀態 | 對應測試 |
|---|---|---|
| R1 套版系統（後端驗證／存取／classic 預設） | 通過（邏輯層） | backend：normTemplate_、cleanProject_ defaults、publicProject_、guard |
| R2 RPG 職業、Lv/EXP | 通過（邏輯層） | templates：rpg classes、levelInfo；backend：avatars match frontend |
| R3 NPC 對話 | 通過（npcOf、typewriter 純函式） | templates：npcOf；fx：typewriter |
| R4 特效（粒子 ≤ 40、可關閉、持久化） | 通過（純函式） | fx：particles cap、disabled |
| R5 偵探／特務／海盜／學院 | 通過（用語與 fx／主題對應） | templates：vocab complete、fx and theme hints |
| R6 後台選單與 NPC 欄位 | 通過（靜態檢查） | static：admin wiring |

測試中修正 2 項為測試本身的錯誤（regex 與 typeSteps 回傳格式假設），程式無須修改。

## Known Issues / 未驗證
- **未在真實瀏覽器與手機上操作**：沒有後端網址可連，畫面、動畫、對話框排版、返回鍵行為只做靜態與純函式檢查。
- 過關畫面的粒子層（z-index 1800）在遮罩（2000）之下，會被半透明遮罩蓋住一點。
- 過關 NPC 訊息只取 `success_message` 第一句（≤ 80 字）。
- 過關 NPC 區塊用 `:has()` 排版，舊瀏覽器排版較不精準但可用。
- 後端新欄位需重新部署 Code.gs（版本 1.2.0）；後台會提示。

## 手動驗證步驟
1. 重新部署 Code.gs；後台開專案，選「RPG 角色冒險」儲存，重開確認值保留，NPC 欄位出現。
2. 用「連結／QR」開前台：確認有職業選擇、HUD 有 Lv/EXP、開場有 NPC 逐字對話。
3. 打卡、答題過關：看到 LEVEL UP；偵探套版看到 SOLVED 印章；海盜／學院看到金幣／星光。
4. 右上 ✨ 關閉特效後重新整理，仍為關閉；系統開啟「減少動態效果」時無粒子。
5. 套版改回「經典」，確認畫面與升級前相同；再用 `node tools/mobilecheck.js` 檢查 320–412px 版面。

## 關卡面板套版化（追加）
- 未在瀏覽器實測：卷軸版面、內嵌 NPC 氣泡、命中閃光／震動、320px 排版。
- 打卡台詞用底部對話框，可能蓋住送出鈕，已設 8 秒自動關閉、點擊可關。
- 台詞覆寫需重新部署 Code.gs 後才生效；沒有值時用套版預設台詞。

## 瀏覽器驗證（headless Chrome）
- 工具：`node tools/mockserver.js [port]`（靜態檔＋模擬後端，`/__set?tpl=rpg&theme=forest&switch=1` 切換套版／主題）；`node tools/shots.js [套版[:主題] …] [--size 320x568]`（自動啟動模擬後端與 Chrome，走完介紹→開始→主畫面→關卡→打卡→答錯→提示→答對→完賽，截圖存 `shots/`，已加入 .gitignore，並在各步驟檢查橫向溢出與小按鈕、收集 console 錯誤）。
- 範圍：6 個套版＋建議主題、rpg+neon、academy+mist（390x844，各約 19 張，共 153 張），另以 320x568 抽查 rpg／detective／academy+mist；`tools/mobilecheck.js` 對模擬後端的介紹頁（320–412px）無橫向捲動、無過小按鈕。
- 發現並修正：
  1. 過關畫面 NPC 氣泡與卡片左右並排（`.solved-overlay` 在 style.css 後段被改成橫向 flex，`:has` 規則只設 grid 屬性無效）→ css/templates.css 改成 `#solved` 直向排列。
  2. 環境粒子畫布 z-index 1800 蓋在關卡面板文字上（agent 的 0/1 雨、RPG 螢火蟲壓在題目上）→ 降到 900（面板之下）；過關特效層 `.fx-top` 不變。
  3. 學院（campus 主題）介紹頁英雄區白字壓淡粉漸層，對比不足 → templates.css 加深漸層並讓副標變白。
  4. 完賽頁排行榜／徽章卡片與上方按鈕貼在一起 → 非經典套版加 12px 間距（經典不變）。
  5. 開始闖關時 `scrollIntoView` 會連整頁一起捲（320 寬時主畫面開場被捲下 400px，看不到 HUD 與地圖；此為舊行為，經典也會）→ 改成只橫向捲動關卡列。
- 驗證結果：6 套版＋2 組非建議組合所有步驟畫面正常（職業選擇、HUD Lv/EXP、內嵌開場氣泡、卷軸／案件卷宗版面、體力列、答錯震動與 NPC 回應、LEVEL UP、SOLVED 印章、完賽）；暗色主題（neon、mist）搭 RPG／學院對比足夠；經典畫面沒有任何新元素；console 無錯誤（`navigator.vibrate` 的「未經使用者操作」提示來自自動點擊，已排除）。
- 仍需人眼／真機確認：觸控手勢與震動、GPS 定位與指南針、Leaflet 真實圖磚（本次離線封鎖）、音效、`prefers-reduced-motion`、iOS Safari 的 `:has()` 與 dvh 行為、字型實際載入（模擬環境擋掉 Google Fonts）。

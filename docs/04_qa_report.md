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

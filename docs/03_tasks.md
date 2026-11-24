# 任務拆解

## 1. Required Packages
無新增執行期套件。測試只用 Node ≥ 22 內建 `node:test`、`node:assert`、`node:vm`。

## 2. Task List
| Task | 檔案 | 說明 | 依賴 | 平行群組 |
|---|---|---|---|---|
| T1 | `js/templates.js` | 註冊表與純函式（見設計 4.1）；UMD | — | A |
| T2 | `js/fx.js` | 粒子／burst／confetti／typewriter／開關；UMD | — | A |
| T3 | `css/templates.css` | `tpl-*` 版型與新元件樣式 | T1（class/id 名稱） | A |
| T4 | `apps-script/Code.gs` | 後端欄位、驗證、公開欄位、版本 | — | B |
| T5 | `admin.html`、`js/admin.js` | 套版下拉＋預覽＋NPC 欄位、儲存／載入 | T1、T4 | B |
| T6 | `index.html`、`js/player.js`、`js/board.js`、`js/common.js` | 整合：套版套用、職業、HUD、對話框、過關動畫、特效掛接、用語、版本字串 | T1、T2、T3、T4 | C |
| T7 | `DESIGN.md`、`README.md` | 文件 | T6 | D |
| T8 | `tests/*.test.js` | QA 測試 | T1–T6 | D |

> 實作分兩個 Engineer：**E1** ＝ T4＋T5；**E2** ＝ T1＋T2＋T3＋T6。E1、E2 只透過設計文件介面溝通，可平行。

## 3. Shared Knowledge
- 風格：沿用專案現有寫法（IIFE、`var`、2 空格、繁體中文註解）；不引入 ES module／框架／建置。
- 套版 id：`classic|rpg|detective|agent|pirate|academy`；特效 `fx`：`''|fireflies|ink|stream|bubbles|stars`。
- localStorage 鍵：`escapegame:fx`（`'0'`＝關閉）。
- 快取版本字串統一 `?v=20261124a`（index.html、admin.html、board.html 內所有 css/js）。
- 版本：`Code.gs APP_VERSION='1.2.0'`、`common.js FRONT_VERSION='1.2.0'`、`MIN_BACKEND='1.2.0'`、`MIN_FRONT` 不變。
- 職業／偵探／特務 avatar 清單必須在 `Code.gs` 與 `templates.js` 完全一致。
- 錯誤處理：後端用 `appError_(msg,'BAD_INPUT')`；前台任何套版／特效例外都不得影響闖關（`try/catch` 包住，失敗就當 classic／無特效）。
- 無障礙：新增互動元素有 `aria-label`；特效 canvas `aria-hidden`；對話框 `role="dialog"`；`prefers-reduced-motion` 時逐字輸出直接顯示全文。
- 驗收守則：`classic` 套版 + 舊專案資料，畫面與升級前相同。

## 4. Test Plan
| P0 | 驗收條件 | 測試檔 / 名稱 |
|---|---|---|
| R1 | 非法 template 被 norm 成 classic | tests/templates.test.js「norm falls back to classic」 |
| R1 | 後端 `normTemplate_`、`cleanProject_` 舊資料→classic、`publicProject_` 回 template | tests/backend.test.js「normTemplate_」「cleanProject_ defaults」「publicProject_ exposes template」 |
| R1 | `adminSaveProject_` 非法 template → BAD_INPUT（原始碼靜態檢查驗證存在該分支） | tests/backend.test.js「rejects invalid template」 |
| R1 | classic 不新增可見元素（新 DOM 皆預設 `hidden`） | tests/static.test.js「new UI hidden by default」 |
| R2 | 職業 ≥ 6、前後端清單一致、白名單含職業 | tests/templates.test.js「rpg classes」；tests/backend.test.js「avatars match frontend」「avatarsFor_」 |
| R2 | `levelInfo`：0 關→Lv1；2 關→Lv3；pct 上限 100；無關卡不除以 0 | tests/templates.test.js「levelInfo」 |
| R3 | `npcOf`：專案值優先、否則套版預設、classic 無對話 | tests/templates.test.js「npcOf」 |
| R3 | `typeSteps`／`typewriter`：reduced-motion 直接全文；skip 立即完成 | tests/fx.test.js「typewriter」 |
| R4 | `particleSpec` 粒子數 ≤ 40；`setEnabled(false)` 後 `start` 不啟動；localStorage 持久化 | tests/fx.test.js「particles cap」「disabled」 |
| R5 | detective／agent／pirate／academy vocab 完整（所有鍵都有值）、各自 fx 正確 | tests/templates.test.js「vocab complete」 |
| R6 | admin.html 有 `mp-template`、`mp-npc_name`、`mp-npc_avatar`；admin.js `PROJECT_FIELDS` 含三欄 | tests/static.test.js「admin wiring」 |
| 共通 | 引入順序（templates→fx→player）、`?v=` 一致、`player.js` 引用的新 id 都存在於 index.html | tests/static.test.js |

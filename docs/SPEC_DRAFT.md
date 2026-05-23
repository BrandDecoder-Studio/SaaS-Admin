# Brand Decoder SaaS — 功能 Spec 草案（待對齊）

> **狀態：DRAFT** — 由程式碼逆向整理，**非正式規格**。  
> 欄位結構標示 ⚠️ 者需您提供 Firestore 截圖後才能定稿。  
> 請逐項回覆：✅ 正確 / ❌ 錯誤 / ➕ 補充

---

## A0. 多租戶架構（核心原則 · 必記）

> **本平台為多租戶（Multi-Tenant）SaaS。** 任何新功能、規則、UI、log 皆須先問：「資料與權限是否嚴格落在某一個租戶（client）內？」

### 租戶定義

| 概念 | 實作對應 |
|------|----------|
| **租戶（Tenant）** | Firestore `clients/{clientId}` 一筆文件 = 一家店家／一個專案 |
| **租戶隔離邊界** | 子集合 `products`, `members`, `qa`, `audit_logs`, `secrets/keys`… 皆在 `clients/{clientId}/` 下 |
| **租戶管理員** | `clients.adminEmail`（一 email 可理論綁多店，現行 UI 取第一家） |
| **平台方（莊家）** | Super Admin（`sys_config/admin_whitelist`）可跨租戶操作 |
| **代理商（保留）** | `agent_id` + `distributors` + `partner.html` — **尚未啟用營運**，見 **A1** |
| **LINE 實例** | 同一 Cloud Run 服務，依 `lineBotId` / Webhook 路由到對應 `clientId` |

### 開發時必守（多租戶檢查清單）

1. **禁止**在未帶 `clientId` 的情況下讀寫租戶業務資料（商品、會員、點數、log）。  
2. **禁止** A 租戶管理員看到或修改 B 租戶資料（前端閘道 + Firestore Rules 雙層）。  
3. **點數** `balance_points` 為**租戶級**，儲值／扣款 log 寫入 `clients/{id}/audit_logs`。  
4. **機密** 僅 `clients/{id}/secrets/keys`，Super Admin 專用；不可放回 `clients` 主檔。  
5. **戰情／統計** 查詢必綁 `window.currentDocId` / `currentDbId`，不可混用他戶 id。  
6. **新功能**（如綠界購點）須標明：訂單、log、`merchant_trade_no` 是否含 `clientId`，避免跨戶入帳。

### 與近期實作的關係

| 功能 | 多租戶含義 |
|------|------------|
| 登入閘道 `no-access-view` | 無任何租戶綁定 → 不進入**任一**租戶後台 |
| `dingin.tw` / `peterla0412` | 僅能進入 **adminEmail 相符** 的租戶；改 email 即剝奪該戶權限 |
| Super Admin | **唯一**可跨租戶列表、開店、儲值、審核申請 |

### A1. 代理商模組（保留未啟用 · 2026-05 對齊）

> **產品決策**：地推／分潤為早期發想，**目前沒有實際運行**。程式與 Firestore 結構**保留**，與現行營運功能**切割**。

| 項目 | 說明 |
|------|------|
| **狀態** | 🔒 **保留、未啟用** — **非目前開發項目** |
| **發想背景** | 供地推部隊推廣 + 分潤（`partner.html`、`distributors`、`commissions`） |
| **現行正式金流** | 僅 **Super Admin 匯款／手動補點**（`adminTopUpAndDistribute`、`ADMIN_TOPUP` / `ADMIN_ADJUST`） |
| **日後若啟用** | 另開 Spec：地推綁定、分潤結算、與補點／對帳如何串接 |
| **開發原則** | 不修／不部署代理商流程；Rules 收緊 `distributors` 可列低優先（無人使用） |

**與程式保留物的對照（勿當正式功能維護）：**

| 保留項 | 路徑／檔案 | 現況 |
|--------|------------|------|
| 夥伴入口 | `frontend/partner.html`、`js/partner-app.js` | 未對外營運 |
| 資料 | `distributors`、`distributors/{id}/commissions` | 可空或測試資料 |
| 開店歸戶 | `clients.agent_id`、`createClient` 的 `agent` URL 參數 | 可寫入，不影響店家日常 |
| 儲值精靈分潤 | `adminTopUpAndDistribute` 內 `agent_id` → `commissions` | 僅當該客戶**已有** `agent_id` 時寫入；非地推主流程 |
| 劃撥 API | `transferPoints`、`PARTNER_TOPUP` | **未啟用** |

**切割摘要：**

```text
【在用的】Super Admin 補點／儲值  →  clients.balance_points + audit_logs
【保留】代理商 UI／分潤／劃撥     →  不納入目前迭代與驗收
```

---

## A. 系統總覽

| 項目 | 目前理解 | 待確認 |
|------|----------|--------|
| 架構 | **多租戶 SaaS**（見 **A0**） | |
| 產品名稱 | Brand Decoder SaaS | |
| GCP 專案 ID | `lllcnd` | |
| Firestore 資料庫 ID | `branddecoder-saas-db` | |
| 管理界面 | GitHub Pages（repo: SaaS-Admin，根目錄部署） | 是否改 monorepo？ |
| LINE Bot 後端 | Cloud Run `brand-decoder-bot` / `asia-east1` | |
| Webhook 入口 | `exports.webhook`（`index.js`） | |
| 機密存放 | `clients/{clientId}/secrets/keys` | **禁止匯出真值**；欄位見 `secrets.keys.example.json` |
| Cloud Run 環境變數 | 無（多寫在程式＋Firestore） | |

---

## B. 前端（`frontend/` — 管理界面）

### B1. 頁面

| 檔案 | 用途 | 待確認 |
|------|------|--------|
| `index.html` | Super Admin / 店家管理主控台 | |
| `apply.html` | 新客申請表單 | |
| `partner.html` | 代理商（夥伴）入口 — **保留未啟用**（見 **A1**） | |

### B2. 認證與權限

#### B2a. 現況（`index.html` 管理主控台）

| 功能 | 行為 |
|------|------|
| 登入閘道 | 僅 Firebase Google 登入 + 勾選條款；**不**檢查是否有店可管 |
| Super Admin | `sys_config/admin_whitelist.emails` 含登入 email → 載入全部 `clients` |
| Super Admin 白名單（已確認 2026-05） | 目前僅 **`brand.decoderai@gmail.com`** 一筆 |
| Super Admin 政策（2026-05 決策） | **短期僅一位**，不規劃第二人；Rules 硬編碼 email 與白名單並存可接受，維持簡單 |
| 店家 Admin | `clients.adminEmail == 登入 email`（精確比對）→ 直接 `openClientDetail` |
| 零權限帳號 | 非 Super Admin 且查無 client → 仍 `showDashboard()`，列表**空白無提示**（待修） |
| 代理商 | **`partner.html` 獨立流程**（**A1：未啟用**）；不經 `index.html` / `app.js` 登入閘道 |
| 新客申請 | **`apply.html` 獨立**；不需管理台登入 |
| 服務條款 | 登入前須勾選 `#legal-agreement-check` |

#### B2b. 登入後授權閘道（**已實作 · index.html / app.js**）

**目標**：無權限使用者不得看到管理功能 UI（戰情中心／AI 大腦／詳情分頁），避免誤以為系統故障。

**時機**：`onAuthStateChanged` 取得 `user` 後，在 `showDashboard()` / `openClientDetail()` **之前**完成授權檢查（可並行：`checkSuperAdmin` + `getClientsByEmail`）。

**判定表**：

| 條件 | 畫面 |
|------|------|
| `admin_whitelist` 含 email | `dashboard-view` + 全部店家列表（同現況） |
| 否，且 `getClientsByEmail` 有 ≥1 筆 | `detail-view` 直接進第一家（同現況） |
| 否，且 `getClientsByEmail` 為空 | **`no-access-view`**：文案 + 登出 + 連結官網（**不**自動跳轉） |

**固定文案**：

> 您並沒有管理任何店家，請與管理員連絡！

**UI 品牌（已實作）**：導覽列與標題改為 **「智能中控室」**（不掛品牌名）。

**UI 約定**：

- 授權檢查中：維持登入頁或全頁 loading，**避免先閃出**「專案管理列表」。
- 頂部 `navbar`（email、登出）可保留，便於使用者確認登入帳號並登出。
- `no-access-view` 不呼叫 `loadBillingStats`、不讀 secrets、不寫入任何設定。

**驗收範例**（依目前 DB）：

| 登入 email | 預期 |
|------------|------|
| `brand.decoderai@gmail.com` | Super Admin 列表 |
| `dingin.tw@gmail.com`（`adminEmail` 已綁定） | 進該店詳情 |
| `peterla0412@gmail.com`（已自 `adminEmail` 移除） | 僅 no-access 文案 |

#### B2c. 影響分析（規劃變更）

| 範圍 | 是否受影響 | 說明 |
|------|------------|------|
| Firebase Google 登入 | 否 | 仍任何人都可完成 OAuth；差別在登入**後**顯示哪個 view |
| Super Admin | 否 | 白名單邏輯不變 |
| 店家 Admin（有綁定 email） | 否 | 仍直接進詳情；戰情／大腦等操作同現況 |
| `audit_logs` / 管理操作 log | **幾乎否** | log 在詳情內操作時寫入（`api._logAction` 用 `auth.currentUser.email`）；被攔截者**進不了詳情** → 不會新增管理端 log |
| LINE Bot / Cloud Run | 否 | 後端 Webhook 與 Firestore 讀寫不受前端 view 影響 |
| `partner.html` 代理商 | 否 | 獨立 `partner-app.js` |
| `apply.html` 申請 | 否 | 獨立頁面 |
| Firestore 讀取次數 | 略同 | 仍 1 次白名單 + 1 次 `adminEmail` 查詢；與現況相同，僅改變結果 UI |
| 資安（真正防護） | 需 Rules | 前端閘道為 UX；**Firestore Security Rules** 仍應限制非授權讀寫（另案） |
| 邊角：重整頁面 | 改善 | 無權限者重整後應仍見 no-access，不會空白列表 |
| 邊角：Super Admin 按「返回列表」 | 否 | 僅 Super Admin 可見返回鈕 |
| 邊角：多家店同 email | 否 | 仍開第一家；攔截條件為 empty |

**結論**：變更範圍限 **管理主控台登入後導向**，屬「能否進入操作界面」；不影響已授權者之功能與 log 格式。您的理解正確：**主要是登入成功後的畫面分流，不影響後續合法操作者的 log 記載。**

#### B2d. Firestore Security Rules 分析（V15.3 · 2026-03-03）

> 規則來源：使用者提供之 `firestore.rules` 全文。僅分析，未改規則。

**與前端 B2b 登入攔截的關係**：

| 層級 | 作用 |
|------|------|
| **Rules（後端）** | 已限制：非 Super Admin 且非 `adminEmail` 擁有者 → **讀不到別家 `clients` 與子集合** |
| **前端閘道（規劃）** | 避免無權限者看到空白管理 UI；**不取代 Rules** |

`peterla0412@gmail.com` 在 Rules 下本來就不應讀到已改綁 `dingin.tw` 的店家；前端攔截是 **UX**，不是唯一防線。

**對照現行功能（✅ 合理）**：

| 路徑 | 規則摘要 | 與程式 |
|------|----------|--------|
| `sys_config/admin_whitelist` | 已登入可讀；僅 Super Admin 可寫 | 對應 `checkSuperAdmin()` |
| `clients/{id}` | Super Admin / `adminEmail` 擁有者 / 合法代理商 | 列表、詳情、partner 劃撥 |
| `clients/{id}/secrets/**` | **僅 Super Admin** | 前端金庫僅 Super Admin 讀寫 |
| `clients/{id}/{子集合}` | 排除 `secrets`；Owner 或 Super Admin | products、qa、members、audit_logs、click_logs 等 |
| `clients/{id}/audit_logs` | 讀：Super Admin / Owner / 代理商；建：同上；不可改刪 | 對應 `api._logAction`、劃撥 log |
| `monthly_stats` | 讀：Super Admin 或 `clientId` Owner；不可寫 | 戰情室月統計 |
| `applications` | **create：任何人**；讀改刪：Super Admin | `apply.html` 投遞 + 後台審核 |
| 根目錄 `/audit_logs` | 獨立規則（見下方備註） | 現行前端/後端主寫 `clients/{id}/audit_logs` |

**子集合萬用規則**（`{subcollection}/{document=**}` + 排除 `secrets`）可涵蓋：`products`、`qa`、`members`、`leads`、`click_logs`、`daily_product_stats`、`categories`、`recommend_logs` 等，無需逐條列出。

**已發現問題／建議（依嚴重度）**：

| 等級 | 項目 | 說明 |
|------|------|------|
| 🟢 資訊 | 檔尾 `documents` 層 `allow write` | 見 **B2f**；非儲值主規則。單一 Super Admin 下可維持現狀；若要精簡 Rules 可日後刪除重複行（非必須）。 |
| 🟠 中（低優先） | `distributors` **任意已登入者可 read** | 代理商**未啟用**（**A1**）時為理論風險；啟用地推前建議改為：本人 `login_email` 或 `isSuperAdmin()`。 |
| 🟠 中 | `sys_config` **任意已登入者可 read** | 白名單 email 陣列對所有登入者可見（隱私/資訊揭露）。若可接受則保留；否則僅 Super Admin 可讀。 |
| 🟢 資訊 | Super Admin 硬編碼 email | `distributors` / `commissions` 使用 `brand.decoderai@gmail.com`；與白名單單一帳號一致。**現階段不擴充第二人，無需改。** |
| 🟡 低 | 根目錄 `/audit_logs` | 與 `clients/{id}/audit_logs` 並存；現行 `api.js` / `billing.js` 用**子集合**。根路徑若已廢棄可刪規則減混淆；若仍寫入則須確認 `clientId` 驗證。 |
| 🟢 資訊 | `applications` `create: if true` | 意圖為官網匿名申請；注意洗版，必要時加 App Check / rate limit（另案）。 |

**店家 Admin 更新限制（設計良好）**：

- Owner 更新 `clients` 時 **不可改 `balance_points`**（防自行加點）。
- 代理商僅能透過規則 **只改 `balance_points`** 做劃撥。

**與「無金鑰在 Rules」**：

- Rules **不含** LINE / Gemini 金鑰；`secrets` 僅 Super Admin 可讀寫 → **與金庫設計一致**。
- 貼 Rules 給第三方分析 **合理**；仍勿貼 `secrets/keys` **文件內容**。

#### B2e. 手動儲值／發錢入帳（Super Admin 面板）與 Rules 對照

**您的記憶正確**：此功能在 **戰情中心分頁下方**（`#admin-topup-panel`，僅 `window.isSuperUser` 時顯示），按鈕「啟動儲值與分潤精靈」。

| 步驟 | 前端 | Firestore 寫入 | 依賴哪條 Rule |
|------|------|----------------|---------------|
| 1 | `initAdminTopUp()` → `API.adminTopUpAndDistribute()` | `clients/{id}` 更新 `balance_points` | `match /clients/{id}` → `allow update: if isSuperAdmin()` |
| 2 | 同上 | `clients/{id}/audit_logs` 新增一筆（`ADMIN_TOPUP`） | `match .../audit_logs` → `allow create` 含 `isSuperAdmin()` |
| 3 | 若客戶有 `agent_id` | `distributors/{agentId}/commissions` 新增分潤列（`pending`） | `match .../commissions` → `allow write` 且 email `== brand.decoderai@gmail.com` |
| 4 | （舊路徑）`adminAddPoints()` | 同上 1～2，`action: ADMIN_ADJUST` | 同上；UI 上 `admin-points-input` 已少見，主流程為精靈 |

**店家 Admin 不能手動加點**：`allow update` 要求 Owner 時 `balance_points` 不變 → 與設計一致。

**代理商劃撥**（`partner.html` → `transferPoints`）：改 `distributors` 與 `clients` 的 `balance_points` + 客戶 `audit_logs`（`PARTNER_TOPUP`）→ 靠 `isAuthorizedDistributor` 分支，**不是**檔尾那行孤立 `allow write`。

**結論**：註解「寫入權限依然鎖死，只有超級管理員可以發錢入帳」描述的是**意圖**；實際生效的是：

- 客戶加點：`isSuperAdmin()`（白名單）
- 分潤 commissions 寫入：硬編碼 `brand.decoderai@gmail.com`（與唯一 Super Admin 相同，現階段 OK）

檔尾 `documents` 層 `allow write` **不是**手動儲值主路徑；儲值依 **B2e** 的 `clients` + `commissions` 規則。

#### B2f. 規則檔括號結構（V15.3 全碼複核）

```text
service cloud.firestore {
  match /databases/{database}/documents {
    match /audit_logs/{logId}           ← 根目錄 audit_logs（與 clients/.../audit_logs 不同）
    match /sys_config/{docId}
    match /clients/{clientId}
      match /secrets/{document=**}
      match /audit_logs/{logId}         ← 客戶子集合 audit_logs（api.js 使用此路徑）
      match /{subcollection}/{document=**}
    match /monthly_stats/{statId}
    match /applications/{appId}
    match /distributors/{distributorId}
      match /commissions/{commissionId}
    allow write: ... brand.decoderai...  ← ⚠️ 在 documents 層，不在任何集合 match 內
  }
}
```

**手動儲值（Super Admin 精靈）實際命中的規則**：

| 操作 | 路徑 | 命中規則 |
|------|------|----------|
| 加客戶點數 | `clients/{id}` update | `match /clients/{clientId}` → `allow update: if isSuperAdmin()` |
| 寫入帳 log | `clients/{id}/audit_logs` create | 巢狀 `match /audit_logs` → `allow create` 含 `isSuperAdmin()` |
| 寫分潤列 | `distributors/{agentId}/commissions` create | `match /commissions` → `allow write`（硬編碼 email） |

**`distributors` 區塊內已有一條 `allow write`**（同硬編碼 email）→ 用於改 **代理商主檔**（如結算 `paid_amount`），與 **commissions 子集合** 的 write 分開。

**檔尾 `documents` 層 `allow write`**：註解「發錢入帳」＝業務意圖正確；實際儲值由上表三條覆蓋。單一 Super Admin 政策下**可不動 Rules**；若要精簡檔案再測試刪除該行即可。

### B3. 管理模組（`js/modules/`）

| 模組 | 主要功能 | 主要 API／資料 |
|------|----------|----------------|
| **admin.js** | 客戶列表、開通、**儲值／補點**、申請審核、停權；代理商結算 UI **保留未啟用**（**A1**） | `clients`, `applications`, `audit_logs` |
| **products.js** | 商品 CRUD、分類、AI 標籤建議 | `products`, `categories`?, Cloud Run `aiTagSuggest` |
| **crm.js** | 會員、商機（leads） | `members`, `leads` |
| **settings.js** | QA 知識庫、LINE/Gemini 整合、店家設定 | `qa`, `secrets/keys`, `builder_settings` |
| **war-room.js** | 戰情室：點數、統計、熱門商品 | `audit_logs`, `click_logs`, `monthly_stats`, `daily_product_stats` |
| **prompt-builder.js** | Super Admin 客製 Prompt（God Mode） | ⚠️ 寫入欄位需截圖 |
| **partner-app.js** | 代理商看歸戶客戶、劃撥點數 — **保留未啟用**（**A1**） | `agent_id`, `PARTNER_TOPUP` |

### B4. 前端 → 後端 HTTP（Cloud Run）

| action | 用途 | 呼叫端 |
|--------|------|--------|
| `aiTagSuggest` | 商品圖 AI 標籤 + `system_route` | `api.getAiTagSuggestions` |
| `getEmbedding` | 文字向量 768 維（RAG） | `api.getProductEmbedding`（QA／商品儲存時） |

固定 URL（寫在 `api.js`）：  
`https://brand-decoder-bot-217800246535.asia-east1.run.app`

### B5. 前端 → Firestore 直接寫入（節選）

| 路徑 | 用途 |
|------|------|
| `clients` | 店家主檔 |
| `clients/{id}/secrets/keys` | LINE / Gemini 金鑰金庫（**不匯出真值**，見 `secrets.keys.example.json`） |
| `clients/{id}/products` | 商品 |
| `clients/{id}/qa` | QA（含 `embedding` vector） |
| `clients/{id}/members` | LINE 會員 |
| `clients/{id}/leads` | 商機 |
| `clients/{id}/audit_logs` | 稽核／計費日誌 |
| `clients/{id}/click_logs` | 點擊足跡 |
| `applications` | 新客申請 |
| `distributors` | 代理商 |
| `monthly_stats/{docId}` | 月統計 |
| `sys_config/admin_whitelist` | Super Admin 白名單 |

⚠️ **`clients` 主檔完整欄位**、**`builder_settings` 子物件** 需截圖定稿。

---

## C. 後端（`backend/` — LINE Webhook + API）

### C1. 核心入口

| 檔案 | 職責 |
|------|------|
| `index.js` | LINE Webhook 主流程 v24.2.4：驗簽、路由、AI 對話、計費 |
| `saas-api.js` | HTTP `?action=` API 閘道（展示間、申請、embedding、標籤） |

### C2. 後端模組地圖

| 檔案 | 職責（摘要） |
|------|----------------|
| `router.js` | 意圖／路由判定 |
| `hawk-eye.js` | 圖片分析 |
| `line-ui.js` | LINE 訊息／Carousel／Quick Reply |
| `prompt-engine.js` | Prompt 組裝 |
| `rag-engine.js` | RAG 檢索 |
| `products.js` | 商品查詢／推薦 |
| `crm.js` | CRM 相關 |
| `leads.js` | 商機、漏斗 QR、冷卻 |
| `salesfunnel.js` | 仿人情境逼單 |
| `billing.js` | 點數扣款與日誌 |
| `gle-engine.js` | **Global Language Engine**：依 `builder_settings.gleSelectedLanguages` 限制 AI 回覆語言 |
| `maps.js` | **門市模組**：搜尋／最近門市／店名查找；資料來源 `builder_settings.stores`（含 lat/lng，LINE 定位與導航） |
| `showroom-controller.js` | 沉浸展示間狀態機 |
| `synthesis-engine.js` | AI 圖像合成 |
| `aidp-logic.js` | 用戶照片合規審查 |
| `ai-config.js` | Gemini 模型名稱常數 |

### C3. LINE Webhook 主流程（高階）

1. 接收 LINE 事件 → 依 `lineBotId` 或路由找 `clientId`
2. 讀取 `secrets/keys`（channelAccessToken, channelSecret, geminiApiKey）
3. 驗證 LINE 簽章（`channelSecret` + rawBody）
4. 分支：Postback / 文字 / 圖片 → showroom / salesfunnel / RAG / 商品推薦等
5. `billing.performBillingAndLogging` 結束計費

⚠️ **client 解析邏輯**（多店家如何對應 LINE Bot）需截圖或說明。

### C4. `saas-api.js` HTTP Actions

| action | 功能 |
|--------|------|
| `synthesisTask` | 沉浸展示間：AIDP 審圖 → 合成 → 上傳 → LINE 推播 |
| `submitForm` | 官網新客申請 → Firestore + Telegram 通知 |
| `aiTagSuggest` | 商品圖 AI 標籤與路由 |
| `getEmbedding` | 文字向量（RAG） |

### C5. 沉浸展示間狀態機（`showroom-controller` + `members`）

| 狀態（程式出現） | 說明（待確認） |
|------------------|----------------|
| `IDLE` | 閒置 |
| `WAITING_SCENARIO` | 等待選情境 |
| `WAITING_IMAGE` | 等待用戶傳圖 |
| `PROCESSING_STUDIO` | 合成中（免圖流程） |
| `PROCESSING_IMAGE` | 處理用戶圖片中 |

相關 member 欄位：`showroom_state`, `showroom_target_product_id`, `showroom_scenarios`, `showroom_daily_count`, `last_showroom_click_at` 等 ⚠️

Postback：`action=start_showroom&productId=...`

### C6. 計費（`billing.js`）

- 店家點數：`clients.balance_points`
- 日誌：`clients/{id}/audit_logs`（`action`, `service_type`, `dedicted_points`, `details` JSON）
- ⚠️ 各 `service_type` / `action` 計價表需業務確認

---

## D. 資料模型草案（⚠️ 需截圖驗證）

### D1. `clients/{clientId}`（已對齊片段）

**頂層子集合**（截圖 2026-05）：`audit_logs`, `categories`, `click_logs`, `daily_product_stats`, `leads`（另有程式使用 `members`, `products`, `qa`, `secrets`）

| 欄位 | 說明 |
|------|------|
| `name` | 店家名稱 |
| `enableVision` | 是否啟用視覺分析 |
| `adminEmail` | 管理員 email |
| `lineBotId` | LINE Bot ID（路由用，常與 client docId 相同） |
| `status` | 例：`ACTIVE` |
| `suspended_at` / `suspend_reason` / `suspend_memo` / `evidence_url` | 停權相關 |
| `agent_id` | 代理商 ID（可為空字串） |
| `margin_rate` / `margin_expire_at` | 代理商分潤 |
| `balance_points` | 點數餘額（可為小數） |
| `last_transaction_at` | 最後交易時間 |
| `systemPrompt` | **編譯後**完整 AI Prompt（後端用，與 `customPrompt` 不同） |
| `builder_settings` | 見 **D1b** |
| `createdAt` | 建立時間（部分文件可能無） |

#### D1b. `builder_settings`（已對齊片段）

| 欄位 | 型別 | 說明 |
|------|------|------|
| `activeEngines` | string[] | 例：`Sales`, `O2O`, `Service` |
| `activeRules` | string[] | 例：`StrictQA`, `NoBargain` |
| `brand` | string | 品牌名 |
| `brandVibe` | string | 品牌調性 |
| `commStyle` | string | 溝通風格 |
| `customPrompt` | string | Super Admin 客製 Prompt（長文） |
| `enable_immersive_showroom` | boolean | 沉浸展示間開關 |
| `enable_tg_summary` | boolean | Telegram 摘要 |
| `gleSelectedLanguages` | string[] | 多語言（對應 `gle-engine.js`） |
| `industry` | string | 例：`Professional` |
| `memoryLength` | number | 對話記憶輪數 |
| `trollAlertThreshold` | number | 防刷頻／轉真人閾值 |
| `telegramChatId` | string | TG 摘要推播目標 |
| `super_keywords` | string | 超級關鍵字（點數相關等） |
| `watermark_free_until` | timestamp | 去浮水印優惠到期 |
| `quickReplies` | array | `{ label, text }` LINE Quick Reply |
| `remove_watermark` | boolean | 展示間去浮水印 |
| `responseLength` | string | 例：`Short` |
| `role` | string | 例：`Proactive Salesperson` |
| `role_weight` | number | 角色權重 |
| `stores` | array | **門市清單**（見 D1c） |

#### D1c. `builder_settings.stores[]`（門市／maps 用）

| 欄位 | 說明 |
|------|------|
| `name` | 店名 |
| `displayAddr` | 顯示用地址 |
| `address` | 備用地址 |
| `lat` / `lng` | 經緯度（數字，供最近門市計算） |
| `mapLink` | 導航連結（前端 Google Places 可寫入） |

前端：`settings.js` 寫入 `stores`；`products.js` 有 `initGoogleMapsAutocomplete`。後端：`maps.js` 處理搜尋與最近門市。

### D2. `clients/{id}/secrets/keys`

| 欄位 | 說明 |
|------|------|
| `channelAccessToken` | LINE |
| `channelSecret` | LINE 簽章 |
| `geminiApiKey` | Gemini |
| `lineBotId` | |
| `updatedAt` | |

### D3. `clients/{id}/products`（片段）

可能含：`name`, `imageUrl` / `image`, `embedding` (vector), `enable_ai_showroom`, 分類相關 ⚠️

### D4. `clients/{id}/members`（片段）

LINE `userId` 為 docId；含 `showroom_*` 狀態欄位 ⚠️

### D5. 其他集合

| 集合 | 用途 |
|------|------|
| `applications` | 新客申請；`status`: pending/PENDING 等 |
| `distributors` | 代理商；`login_email`, `balance_points` ⚠️ |
| `monthly_stats` | 月報表 docId 格式 `{dbId}_{YYYY_MM}` ? |

---

## E. 預留功能（未實作）

| 編號 | 功能 | 文件 |
|------|------|------|
| R1 | 綠界（ECPay）購點；成功／失敗皆寫 `audit_logs` | [`SPEC_RESERVED.md`](SPEC_RESERVED.md) § R1 |

---

## F. 部署與維護（非功能 Spec）

| 項目 | 現況 |
|------|------|
| 本地結構 | `frontend/` + `backend/` monorepo |
| 線上前端 | SaaS-Admin repo 根目錄 Pages |
| 線上後端 | Cloud Run Console 部署 |
| CI | Workflow 預設**手動**（見 README） |

---

## G. 提供資料庫結構

- `clients` 主檔：可用匯出腳本。
- **`secrets/keys`：禁止匯出**（僅 `secrets.keys.example.json`）。
- 其他子集合：**按需截圖**，不批次匯出。

詳見 [`docs/schema/README.md`](../schema/README.md)。

---

## H. 待您對齊的回覆格式

請複製並填寫：

```text
【整體】A 系統總覽：✅ / 修正：___
【前端】B3 模組清單：✅ / 缺漏：___
【後端】C3 Webhook 流程：✅ / 修正：___
【資料】D 欄位：已附截圖 / 稍後補 / 欄位說明如下：___
【優先】下一個要寫進正式 Spec 的功能：___
【禁止】本次不討論：___
```

---

## I. 正式 Spec 升級條件

當您回覆「**Spec 草案已對齊**」後，才會：

1. 將本檔升級或複製為 `docs/SPEC.md`
2. 後續每個功能變更引用 Spec 章節編號
3. 依 `DEVELOPMENT_RULES.md` 執行「分析→同意→實作」

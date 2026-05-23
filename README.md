# Saas Pinzi（Brand Decoder SaaS）

本地開發 monorepo：管理界面 + Cloud Run 後端。

```
Saas Pinzi/
├── frontend/    → GitHub Pages（SaaS 管理后台）
└── backend/     → Cloud Run brand-decoder-bot（LINE Webhook）
```

## 日常流程

1. 在本地修改 `frontend/` 或 `backend/`
2. `git add` → `git commit` → `git push origin main`
3. GitHub Actions 自動：
   - `frontend/**` 變更 → 部署 GitHub Pages
   - `backend/**` 變更 → 部署 Cloud Run（`lllcnd` / `asia-east1`）

## 首次設定 GitHub

### 1. 建立／連接 Repo

建議沿用 [BrandDecoder-Studio/SaaS-Admin](https://github.com/BrandDecoder-Studio/SaaS-Admin)，或新建 monorepo。

```powershell
cd "c:\Users\kclun\Desktop\Saas Pinzi"
git init
git remote add origin https://github.com/BrandDecoder-Studio/SaaS-Admin.git
git add .
git commit -m "chore: monorepo with frontend and Cloud Run backend"
git push -u origin main
```

> 若沿用 SaaS-Admin：第一次 push 後請到 **Settings → Pages → Build and deployment** 改為 **GitHub Actions**（不再用 branch 根目錄，因程式在 `frontend/`）。

### 2. 後端部署用 GCP 服務帳戶

在 [GCP Console](https://console.cloud.google.com/) → IAM → 服務帳戶 → 建立，角色至少：

- Cloud Run Admin
- Cloud Build Editor
- Service Account User
- Storage Admin（上傳 build 原始碼）
- Artifact Registry Writer

下載 JSON 金鑰，到 GitHub Repo → **Settings → Secrets → Actions** 新增：

| Secret 名稱   | 內容           |
|---------------|----------------|
| `GCP_SA_KEY`  | 服務帳戶 JSON 全文 |

### 3. 本機 gcloud（可選，手動部署測試）

```powershell
gcloud config set project lllcnd
cd backend
npm install
gcloud run deploy brand-decoder-bot --source . --region asia-east1 --function webhook --allow-unauthenticated
```

## 專案對照

| 項目 | 值 |
|------|-----|
| GCP Project ID | `lllcnd` |
| Firestore DB | `branddecoder-saas-db` |
| Cloud Run 服務 | `brand-decoder-bot` |
| Region | `asia-east1` |
| Webhook 入口 | `exports.webhook` |

機密（LINE / Gemini）在 Firestore `clients/{id}/secrets/keys`，非 Cloud Run 環境變數。

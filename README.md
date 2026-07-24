# Eric's Portfolio V4.1｜手機友善單層架構

這一版沒有 `public` 或 `src` 資料夾，所有檔案都在同一個根目錄，適合使用 iPhone 的 GitHub「Upload files」。

## 上傳到新 GitHub Repository

請一次上傳：

- worker.js
- wrangler.jsonc
- package.json
- README.md

其中 `worker.js` 已經包含：
- 完整網頁
- CSS
- 前端 JavaScript
- PWA Service Worker
- Manifest 與圖示
- 台股 API
- 匯率 API
- 自動 Beta API

因此不需要另外上傳 `index.html`、`app.js` 或資料夾。

## Cloudflare Git 自動部署

1. Cloudflare → Workers & Pages。
2. 建立新的 Worker，選擇連接 Git／Import a repository。
3. 選擇新的 V4 Repository。
4. Production branch 選 `main`。
5. Deploy command 使用 `npx wrangler deploy`。
6. 儲存並部署。

以後只要在 GitHub 更新這些根目錄檔案，Cloudflare 就會自動部署。

## 注意

本版已設定直接部署到既有 Worker：`stock-dashboard-api`，會沿用原本的 workers.dev 網址。
部署前請確認 Cloudflare 專案連接的是 `eric760614-dev/stock-tool`。

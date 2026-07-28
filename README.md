# AlphaPilot V12.0.1 — PWA App 版

以 V11.1.0 為基礎，保留 AU9901 報價、智慧搜尋、Skeleton Loading 與動畫，加入完整 PWA：

- iPhone／Android 主畫面安裝
- Standalone 全螢幕模式
- 180、192、512 PNG App 圖示與 Maskable Icon
- 啟動畫面與安全區適配
- 首次安裝引導（iPhone 顯示 Safari 加入主畫面步驟）
- 離線 App Shell 與離線提示頁
- Service Worker 新版本提示與一鍵更新
- App Shortcuts：新增持股、資產配置

## 部署

將本資料夾的 `worker.js`、`package.json`、`wrangler.jsonc`、`README.md` 覆蓋至 GitHub 專案根目錄並 Commit，Cloudflare 自動部署。

## iPhone 安裝

請用 Safari 開啟網站，點分享按鈕 → 加入主畫面 → 加入。首次安裝後會以獨立 App 模式啟動。

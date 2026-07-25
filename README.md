# AlphaPilot V8.7 Stable

Cloudflare Worker 單檔投資組合工具。

## V8.7 改善
- AU9901 改採櫃買中心最近收盤／最近成交資料，不再依賴盤中即時報價。
- 黃金資料來源短暫失敗時，既有持股會沿用上一次成功取得的收盤價，不會把市值歸零。
- 備份區只保留一個「匯入記錄檔」按鈕，隱藏瀏覽器原生的「尚未選取檔案」欄位。
- 沿用既有 LocalStorage 資料格式，不需重新輸入持股。
- 更新 Safari、Chrome 與 PWA 快取版本。

## 部署
將 `worker.js`、`wrangler.jsonc`、`package.json`、`README.md` 四個檔案推送至 GitHub，Cloudflare Workers 會自動部署。

# AlphaPilot V8.8 Stable

Cloudflare Worker 單檔部署版。

## V8.8 更新
- 質押資料改為獨立紀錄清單。
- 可從目前持股選擇股票，手動輸入質押金額與年利率。
- 同一股票再次新增時會更新該筆紀錄。
- 每筆顯示目前維持率與估計年利息。
- 還清後可直接刪除質押紀錄。
- 舊 V8.7 質押資料會自動移轉。

部署時將 `worker.js`、`wrangler.jsonc`、`package.json`、`README.md` 覆蓋至 GitHub。

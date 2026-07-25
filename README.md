# AlphaPilot V8.9 Stable

Cloudflare Worker 單檔部署版。

## V8.9 更新
- 新增質押金額上限驗證：質押金額不可超過該股票目前市值。
- 若舊紀錄已超過目前市值，卡片會標示異常並提示更新或刪除。
- 市值仍會隨持股最新報價與匯率自動更新，維持率也會同步重算。
- 保留 V8.8 的獨立質押清單、更新與刪除功能。

部署時將 `worker.js`、`wrangler.jsonc`、`package.json`、`README.md` 覆蓋至 GitHub。

# 投資資產儀表板 v3.1

## 新功能
- 不需要手動選擇台股或美股。
- 輸入股票代號後，系統會自動查詢並判斷市場。
- 查不到代號時顯示「沒有此股票，請重新輸入」。
- 美股驗證仍需要先設定 Finnhub API Key。
- 更新 Service Worker 版本，減少 Safari 持續載入舊版的問題。

## GitHub 更新
請上傳並覆蓋：
- index.html
- style.css
- app.js
- sw.js
- manifest.webmanifest
- icon.svg

`cloudflare-worker.js` 不需要重新部署。

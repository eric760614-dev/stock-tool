# 投資資產儀表板 v3

GitHub 根目錄上傳並覆蓋：
index.html、style.css、app.js、sw.js、manifest.webmanifest、icon.svg

Cloudflare Worker：
將 cloudflare-worker.js 全部內容貼入 stock-dashboard-api 的 worker.js，然後部署。

測試：
https://stock-dashboard-api.eric760614.workers.dev/status
https://stock-dashboard-api.eric760614.workers.dev/tw?symbol=0050

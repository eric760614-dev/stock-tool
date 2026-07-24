# 投資資產儀表板 v3.4｜自動 Beta

## Beta 計算方式
個別股票 Beta = 股票報酬與市場報酬的共變異數 ÷ 市場報酬的變異數。

本版本使用：
- 近兩年
- 每週調整後收盤價
- 台股基準：台灣加權指數
- 美股基準：S&P 500
- 至少 30 組對齊週報酬

投資組合 Beta：
- 每檔股票 Beta × 該股票占總資產比重
- 現金 Beta = 0
- 台股與美股均先換算為新台幣市值後加權

## 新功能
- 不需要手動輸入 Beta。
- 新增持股時自動計算 Beta。
- 「更新」與「更新全部」會同步重新估算 Beta。
- 顯示各股票的 Beta 與基準指數。
- 顯示 Beta 資料涵蓋率。
- 保留漢堡側邊選單。

## 重要：這次需要更新兩個地方

### GitHub
覆蓋：
- index.html
- style.css
- app.js
- sw.js
- manifest.webmanifest
- icon.svg

### Cloudflare Worker
將 `cloudflare-worker.js` 全部內容貼到 Cloudflare 的 `worker.js`，取代舊內容，然後按「部署」。

本版本的 Beta 是歷史估計值，會隨期間、頻率和基準指數改變；Beta 衡量的是市場敏感度，不是全部投資風險。

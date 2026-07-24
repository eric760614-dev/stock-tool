# 投資資產儀表板 v3.2

## 新功能
- 新增可愛風格的市場圓餅圖：台股、美股、現金占總資產比例。
- 保留原本個別持股配置圓餅圖。
- 新增投資組合 Beta 卡片、風險說明與資料涵蓋率。
- 新增持股時可輸入 Beta；既有持股可按「修改」補上 Beta。
- 投資組合 Beta 採總資產市值加權，現金 Beta 視為 0。
- 未填 Beta 的持股不會被假設為 1，避免顯示錯誤風險數字。

## GitHub 更新
上傳並覆蓋：
- index.html
- style.css
- app.js
- sw.js
- manifest.webmanifest
- icon.svg

Cloudflare Worker 不需要重新部署。

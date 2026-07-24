# 股票總資產計算器

## 使用方式
1. 將整個資料夾部署到 GitHub Pages、Netlify 或 Cloudflare Pages。
2. 用 iPhone Safari 開啟網址。
3. 點「分享」→「加入主畫面」。
4. 在設定中貼上 Finnhub API Key（美股報價需要）。
5. 新增台股或美股代號及持有股數。

## 代號格式
- 台股：2330、0050、00631L
- 美股：AAPL、QQQM、VT

## 注意
- 台股資料透過 TWSE 即時資訊公開查詢端點取得，端點可用性與授權政策可能調整。
- 美股使用 Finnhub Quote API，免費方案的即時性與額度依 Finnhub 帳戶方案。
- 匯率使用 open.er-api.com；失敗時可手動輸入。
- 所有持股與 API Key 只存在瀏覽器 localStorage。

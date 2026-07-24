# 股票總資產計算器 v2

## 更新內容
- 台股改由 Cloudflare Worker 代為查詢證交所「基本市況報導」資料，避開瀏覽器 CORS 限制。
- 支援上市、上櫃代號自動查詢。
- 查無成交價時會依序採用最近撮合價或昨收價，畫面仍保留手動價格備援。

## A. 更新 GitHub Pages
將以下檔案重新上傳並覆蓋原檔：
- index.html
- sw.js
- manifest.webmanifest
- icon.svg

## B. 建立 Cloudflare Worker
1. 註冊或登入 Cloudflare。
2. Workers & Pages → Create → Worker → Deploy。
3. Edit code，刪除預設程式碼。
4. 貼上 `cloudflare-worker.js` 全部內容，按 Deploy。
5. 複製 Worker 網址，例如：
   `https://stock-price-proxy.你的帳號.workers.dev`
6. 開啟股票工具 → 設定與使用說明 → 將網址貼到「台股查價 Worker 網址」→ 儲存。

## C. 美股
美股仍使用 Finnhub Quote API；請在工具設定中貼上 Finnhub API Key。

## 注意
- 證交所即時資訊端點及使用政策可能調整。
- 免費報價的延遲與可用性取決於資料供應方。
- 持股、API Key 與 Worker 網址只儲存在瀏覽器 localStorage。

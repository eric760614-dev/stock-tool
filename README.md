# AlphaPilot V6

將以下 4 個檔案上傳並覆蓋 GitHub `stock-tool` 根目錄：

- `worker.js`
- `wrangler.jsonc`
- `package.json`
- `README.md`

Commit 後 Cloudflare Git 會自動部署。

## V6 核心更新

- 組合 Beta 正式採用：`Σ（資產權重 × 個別 Beta）`
- 現金 Beta 固定為 0，並納入總資產權重
- 每檔持股顯示「權重、Beta、Beta 貢獻」
- 市場漲跌情境模擬與資產金額概算
- Beta 風險分級：低敏感、接近大盤、積極、高波動
- 歷史 Beta 以近兩年每週報酬計算
- 修正不同交易日造成的週資料對齊問題
- 00631L 等常用 ETF 歷史資料抓取失敗時，使用清楚標示的模型值
- 可輸入手動 Beta；手動值不會被自動更新覆蓋
- 明確區分 Beta（敏感度）與 Exposure（投入曝險）

## 重要提醒

Beta 與情境模擬是統計及線性概算，不代表實際報酬保證。槓桿 ETF 會受到每日重置、波動耗損及追蹤誤差影響。

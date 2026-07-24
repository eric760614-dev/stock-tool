# AlphaPilot V6.3

將以下 4 個檔案上傳並覆蓋 GitHub `stock-tool` 根目錄：

- `worker.js`
- `wrangler.jsonc`
- `package.json`
- `README.md`

Commit 後 Cloudflare Git 會自動部署。

## V6.3 分頁調整

- 開啟 App 時只顯示首頁資產摘要
- 選擇「持股」時只顯示新增持股與持股清單
- 選擇「資產配置」時只顯示配置、Beta 與完整再平衡助手
- 選擇「現金／質押」時只顯示現金及質押資訊
- 選擇「資產歷史」時只顯示歷史紀錄
- 選擇「設定」時只顯示設定及手機檔案備份
- 修正配置助手先前可能同時出現在其他頁面的問題
- 每次切換頁面會自動回到頁面頂端

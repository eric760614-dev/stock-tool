# AlphaPilot V8.5 Stable

Cloudflare Worker 單檔投資組合工具。

## V8 重點
- 目標 Portfolio Beta（預設 1.20）
- Beta Advisor：以簡潔文字提供配置調整方向
- 聰明再平衡顯示調整後 Beta
- Investment Score
- Beta 全自動，無手動 Beta 欄位
- 支援 Safari、Chrome、Edge、Firefox 與安裝成 PWA
- 保留持股合併、報價、備份還原、質押與歷史功能

將四個檔案推送至 GitHub，Cloudflare Workers 會自動部署。


## V8.5 Stable 修正
- 修正新增持股時 `betaSourceText` 未定義造成的畫面中斷。
- 修正資料已儲存，但持股清單無法顯示的問題。
- 更新 Safari、Chrome 與 PWA 快取版本。
- 沿用既有 LocalStorage 資料格式，不需重新輸入持股。

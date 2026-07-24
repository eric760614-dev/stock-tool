# AlphaPilot V7.3

Cloudflare Workers 單檔部署版。

## V7.3 更新
- 移除新增與修改持股中的手動 Beta
- Beta 全部由系統自動判斷
- 舊備份中的手動 Beta 設定會被忽略，更新後改用自動 Beta
- 支援 Chrome、Safari、Edge、Firefox
- 保留 V7.2 的自動累加持股、AU9901、自動報價、備份還原與其他功能

將以下四個檔案覆蓋至 GitHub 後，由 Cloudflare 自動部署：
- worker.js
- wrangler.jsonc
- package.json
- README.md

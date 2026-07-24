# AlphaPilot V7.2

保留 V7.1 全部功能，新增相同代號持股自動累加。例如原有 QQQ 30 股，再新增 QQQ 50 股，會自動合併為 80 股，不會建立重複持股。股票代號不分大小寫，新增後依代號排序；AU9901 也支援相同累加邏輯。

覆蓋 GitHub 中的 worker.js、wrangler.jsonc、package.json、README.md，Cloudflare 部署完成後重新整理，版本應顯示 V7.2。

# AlphaPilot V12.0.2

## 本次修正

- 台股與美股的單位價格在資產計算前統一四捨五入至小數點後 2 位。
- 持股市值、總資產、台股與美股合計皆顯示至小數點後 2 位。
- 保留 V12.0.1 的 TWSE MIS 即時價解析與 PWA 功能。
- 更新 Service Worker 快取版本，避免手機沿用舊版。

## 部署

```bash
npm install
npx wrangler deploy
```

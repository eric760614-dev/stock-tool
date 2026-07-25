const ALLOWED_ORIGINS = new Set([
  "https://eric760614-dev.github.io",
  "http://localhost:8787",
  "http://127.0.0.1:8787"
]);

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "*";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function jsonResponse(request, data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(request)
    }
  });
}

function firstPositiveNumber(values) {
  for (const value of values) {
    if (value === undefined || value === null || value === "" || value === "-") continue;
    const number = Number(String(value).replace(/,/g, ""));
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

async function queryTwseChannel(channel) {
  const url = new URL("https://mis.twse.com.tw/stock/api/getStockInfo.jsp");
  url.searchParams.set("ex_ch", channel);
  url.searchParams.set("json", "1");
  url.searchParams.set("delay", "0");
  url.searchParams.set("_", String(Date.now()));

  const response = await fetch(url.toString(), {
    headers: {
      "Accept": "application/json,text/plain,*/*",
      "Referer": "https://mis.twse.com.tw/stock/index?lang=zhHant",
      "User-Agent": "Mozilla/5.0 StockDashboardWorker/3.0"
    },
    cf: { cacheTtl: 0, cacheEverything: false }
  });

  if (!response.ok) throw new Error(`TWSE upstream HTTP ${response.status}`);

  const data = await response.json();
  const item = Array.isArray(data.msgArray) ? data.msgArray[0] : null;
  if (!item || !item.c) return null;

  const price = firstPositiveNumber([item.z, item.pz, item.y]);
  if (!price) return null;

  return {
    symbol: item.c,
    name: item.n || item.nf || item.c,
    market: channel.startsWith("tse_") ? "TWSE" : "TPEx",
    price,
    previousClose: firstPositiveNumber([item.y]),
    open: firstPositiveNumber([item.o]),
    high: firstPositiveNumber([item.h]),
    low: firstPositiveNumber([item.l]),
    volume: firstPositiveNumber([item.v, item.tv]),
    date: item.d || null,
    time: item.t || item.ot || null
  };
}

function parseCsvLine(line) {
  const fields = []; let field = ""; let quoted = false;
  for (let i = 0; i < line.length; i++) { const ch = line[i]; if (ch === '"') { if (quoted && line[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; } else if (ch === ',' && !quoted) { fields.push(field.trim()); field = ""; } else field += ch; }
  fields.push(field.trim()); return fields.map(v => v.replace(/^"|"$/g, "").trim());
}

async function getGoldQuote(symbol = "AU9901") {
  const headers = {
    "Accept": "application/json,text/csv,text/plain,*/*",
    "Referer": "https://www.tpex.org.tw/zh-tw/other/gold/statistics/price.html",
    "User-Agent": "Mozilla/5.0 AlphaPilot/8.7"
  };

  // 優先使用櫃買中心 OpenAPI 的黃金現貨當日行情表。
  // AlphaPilot 僅取「最後收盤／最近成交」類價格，不再依賴盤中即時連線。
  try {
    const response = await fetch("https://www.tpex.org.tw/openapi/v1/tpex_gold_latest", {
      headers,
      cf: { cacheTtl: 1800, cacheEverything: true }
    });
    if (!response.ok) throw new Error(`TPEx OpenAPI HTTP ${response.status}`);
    const data = await response.json();
    const rows = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
    const row = rows.find(item => {
      const code = item?.["黃金現貨代號"] ?? item?.["代號"] ?? item?.Code ?? item?.SecuritiesCompanyCode ?? item?.Symbol;
      return String(code || "").trim().toUpperCase() === symbol;
    });
    if (!row) throw new Error(`OpenAPI 查無 ${symbol}`);
    const pick = (...names) => {
      for (const name of names) if (row[name] !== undefined && row[name] !== null) return row[name];
      return null;
    };
    const close = firstPositiveNumber([
      pick("收盤價", "最後成交價", "投資人最近一筆成交價", "投資人成交當日均價", "成交均價", "最近成交價"),
      pick("造市商前日最後一筆報價", "前日價格", "投資人成交前日均價")
    ]);
    if (!close) throw new Error(`${symbol} 沒有有效收盤價`);
    const previousClose = firstPositiveNumber([
      pick("前日價格", "造市商前日最後一筆報價", "投資人成交前日均價", "買進報價前日價格", "賣出報價前日價格")
    ]);
    return {
      symbol,
      name: pick("黃金現貨簡稱", "黃金簡稱", "名稱", "Name") || "臺銀金",
      market: "TPEx Gold",
      assetType: "gold",
      price: close,
      previousClose: previousClose || close,
      high: firstPositiveNumber([pick("最高價", "投資人成交當日最高")]),
      low: firstPositiveNumber([pick("最低價", "投資人成交當日最低")]),
      volume: firstPositiveNumber([pick("成交量", "投資人成交量")]),
      date: pick("資料日期", "日期", "Date") || null,
      time: pick("資料時間", "時間", "Time") || null,
      quoteType: "last-close"
    };
  } catch (openApiError) {
    // 相容舊資料來源，避免櫃買中心其中一個服務暫時異常時完全無法報價。
    const response = await fetch("https://www.tpex.org.tw/web/gold/lateststats/new_dl.php", {
      headers,
      cf: { cacheTtl: 1800, cacheEverything: true }
    });
    if (!response.ok) throw new Error(`TPEx gold upstream HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    let text = new TextDecoder("utf-8").decode(bytes);
    if (!text.includes("黃金現貨代號")) { try { text = new TextDecoder("big5").decode(bytes); } catch {} }
    text = text.replace(/^\uFEFF/, "");
    const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    const hi = lines.findIndex(x => x.includes("黃金現貨代號"));
    if (hi < 0) throw new Error("櫃買中心黃金收盤資料暫時無法取得");
    const csvHeaders = parseCsvLine(lines[hi]);
    const ci = csvHeaders.findIndex(h => h.includes("黃金現貨代號"));
    const row = lines.slice(hi + 1).map(parseCsvLine).find(r => String(r[ci] || "").toUpperCase() === symbol);
    if (!row) throw new Error(`查無 ${symbol} 黃金現貨報價`);
    const value = name => { const i = csvHeaders.findIndex(h => h.includes(name)); return i >= 0 ? row[i] : null; };
    const close = firstPositiveNumber([
      value("投資人最近一筆成交價"),
      value("投資人成交當日均價"),
      value("買進報價前日價格"),
      value("賣出報價前日價格")
    ]);
    if (!close) throw new Error(`${symbol} 目前沒有有效收盤價`);
    const previousClose = firstPositiveNumber([value("投資人成交前日均價"), value("買進報價前日價格"), value("賣出報價前日價格")]);
    return {
      symbol,
      name: value("黃金現貨簡稱") || "臺銀金",
      market: "TPEx Gold",
      assetType: "gold",
      price: close,
      previousClose: previousClose || close,
      high: firstPositiveNumber([value("投資人成交當日最高")]),
      low: firstPositiveNumber([value("投資人成交當日最低")]),
      volume: firstPositiveNumber([value("投資人成交量")]),
      date: value("資料日期"),
      time: value("資料時間"),
      quoteType: "last-close"
    };
  }
}

async function getTaiwanQuote(symbol) {
  const normalized = symbol.toUpperCase().replace(/\.(TW|TWO)$/i, "");
  if (normalized === "AU9901") return getGoldQuote(normalized);
  const channels = [`tse_${normalized}.tw`, `otc_${normalized}.tw`];

  for (const channel of channels) {
    const quote = await queryTwseChannel(channel);
    if (quote) return quote;
  }
  return null;
}


function yahooSymbol(symbol, market, otc = false) {
  const clean = String(symbol || "").trim().toUpperCase().replace(/\.(TW|TWO)$/i, "");
  if (market === "TW") return `${clean}.${otc ? "TWO" : "TW"}`;
  return clean;
}

async function fetchYahooSeries(ticker) {
  const endpoint = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`);
  endpoint.searchParams.set("range", "2y");
  endpoint.searchParams.set("interval", "1wk");
  endpoint.searchParams.set("events", "history");
  endpoint.searchParams.set("includeAdjustedClose", "true");

  const response = await fetch(endpoint.toString(), {
    headers: {
      "Accept": "application/json",
      "User-Agent": "Mozilla/5.0 StockDashboardWorker/3.4"
    },
    cf: { cacheTtl: 43200, cacheEverything: true }
  });
  if (!response.ok) throw new Error(`Historical data HTTP ${response.status}`);

  const data = await response.json();
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error("查無歷史價格");

  const timestamps = result.timestamp || [];
  const adjusted = result.indicators?.adjclose?.[0]?.adjclose || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  const prices = timestamps.map((t, i) => {
    const price = Number(adjusted[i] ?? closes[i]);
    return Number.isFinite(price) && price > 0 ? [Number(t), price] : null;
  }).filter(Boolean);

  if (prices.length < 32) throw new Error("歷史資料不足");
  return prices;
}

function isoWeekKey(timestamp) {
  const d = new Date(timestamp * 1000);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function weeklyReturns(series) {
  const output = new Map();
  for (let i = 1; i < series.length; i++) {
    const previous = series[i - 1][1];
    const current = series[i][1];
    if (!(previous > 0 && current > 0)) continue;
    output.set(isoWeekKey(series[i][0]), current / previous - 1);
  }
  return output;
}

function calculateBeta(assetSeries, marketSeries) {
  const asset = weeklyReturns(assetSeries);
  const market = weeklyReturns(marketSeries);
  const pairs = [];

  for (const [date, assetReturn] of asset) {
    if (market.has(date)) pairs.push([assetReturn, market.get(date)]);
  }

  if (pairs.length < 30) throw new Error("可對齊的歷史資料不足");

  const meanAsset = pairs.reduce((s, x) => s + x[0], 0) / pairs.length;
  const meanMarket = pairs.reduce((s, x) => s + x[1], 0) / pairs.length;
  let covariance = 0;
  let variance = 0;

  for (const [assetReturn, marketReturn] of pairs) {
    covariance += (assetReturn - meanAsset) * (marketReturn - meanMarket);
    variance += (marketReturn - meanMarket) ** 2;
  }

  if (!(variance > 0)) throw new Error("市場報酬變異數無效");
  return { beta: covariance / variance, observations: pairs.length };
}

const BETA_MODEL_FALLBACKS = {
  "0050": { beta: 1.0, label: "原型台灣50模型" },
  "006208": { beta: 1.0, label: "原型台灣50模型" },
  "00631L": { beta: 2.0, label: "台灣50正2槓桿模型" },
  "00663L": { beta: 2.0, label: "NASDAQ正2槓桿模型" },
  "00675L": { beta: 2.0, label: "台灣加權正2槓桿模型" },
  "00662": { beta: 1.0, label: "NASDAQ 100原型模型" },
  "00865B": { beta: 0.15, label: "短天期公債防禦模型" },
  "AU9901": { beta: 0.10, label: "黃金低股市相關模型" },
  "VT": { beta: 1.0, label: "全球股票原型模型" },
  "VOO": { beta: 1.0, label: "S&P 500原型模型" },
  "SPY": { beta: 1.0, label: "S&P 500原型模型" },
  "QQQ": { beta: 1.0, label: "NASDAQ 100原型模型" },
  "QQQM": { beta: 1.0, label: "NASDAQ 100原型模型" }
};

function getBetaFallback(symbol, market) {
  const clean = String(symbol || "").toUpperCase().replace(/\.(TW|TWO)$/i, "");
  const item = BETA_MODEL_FALLBACKS[clean];
  if (!item) return null;
  return {
    symbol: clean,
    market: market === "TW" ? "TW" : "US",
    benchmark: market === "TW" ? "台灣加權指數" : "S&P 500",
    benchmarkTicker: market === "TW" ? "^TWII" : "^GSPC",
    period: "模型",
    interval: "模型",
    beta: item.beta,
    observations: 0,
    source: "model",
    sourceLabel: item.label
  };
}

async function getAutomaticBeta(symbol, market) {
  const normalizedMarket = market === "TW" ? "TW" : "US";
  const benchmarkTicker = normalizedMarket === "TW" ? "^TWII" : "^GSPC";
  const benchmarkName = normalizedMarket === "TW" ? "台灣加權指數" : "S&P 500";

  let assetTicker = yahooSymbol(symbol, normalizedMarket, false);
  let assetSeries;

  try {
    assetSeries = await fetchYahooSeries(assetTicker);
  } catch (error) {
    if (normalizedMarket === "TW") {
      try {
        assetTicker = yahooSymbol(symbol, normalizedMarket, true);
        assetSeries = await fetchYahooSeries(assetTicker);
      } catch (secondError) {
        const fallback = getBetaFallback(symbol, normalizedMarket);
        if (fallback) return fallback;
        throw secondError;
      }
    } else {
      const fallback = getBetaFallback(symbol, normalizedMarket);
      if (fallback) return fallback;
      throw error;
    }
  }

  try {
    const marketSeries = await fetchYahooSeries(benchmarkTicker);
    const result = calculateBeta(assetSeries, marketSeries);
    return {
      symbol: String(symbol).toUpperCase(),
      market: normalizedMarket,
      ticker: assetTicker,
      benchmark: benchmarkName,
      benchmarkTicker,
      period: "2y",
      interval: "1wk",
      beta: Number(result.beta.toFixed(4)),
      observations: result.observations,
      source: "historical",
      sourceLabel: "近兩年每週報酬"
    };
  } catch (error) {
    const fallback = getBetaFallback(symbol, normalizedMarket);
    if (fallback) return fallback;
    throw error;
  }
}

async function getFx() {
  const response = await fetch("https://open.er-api.com/v6/latest/USD", {
    cf: { cacheTtl: 900, cacheEverything: true }
  });
  if (!response.ok) throw new Error(`FX upstream HTTP ${response.status}`);
  const data = await response.json();
  const rate = Number(data?.rates?.TWD);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("Invalid USD/TWD rate");
  return { base: "USD", quote: "TWD", rate, updatedAt: data.time_last_update_utc || null };
}


const STATIC_FILES = {"index.html":"<!doctype html>\n<html lang=\"zh-Hant\">\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\">\n  <meta name=\"theme-color\" content=\"#081222\">\n  <meta name=\"apple-mobile-web-app-capable\" content=\"yes\">\n  <meta name=\"mobile-web-app-capable\" content=\"yes\">\n  <meta name=\"apple-mobile-web-app-status-bar-style\" content=\"black-translucent\">\n  <meta name=\"apple-mobile-web-app-title\" content=\"資產儀表板\">\n  <link rel=\"manifest\" href=\"manifest.webmanifest\">\n  <link rel=\"icon\" href=\"icon.svg\">\n  <link rel=\"stylesheet\" href=\"style.css?v=8.7.0\">\n  <title>AlphaPilot V8.7 Stable</title>\n</head>\n<body>\n  <main class=\"app\">\n    <header class=\"hero\">\n      <div>\n        <div class=\"brand-lockup\">\n          <img src=\"icon.svg\" class=\"brand-icon\" alt=\"AlphaPilot\">\n          <div><p class=\"eyebrow\">ERIC'S PORTFOLIO</p><h1>AlphaPilot <em>V8.7</em></h1></div>\n        </div>\n      </div>\n      <div class=\"hero-actions\">\n        <button id=\"themeToggle\" class=\"icon-action\" aria-label=\"切換外觀\">☾</button><button id=\"refreshAll\" class=\"primary compact\">更新全部</button>\n        <button id=\"menuButton\" class=\"menu-button\" aria-label=\"開啟選單\" aria-expanded=\"false\">\n          <span></span><span></span><span></span>\n        </button>\n      </div>\n    </header>\n    <section id=\"dashboard\" class=\"tab-panel active dashboard-panel\">\n\n\n    <section class=\"summary-grid\">\n      <article class=\"summary-card total\"><span>總資產（新台幣）</span><strong id=\"totalTwd\">NT$0</strong><small id=\"lastUpdated\">尚未更新</small></article>\n      <article class=\"summary-card\"><span>今日損益</span><strong id=\"dailyPnl\">NT$0</strong><small id=\"dailyPnlPct\">0.00%</small></article>\n      <article class=\"summary-card\"><span>台股市值</span><strong id=\"twTotal\">NT$0</strong><small id=\"twCount\">0 檔</small></article>\n      <article class=\"summary-card\"><span>美股市值</span><strong id=\"usTotal\">US$0</strong><small id=\"fxText\">USD/TWD --</small></article>\n      <article class=\"summary-card\"><span>現金</span><strong id=\"cashTotal\">NT$0</strong><small>台幣＋美元換算</small></article>\n      <article class=\"summary-card beta-card beta-goal-card\"><span>投資組合 Beta</span><strong id=\"portfolioBeta\">--</strong><small id=\"betaGoalSummary\">目標 1.20</small><button id=\"openBetaAdvisor\" class=\"mini-link\" type=\"button\">查看調整建議</button></article>\n      <article class=\"summary-card score-card\"><span>Investment Score</span><strong id=\"investmentScore\">--</strong><small id=\"scoreSummary\">等待持股資料</small></article>\n    </section>\n    </section>\n\n    <div id=\"menuOverlay\" class=\"menu-overlay\"></div>\n    <aside id=\"sideMenu\" class=\"side-menu\" aria-hidden=\"true\">\n      <div class=\"side-menu-head\">\n        <div>\n          <small>目前頁面</small>\n          <strong id=\"currentPageTitle\">首頁</strong>\n        </div>\n        <button id=\"closeMenu\" class=\"menu-close\" aria-label=\"關閉選單\">×</button>\n      </div>\n\n      <nav class=\"side-menu-nav\">\n        <button data-tab=\"dashboard\" class=\"active\">\n          <span class=\"menu-icon\">🏠</span><span>首頁</span>\n        </button>\n        <button data-tab=\"portfolio\">\n          <span class=\"menu-icon\">📈</span><span>持股</span>\n        </button>\n        <button data-tab=\"allocation\">\n          <span class=\"menu-icon\">🥧</span><span>資產配置</span>\n        </button>\n        <button data-tab=\"rebalance\">\n          <span class=\"menu-icon\">🧠</span><span>聰明再平衡</span>\n        </button>\n        <button data-tab=\"risk\">\n          <span class=\"menu-icon\">🛡️</span><span>風險模擬</span>\n        </button>\n        <button data-tab=\"history\">\n          <span class=\"menu-icon\">🕘</span><span>資產歷史</span>\n        </button>\n        <button data-tab=\"settings\">\n          <span class=\"menu-icon\">⚙️</span><span>設定</span>\n        </button>\n      </nav>\n\n      <div class=\"side-menu-foot\">選擇功能後會自動切換頁面</div>\n    </aside>\n\n    <div class=\"page-indicator\">\n      <span id=\"currentPageIcon\">🏠</span>\n      <strong id=\"currentPageLabel\">首頁</strong>\n    </div>\n\n    <section id=\"portfolio\" class=\"tab-panel\">\n      <article class=\"card\">\n        <div class=\"section-head\"><h2>新增持股</h2><span>台股與美股</span></div>\n        <div class=\"form-grid two\">\n          <label>股票代號\n            <input id=\"symbol\" placeholder=\"例如 0050、QQQM、AU9901\" autocapitalize=\"characters\" autocomplete=\"off\">\n            <small id=\"symbolStatus\" class=\"field-status\">系統會自動判斷台股、美股；AU9901 使用最近收盤價</small>\n          </label>\n          <label>持有股數<input id=\"shares\" type=\"number\" min=\"0\" step=\"any\" placeholder=\"1000\"></label>\n        </div>\n        <div class=\"form-grid two\">\n          <label>手動價格（選填）<input id=\"manualPrice\" type=\"number\" min=\"0\" step=\"any\" placeholder=\"報價失敗時使用\"></label>\n        </div>\n        <div class=\"auto-beta-hint compact-hint\">📐 Beta 由系統自動判斷：優先使用近兩年每週報酬，資料不足時改用標的模型。</div>\n        <button id=\"addHolding\" class=\"primary full\">加入持股</button>\n      </article>\n\n      <article class=\"card\">\n        <div class=\"section-head\"><h2>我的持股</h2><button id=\"clearHoldings\" class=\"text-button danger-text\">全部清除</button></div>\n        <div id=\"holdingsList\" class=\"holding-list\"></div>\n      </article>\n\n      <article class=\"card\">\n        <div class=\"section-head\"><h2>現金部位</h2><span>納入總資產</span></div>\n        <div class=\"form-grid two\">\n          <label>台幣現金<input id=\"cashTwd\" type=\"number\" min=\"0\" step=\"any\"></label>\n          <label>美元現金<input id=\"cashUsd\" type=\"number\" min=\"0\" step=\"any\"></label>\n        </div>\n        <button id=\"saveCash\" class=\"primary full\">儲存現金</button>\n      </article>\n    </section>\n\n    <section id=\"allocation\" class=\"tab-panel\">\n      <article class=\"card cute-card\">\n        <div class=\"section-head\"><h2>市場配置</h2><span>台股／美股／現金</span></div>\n        <canvas id=\"marketChart\" width=\"500\" height=\"500\"></canvas>\n        <div id=\"marketLegend\" class=\"legend\"></div>\n      </article>\n\n      <article class=\"card\">\n        <div class=\"section-head\"><h2>持股配置</h2><span>依個別股票市值</span></div>\n        <canvas id=\"allocationChart\" width=\"500\" height=\"500\"></canvas>\n        <div id=\"allocationLegend\" class=\"legend\"></div>\n      </article>\n\n      <article class=\"card beta-center\">\n        <div class=\"section-head\"><div><p class=\"eyebrow\">BETA ADVISOR</p><h2>目標 Beta</h2></div><span>自動判斷</span></div>\n        <div class=\"beta-simple-grid\">\n          <div><span>目前</span><strong id=\"betaDetail\">--</strong></div>\n          <div><span>目標</span><strong id=\"betaTargetDisplay\">1.20</strong></div>\n        </div>\n        <p id=\"betaDescription\" class=\"beta-simple-message\">新增或更新持股後，系統會自動計算。</p>\n        <div id=\"betaAdvisorResult\" class=\"advisor-box\">尚無調整建議</div>\n      </article>\n    </section>\n\n    \n<section id=\"rebalance\" class=\"tab-panel\">\n  <div class=\"section-head\"><div><p class=\"eyebrow\">SMART REBALANCE</p><h2>聰明再平衡</h2></div></div>\n  <article class=\"panel glass-panel\">\n    <p class=\"helper-copy\">會依目前持股市值進行完整再平衡。新增資金可填 0；系統仍會計算哪些標的應賣出、哪些應買入。目標為 0% 的標的會列為全部賣出。所有比例合計需為 100%。</p>\n    <label>新增資金（TWD）\n      <input id=\"newCapital\" type=\"number\" inputmode=\"decimal\" placeholder=\"可填 0，例如 3000000\">\n    </label>\n    <div id=\"targetWeightList\" class=\"target-weight-list\"></div>\n    <div class=\"weight-total-row\"><span>目標比例合計</span><strong id=\"targetWeightTotal\">0%</strong></div>\n    <button id=\"calcRebalance\" class=\"primary full\">計算完整再平衡</button>\n    <div id=\"rebalanceResult\" class=\"result-stack\"></div>\n  </article>\n</section>\n\n\n<section id=\"risk\" class=\"tab-panel\">\n  <article class=\"card scenario-card\">\n        <div class=\"section-head\"><div><p class=\"eyebrow\">SCENARIO</p><h2>市場情境模擬</h2></div><span>線性概算</span></div>\n        <label>假設大盤漲跌\n          <input id=\"marketScenario\" type=\"range\" min=\"-40\" max=\"40\" value=\"-20\" step=\"1\">\n        </label>\n        <div class=\"scenario-grid\">\n          <div><span>市場情境</span><strong id=\"marketScenarioText\">-20%</strong></div>\n          <div><span>組合預估波動</span><strong id=\"portfolioScenario\">--</strong></div>\n          <div><span>預估資產變化</span><strong id=\"scenarioMoney\">--</strong></div>\n        </div>\n        <small class=\"scenario-warning\">此為 Beta 線性概算；槓桿 ETF 的每日重置、匯率、債券及跨市場差異，可能使實際結果不同。</small>\n      </article>\n  <article class=\"card\">\n        <div class=\"section-head\"><h2>質押試算</h2><span>依實際借款填寫</span></div>\n        <p class=\"helper-copy\">系統不推估銀行可質押額度。請針對每檔持股填入實際質押借款與年利率；未質押請填 0。</p>\n        <div class=\"pledge-table-head\"><span>股票</span><span>質押金額</span><span>年利率</span><span>目前維持率</span></div>\n        <div id=\"pledgeHoldingList\" class=\"pledge-holding-list\"></div>\n        <div class=\"pledge-summary-row\"><span>質押借款合計</span><strong id=\"pledgeDebtTotal\">NT$0</strong></div>\n        <div class=\"pledge-summary-row\"><span>估計年利息</span><strong id=\"pledgeInterestTotal\">NT$0</strong></div>\n        <button id=\"savePledge\" class=\"primary full\">儲存質押資料</button>\n      </article>\n  <article class=\"panel glass-panel stress-card\">\n    <div class=\"section-head\"><div><p class=\"eyebrow\">RISK LAB</p><h2>質押壓力測試</h2></div></div>\n    <div class=\"form-grid two\">\n      <label>股市下跌幅度<input id=\"stressDrop\" type=\"range\" min=\"0\" max=\"60\" value=\"20\" step=\"1\"></label>\n      <div class=\"stress-number\"><strong id=\"stressDropText\">-20%</strong><small>模擬整體質押資產同步下跌</small></div>\n    </div>\n    <div class=\"stress-grid\">\n      <div><span>壓力後維持率</span><strong id=\"stressMaintenance\">--</strong></div>\n      <div><span>安全緩衝</span><strong id=\"stressBuffer\">--</strong></div>\n    </div>\n  </article>\n</section>\n<section id=\"history\" class=\"tab-panel\">\n      <article class=\"card\">\n        <div class=\"section-head\"><h2>資產歷史</h2><button id=\"saveSnapshot\" class=\"secondary compact\">記錄今天</button></div>\n        <canvas id=\"historyChart\" width=\"720\" height=\"360\"></canvas>\n        <div id=\"historyList\" class=\"history-list\"></div>\n      </article>\n    </section>\n\n    <section id=\"settings\" class=\"tab-panel\">\n      <article class=\"card\">\n        <div class=\"section-head\"><h2>設定</h2><span>AlphaPilot V8</span></div>\n        <div class=\"architecture-status\">\n          <div class=\"status-orb\">☁️</div>\n          <div>\n            <strong>Cloudflare 前後端已整合</strong>\n            <p>台股、匯率與 Beta 會由目前網站自動處理，不需再填 Worker 網址。</p>\n          </div>\n        </div>\n        <label>Finnhub API Key（美股）<input id=\"finnhubKey\" type=\"password\" placeholder=\"免費 API Key\"></label>\n        <label>USD/TWD 備用匯率<input id=\"fxRate\" type=\"number\" min=\"0\" step=\"0.0001\"></label>\n        <label>目標 Portfolio Beta<input id=\"targetBeta\" type=\"number\" min=\"0.1\" max=\"3\" step=\"0.05\" inputmode=\"decimal\" value=\"1.20\"></label>\n        <button id=\"saveSettings\" class=\"primary full\">儲存設定</button>\n        <button id=\"testWorker\" class=\"secondary full\">測試系統連線</button>\n        <div id=\"settingsStatus\" class=\"status\"></div>\n      </article>\n\n      <article class=\"card backup-card\">\n        <div class=\"section-head\"><div><p class=\"eyebrow\">LOCAL BACKUP</p><h2>手機檔案備份</h2></div><span>JSON</span></div>\n        <p class=\"helper-copy\">可將持股、現金、質押、設定及歷史紀錄存到手機「檔案」App；需要時選取記錄檔匯入。</p>\n        <div class=\"backup-actions\">\n          <button id=\"exportBackup\" class=\"primary\">匯出完整備份</button>\n          <button id=\"chooseBackup\" class=\"secondary\">匯入記錄檔</button>\n        </div>\n        <input id=\"importBackupFile\" type=\"file\" accept=\".json,application/json\" hidden aria-hidden=\"true\" tabindex=\"-1\">\n        <div id=\"backupStatus\" class=\"status\"></div>\n      </article>\n    </section>\n\n    <div id=\"toast\" class=\"toast\"></div>\n  </main>\n  <script src=\"app.js?v=8.7.0\"></script>\n</body>\n</html>\n","app.js":"\nconst $=id=>document.getElementById(id);\nconst KEY=\"stockDashboardV3\";\nconst THEME_KEY=\"alphaPilotTheme\";\nconst DEFAULT={holdings:[],cashTwd:0,cashUsd:0,fxRate:32.5,finnhubKey:\"\",history:[],targetWeights:{},targetBeta:1.20};\nlet state=(()=>{try{return {...DEFAULT,...JSON.parse(localStorage.getItem(KEY)||\"{}\")}}catch{return {...DEFAULT}}})();\nstate.holdings=(state.holdings||[]).map(h=>({...h,betaManual:false,pledgeAmount:Number(h.pledgeAmount)||0,pledgeRate:Number(h.pledgeRate)||0}));\nconst n=v=>Number.isFinite(Number(v))?Number(v):0;\nstate.targetBeta=Math.max(0.1,Math.min(3,n(state.targetBeta||1.20)));\nconst money=(v,c=\"TWD\")=>new Intl.NumberFormat(\"zh-TW\",{style:\"currency\",currency:c,maximumFractionDigits:c===\"TWD\"?0:2}).format(n(v));\nconst fmt=(v,d=2)=>n(v).toLocaleString(\"zh-TW\",{maximumFractionDigits:d});\nconst save=()=>localStorage.setItem(KEY,JSON.stringify(state));\nconst toast=m=>{const e=$(\"toast\");e.textContent=m;e.classList.add(\"show\");clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove(\"show\"),2200)};\nconst now=()=>new Date().toLocaleString(\"zh-TW\",{hour12:false});\nconst valueTwd=h=>n(h.price)*n(h.shares)*(h.market===\"US\"?n(state.fxRate):1);\nconst prevTwd=h=>n(h.previousClose)*n(h.shares)*(h.market===\"US\"?n(state.fxRate):1);\n\nfunction totals(){\n  let tw=0,us=0,daily=0,base=0;\n  state.holdings.forEach(h=>{\n    const local=n(h.price)*n(h.shares);\n    h.market===\"TW\"?tw+=local:us+=local;\n    if(n(h.previousClose)>0){daily+=valueTwd(h)-prevTwd(h);base+=prevTwd(h)}\n  });\n  const cash=n(state.cashTwd)+n(state.cashUsd)*n(state.fxRate);\n  const total=tw+us*n(state.fxRate)+cash;\n  let betaWeighted=0,betaValue=0;\n  state.holdings.forEach(h=>{\n    if(h.beta!==undefined&&h.beta!==null&&h.beta!==\"\"&&n(h.beta)>=0){\n      const v=valueTwd(h);\n      betaWeighted+=v*n(h.beta);\n      betaValue+=v;\n    }\n  });\n  const portfolioBeta=total>0?betaWeighted/total:null;\n  const betaCoverage=total>0?betaValue/total*100:0;\n  return {tw,us,daily,base,cash,total,portfolioBeta,betaCoverage};\n}\n\n\nfunction validBeta(h){return h.beta!==undefined&&h.beta!==null&&h.beta!==\"\"&&Number.isFinite(Number(h.beta))}\nfunction targetBeta(){return Math.max(0.1,Math.min(3,n(state.targetBeta||1.20)))}\nfunction betaAdvisor(){\n  const t=totals(), target=targetBeta();\n  if(t.portfolioBeta===null||t.betaCoverage<=0||t.total<=0)return {text:\"按「更新全部」後即可產生建議。\",ready:false};\n  const diff=target-t.portfolioBeta;\n  if(Math.abs(diff)<=0.03)return {text:`目前 Beta ${fmt(t.portfolioBeta,2)}，已接近目標 ${fmt(target,2)}，維持配置即可。`,ready:true};\n  const assets=state.holdings.filter(validBeta).map(h=>({symbol:h.symbol,beta:n(h.beta),value:valueTwd(h)})).filter(x=>x.value>0).sort((a,b)=>a.beta-b.beta);\n  if(!assets.length)return {text:\"目前沒有可用的 Beta 資料。\",ready:false};\n  const low=assets[0], high=assets[assets.length-1];\n  if(diff>0){\n    const source=t.cash>0?{symbol:\"現金\",beta:0,value:t.cash}:low;\n    const gap=high.beta-source.beta;\n    if(gap<=0.001)return {text:`目前持股的 Beta 無法把組合提高到 ${fmt(target,2)}。`,ready:true};\n    const amount=Math.abs(diff)*t.total/gap;\n    const capped=Math.min(amount,source.value||amount);\n    return {text:`要接近目標 ${fmt(target,2)}：將約 ${money(capped)} 從「${source.symbol}」調整到「${high.symbol}」。`,ready:true};\n  }\n  const gap=high.beta-low.beta;\n  if(gap<=0.001)return {text:`目前持股的 Beta 無法把組合降低到 ${fmt(target,2)}。`,ready:true};\n  const amount=Math.abs(diff)*t.total/gap;\n  const capped=Math.min(amount,high.value);\n  return {text:`要接近目標 ${fmt(target,2)}：將約 ${money(capped)} 從「${high.symbol}」調整到「${low.symbol}」。`,ready:true};\n}\nfunction allocationScore(){\n  const t=totals(); if(t.total<=0)return {score:null,label:\"等待持股資料\"};\n  const values=state.holdings.map(h=>({symbol:h.symbol,value:valueTwd(h)}));\n  const investTotal=values.reduce((s,x)=>s+x.value,0);\n  const weights=state.targetWeights||{};\n  const sumTargets=Object.values(weights).reduce((s,x)=>s+n(x),0);\n  let alloc=20;\n  if(investTotal>0&&Math.abs(sumTargets-100)<0.05){\n    const distance=values.reduce((s,x)=>s+Math.abs(x.value/investTotal*100-n(weights[x.symbol])),0);\n    alloc=Math.max(0,40-distance*0.8);\n  }\n  const beta=t.portfolioBeta===null?0:Math.max(0,30-Math.abs(t.portfolioBeta-targetBeta())*75);\n  const maxWeight=values.length&&t.total>0?Math.max(...values.map(x=>x.value/t.total)):0;\n  const concentration=Math.max(0,20-Math.max(0,maxWeight-0.35)*60);\n  const cashRatio=t.cash/t.total;\n  const cash=Math.max(0,10-Math.abs(cashRatio-0.15)*35);\n  const score=Math.round(Math.max(0,Math.min(100,alloc+beta+concentration+cash)));\n  return {score,label:score>=90?\"配置健康\":score>=75?\"大致穩定\":\"建議重新平衡\"};\n}\nfunction renderBetaCenter(){\n  const t=totals(), target=targetBeta(), adv=betaAdvisor();\n  if($(\"betaTargetDisplay\"))$(\"betaTargetDisplay\").textContent=fmt(target,2);\n  if($(\"betaAdvisorResult\"))$(\"betaAdvisorResult\").textContent=adv.text;\n  if($(\"betaDescription\"))$(\"betaDescription\").textContent=t.portfolioBeta===null?\"尚未完成 Beta 計算。\":`目前與目標相差 ${t.portfolioBeta-target>=0?\"+\":\"\"}${fmt(t.portfolioBeta-target,2)}。`;\n  renderBetaScenario();\n}\nfunction renderBetaScenario(){\n  const t=totals(), market=n($(\"marketScenario\")?.value), ready=t.portfolioBeta!==null&&t.betaCoverage>0;\n  const change=ready?market*t.portfolioBeta:null;\n  if($(\"marketScenarioText\"))$(\"marketScenarioText\").textContent=`${market>0?\"+\":\"\"}${fmt(market,0)}%`;\n  if($(\"portfolioScenario\")){$(\"portfolioScenario\").textContent=change===null?\"--\":`${change>0?\"+\":\"\"}${fmt(change,2)}%`;$(\"portfolioScenario\").className=change===null?\"\":change>=0?\"positive\":\"negative\"}\n  if($(\"scenarioMoney\")){$(\"scenarioMoney\").textContent=change===null?\"--\":money(t.total*change/100);$(\"scenarioMoney\").className=change===null?\"\":change>=0?\"positive\":\"negative\"}\n}\n\nfunction render(){\n  const t=totals();\n  $(\"totalTwd\").textContent=money(t.total);$(\"twTotal\").textContent=money(t.tw);$(\"usTotal\").textContent=money(t.us,\"USD\");\n  $(\"cashTotal\").textContent=money(t.cash);\n  const betaReady=t.portfolioBeta!==null&&t.betaCoverage>0;\n  $(\"portfolioBeta\").textContent=betaReady?fmt(t.portfolioBeta,2):\"--\";\n  if($(\"betaGoalSummary\"))$(\"betaGoalSummary\").textContent=betaReady?`目標 ${fmt(targetBeta(),2)}｜差距 ${t.portfolioBeta-targetBeta()>=0?\"+\":\"\"}${fmt(t.portfolioBeta-targetBeta(),2)}`:`目標 ${fmt(targetBeta(),2)}`;\n  $(\"betaDetail\").textContent=betaReady?fmt(t.portfolioBeta,2):\"--\";\n  const score=allocationScore();\n  if($(\"investmentScore\"))$(\"investmentScore\").textContent=score.score===null?\"--\":`${score.score}/100`;\n  if($(\"scoreSummary\"))$(\"scoreSummary\").textContent=score.label;\n  renderBetaCenter();\n  renderPledgeRows();\n  $(\"dailyPnl\").textContent=money(t.daily);$(\"dailyPnlPct\").textContent=t.base?`${t.daily>=0?\"+\":\"\"}${fmt(t.daily/t.base*100,2)}%`:\"0.00%\";\n  $(\"twCount\").textContent=`${state.holdings.filter(h=>h.market===\"TW\").length} 檔`;$(\"fxText\").textContent=`USD/TWD ${fmt(state.fxRate,4)}`;\n  $(\"lastUpdated\").textContent=state.holdings.map(h=>h.updatedAt).filter(Boolean).sort().at(-1)||\"尚未更新\";\n  renderHoldings();renderMarketPie();renderPie();renderHistory();renderTargetWeightList();\n  $(\"cashTwd\").value=state.cashTwd;$(\"cashUsd\").value=state.cashUsd;\n  $(\"finnhubKey\").value=state.finnhubKey;$(\"fxRate\").value=state.fxRate;if($(\"targetBeta\"))$(\"targetBeta\").value=targetBeta();\n}\n\nfunction renderPledgeRows(){\n  const list=$(\"pledgeHoldingList\");\n  if(!list)return;\n  if(!state.holdings.length){\n    list.innerHTML='<div class=\"empty-holdings\">尚未加入持股</div>';\n    $(\"pledgeDebtTotal\").textContent=money(0);\n    $(\"pledgeInterestTotal\").textContent=money(0);\n    return;\n  }\n  let debtTotal=0,interestTotal=0;\n  list.innerHTML=state.holdings.map((h,i)=>{\n    const amount=n(h.pledgeAmount),rate=n(h.pledgeRate);\n    debtTotal+=amount;interestTotal+=amount*rate/100;\n    const ratio=amount>0?valueTwd(h)/amount*100:null;\n    return `<div class=\"pledge-holding-row\" data-pledge-index=\"${i}\">\n      <div class=\"pledge-symbol\"><strong>${h.symbol}</strong><small>市值 ${money(valueTwd(h))}</small></div>\n      <label><span>質押金額</span><input data-field=\"amount\" type=\"number\" min=\"0\" step=\"any\" value=\"${amount||0}\" inputmode=\"decimal\"></label>\n      <label><span>年利率 %</span><input data-field=\"rate\" type=\"number\" min=\"0\" step=\"0.01\" value=\"${amount>0?rate:\"\"}\" inputmode=\"decimal\" ${amount>0?\"\":\"placeholder=未質押\"}></label>\n      <div class=\"pledge-ratio\"><span>目前維持率</span><strong class=\"${ratio!==null&&ratio<166?\"negative\":ratio!==null&&ratio>=200?\"positive\":\"\"}\">${ratio===null?\"--\":`${fmt(ratio,1)}%`}</strong></div>\n    </div>`;\n  }).join(\"\");\n  $(\"pledgeDebtTotal\").textContent=money(debtTotal);\n  $(\"pledgeInterestTotal\").textContent=money(interestTotal);\n}\n\nfunction renderHoldings(){\n  const list=$(\"holdingsList\");\n  if(!state.holdings.length){\n    list.innerHTML='<div class=\"empty-holdings\">尚未加入持股</div>';\n    return;\n  }\n  list.innerHTML=state.holdings.map((h,i)=>{\n    const c=h.market===\"TW\"?\"TWD\":\"USD\";\n    const change=n(h.previousClose)>0?(n(h.price)-n(h.previousClose))/n(h.previousClose)*100:null;\n    return `<details class=\"holding-compact\">\n      <summary>\n        <div class=\"holding-summary-main\">\n          <span class=\"holding-symbol\">${h.symbol}</span>\n          <span class=\"pill\">${h.market===\"TW\"?\"台股\":\"美股\"}</span>\n        </div>\n        <div class=\"holding-summary-value\">${money(n(h.price)*n(h.shares),c)}</div>\n        <span class=\"holding-chevron\" aria-hidden=\"true\">⌄</span>\n      </summary>\n      <div class=\"holding-detail\">\n        <div class=\"holding-meta\">\n          ${h.name||h.symbol}<br>\n          股數 ${fmt(h.shares,4)}｜價格 ${money(h.price,c)}\n          ${change===null?\"\":`｜<span class=\"${change>=0?\"positive\":\"negative\"}\">${change>=0?\"+\":\"\"}${fmt(change,2)}%</span>`}\n          ${n(h.pledgeAmount)>0?`｜質押借款 ${money(h.pledgeAmount)}｜維持率 ${fmt(valueTwd(h)/n(h.pledgeAmount)*100,1)}%`:\"\"}\n          ${h.beta!==undefined&&h.beta!==null&&h.beta!==\"\"?`<br>Beta ${fmt(h.beta,2)}・自動`:\"<br>Beta 尚未計算\"}\n          <br>${h.updatedAt?`更新 ${h.updatedAt}`:\"尚未取得報價\"}\n          ${h.error?`<br><span class=\"holding-error\">${h.error}</span>`:\"\"}\n        </div>\n        <div class=\"holding-actions\">\n          <button onclick=\"refreshHolding(${i})\">更新</button>\n          <button onclick=\"editHolding(${i})\">修改</button>\n          <button class=\"remove\" onclick=\"removeHolding(${i})\">刪除</button>\n        </div>\n      </div>\n    </details>`;\n  }).join(\"\");\n}\n\nasync function fetchTw(symbol){\n  const r=await fetch(`/api/tw?symbol=${encodeURIComponent(symbol)}`,{cache:\"no-store\"});\n  const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||`HTTP ${r.status}`);\n  return {price:n(d.price),previousClose:n(d.previousClose),name:d.name||symbol};\n}\nasync function fetchUs(symbol){\n  if(!state.finnhubKey)throw new Error(\"請先設定 Finnhub API Key\");\n  const r=await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(state.finnhubKey)}`,{cache:\"no-store\"});\n  const d=await r.json();if(!r.ok||!n(d.c))throw new Error(\"查無美股報價\");\n  return {price:n(d.c),previousClose:n(d.pc),name:symbol};\n}\n\nasync function fetchBeta(symbol,market){\n  const r=await fetch(`/api/beta?market=${encodeURIComponent(market)}&symbol=${encodeURIComponent(symbol)}`,{cache:\"no-store\"});\n  const d=await r.json();\n  if(!r.ok||!d.ok||!Number.isFinite(Number(d.beta)))throw new Error(d.error||\"Beta 計算失敗\");\n  return {\n    beta:n(d.beta),\n    betaBenchmark:d.benchmark||\"\",\n    betaObservations:n(d.observations),\n    betaSource:d.source||\"historical\",\n    betaSourceLabel:d.sourceLabel||\"近兩年每週報酬\",\n    betaUpdatedAt:d.fetchedAt||now()\n  };\n}\n\nconst looksLikeTw=symbol=>/^\\d{4,6}$/.test(symbol)||/^AU99\\d{2}$/.test(symbol);\n\nasync function detectStock(symbol){\n  if(symbol===\"AU9901\"){\n    try{const quote=await fetchTw(symbol);return {market:\"TW\",symbol,...quote,manualOnly:false,assetType:\"gold\",quoteType:\"last-close\"};}\n    catch(e){return {market:\"TW\",symbol,name:\"臺灣銀行黃金現貨 AU9901\",price:0,previousClose:0,manualOnly:true,assetType:\"gold\",quoteType:\"last-close\"};}\n  }\n  const order=looksLikeTw(symbol)?[\"TW\",\"US\"]:[\"US\",\"TW\"];\n  let usKeyMissing=false,lastError=null;\n\n  for(const market of order){\n    try{\n      if(market===\"US\"&&!state.finnhubKey){\n        usKeyMissing=true;\n        continue;\n      }\n      const quote=market===\"TW\"?await fetchTw(symbol):await fetchUs(symbol);\n      if(n(quote.price)>0)return {market,...quote};\n    }catch(e){\n      lastError=e;\n    }\n  }\n\n  if(!looksLikeTw(symbol)&&usKeyMissing){\n    throw new Error(\"請先設定 Finnhub API Key，才能驗證美股代號\");\n  }\n  throw new Error(\"沒有此股票，請重新輸入\");\n}\nwindow.refreshHolding=async i=>{\n  const h=state.holdings[i];\n  h.error=\"更新報價與 Beta 中\";\n  renderHoldings();\n  const errors=[];\n  try{\n    if(h.symbol===\"AU9901\"){\n      try{\n        const q=await fetchTw(h.symbol);\n        Object.assign(h,q,{manualOnly:false,assetType:\"gold\",quoteType:\"last-close\",updatedAt:`最近收盤價 ${now()}`});\n      }catch(goldError){\n        if(n(h.price)>0){\n          h.manualOnly=false;\n          h.assetType=\"gold\";\n          h.quoteType=\"cached-close\";\n          h.updatedAt=`沿用上次收盤價 ${now()}`;\n        }else throw goldError;\n      }\n    }\n    else if(h.manualOnly){h.updatedAt=`手動價格 ${now()}`;}\n    else{const q=h.market===\"TW\"?await fetchTw(h.symbol):await fetchUs(h.symbol);Object.assign(h,q,{updatedAt:now()});}\n  }catch(e){errors.push(`報價：${e.message}`)}\n  try{\n    Object.assign(h,await fetchBeta(h.symbol,h.market));\n  }catch(e){errors.push(`Beta：${e.message}`)}\n  h.error=errors.join(\"｜\");\n  save();render();\n};\nwindow.removeHolding=i=>{state.holdings.splice(i,1);save();render()};\nwindow.editHolding=i=>{const h=state.holdings[i],s=prompt(`${h.symbol} 股數`,h.shares);if(s===null)return;const p=prompt(`${h.symbol} 手動價格`,h.price||\"\");if(p===null)return;h.shares=n(s);if(p!==\"\"){h.price=n(p);h.updatedAt=`手動 ${now()}`}h.betaManual=false;save();render()};\n\n\nfunction renderMarketPie(){\n  const canvas=$(\"marketChart\"),ctx=canvas.getContext(\"2d\"),w=canvas.width,h=canvas.height,t=totals();\n  const data=[\n    [\"台股\",t.tw,\"#69a8ff\",\"🐳\"],\n    [\"美股\",t.us*n(state.fxRate),\"#a78bfa\",\"🦄\"],\n    [\"現金\",t.cash,\"#5eead4\",\"🐣\"]\n  ].filter(([,v])=>v>0);\n  const total=data.reduce((s,[,v])=>s+v,0);\n  ctx.clearRect(0,0,w,h);\n  if(!total){\n    ctx.fillStyle=\"#98a8c1\";ctx.font=\"26px sans-serif\";ctx.textAlign=\"center\";\n    ctx.fillText(\"尚無資料\",w/2,h/2);$(\"marketLegend\").innerHTML=\"\";return;\n  }\n  let a=-Math.PI/2,r=Math.min(w,h)*.36,cx=w/2,cy=h/2;\n  data.forEach(([,v,color])=>{\n    const b=a+v/total*Math.PI*2;\n    ctx.beginPath();ctx.arc(cx,cy,r,a,b);ctx.arc(cx,cy,r*.58,b,a,true);ctx.closePath();\n    ctx.fillStyle=color;ctx.fill();a=b;\n  });\n  ctx.beginPath();ctx.arc(cx,cy,r*.51,0,Math.PI*2);ctx.fillStyle=\"#101c30\";ctx.fill();\n  ctx.fillStyle=\"#fff\";ctx.textAlign=\"center\";ctx.font=\"bold 30px sans-serif\";ctx.fillText(\"資產配比\",cx,cy-3);\n  ctx.font=\"20px sans-serif\";ctx.fillStyle=\"#cbd5e1\";ctx.fillText(\"100%\",cx,cy+29);\n  $(\"marketLegend\").innerHTML=data.map(([name,v,color,emoji])=>`<div class=\"legend-row cute-legend\"><span><i style=\"background:${color}\"></i>${emoji} ${name}</span><strong>${fmt(v/total*100,1)}%</strong></div>`).join(\"\");\n}\n\nfunction renderPie(){\n  const canvas=$(\"allocationChart\"),ctx=canvas.getContext(\"2d\"),w=canvas.width,h=canvas.height,map=new Map();\n  state.holdings.forEach(x=>map.set(x.symbol,(map.get(x.symbol)||0)+valueTwd(x)));\n  const cash=n(state.cashTwd)+n(state.cashUsd)*n(state.fxRate);if(cash>0)map.set(\"現金\",cash);\n  const data=[...map.entries()].filter(([,v])=>v>0),total=data.reduce((s,[,v])=>s+v,0);ctx.clearRect(0,0,w,h);\n  if(!total){ctx.fillStyle=\"#98a8c1\";ctx.font=\"26px sans-serif\";ctx.textAlign=\"center\";ctx.fillText(\"尚無資料\",w/2,h/2);$(\"allocationLegend\").innerHTML=\"\";return}\n  let a=-Math.PI/2,r=Math.min(w,h)*.36,cx=w/2,cy=h/2;\n  data.forEach(([,v],i)=>{const b=a+v/total*Math.PI*2;ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,r,a,b);ctx.closePath();ctx.fillStyle=`hsl(${(i*67+210)%360} 65% 55%)`;ctx.fill();a=b});\n  ctx.beginPath();ctx.arc(cx,cy,r*.55,0,Math.PI*2);ctx.fillStyle=\"#101c30\";ctx.fill();ctx.fillStyle=\"#fff\";ctx.textAlign=\"center\";ctx.font=\"bold 26px sans-serif\";ctx.fillText(\"總資產\",cx,cy-4);ctx.font=\"20px sans-serif\";ctx.fillText(money(total),cx,cy+28);\n  $(\"allocationLegend\").innerHTML=data.map(([k,v])=>`<div class=\"legend-row\"><span>${k}</span><strong>${fmt(v/total*100,1)}%</strong></div>`).join(\"\");\n}\n\nfunction renderHistory(){\n  const c=$(\"historyChart\"),ctx=c.getContext(\"2d\"),w=c.width,h=c.height,p=45,d=state.history.slice(-30);ctx.clearRect(0,0,w,h);\n  if(d.length<2){ctx.fillStyle=\"#98a8c1\";ctx.font=\"22px sans-serif\";ctx.textAlign=\"center\";ctx.fillText(\"至少記錄兩次後顯示曲線\",w/2,h/2)}else{const vals=d.map(x=>n(x.total)),min=Math.min(...vals),max=Math.max(...vals),range=max-min||1;ctx.strokeStyle=\"#2f64e9\";ctx.lineWidth=5;ctx.beginPath();d.forEach((x,i)=>{const px=p+i*(w-2*p)/(d.length-1),py=h-p-(n(x.total)-min)/range*(h-2*p);i?ctx.lineTo(px,py):ctx.moveTo(px,py)});ctx.stroke()}\n  $(\"historyList\").innerHTML=d.slice(-10).reverse().map(x=>`<div class=\"history-item\"><span>${x.date}</span><strong>${money(x.total)}</strong></div>`).join(\"\");\n}\n\n$(\"addHolding\").onclick=async()=>{\n  const symbol=$(\"symbol\").value.trim().toUpperCase().replace(/\\s+/g,\"\");\n  const shares=n($(\"shares\").value),manualPrice=n($(\"manualPrice\").value);\n  if(!symbol||shares<=0)return toast(\"請輸入股票代號與持有股數\");\n\n  const existingIndex=state.holdings.findIndex(h=>(h.symbol||\"\").toUpperCase()===symbol);\n  if(existingIndex>=0){\n    const holding=state.holdings[existingIndex];\n    const oldShares=n(holding.shares);\n    holding.shares=oldShares+shares;\n    if(manualPrice>0){holding.price=manualPrice;holding.updatedAt=`手動 ${now()}`;}\n    state.holdings.sort((a,b)=>(a.symbol||\"\").localeCompare(b.symbol||\"\",undefined,{numeric:true,sensitivity:\"base\"}));\n    save();\n    render();\n    $(\"symbol\").value=\"\";\n    $(\"shares\").value=\"\";\n    $(\"manualPrice\").value=\"\";\n    $(\"symbolStatus\").textContent=`已合併 ${symbol}：${oldShares} + ${shares} = ${holding.shares}`;\n    $(\"symbolStatus\").className=\"field-status success\";\n    toast(`已將 ${symbol} 從 ${oldShares} 股增加為 ${holding.shares} 股`);\n    return;\n  }\n\n  const button=$(\"addHolding\");\n  const originalText=button.textContent;\n  button.disabled=true;\n  button.textContent=\"正在辨識股票…\";\n  $(\"symbolStatus\").textContent=\"正在自動判斷台股或美股\";\n  $(\"symbolStatus\").className=\"field-status\";\n\n  try{\n    const detected=await detectStock(symbol);\n    if(detected.manualOnly&&!(manualPrice>0)){\n      throw new Error(\"AU9901 最近收盤價暫時無法取得；請稍後再試，或先輸入每台錢的手動價格\");\n    }\n    const price=manualPrice>0?manualPrice:detected.price;\n    state.holdings.push({\n      market:detected.market,\n      symbol,\n      manualOnly:Boolean(detected.manualOnly),\n      assetType:detected.assetType||\"stock\",\n      shares,\n      price,\n      previousClose:detected.previousClose,\n      pledgeAmount:0,\n      pledgeRate:0,\n      beta:null,\n      betaManual:false,\n      betaSource:\"\",\n      betaSourceLabel:\"\",\n      betaBenchmark:\"\",\n      betaObservations:0,\n      name:detected.name||symbol,\n      updatedAt:manualPrice>0?`手動 ${now()}`:(symbol===\"AU9901\"?`最近收盤價 ${now()}`:now()),\n      error:\"\"\n    });\n    const newIndex=state.holdings.length-1;\n    try{\n      Object.assign(state.holdings[newIndex],await fetchBeta(symbol,detected.market));\n    }catch(e){\n      state.holdings[newIndex].error=`Beta：${e.message}`;\n    }\n    state.holdings.sort((a,b)=>(a.symbol||\"\").localeCompare(b.symbol||\"\",undefined,{numeric:true,sensitivity:\"base\"}));\n    save();\n    render();\n    $(\"symbol\").value=\"\";\n    $(\"shares\").value=\"\";\n    $(\"manualPrice\").value=\"\";\n    $(\"symbolStatus\").textContent=`已辨識為${detected.market===\"TW\"?\"台股\":\"美股\"}：${detected.name||symbol}`;\n    $(\"symbolStatus\").className=\"field-status success\";\n    toast(`已加入${detected.market===\"TW\"?\"台股\":\"美股\"} ${symbol}`);\n  }catch(e){\n    $(\"symbolStatus\").textContent=e.message;\n    $(\"symbolStatus\").className=\"field-status error\";\n    toast(e.message);\n  }finally{\n    button.disabled=false;\n    button.textContent=originalText;\n  }\n};\n$(\"refreshAll\").onclick=async()=>{try{const r=await fetch(\"/api/fx\"),d=await r.json();if(d.ok)state.fxRate=n(d.rate)}catch{}for(let i=0;i<state.holdings.length;i++)await refreshHolding(i);save();render();toast(\"更新完成\")};\n$(\"clearHoldings\").onclick=()=>{if(confirm(\"確定刪除全部持股？\")){state.holdings=[];save();render()}};\n$(\"saveCash\").onclick=()=>{state.cashTwd=n($(\"cashTwd\").value);state.cashUsd=n($(\"cashUsd\").value);save();render();toast(\"現金已儲存\")};\n$(\"savePledge\").onclick=()=>{document.querySelectorAll(\"[data-pledge-index]\").forEach(row=>{const i=n(row.dataset.pledgeIndex),h=state.holdings[i];if(!h)return;h.pledgeAmount=Math.max(0,n(row.querySelector(\"[data-field=amount]\")?.value));h.pledgeRate=h.pledgeAmount>0?Math.max(0,n(row.querySelector(\"[data-field=rate]\")?.value)):0});save();render();toast(\"質押資料已儲存\")};\n$(\"saveSettings\").onclick=()=>{state.finnhubKey=$(\"finnhubKey\").value.trim();state.fxRate=n($(\"fxRate\").value)||state.fxRate;state.targetBeta=Math.max(0.1,Math.min(3,n($(\"targetBeta\")?.value)||1.20));save();render();toast(\"設定已儲存\")};\n$(\"testWorker\").onclick=async()=>{try{const r=await fetch(\"/api/status\",{cache:\"no-store\"}),d=await r.json();$(\"settingsStatus\").textContent=d.ok?`系統連線正常｜V${d.version}`:`失敗：${d.error}`}catch(e){$(\"settingsStatus\").textContent=`連線失敗：${e.message}`}};\n$(\"saveSnapshot\").onclick=()=>{const date=new Date().toISOString().slice(0,10),total=totals().total,old=state.history.find(x=>x.date===date);old?old.total=total:state.history.push({date,total});save();render();toast(\"今天資產已記錄\")};\nconst PAGE_META={\n  dashboard:{label:\"首頁\",icon:\"🏠\"},\n  portfolio:{label:\"持股\",icon:\"📈\"},\n  allocation:{label:\"資產配置\",icon:\"🥧\"},\n  rebalance:{label:\"聰明再平衡\",icon:\"🧠\"},\n  risk:{label:\"風險模擬\",icon:\"🛡️\"},\n  history:{label:\"資產歷史\",icon:\"🕘\"},\n  settings:{label:\"設定\",icon:\"⚙️\"}\n};\n\nfunction openMenu(){\n  $(\"sideMenu\").classList.add(\"open\");\n  $(\"menuOverlay\").classList.add(\"show\");\n  $(\"sideMenu\").setAttribute(\"aria-hidden\",\"false\");\n  $(\"menuButton\").setAttribute(\"aria-expanded\",\"true\");\n  document.body.classList.add(\"menu-open\");\n}\n\nfunction closeMenu(){\n  $(\"sideMenu\").classList.remove(\"open\");\n  $(\"menuOverlay\").classList.remove(\"show\");\n  $(\"sideMenu\").setAttribute(\"aria-hidden\",\"true\");\n  $(\"menuButton\").setAttribute(\"aria-expanded\",\"false\");\n  document.body.classList.remove(\"menu-open\");\n}\n\nfunction switchPage(tab){\n  const selected=PAGE_META[tab]?tab:\"dashboard\";\n  const meta=PAGE_META[selected];\n  document.querySelectorAll(\".side-menu-nav button\").forEach(x=>x.classList.toggle(\"active\",x.dataset.tab===selected));\n  document.querySelectorAll(\".tab-panel\").forEach(p=>p.classList.toggle(\"active\",p.id===selected));\n  document.body.dataset.activeTab=selected;\n  $(\"currentPageTitle\").textContent=meta.label;\n  $(\"currentPageLabel\").textContent=meta.label;\n  $(\"currentPageIcon\").textContent=meta.icon;\n  closeMenu();\n  window.scrollTo({top:0,behavior:\"smooth\"});\n  render();\n}\n\n$(\"menuButton\").onclick=openMenu;\n$(\"closeMenu\").onclick=closeMenu;\n$(\"menuOverlay\").onclick=closeMenu;\ndocument.querySelectorAll(\".side-menu-nav button\").forEach(b=>b.onclick=()=>switchPage(b.dataset.tab));\ndocument.addEventListener(\"keydown\",e=>{if(e.key===\"Escape\")closeMenu()});\n\nswitchPage(\"dashboard\");if(\"serviceWorker\"in navigator)navigator.serviceWorker.register(\"./sw.js?v=8.7.0\").catch(()=>{});\n\n\nfunction getCurrentHoldingValues(){\n  return state.holdings.map((h,index)=>({\n    index,\n    symbol:h.symbol,\n    name:h.name||h.symbol,\n    value:valueTwd(h)\n  }));\n}\nfunction renderTargetWeightList(){\n  const box=$(\"targetWeightList\");\n  if(!box)return;\n  const saved=state.targetWeights||{};\n  if(!state.holdings.length){\n    box.innerHTML='<div class=\"empty-target\">請先在「持股」頁加入股票。</div>';\n    if($(\"targetWeightTotal\"))$(\"targetWeightTotal\").textContent=\"0%\";\n    return;\n  }\n  box.innerHTML=state.holdings.map((h,i)=>`\n    <label class=\"target-weight-row\">\n      <div><strong>${h.symbol}</strong><small>${h.name||h.symbol}</small></div>\n      <div class=\"percent-input\"><input class=\"target-weight-input\" data-symbol=\"${h.symbol}\" type=\"number\" min=\"0\" max=\"100\" step=\"0.1\" inputmode=\"decimal\" value=\"${saved[h.symbol]??\"\"}\" placeholder=\"0\"><span>%</span></div>\n    </label>`).join(\"\");\n  box.querySelectorAll(\".target-weight-input\").forEach(input=>{\n    input.addEventListener(\"input\",()=>{\n      state.targetWeights=state.targetWeights||{};\n      state.targetWeights[input.dataset.symbol]=Math.max(0,Math.min(100,n(input.value)));\n      save();\n      updateTargetWeightTotal();\n    });\n  });\n  updateTargetWeightTotal();\n}\nfunction getTargetWeightMap(){\n  const result={};\n  document.querySelectorAll(\".target-weight-input\").forEach(input=>{\n    result[input.dataset.symbol]=Math.max(0,Math.min(100,n(input.value)));\n  });\n  return result;\n}\nfunction updateTargetWeightTotal(){\n  const weights=getTargetWeightMap();\n  const total=Object.values(weights).reduce((a,b)=>a+b,0);\n  const el=$(\"targetWeightTotal\");\n  if(el){\n    el.textContent=`${fmt(total,1)}%`;\n    el.className=Math.abs(total-100)<0.01?\"positive\":\"negative\";\n  }\n}\nfunction calculateRebalance(){\n  const capital=Math.max(0,n($(\"newCapital\")?.value));\n  const values=getCurrentHoldingValues();\n  const weights=getTargetWeightMap();\n  const box=$(\"rebalanceResult\");\n  if(!box)return;\n\n  if(!values.length){\n    box.innerHTML='<div class=\"result-row\"><small>請先加入持股。</small></div>';\n    return;\n  }\n\n  const sumW=values.reduce((sum,x)=>sum+n(weights[x.symbol]),0);\n  if(Math.abs(sumW-100)>0.01){\n    box.innerHTML=`<div class=\"result-row warning-row\"><small>目前比例合計為 ${fmt(sumW,1)}%，請調整為 100%。</small></div>`;\n    return;\n  }\n\n  state.targetWeights=weights;\n  save();\n\n  const currentTotal=values.reduce((a,b)=>a+b.value,0);\n  const targetTotal=currentTotal+capital;\n\n  const rows=values.map(x=>{\n    const targetPct=n(weights[x.symbol]);\n    const targetValue=targetTotal*targetPct/100;\n    const diff=targetValue-x.value;\n    let action=\"維持\";\n    if(diff>1)action=\"買入\";\n    else if(diff<-1)action=\"賣出\";\n\n    return {\n      ...x,\n      targetPct,\n      targetValue,\n      currentPct:currentTotal>0?x.value/currentTotal*100:0,\n      diff,\n      action,\n      isExit:targetPct===0&&x.value>0\n    };\n  });\n\n  const buyTotal=rows.filter(x=>x.diff>1).reduce((s,x)=>s+x.diff,0);\n  const sellTotal=rows.filter(x=>x.diff<-1).reduce((s,x)=>s+Math.abs(x.diff),0);\n  const net=buyTotal-sellTotal;\n\n  const projectedBeta=rows.reduce((s,x)=>{const h=state.holdings[x.index];return s+(validBeta(h)?x.targetPct/100*n(h.beta):0)},0);\n  const betaGap=projectedBeta-targetBeta();\n  const summary=`<div class=\"rebalance-summary\">\n    <div><span>目前資產</span><strong>${money(currentTotal)}</strong></div>\n    <div><span>新增資金</span><strong>${money(capital)}</strong></div>\n    <div><span>再平衡後</span><strong>${money(targetTotal)}</strong></div>\n  </div>\n  <div class=\"rebalance-beta-result\"><span>調整後 Portfolio Beta</span><strong>${fmt(projectedBeta,2)}</strong><small>目標 ${fmt(targetBeta(),2)}｜${Math.abs(betaGap)<=0.03?\"已接近目標\":`仍相差 ${betaGap>=0?\"+\":\"\"}${fmt(betaGap,2)}`}</small></div>\n  <div class=\"rebalance-flow\">\n    <span>預計賣出 <strong>${money(sellTotal)}</strong></span>\n    <span>預計買入 <strong>${money(buyTotal)}</strong></span>\n    <span>淨投入 <strong>${money(net)}</strong></span>\n  </div>`;\n\n  const ordered=[\n    ...rows.filter(x=>x.action===\"賣出\").sort((a,b)=>a.diff-b.diff),\n    ...rows.filter(x=>x.action===\"買入\").sort((a,b)=>b.diff-a.diff),\n    ...rows.filter(x=>x.action===\"維持\")\n  ];\n\n  const detail=ordered.map(x=>{\n    const actionClass=x.action===\"買入\"?\"buy-action\":x.action===\"賣出\"?\"sell-action\":\"hold-action\";\n    const amount=Math.abs(x.diff);\n    const actionText=x.isExit\n      ? `全部賣出 ${money(x.value)}`\n      : x.action===\"維持\"\n        ? \"無需調整\"\n        : `${x.action} ${money(amount)}`;\n\n    return `<div class=\"rebalance-row ${actionClass}\">\n      <div class=\"rebalance-symbol\">\n        <strong>${x.symbol}</strong>\n        <small>${x.name}</small>\n      </div>\n      <div class=\"rebalance-ratio\">\n        <span>${fmt(x.currentPct,1)}%</span>\n        <b>→</b>\n        <strong>${fmt(x.targetPct,1)}%</strong>\n      </div>\n      <div class=\"rebalance-action\">\n        <strong>${actionText}</strong>\n        <small>目標市值 ${money(x.targetValue)}</small>\n      </div>\n    </div>`;\n  }).join(\"\");\n\n  box.innerHTML=summary+detail;\n}\nfunction renderStress(){\n  const drop=n($(\"stressDrop\")?.value);\n  const t=totals();\n  const pledged=state.holdings.filter(h=>n(h.pledgeAmount)>0);\n  const pledgedValue=pledged.reduce((s,h)=>s+valueTwd(h),0);\n  const pledgeDebt=pledged.reduce((s,h)=>s+n(h.pledgeAmount),0);\n  const stressed=pledgedValue*(1-drop/100);\n  const ratio=pledgeDebt>0?stressed/pledgeDebt*100:null;\n  if($(\"stressDropText\"))$(\"stressDropText\").textContent=`-${drop}%`;\n  if($(\"stressMaintenance\"))$(\"stressMaintenance\").textContent=ratio===null?\"--\":`${fmt(ratio,1)}%`;\n  if($(\"stressBuffer\")){\n    const buffer=ratio===null?null:ratio-140;\n    $(\"stressBuffer\").textContent=buffer===null?\"--\":`${buffer>=0?\"+\":\"\"}${fmt(buffer,1)}%`;\n    $(\"stressBuffer\").className=buffer===null?\"\":buffer>=30?\"positive\":\"negative\";\n  }\n}\nfunction applyTheme(theme){\n  document.body.classList.toggle(\"light-mode\",theme===\"light\");\n  if($(\"themeToggle\"))$(\"themeToggle\").textContent=theme===\"light\"?\"☀\":\"☾\";\n  localStorage.setItem(THEME_KEY,theme);\n}\ndocument.addEventListener(\"DOMContentLoaded\",()=>{\n  applyTheme(localStorage.getItem(THEME_KEY)||\"dark\");\n  $(\"themeToggle\")?.addEventListener(\"click\",()=>applyTheme(document.body.classList.contains(\"light-mode\")?\"dark\":\"light\"));\n  $(\"calcRebalance\")?.addEventListener(\"click\",calculateRebalance);\n  $(\"stressDrop\")?.addEventListener(\"input\",renderStress);\n  setTimeout(renderStress,50);\n});\nconst originalRenderV5=render;\nrender=function(){originalRenderV5();renderStress();}\n\ndocument.addEventListener(\"DOMContentLoaded\",()=>{\n  $(\"marketScenario\")?.addEventListener(\"input\",renderBetaScenario);\n  setTimeout(()=>{renderBetaCenter();renderBetaScenario()},80);\n});\n\nfunction cleanBackupState(source){\n  const incoming=source&&typeof source===\"object\"?source:{};\n  return {\n    ...DEFAULT,\n    ...incoming,\n    holdings:Array.isArray(incoming.holdings)?incoming.holdings:[],\n    history:Array.isArray(incoming.history)?incoming.history:[],\n    targetWeights:incoming.targetWeights&&typeof incoming.targetWeights===\"object\"?incoming.targetWeights:{},\n    targetBeta:Math.max(0.1,Math.min(3,n(incoming.targetBeta||1.20)))\n  };\n}\nfunction backupPayload(){\n  const snapshot=cleanBackupState(JSON.parse(JSON.stringify(state)));\n  return {\n    app:\"AlphaPilot\",\n    version:\"8.0.0\",\n    exportedAt:new Date().toISOString(),\n    summary:{holdings:snapshot.holdings.length,cashTwd:n(snapshot.cashTwd),cashUsd:n(snapshot.cashUsd),history:snapshot.history.length},\n    data:snapshot\n  };\n}\nfunction exportBackup(){\n  const status=$(\"backupStatus\");\n  try{\n    const backup=backupPayload();\n    const payload=JSON.stringify(backup,null,2);\n    const verified=JSON.parse(payload);\n    if(!Array.isArray(verified.data?.holdings))throw new Error(\"備份內容驗證失敗\");\n    const blob=new Blob([payload],{type:\"application/json;charset=utf-8\"});\n    const url=URL.createObjectURL(blob);\n    const a=document.createElement(\"a\");\n    const d=new Date();\n    const stamp=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,\"0\")}-${String(d.getDate()).padStart(2,\"0\")}`;\n    a.href=url;a.download=`AlphaPilot-V8-backup-${stamp}.json`;\n    document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);\n    if(status)status.textContent=`備份完成：${backup.summary.holdings} 檔持股、台幣現金 ${money(backup.summary.cashTwd)}。`;\n  }catch(error){if(status)status.textContent=`匯出失敗：${error.message}`;}\n}\nasync function importBackupFile(file){\n  const status=$(\"backupStatus\");\n  try{\n    const text=await file.text();\n    const parsed=JSON.parse(text);\n    const raw=parsed?.data||parsed;\n    if(!raw||typeof raw!==\"object\"||!Array.isArray(raw.holdings))throw new Error(\"不是有效的 AlphaPilot 備份檔\");\n    const incoming=cleanBackupState(raw);\n    const count=incoming.holdings.length;\n    const date=parsed?.exportedAt?new Date(parsed.exportedAt).toLocaleString(\"zh-TW\"):\"日期不明\";\n    const cashText=`台幣 ${money(incoming.cashTwd)}／美元 ${money(incoming.cashUsd,\"USD\")}`;\n    const ok=confirm(`備份日期：${date}\\n持股數量：${count} 檔\\n現金：${cashText}\\n歷史紀錄：${incoming.history.length} 筆\\n\\n還原後會覆蓋目前資料，確定繼續嗎？`);\n    if(!ok){if(status)status.textContent=\"已取消匯入。\";return}\n    localStorage.setItem(KEY,JSON.stringify(incoming));\n    const stored=JSON.parse(localStorage.getItem(KEY)||\"null\");\n    if(!stored||!Array.isArray(stored.holdings))throw new Error(\"資料寫入手機儲存空間失敗\");\n    if(stored.holdings.length!==count||n(stored.cashTwd)!==n(incoming.cashTwd)||n(stored.cashUsd)!==n(incoming.cashUsd))throw new Error(\"寫入後驗證不一致，已停止還原\");\n    state=cleanBackupState(stored);\n    render();renderTargetWeightList();\n    if(status)status.textContent=`匯入成功：${count} 檔持股，現金與設定已載入。`;\n    toast(\"記錄檔匯入成功\");\n  }catch(error){if(status)status.textContent=`匯入失敗：${error.message}`;toast(\"記錄檔匯入失敗\");}\n  finally{if($(\"importBackupFile\"))$(\"importBackupFile\").value=\"\";}\n}\n\ndocument.addEventListener(\"DOMContentLoaded\",()=>{\n  $(\"exportBackup\")?.addEventListener(\"click\",exportBackup);\n  $(\"chooseBackup\")?.addEventListener(\"click\",()=>$(\"importBackupFile\")?.click());\n  $(\"importBackupFile\")?.addEventListener(\"change\",e=>{\n    const file=e.target.files?.[0];\n    if(file)importBackupFile(file);\n  });\n  setTimeout(renderTargetWeightList,100);\n});\n\ndocument.addEventListener(\"DOMContentLoaded\",()=>{\n  $(\"openBetaAdvisor\")?.addEventListener(\"click\",()=>switchPage(\"allocation\"));\n  $(\"targetBeta\")?.addEventListener(\"change\",()=>{state.targetBeta=Math.max(0.1,Math.min(3,n($(\"targetBeta\").value)||1.20));save();render();});\n});\n","style.css":"\n:root{--bg:#07101e;--surface:#101c30;--surface2:#0a1527;--line:#253752;--text:#f8fafc;--muted:#98a8c1;--blue:#2f64e9;--green:#34d399;--red:#fb7185}\n*{box-sizing:border-box}html{background:var(--bg)}body{margin:0;color:var(--text);font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;background:radial-gradient(circle at top,#112443 0,#07101e 35%);min-height:100vh}\nbutton,input,select{font:inherit}.app{max-width:880px;margin:auto;padding:calc(env(safe-area-inset-top) + 18px) 14px calc(env(safe-area-inset-bottom) + 36px)}\n.hero{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}.hero h1{font-size:25px;margin:2px 0}.eyebrow{font-size:11px;color:#70a5ff;letter-spacing:1.6px;margin:0}\n.summary-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}.summary-card{background:rgba(16,28,48,.95);border:1px solid var(--line);border-radius:17px;padding:14px;min-height:102px}.summary-card.total{grid-column:span 2;background:linear-gradient(135deg,#143c87,#1f5edf)}.summary-card span,.summary-card small{display:block}.summary-card span{color:#cbd5e1;font-size:12px}.summary-card strong{display:block;font-size:22px;margin:9px 0 5px}.summary-card.total strong{font-size:31px}.summary-card small{color:#9fb0c8;font-size:11px}\n.tabs{display:flex;overflow:auto;gap:8px;margin:16px 0 12px;padding-bottom:3px}.tabs button{white-space:nowrap;border:1px solid var(--line);background:var(--surface2);color:var(--muted);padding:10px 15px;border-radius:999px}.tabs button.active{background:var(--blue);color:white;border-color:transparent}\n.tab-panel{display:none}.tab-panel.active{display:block}.card{background:rgba(16,28,48,.96);border:1px solid var(--line);border-radius:20px;padding:16px;margin-bottom:12px}.section-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:14px}.section-head h2{font-size:19px;margin:0}.section-head span{font-size:12px;color:var(--muted)}\n.form-grid{display:grid;gap:10px;margin-bottom:10px}.form-grid.two{grid-template-columns:1fr 1fr}.form-grid.three{grid-template-columns:.75fr 1fr 1fr}label{display:block;color:var(--muted);font-size:12px;margin:10px 0}input,select{display:block;width:100%;margin-top:6px;border:1px solid var(--line);background:#071426;color:var(--text);border-radius:13px;padding:12px 13px;font-size:16px;min-height:48px}\nbutton{border:0;border-radius:13px;padding:12px 15px;color:white;font-weight:700;cursor:pointer}.primary{background:var(--blue)}.secondary{background:#172945;border:1px solid var(--line)}.compact{width:auto;padding:10px 14px}.full{width:100%;margin-top:9px}.text-button{background:transparent;padding:4px}.danger-text{color:var(--red)}\n.holding-list:empty:before{content:\"尚未加入持股\";display:block;color:var(--muted);padding:18px 0;text-align:center}.holding{border-top:1px solid var(--line);padding:15px 0}.holding:first-child{border-top:0}.holding-top{display:flex;justify-content:space-between;gap:10px}.holding-symbol{font-size:20px;font-weight:800}.pill{font-size:11px;padding:4px 8px;border-radius:999px;background:#22334e;color:#dbeafe;margin-left:5px}.holding-value{text-align:right;font-weight:800;font-size:18px}.holding-meta{color:var(--muted);font-size:12px;line-height:1.55;margin-top:6px}.holding-error{color:var(--red)}.holding-actions{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:11px}.holding-actions button{background:#172945;border:1px solid var(--line);padding:9px}.holding-actions .remove{background:#411624;color:#fecdd3}\ncanvas{width:100%;height:auto;display:block;max-height:380px}.legend{margin-top:12px}.legend-row,.info-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:11px 0;border-top:1px solid var(--line)}.legend-row:first-child,.info-row:first-child{border-top:0}.info-row input{width:48%;margin:0}\n.history-list{margin-top:10px}.history-item{display:flex;justify-content:space-between;color:var(--muted);font-size:12px;padding:8px 0;border-top:1px solid var(--line)}.status{font-size:12px;color:var(--muted);padding-top:8px}.toast{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom) + 22px);transform:translateX(-50%) translateY(120px);background:#e2e8f0;color:#0f172a;padding:11px 16px;border-radius:999px;font-size:13px;transition:.25s}.toast.show{transform:translateX(-50%) translateY(0)}.positive{color:var(--green)!important}.negative{color:var(--red)!important}\n@media(max-width:560px){.form-grid.two,.form-grid.three{grid-template-columns:1fr}.hero h1{font-size:22px}.summary-card strong{font-size:19px}.summary-card.total strong{font-size:27px}}\n\n.field-status{display:block;margin-top:8px;color:#91a2bd;font-size:.82rem;line-height:1.4}\n.field-status.success{color:#57d38c}\n.field-status.error{color:#ff6b86}\nbutton:disabled{opacity:.65;cursor:wait}\n\n.beta-card{background:linear-gradient(145deg,rgba(47,100,233,.18),rgba(167,139,250,.14))}\n.cute-card{background:linear-gradient(160deg,rgba(24,47,84,.98),rgba(16,28,48,.98))}\n.cute-legend span{display:flex;align-items:center;gap:8px}\n.cute-legend i{display:inline-block;width:11px;height:11px;border-radius:50%;box-shadow:0 0 10px rgba(255,255,255,.2)}\n.beta-display{text-align:center;padding:8px 0 5px}\n.beta-display small{display:block;color:var(--muted);font-size:12px}\n.beta-display strong{display:block;font-size:46px;margin:8px 0}\n.beta-display p{color:#cbd5e1;font-size:13px;line-height:1.5;margin:13px 0 0}\n.beta-meter{height:12px;background:#071426;border:1px solid var(--line);border-radius:999px;overflow:hidden;margin:10px auto 0;max-width:420px}\n.beta-meter span{display:block;height:100%;width:0;background:linear-gradient(90deg,#5eead4,#69a8ff,#a78bfa,#fb7185);border-radius:999px;transition:width .35s ease}\n.beta-note{color:var(--muted);font-size:11px;line-height:1.55;border-top:1px solid var(--line);padding-top:12px;margin-top:12px}\n\n.hero-actions{display:flex;align-items:center;gap:10px}\n.menu-button{\n  width:48px;height:48px;border-radius:16px;border:1px solid var(--line);\n  background:rgba(15,29,51,.92);display:flex;flex-direction:column;\n  align-items:center;justify-content:center;gap:5px;padding:0;\n  box-shadow:0 10px 24px rgba(0,0,0,.18)\n}\n.menu-button span{display:block;width:22px;height:2.5px;border-radius:99px;background:#fff}\n.tabs{display:none!important}\n\n.page-indicator{\n  display:inline-flex;align-items:center;gap:9px;margin:0 0 16px;\n  padding:10px 14px;border:1px solid var(--line);border-radius:999px;\n  background:rgba(16,28,48,.82);color:#dbeafe;font-size:.95rem;\n  box-shadow:0 8px 22px rgba(0,0,0,.12)\n}\n.page-indicator span{font-size:1.15rem}\n\n.menu-overlay{\n  position:fixed;inset:0;background:rgba(1,8,20,.65);backdrop-filter:blur(3px);\n  opacity:0;pointer-events:none;transition:opacity .22s ease;z-index:80\n}\n.menu-overlay.show{opacity:1;pointer-events:auto}\n\n.side-menu{\n  position:fixed;top:0;right:0;width:min(84vw,360px);height:100dvh;\n  background:linear-gradient(180deg,#132542 0%,#0b172a 100%);\n  border-left:1px solid rgba(110,145,198,.28);\n  box-shadow:-22px 0 45px rgba(0,0,0,.38);\n  transform:translateX(105%);transition:transform .25s ease;\n  z-index:90;padding:max(22px,env(safe-area-inset-top)) 18px max(22px,env(safe-area-inset-bottom));\n  display:flex;flex-direction:column\n}\n.side-menu.open{transform:translateX(0)}\nbody.menu-open{overflow:hidden}\n\n.side-menu-head{\n  display:flex;align-items:center;justify-content:space-between;\n  padding:10px 6px 22px;border-bottom:1px solid var(--line)\n}\n.side-menu-head small{display:block;color:var(--muted);font-size:.76rem;margin-bottom:4px}\n.side-menu-head strong{font-size:1.4rem}\n.menu-close{\n  width:42px;height:42px;border-radius:14px;border:1px solid var(--line);\n  background:#172945;color:#fff;font-size:1.75rem;line-height:1\n}\n\n.side-menu-nav{display:grid;gap:10px;padding:20px 0}\n.side-menu-nav button{\n  width:100%;display:flex;align-items:center;gap:14px;text-align:left;\n  padding:16px 18px;border-radius:17px;border:1px solid transparent;\n  background:transparent;color:#b8c6dc;font-size:1.06rem;font-weight:700;\n  transition:.18s ease\n}\n.side-menu-nav button.active{\n  color:#fff;background:linear-gradient(135deg,#2f64e9,#5b8cff);\n  border-color:rgba(255,255,255,.18);box-shadow:0 12px 28px rgba(47,100,233,.28)\n}\n.side-menu-nav button:not(.active):active{background:#172945}\n.menu-icon{\n  width:37px;height:37px;display:grid;place-items:center;border-radius:12px;\n  background:rgba(255,255,255,.08);font-size:1.2rem\n}\n.side-menu-nav button.active .menu-icon{background:rgba(255,255,255,.16)}\n.side-menu-foot{\n  margin-top:auto;color:#71829d;text-align:center;font-size:.78rem;\n  border-top:1px solid var(--line);padding-top:18px\n}\n\n@media(max-width:520px){\n  .hero{align-items:flex-start}\n  .hero-actions{gap:8px}\n  .hero .primary.compact{padding-left:16px;padding-right:16px}\n  .menu-button{width:46px;height:46px;border-radius:15px}\n}\n\n.auto-beta-hint{\n  margin:-2px 0 16px;padding:12px 14px;border:1px solid rgba(105,168,255,.22);\n  border-radius:14px;background:rgba(47,100,233,.08);color:#aebed5;\n  font-size:.79rem;line-height:1.55\n}\n\n.architecture-status{\n  display:flex;gap:14px;align-items:center;margin:4px 0 18px;padding:15px;\n  border:1px solid rgba(94,234,212,.22);border-radius:17px;\n  background:linear-gradient(135deg,rgba(94,234,212,.08),rgba(47,100,233,.08))\n}\n.architecture-status .status-orb{\n  flex:0 0 46px;width:46px;height:46px;border-radius:15px;\n  display:grid;place-items:center;background:rgba(255,255,255,.08);font-size:1.35rem\n}\n.architecture-status strong{display:block;color:#e8f5ff;margin-bottom:4px}\n.architecture-status p{margin:0;color:var(--muted);font-size:.78rem;line-height:1.5}\n\n/* AlphaPilot V5 */\n:root{--accent:#7c8cff;--accent2:#4ee0c1;--gold:#f3c969}\nbody{background:\n radial-gradient(circle at 10% -10%,rgba(124,140,255,.24),transparent 36%),\n radial-gradient(circle at 100% 12%,rgba(78,224,193,.12),transparent 28%),\n linear-gradient(180deg,#07101e,#091321 52%,#06101b);min-height:100vh}\n.brand-lockup{display:flex;align-items:center;gap:12px}.brand-icon{width:52px;height:52px;border-radius:17px;box-shadow:0 12px 32px rgba(75,100,255,.36)}\n.hero h1 em{font-style:normal;font-size:.48em;color:#9fb0ff;background:rgba(124,140,255,.14);padding:4px 7px;border-radius:8px;vertical-align:middle}\n.icon-action{width:46px;height:46px;padding:0;border-radius:15px;background:rgba(18,34,58,.9);border:1px solid var(--line);font-size:20px}\n.summary-card{backdrop-filter:blur(16px);background:linear-gradient(145deg,rgba(21,39,67,.92),rgba(12,25,44,.88));box-shadow:0 14px 38px rgba(0,0,0,.18)}\n.summary-card.total{background:linear-gradient(135deg,rgba(89,105,241,.96),rgba(46,195,170,.80));border-color:rgba(255,255,255,.20)}\n.glass-panel{background:linear-gradient(145deg,rgba(20,38,65,.83),rgba(11,24,42,.84));backdrop-filter:blur(18px)}\n.utility-panel{margin-top:16px}\n.helper-copy{color:var(--muted);line-height:1.65;margin-top:0}\n.result-stack{display:grid;gap:9px;margin-top:15px}\n.result-row{display:flex;justify-content:space-between;gap:12px;padding:13px 14px;border-radius:14px;background:rgba(8,22,40,.72);border:1px solid var(--line)}\n.result-row strong{color:#e9f4ff}.result-row small{color:var(--muted)}\n.stress-number{display:flex;flex-direction:column;justify-content:center;align-items:center;border:1px solid var(--line);border-radius:16px;background:rgba(8,22,40,.65);min-height:80px}\n.stress-number strong{font-size:28px;color:#ff9fb0}.stress-number small{color:var(--muted);margin-top:5px}\n.stress-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:15px}\n.stress-grid>div{padding:16px;border-radius:16px;background:rgba(8,22,40,.72);border:1px solid var(--line)}\n.stress-grid span{display:block;color:var(--muted);font-size:12px}.stress-grid strong{display:block;font-size:24px;margin-top:7px}\nbody.light-mode{background:#eef3fb;color:#102038}\nbody.light-mode .panel,body.light-mode .summary-card,body.light-mode .side-menu,body.light-mode .page-indicator{background:rgba(255,255,255,.92);color:#102038}\nbody.light-mode input,body.light-mode select,body.light-mode button:not(.primary){background:#f4f7fc;color:#102038}\nbody.light-mode .holding,body.light-mode .result-row,body.light-mode .stress-grid>div,body.light-mode .stress-number{background:#f5f8fd;color:#102038}\nbody.light-mode .holding-meta,body.light-mode .helper-copy,body.light-mode .stress-number small{color:#63708a}\n@media(max-width:560px){.brand-icon{width:46px;height:46px}.stress-grid{grid-template-columns:1fr}.hero-actions .primary.compact{font-size:0;width:46px;padding:0}.hero-actions .primary.compact:after{content:\"↻\";font-size:22px}}\n\n/* AlphaPilot V6 — Beta Risk Engine */\n.compact-hint{margin:0;min-height:52px;display:flex;align-items:center}\n.beta-center{overflow:hidden}\n.beta-hero-grid{display:grid;grid-template-columns:180px 1fr;gap:18px;align-items:center}\n.beta-orb{width:160px;height:160px;margin:auto;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:radial-gradient(circle at 35% 25%,rgba(124,140,255,.52),rgba(9,25,47,.92) 62%);border:1px solid rgba(160,176,255,.36);box-shadow:inset 0 0 35px rgba(88,105,240,.15),0 16px 35px rgba(0,0,0,.18)}\n.beta-orb small{color:var(--muted)}.beta-orb strong{font-size:43px;line-height:1.1;margin:6px 0}.beta-orb span{font-size:12px;padding:5px 10px;border-radius:999px;background:rgba(255,255,255,.08)}\n.formula-chip{display:inline-flex;padding:8px 11px;border-radius:11px;background:rgba(124,140,255,.12);color:#bfc8ff;font-size:12px}\n.beta-breakdown{display:grid;gap:9px;margin-top:20px}\n.beta-row{display:grid;grid-template-columns:minmax(120px,1.6fr) repeat(3,minmax(58px,.7fr));align-items:center;gap:10px;padding:13px 14px;border-radius:15px;background:rgba(7,20,38,.66);border:1px solid var(--line)}\n.beta-row>div:first-child{display:flex;flex-direction:column}.beta-row small,.beta-row span{font-size:11px;color:var(--muted)}.beta-row>div:not(:first-child){text-align:right}.beta-row>div:not(:first-child) strong{display:block;margin-top:3px}\n.risk-low{color:#65e6c4!important}.risk-normal{color:#9fb0ff!important}.risk-high{color:#f3c969!important}.risk-danger{color:#ff899e!important}\n.scenario-card input[type=range]{width:100%;accent-color:#7c8cff}\n.scenario-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:16px}\n.scenario-grid>div{padding:15px;border-radius:16px;background:rgba(7,20,38,.68);border:1px solid var(--line)}\n.scenario-grid span{display:block;color:var(--muted);font-size:12px}.scenario-grid strong{display:block;font-size:24px;margin-top:6px}\n.scenario-warning{display:block;margin-top:13px;color:var(--muted);line-height:1.6}\nbody.light-mode .beta-row,body.light-mode .scenario-grid>div{background:#f5f8fd}\nbody.light-mode .beta-orb{background:radial-gradient(circle at 35% 25%,#d8ddff,#f3f6ff 65%);color:#142441}\n@media(max-width:640px){\n .beta-hero-grid{grid-template-columns:1fr}.beta-orb{width:145px;height:145px}\n .beta-row{grid-template-columns:1.4fr repeat(3,.65fr);font-size:13px;padding:12px 10px;gap:6px}\n .scenario-grid{grid-template-columns:1fr}.scenario-grid>div{display:flex;justify-content:space-between;align-items:center}.scenario-grid strong{font-size:21px;margin:0}\n}\n\n/* AlphaPilot V6.1 — Compact holdings, allocation list, local backup */\n.holding-list{display:grid;gap:0}\n.holding-compact{border-bottom:1px solid var(--line)}\n.holding-compact:last-child{border-bottom:0}\n.holding-compact summary{list-style:none;display:grid;grid-template-columns:minmax(100px,1fr) auto 24px;align-items:center;gap:12px;padding:18px 0;cursor:pointer;-webkit-tap-highlight-color:transparent}\n.holding-compact summary::-webkit-details-marker{display:none}\n.holding-summary-main{display:flex;align-items:center;gap:8px;min-width:0}\n.holding-summary-value{font-size:20px;font-weight:800;text-align:right;white-space:nowrap}\n.holding-chevron{font-size:20px;color:var(--muted);transition:transform .2s;text-align:center}\n.holding-compact[open] .holding-chevron{transform:rotate(180deg)}\n.holding-detail{padding:0 0 18px;animation:detailOpen .18s ease-out}\n.holding-detail .holding-meta{line-height:1.65;color:var(--muted)}\n.holding-detail .holding-actions{margin-top:14px}\n.empty-holdings,.empty-target{padding:18px;text-align:center;color:var(--muted);border:1px dashed var(--line);border-radius:15px}\n@keyframes detailOpen{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}\n\n.target-weight-list{display:grid;gap:9px;margin:16px 0}\n.target-weight-row{display:flex!important;align-items:center;justify-content:space-between;gap:16px;padding:13px 14px;border-radius:15px;background:rgba(7,20,38,.68);border:1px solid var(--line)}\n.target-weight-row>div:first-child{display:flex;flex-direction:column;min-width:0}\n.target-weight-row small{color:var(--muted);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:190px}\n.percent-input{display:flex;align-items:center;gap:7px;flex:0 0 auto}\n.percent-input input{width:92px;text-align:right;margin:0!important;padding:11px 12px!important}\n.percent-input span{font-weight:700;color:var(--muted)}\n.weight-total-row{display:flex;justify-content:space-between;align-items:center;padding:13px 4px;margin-bottom:13px;color:var(--muted)}\n.weight-total-row strong{font-size:19px}\n.warning-row{border-color:rgba(255,137,158,.45)!important}\n\n.backup-actions{display:grid;grid-template-columns:1fr 1fr;gap:12px}\n.backup-actions button{width:100%}\nbody.light-mode .target-weight-row{background:#f5f8fd}\n@media(max-width:560px){\n  .holding-compact summary{grid-template-columns:minmax(86px,1fr) auto 20px;gap:8px;padding:16px 0}\n  .holding-summary-value{font-size:17px}\n  .holding-symbol{font-size:20px}\n  .target-weight-row small{max-width:145px}\n  .percent-input input{width:78px}\n  .backup-actions{grid-template-columns:1fr}\n}\n\n/* AlphaPilot V6.2 — Full portfolio rebalancing */\n.rebalance-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:16px}\n.rebalance-summary>div{padding:13px;border-radius:14px;background:rgba(7,20,38,.68);border:1px solid var(--line)}\n.rebalance-summary span,.rebalance-flow span{display:block;color:var(--muted);font-size:12px}\n.rebalance-summary strong{display:block;margin-top:5px;font-size:17px}\n.rebalance-flow{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:10px 0 14px}\n.rebalance-flow>span{padding:11px 13px;border-radius:13px;background:rgba(124,140,255,.08);border:1px solid var(--line)}\n.rebalance-flow strong{display:block;color:#eaf0ff;margin-top:4px;font-size:15px}\n.rebalance-row{display:grid;grid-template-columns:minmax(100px,1fr) minmax(110px,.9fr) minmax(150px,1.2fr);align-items:center;gap:12px;padding:14px;border-radius:15px;border:1px solid var(--line);background:rgba(7,20,38,.68)}\n.rebalance-symbol,.rebalance-action{display:flex;flex-direction:column}\n.rebalance-symbol small,.rebalance-action small{color:var(--muted);font-size:11px;margin-top:4px}\n.rebalance-ratio{display:flex;align-items:center;justify-content:center;gap:8px}\n.rebalance-ratio span{color:var(--muted)}.rebalance-ratio b{color:#73809b}\n.rebalance-action{text-align:right}\n.buy-action{border-color:rgba(78,224,193,.35)}\n.buy-action .rebalance-action>strong{color:#65e6c4}\n.sell-action{border-color:rgba(255,137,158,.38)}\n.sell-action .rebalance-action>strong{color:#ff899e}\n.hold-action{opacity:.72}\nbody.light-mode .rebalance-summary>div,body.light-mode .rebalance-row{background:#f5f8fd}\nbody.light-mode .rebalance-flow>span{background:#eef2ff}\n@media(max-width:620px){\n  .rebalance-summary,.rebalance-flow{grid-template-columns:1fr}\n  .rebalance-summary>div,.rebalance-flow>span{display:flex;justify-content:space-between;align-items:center}\n  .rebalance-summary strong,.rebalance-flow strong{margin:0}\n  .rebalance-row{grid-template-columns:1fr auto;gap:8px}\n  .rebalance-ratio{justify-content:flex-end}\n  .rebalance-action{grid-column:1/-1;text-align:left;padding-top:8px;border-top:1px solid var(--line)}\n}\n\n/* AlphaPilot V6.3 — One page at a time */\n.dashboard-panel{display:none}\n.dashboard-panel.active{display:block}\n.dashboard-panel .summary-grid{margin-bottom:0}\n.linked-panel{display:none;margin-top:16px}\n.linked-panel.active{display:block}\nbody[data-active-tab=\"dashboard\"] .page-indicator{display:none}\nbody[data-active-tab=\"dashboard\"] .dashboard-panel{animation:pageIn .18s ease-out}\n.tab-panel.active,.linked-panel.active{animation:pageIn .18s ease-out}\n@keyframes pageIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}\n\n/* AlphaPilot V6.4 — Dedicated rebalance and combined risk page */\n#rebalance.tab-panel,#risk.tab-panel{display:none}\n#rebalance.tab-panel.active,#risk.tab-panel.active{display:block}\n#risk{gap:16px}\n#risk.active{display:grid}\n#portfolio .card:last-child{margin-top:16px}\nbody[data-active-tab=\"rebalance\"] .page-indicator,\nbody[data-active-tab=\"risk\"] .page-indicator{display:flex}\n.manual-asset-note{color:var(--gold)}\n\n/* AlphaPilot V7 — verified local backup restore */\n\n\n/* AlphaPilot V8 — target Beta and decision-first UI */\n.beta-goal-card,.score-card{position:relative}\n.mini-link{margin-top:9px;padding:0;border:0;background:transparent;color:#8fa2ff;font-weight:700;text-align:left;cursor:pointer}\n.beta-simple-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:14px 0}\n.beta-simple-grid>div{padding:18px;border:1px solid var(--line);border-radius:18px;background:rgba(7,20,38,.62)}\n.beta-simple-grid span{display:block;color:var(--muted);font-size:12px}.beta-simple-grid strong{display:block;font-size:32px;margin-top:6px}\n.beta-simple-message{color:var(--muted);line-height:1.6}\n.advisor-box,.rebalance-beta-result{padding:16px;border-radius:16px;background:rgba(124,140,255,.10);border:1px solid rgba(124,140,255,.28);line-height:1.7}\n.rebalance-beta-result{margin:12px 0 14px;display:grid;grid-template-columns:1fr auto;gap:4px 12px;align-items:center}\n.rebalance-beta-result span,.rebalance-beta-result small{color:var(--muted)}.rebalance-beta-result strong{font-size:26px}.rebalance-beta-result small{grid-column:1/-1}\nbody.light-mode .beta-simple-grid>div{background:#f5f8fd}\n@media(max-width:560px){.beta-simple-grid{grid-template-columns:1fr 1fr}.beta-simple-grid strong{font-size:27px}}\n\n/* V8.6: keep the native file input hidden; the single visible control is 匯入記錄檔. */\ninput[type=\"file\"][hidden]{display:none!important}\n\n/* AlphaPilot V8.7 — per-holding pledge records */\n.pledge-table-head,.pledge-holding-row{display:grid;grid-template-columns:1.15fr 1fr .8fr .9fr;gap:12px;align-items:center}\n.pledge-table-head{padding:0 12px 10px;color:var(--muted);font-size:12px}\n.pledge-holding-list{display:grid;gap:10px;margin:8px 0 16px}\n.pledge-holding-row{padding:14px;border:1px solid var(--line);border-radius:16px;background:rgba(7,20,38,.62)}\n.pledge-holding-row label{margin:0}.pledge-holding-row label span,.pledge-ratio span{display:none;color:var(--muted);font-size:12px}\n.pledge-holding-row input{margin:0;padding:12px}\n.pledge-symbol small{display:block;color:var(--muted);font-size:11px;margin-top:4px}\n.pledge-ratio{text-align:right}.pledge-ratio strong{font-size:18px}\n.pledge-summary-row{display:flex;justify-content:space-between;align-items:center;padding:13px 4px;border-top:1px solid var(--line)}\nbody.light-mode .pledge-holding-row{background:#f5f8fd}\n@media(max-width:680px){\n .pledge-table-head{display:none}\n .pledge-holding-row{grid-template-columns:1fr 1fr}\n .pledge-symbol{grid-column:1/-1;padding-bottom:4px}\n .pledge-holding-row label span,.pledge-ratio span{display:block;margin-bottom:6px}\n .pledge-ratio{text-align:left;align-self:end;padding:8px 4px}\n}\n","sw.js":"const C='alphapilot-v8-7-stable';\nconst A=['./','./index.html','./style.css?v=8.7.0','./app.js?v=8.7.0','./manifest.webmanifest','./icon.svg'];\nself.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll(A)))});\nself.addEventListener('activate',e=>e.waitUntil(Promise.all([caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))),self.clients.claim()])));\nself.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).pathname.startsWith('/api/'))return;e.respondWith(fetch(e.request,{cache:'no-store'}).then(r=>{const c=r.clone();caches.open(C).then(x=>x.put(e.request,c));return r}).catch(()=>caches.match(e.request)))});\n","manifest.webmanifest":"{\n  \"name\": \"AlphaPilot V8.7 Stable｜目標 Beta\",\n  \"short_name\": \"AlphaPilot\",\n  \"start_url\": \"./\",\n  \"display\": \"standalone\",\n  \"background_color\": \"#07101e\",\n  \"theme_color\": \"#111c38\",\n  \"icons\": [\n    {\n      \"src\": \"icon.svg\",\n      \"sizes\": \"any\",\n      \"type\": \"image/svg+xml\",\n      \"purpose\": \"any maskable\"\n    }\n  ],\n  \"id\": \"./\",\n  \"scope\": \"./\",\n  \"description\": \"支援 Safari、Chrome、Edge 與 Firefox 的投資組合管理與目標 Beta 再平衡工具\"\n}","icon.svg":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 512 512\">\n<defs><linearGradient id=\"g\" x1=\"0\" y1=\"1\" x2=\"1\" y2=\"0\"><stop stop-color=\"#4455dd\"/><stop offset=\"1\" stop-color=\"#55dfbd\"/></linearGradient></defs>\n<rect width=\"512\" height=\"512\" rx=\"118\" fill=\"#0b1630\"/>\n<circle cx=\"256\" cy=\"256\" r=\"158\" fill=\"none\" stroke=\"url(#g)\" stroke-width=\"24\"/>\n<path d=\"M256 92l24 54-24 32-24-32z\" fill=\"#f3c969\"/>\n<path d=\"M150 330l76-82 58 48 82-102\" fill=\"none\" stroke=\"url(#g)\" stroke-width=\"35\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>\n<path d=\"M342 194h24v24\" fill=\"none\" stroke=\"#55dfbd\" stroke-width=\"23\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>\n<circle cx=\"256\" cy=\"256\" r=\"17\" fill=\"#fff\"/>\n</svg>"};

const MIME_TYPES = {".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".webmanifest": "application/manifest+json; charset=utf-8", ".svg": "image/svg+xml; charset=utf-8"};

function staticResponse(pathname) {
  let filename = pathname.replace(/^\/+/, "");
  if (!filename) filename = "index.html";

  // Ignore cache-busting query strings because pathname excludes them.
  if (!(filename in STATIC_FILES)) {
    // SPA fallback: routes without file extensions return index.html.
    if (!filename.includes(".")) filename = "index.html";
    else return null;
  }

  const dot = filename.lastIndexOf(".");
  const ext = dot >= 0 ? filename.slice(dot) : "";
  const contentType = MIME_TYPES[ext] || "text/plain; charset=utf-8";
  const cacheControl = filename === "index.html" || filename === "sw.js"
    ? "no-cache, no-store, must-revalidate"
    : "public, max-age=3600";

  return new Response(STATIC_FILES[filename], {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": cacheControl,
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS" && path.startsWith("/api/")) {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    if (path.startsWith("/api/")) {
      if (request.method !== "GET") {
        return jsonResponse(request, { ok: false, error: "Method not allowed" }, 405);
      }

      try {
        if (path === "/api/status") {
          return jsonResponse(request, {
            ok: true,
            service: "alphapilot-v7-2",
            version: "8.7.0",
            architecture: "Single-file Cloudflare Worker",
            endpoints: [
              "/api/tw?symbol=0050",
              "/api/beta?market=TW&symbol=0050",
              "/api/beta?market=US&symbol=QQQ",
              "/api/fx",
              "/api/status"
            ],
            now: new Date().toISOString()
          });
        }

        if (path === "/api/tw") {
          const symbol = (url.searchParams.get("symbol") || "").trim().toUpperCase();
          if (!/^[0-9A-Z]{2,10}$/.test(symbol)) {
            return jsonResponse(request, { ok: false, error: "請輸入正確台股代號" }, 400);
          }
          const quote = await getTaiwanQuote(symbol);
          if (!quote) {
            return jsonResponse(request, { ok: false, error: `查無 ${symbol} 報價` }, 404);
          }
          return jsonResponse(request, {
            ok: true,
            source: "TWSE MIS",
            fetchedAt: new Date().toISOString(),
            ...quote
          });
        }

        if (path === "/api/beta") {
          const symbol = (url.searchParams.get("symbol") || "").trim().toUpperCase();
          const market = (url.searchParams.get("market") || "").trim().toUpperCase();
          if (!/^[0-9A-Z.^-]{1,15}$/.test(symbol) || !["TW", "US"].includes(market)) {
            return jsonResponse(request, { ok: false, error: "請提供正確的 market 與 symbol" }, 400);
          }
          return jsonResponse(request, {
            ok: true,
            source: "Historical weekly adjusted prices",
            methodology: "covariance(asset returns, benchmark returns) / variance(benchmark returns)",
            fetchedAt: new Date().toISOString(),
            ...(await getAutomaticBeta(symbol, market))
          });
        }

        if (path === "/api/fx") {
          return jsonResponse(request, {
            ok: true,
            fetchedAt: new Date().toISOString(),
            ...(await getFx())
          });
        }

        return jsonResponse(request, { ok: false, error: "API endpoint not found" }, 404);
      } catch (error) {
        return jsonResponse(request, {
          ok: false,
          error: error instanceof Error ? error.message : "Unknown error"
        }, 502);
      }
    }

    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }

    return staticResponse(url.pathname) || new Response("Not found", { status: 404 });
  }
};

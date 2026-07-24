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

async function getTaiwanQuote(symbol) {
  const normalized = symbol.toUpperCase().replace(/\.(TW|TWO)$/i, "");
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

function weeklyReturns(series) {
  const output = new Map();
  for (let i = 1; i < series.length; i++) {
    const previous = series[i - 1][1];
    const current = series[i][1];
    if (!(previous > 0 && current > 0)) continue;
    const day = new Date(series[i][0] * 1000).toISOString().slice(0, 10);
    output.set(day, current / previous - 1);
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

async function getAutomaticBeta(symbol, market) {
  const normalizedMarket = market === "TW" ? "TW" : "US";
  const benchmarkTicker = normalizedMarket === "TW" ? "^TWII" : "^GSPC";
  const benchmarkName = normalizedMarket === "TW" ? "台灣加權指數" : "S&P 500";

  let assetTicker = yahooSymbol(symbol, normalizedMarket, false);
  let assetSeries;

  try {
    assetSeries = await fetchYahooSeries(assetTicker);
  } catch (error) {
    if (normalizedMarket !== "TW") throw error;
    assetTicker = yahooSymbol(symbol, normalizedMarket, true);
    assetSeries = await fetchYahooSeries(assetTicker);
  }

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
    observations: result.observations
  };
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


const STATIC_FILES = {"index.html": "<!doctype html>\n<html lang=\"zh-Hant\">\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\">\n  <meta name=\"theme-color\" content=\"#081222\">\n  <meta name=\"apple-mobile-web-app-capable\" content=\"yes\">\n  <meta name=\"apple-mobile-web-app-status-bar-style\" content=\"black-translucent\">\n  <meta name=\"apple-mobile-web-app-title\" content=\"資產儀表板\">\n  <link rel=\"manifest\" href=\"manifest.webmanifest\">\n  <link rel=\"icon\" href=\"icon.svg\">\n  <link rel=\"stylesheet\" href=\"style.css?v=4.1.0\">\n  <title>投資資產儀表板</title>\n</head>\n<body>\n  <main class=\"app\">\n    <header class=\"hero\">\n      <div>\n        <p class=\"eyebrow\">ERIC'S PORTFOLIO</p>\n        <h1>投資資產儀表板</h1>\n      </div>\n      <div class=\"hero-actions\">\n        <button id=\"refreshAll\" class=\"primary compact\">更新全部</button>\n        <button id=\"menuButton\" class=\"menu-button\" aria-label=\"開啟選單\" aria-expanded=\"false\">\n          <span></span><span></span><span></span>\n        </button>\n      </div>\n    </header>\n\n    <section class=\"summary-grid\">\n      <article class=\"summary-card total\"><span>總資產（新台幣）</span><strong id=\"totalTwd\">NT$0</strong><small id=\"lastUpdated\">尚未更新</small></article>\n      <article class=\"summary-card\"><span>今日損益</span><strong id=\"dailyPnl\">NT$0</strong><small id=\"dailyPnlPct\">0.00%</small></article>\n      <article class=\"summary-card\"><span>台股市值</span><strong id=\"twTotal\">NT$0</strong><small id=\"twCount\">0 檔</small></article>\n      <article class=\"summary-card\"><span>美股市值</span><strong id=\"usTotal\">US$0</strong><small id=\"fxText\">USD/TWD --</small></article>\n      <article class=\"summary-card\"><span>現金</span><strong id=\"cashTotal\">NT$0</strong><small>台幣＋美元換算</small></article>\n      <article class=\"summary-card\"><span>可質押額度</span><strong id=\"pledgeTotal\">NT$0</strong><small id=\"pledgeText\">依自訂成數</small></article>\n      <article class=\"summary-card beta-card\"><span>投資組合 Beta</span><strong id=\"portfolioBeta\">--</strong><small id=\"betaCoverage\">尚未設定持股 Beta</small></article>\n    </section>\n\n    <div id=\"menuOverlay\" class=\"menu-overlay\"></div>\n    <aside id=\"sideMenu\" class=\"side-menu\" aria-hidden=\"true\">\n      <div class=\"side-menu-head\">\n        <div>\n          <small>目前頁面</small>\n          <strong id=\"currentPageTitle\">持股</strong>\n        </div>\n        <button id=\"closeMenu\" class=\"menu-close\" aria-label=\"關閉選單\">×</button>\n      </div>\n\n      <nav class=\"side-menu-nav\">\n        <button data-tab=\"portfolio\" class=\"active\">\n          <span class=\"menu-icon\">📈</span><span>持股</span>\n        </button>\n        <button data-tab=\"allocation\">\n          <span class=\"menu-icon\">🥧</span><span>資產配置</span>\n        </button>\n        <button data-tab=\"cash\">\n          <span class=\"menu-icon\">💰</span><span>現金／質押</span>\n        </button>\n        <button data-tab=\"history\">\n          <span class=\"menu-icon\">🕘</span><span>資產歷史</span>\n        </button>\n        <button data-tab=\"settings\">\n          <span class=\"menu-icon\">⚙️</span><span>設定</span>\n        </button>\n      </nav>\n\n      <div class=\"side-menu-foot\">選擇功能後會自動切換頁面</div>\n    </aside>\n\n    <div class=\"page-indicator\">\n      <span id=\"currentPageIcon\">📈</span>\n      <strong id=\"currentPageLabel\">持股</strong>\n    </div>\n\n    <section id=\"portfolio\" class=\"tab-panel active\">\n      <article class=\"card\">\n        <div class=\"section-head\"><h2>新增持股</h2><span>台股與美股</span></div>\n        <div class=\"form-grid two\">\n          <label>股票代號\n            <input id=\"symbol\" placeholder=\"例如 0050、QQQM\" autocapitalize=\"characters\" autocomplete=\"off\">\n            <small id=\"symbolStatus\" class=\"field-status\">系統會自動判斷台股或美股</small>\n          </label>\n          <label>持有股數<input id=\"shares\" type=\"number\" min=\"0\" step=\"any\" placeholder=\"1000\"></label>\n        </div>\n        <div class=\"form-grid two\">\n          <label>手動價格（選填）<input id=\"manualPrice\" type=\"number\" min=\"0\" step=\"any\" placeholder=\"報價失敗時使用\"></label>\n          <label>質押成數（選填）<input id=\"pledgeRatio\" type=\"number\" min=\"0\" max=\"100\" step=\"1\" placeholder=\"例如 60\"></label>\n        </div>\n        <div class=\"auto-beta-hint\">📐 Beta 會依近兩年每週報酬，自動與市場指數比較計算，不需要手動輸入。</div>\n        <button id=\"addHolding\" class=\"primary full\">加入持股</button>\n      </article>\n\n      <article class=\"card\">\n        <div class=\"section-head\"><h2>我的持股</h2><button id=\"clearHoldings\" class=\"text-button danger-text\">全部清除</button></div>\n        <div id=\"holdingsList\" class=\"holding-list\"></div>\n      </article>\n    </section>\n\n    <section id=\"allocation\" class=\"tab-panel\">\n      <article class=\"card cute-card\">\n        <div class=\"section-head\"><h2>市場配置</h2><span>台股／美股／現金</span></div>\n        <canvas id=\"marketChart\" width=\"500\" height=\"500\"></canvas>\n        <div id=\"marketLegend\" class=\"legend\"></div>\n      </article>\n\n      <article class=\"card\">\n        <div class=\"section-head\"><h2>持股配置</h2><span>依個別股票市值</span></div>\n        <canvas id=\"allocationChart\" width=\"500\" height=\"500\"></canvas>\n        <div id=\"allocationLegend\" class=\"legend\"></div>\n      </article>\n\n      <article class=\"card\">\n        <div class=\"section-head\"><h2>Beta 風險資訊</h2><span>市值加權</span></div>\n        <div class=\"beta-display\">\n          <div>\n            <small>目前總 Beta</small>\n            <strong id=\"betaDetail\">--</strong>\n          </div>\n          <div class=\"beta-meter\"><span id=\"betaMeterFill\"></span></div>\n          <p id=\"betaDescription\">新增或更新持股後，系統會自動計算 Beta。</p>\n        </div>\n        <div class=\"beta-note\">台股以台灣加權指數為基準，美股以 S&amp;P 500 為基準；使用近兩年每週報酬估算。現金 Beta = 0，投資組合 Beta 依總資產市值加權。</div>\n      </article>\n    </section>\n\n    <section id=\"cash\" class=\"tab-panel\">\n      <article class=\"card\">\n        <div class=\"section-head\"><h2>現金部位</h2><span>納入總資產</span></div>\n        <div class=\"form-grid two\">\n          <label>台幣現金<input id=\"cashTwd\" type=\"number\" min=\"0\" step=\"any\"></label>\n          <label>美元現金<input id=\"cashUsd\" type=\"number\" min=\"0\" step=\"any\"></label>\n        </div>\n        <button id=\"saveCash\" class=\"primary full\">儲存現金</button>\n      </article>\n\n      <article class=\"card\">\n        <div class=\"section-head\"><h2>質押試算</h2><span>概算</span></div>\n        <div class=\"info-row\"><span>持股可質押額度</span><strong id=\"pledgeHolding\">NT$0</strong></div>\n        <div class=\"info-row\"><span>目前質押借款</span><input id=\"pledgeDebt\" type=\"number\" min=\"0\" step=\"any\"></div>\n        <div class=\"info-row\"><span>剩餘可借額度</span><strong id=\"pledgeRemaining\">NT$0</strong></div>\n        <div class=\"info-row\"><span>概算維持率</span><strong id=\"maintenanceRatio\">--</strong></div>\n        <button id=\"savePledge\" class=\"primary full\">儲存質押借款</button>\n      </article>\n    </section>\n\n    <section id=\"history\" class=\"tab-panel\">\n      <article class=\"card\">\n        <div class=\"section-head\"><h2>資產歷史</h2><button id=\"saveSnapshot\" class=\"secondary compact\">記錄今天</button></div>\n        <canvas id=\"historyChart\" width=\"720\" height=\"360\"></canvas>\n        <div id=\"historyList\" class=\"history-list\"></div>\n      </article>\n    </section>\n\n    <section id=\"settings\" class=\"tab-panel\">\n      <article class=\"card\">\n        <div class=\"section-head\"><h2>資料來源設定</h2><span>V4 單一架構</span></div>\n        <div class=\"architecture-status\">\n          <div class=\"status-orb\">☁️</div>\n          <div>\n            <strong>Cloudflare 前後端已整合</strong>\n            <p>台股、匯率與 Beta 會由目前網站自動處理，不需再填 Worker 網址。</p>\n          </div>\n        </div>\n        <label>Finnhub API Key（美股）<input id=\"finnhubKey\" type=\"password\" placeholder=\"免費 API Key\"></label>\n        <label>USD/TWD 備用匯率<input id=\"fxRate\" type=\"number\" min=\"0\" step=\"0.0001\"></label>\n        <button id=\"saveSettings\" class=\"primary full\">儲存設定</button>\n        <button id=\"testWorker\" class=\"secondary full\">測試系統連線</button>\n        <div id=\"settingsStatus\" class=\"status\"></div>\n      </article>\n    </section>\n\n    <div id=\"toast\" class=\"toast\"></div>\n  </main>\n  <script src=\"app.js?v=4.1.0\"></script>\n</body>\n</html>\n", "app.js": "\nconst $=id=>document.getElementById(id);\nconst KEY=\"stockDashboardV3\";\nconst DEFAULT={holdings:[],cashTwd:0,cashUsd:0,pledgeDebt:0,fxRate:32.5,finnhubKey:\"\",history:[]};\nlet state=(()=>{try{return {...DEFAULT,...JSON.parse(localStorage.getItem(KEY)||\"{}\")}}catch{return {...DEFAULT}}})();\nconst n=v=>Number.isFinite(Number(v))?Number(v):0;\nconst money=(v,c=\"TWD\")=>new Intl.NumberFormat(\"zh-TW\",{style:\"currency\",currency:c,maximumFractionDigits:c===\"TWD\"?0:2}).format(n(v));\nconst fmt=(v,d=2)=>n(v).toLocaleString(\"zh-TW\",{maximumFractionDigits:d});\nconst save=()=>localStorage.setItem(KEY,JSON.stringify(state));\nconst toast=m=>{const e=$(\"toast\");e.textContent=m;e.classList.add(\"show\");clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove(\"show\"),2200)};\nconst now=()=>new Date().toLocaleString(\"zh-TW\",{hour12:false});\nconst valueTwd=h=>n(h.price)*n(h.shares)*(h.market===\"US\"?n(state.fxRate):1);\nconst prevTwd=h=>n(h.previousClose)*n(h.shares)*(h.market===\"US\"?n(state.fxRate):1);\n\nfunction totals(){\n  let tw=0,us=0,daily=0,base=0,pledge=0;\n  state.holdings.forEach(h=>{\n    const local=n(h.price)*n(h.shares);\n    h.market===\"TW\"?tw+=local:us+=local;\n    if(n(h.previousClose)>0){daily+=valueTwd(h)-prevTwd(h);base+=prevTwd(h)}\n    pledge+=valueTwd(h)*n(h.pledgeRatio)/100;\n  });\n  const cash=n(state.cashTwd)+n(state.cashUsd)*n(state.fxRate);\n  const total=tw+us*n(state.fxRate)+cash;\n  let betaWeighted=0,betaValue=0;\n  state.holdings.forEach(h=>{\n    if(h.beta!==undefined&&h.beta!==null&&h.beta!==\"\"&&n(h.beta)>=0){\n      const v=valueTwd(h);\n      betaWeighted+=v*n(h.beta);\n      betaValue+=v;\n    }\n  });\n  const portfolioBeta=total>0?betaWeighted/total:null;\n  const betaCoverage=total>0?betaValue/total*100:0;\n  return {tw,us,daily,base,pledge,cash,total,portfolioBeta,betaCoverage};\n}\n\nfunction render(){\n  const t=totals();\n  $(\"totalTwd\").textContent=money(t.total);$(\"twTotal\").textContent=money(t.tw);$(\"usTotal\").textContent=money(t.us,\"USD\");\n  $(\"cashTotal\").textContent=money(t.cash);$(\"pledgeTotal\").textContent=money(t.pledge);$(\"pledgeHolding\").textContent=money(t.pledge);\n  const betaReady=t.portfolioBeta!==null&&t.betaCoverage>0;\n  $(\"portfolioBeta\").textContent=betaReady?fmt(t.portfolioBeta,2):\"--\";\n  $(\"betaCoverage\").textContent=betaReady?`自動 Beta 涵蓋 ${fmt(t.betaCoverage,0)}% 總資產`:\"尚未完成 Beta 計算\";\n  $(\"betaDetail\").textContent=betaReady?fmt(t.portfolioBeta,2):\"--\";\n  const meter=Math.max(0,Math.min(100,(betaReady?t.portfolioBeta:0)/2*100));\n  $(\"betaMeterFill\").style.width=`${meter}%`;\n  $(\"betaDescription\").textContent=!betaReady?\"按「更新全部」即可自動估算持股 Beta。\":t.portfolioBeta<0?\"與市場走勢傾向相反。\":t.portfolioBeta<0.7?\"市場敏感度明顯低於大盤。\":t.portfolioBeta<1.15?\"市場敏感度接近大盤。\":t.portfolioBeta<1.5?\"市場敏感度高於大盤。\":\"市場敏感度明顯高於大盤，需留意槓桿與集中風險。\";\n  $(\"pledgeRemaining\").textContent=money(Math.max(0,t.pledge-n(state.pledgeDebt)));\n  const pledgedValue=state.holdings.filter(h=>n(h.pledgeRatio)>0).reduce((s,h)=>s+valueTwd(h),0);\n  $(\"maintenanceRatio\").textContent=n(state.pledgeDebt)>0?`${fmt(pledgedValue/n(state.pledgeDebt)*100,1)}%`:\"--\";\n  $(\"dailyPnl\").textContent=money(t.daily);$(\"dailyPnlPct\").textContent=t.base?`${t.daily>=0?\"+\":\"\"}${fmt(t.daily/t.base*100,2)}%`:\"0.00%\";\n  $(\"twCount\").textContent=`${state.holdings.filter(h=>h.market===\"TW\").length} 檔`;$(\"fxText\").textContent=`USD/TWD ${fmt(state.fxRate,4)}`;\n  $(\"pledgeText\").textContent=`借款 ${money(state.pledgeDebt)}`;\n  $(\"lastUpdated\").textContent=state.holdings.map(h=>h.updatedAt).filter(Boolean).sort().at(-1)||\"尚未更新\";\n  renderHoldings();renderMarketPie();renderPie();renderHistory();\n  $(\"cashTwd\").value=state.cashTwd;$(\"cashUsd\").value=state.cashUsd;$(\"pledgeDebt\").value=state.pledgeDebt;\n  $(\"finnhubKey\").value=state.finnhubKey;$(\"fxRate\").value=state.fxRate;\n}\n\nfunction renderHoldings(){\n  $(\"holdingsList\").innerHTML=state.holdings.map((h,i)=>{\n    const c=h.market===\"TW\"?\"TWD\":\"USD\",change=n(h.previousClose)>0?(n(h.price)-n(h.previousClose))/n(h.previousClose)*100:null;\n    return `<div class=\"holding\"><div class=\"holding-top\"><div><span class=\"holding-symbol\">${h.symbol}</span><span class=\"pill\">${h.market===\"TW\"?\"台股\":\"美股\"}</span></div><div class=\"holding-value\">${money(n(h.price)*n(h.shares),c)}</div></div>\n    <div class=\"holding-meta\">${h.name||\"\"}<br>股數 ${fmt(h.shares,4)}｜價格 ${money(h.price,c)}${change===null?\"\":`｜<span class=\"${change>=0?\"positive\":\"negative\"}\">${change>=0?\"+\":\"\"}${fmt(change,2)}%</span>`}${n(h.pledgeRatio)>0?`｜質押 ${fmt(h.pledgeRatio,0)}%`:\"\"}${h.beta!==undefined&&h.beta!==null&&h.beta!==\"\"?`｜Beta ${fmt(h.beta,2)}${h.betaBenchmark?`（${h.betaBenchmark}）`:\"\"}`:\"｜Beta 尚未計算\"}<br>${h.updatedAt?`更新 ${h.updatedAt}`:\"尚未取得報價\"}${h.error?`<br><span class=\"holding-error\">${h.error}</span>`:\"\"}</div>\n    <div class=\"holding-actions\"><button onclick=\"refreshHolding(${i})\">更新</button><button onclick=\"editHolding(${i})\">修改</button><button class=\"remove\" onclick=\"removeHolding(${i})\">刪除</button></div></div>`;\n  }).join(\"\");\n}\n\nasync function fetchTw(symbol){\n  const r=await fetch(`/api/tw?symbol=${encodeURIComponent(symbol)}`,{cache:\"no-store\"});\n  const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||`HTTP ${r.status}`);\n  return {price:n(d.price),previousClose:n(d.previousClose),name:d.name||symbol};\n}\nasync function fetchUs(symbol){\n  if(!state.finnhubKey)throw new Error(\"請先設定 Finnhub API Key\");\n  const r=await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(state.finnhubKey)}`,{cache:\"no-store\"});\n  const d=await r.json();if(!r.ok||!n(d.c))throw new Error(\"查無美股報價\");\n  return {price:n(d.c),previousClose:n(d.pc),name:symbol};\n}\n\nasync function fetchBeta(symbol,market){\n  const r=await fetch(`/api/beta?market=${encodeURIComponent(market)}&symbol=${encodeURIComponent(symbol)}`,{cache:\"no-store\"});\n  const d=await r.json();\n  if(!r.ok||!d.ok||!Number.isFinite(Number(d.beta)))throw new Error(d.error||\"Beta 計算失敗\");\n  return {\n    beta:n(d.beta),\n    betaBenchmark:d.benchmark||\"\",\n    betaObservations:n(d.observations),\n    betaUpdatedAt:d.fetchedAt||now()\n  };\n}\n\nconst looksLikeTw=symbol=>/^\\d{4,6}$/.test(symbol);\n\nasync function detectStock(symbol){\n  const order=looksLikeTw(symbol)?[\"TW\",\"US\"]:[\"US\",\"TW\"];\n  let usKeyMissing=false,lastError=null;\n\n  for(const market of order){\n    try{\n      if(market===\"US\"&&!state.finnhubKey){\n        usKeyMissing=true;\n        continue;\n      }\n      const quote=market===\"TW\"?await fetchTw(symbol):await fetchUs(symbol);\n      if(n(quote.price)>0)return {market,...quote};\n    }catch(e){\n      lastError=e;\n    }\n  }\n\n  if(!looksLikeTw(symbol)&&usKeyMissing){\n    throw new Error(\"請先設定 Finnhub API Key，才能驗證美股代號\");\n  }\n  throw new Error(\"沒有此股票，請重新輸入\");\n}\nwindow.refreshHolding=async i=>{\n  const h=state.holdings[i];\n  h.error=\"更新報價與 Beta 中\";\n  renderHoldings();\n  const errors=[];\n  try{\n    const q=h.market===\"TW\"?await fetchTw(h.symbol):await fetchUs(h.symbol);\n    Object.assign(h,q,{updatedAt:now()});\n  }catch(e){errors.push(`報價：${e.message}`)}\n  try{\n    Object.assign(h,await fetchBeta(h.symbol,h.market));\n  }catch(e){errors.push(`Beta：${e.message}`)}\n  h.error=errors.join(\"｜\");\n  save();render();\n};\nwindow.removeHolding=i=>{state.holdings.splice(i,1);save();render()};\nwindow.editHolding=i=>{const h=state.holdings[i],s=prompt(`${h.symbol} 股數`,h.shares);if(s===null)return;const p=prompt(`${h.symbol} 手動價格`,h.price||\"\");if(p===null)return;const g=prompt(`${h.symbol} 質押成數 %`,h.pledgeRatio||0);if(g===null)return;h.shares=n(s);if(p!==\"\"){h.price=n(p);h.updatedAt=`手動 ${now()}`}h.pledgeRatio=Math.max(0,Math.min(100,n(g)));save();render()};\n\n\nfunction renderMarketPie(){\n  const canvas=$(\"marketChart\"),ctx=canvas.getContext(\"2d\"),w=canvas.width,h=canvas.height,t=totals();\n  const data=[\n    [\"台股\",t.tw,\"#69a8ff\",\"🐳\"],\n    [\"美股\",t.us*n(state.fxRate),\"#a78bfa\",\"🦄\"],\n    [\"現金\",t.cash,\"#5eead4\",\"🐣\"]\n  ].filter(([,v])=>v>0);\n  const total=data.reduce((s,[,v])=>s+v,0);\n  ctx.clearRect(0,0,w,h);\n  if(!total){\n    ctx.fillStyle=\"#98a8c1\";ctx.font=\"26px sans-serif\";ctx.textAlign=\"center\";\n    ctx.fillText(\"尚無資料\",w/2,h/2);$(\"marketLegend\").innerHTML=\"\";return;\n  }\n  let a=-Math.PI/2,r=Math.min(w,h)*.36,cx=w/2,cy=h/2;\n  data.forEach(([,v,color])=>{\n    const b=a+v/total*Math.PI*2;\n    ctx.beginPath();ctx.arc(cx,cy,r,a,b);ctx.arc(cx,cy,r*.58,b,a,true);ctx.closePath();\n    ctx.fillStyle=color;ctx.fill();a=b;\n  });\n  ctx.beginPath();ctx.arc(cx,cy,r*.51,0,Math.PI*2);ctx.fillStyle=\"#101c30\";ctx.fill();\n  ctx.fillStyle=\"#fff\";ctx.textAlign=\"center\";ctx.font=\"bold 30px sans-serif\";ctx.fillText(\"資產配比\",cx,cy-3);\n  ctx.font=\"20px sans-serif\";ctx.fillStyle=\"#cbd5e1\";ctx.fillText(\"100%\",cx,cy+29);\n  $(\"marketLegend\").innerHTML=data.map(([name,v,color,emoji])=>`<div class=\"legend-row cute-legend\"><span><i style=\"background:${color}\"></i>${emoji} ${name}</span><strong>${fmt(v/total*100,1)}%</strong></div>`).join(\"\");\n}\n\nfunction renderPie(){\n  const canvas=$(\"allocationChart\"),ctx=canvas.getContext(\"2d\"),w=canvas.width,h=canvas.height,map=new Map();\n  state.holdings.forEach(x=>map.set(x.symbol,(map.get(x.symbol)||0)+valueTwd(x)));\n  const cash=n(state.cashTwd)+n(state.cashUsd)*n(state.fxRate);if(cash>0)map.set(\"現金\",cash);\n  const data=[...map.entries()].filter(([,v])=>v>0),total=data.reduce((s,[,v])=>s+v,0);ctx.clearRect(0,0,w,h);\n  if(!total){ctx.fillStyle=\"#98a8c1\";ctx.font=\"26px sans-serif\";ctx.textAlign=\"center\";ctx.fillText(\"尚無資料\",w/2,h/2);$(\"allocationLegend\").innerHTML=\"\";return}\n  let a=-Math.PI/2,r=Math.min(w,h)*.36,cx=w/2,cy=h/2;\n  data.forEach(([,v],i)=>{const b=a+v/total*Math.PI*2;ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,r,a,b);ctx.closePath();ctx.fillStyle=`hsl(${(i*67+210)%360} 65% 55%)`;ctx.fill();a=b});\n  ctx.beginPath();ctx.arc(cx,cy,r*.55,0,Math.PI*2);ctx.fillStyle=\"#101c30\";ctx.fill();ctx.fillStyle=\"#fff\";ctx.textAlign=\"center\";ctx.font=\"bold 26px sans-serif\";ctx.fillText(\"總資產\",cx,cy-4);ctx.font=\"20px sans-serif\";ctx.fillText(money(total),cx,cy+28);\n  $(\"allocationLegend\").innerHTML=data.map(([k,v])=>`<div class=\"legend-row\"><span>${k}</span><strong>${fmt(v/total*100,1)}%</strong></div>`).join(\"\");\n}\n\nfunction renderHistory(){\n  const c=$(\"historyChart\"),ctx=c.getContext(\"2d\"),w=c.width,h=c.height,p=45,d=state.history.slice(-30);ctx.clearRect(0,0,w,h);\n  if(d.length<2){ctx.fillStyle=\"#98a8c1\";ctx.font=\"22px sans-serif\";ctx.textAlign=\"center\";ctx.fillText(\"至少記錄兩次後顯示曲線\",w/2,h/2)}else{const vals=d.map(x=>n(x.total)),min=Math.min(...vals),max=Math.max(...vals),range=max-min||1;ctx.strokeStyle=\"#2f64e9\";ctx.lineWidth=5;ctx.beginPath();d.forEach((x,i)=>{const px=p+i*(w-2*p)/(d.length-1),py=h-p-(n(x.total)-min)/range*(h-2*p);i?ctx.lineTo(px,py):ctx.moveTo(px,py)});ctx.stroke()}\n  $(\"historyList\").innerHTML=d.slice(-10).reverse().map(x=>`<div class=\"history-item\"><span>${x.date}</span><strong>${money(x.total)}</strong></div>`).join(\"\");\n}\n\n$(\"addHolding\").onclick=async()=>{\n  const symbol=$(\"symbol\").value.trim().toUpperCase().replace(/\\s+/g,\"\");\n  const shares=n($(\"shares\").value),manualPrice=n($(\"manualPrice\").value),pledge=n($(\"pledgeRatio\").value);\n  if(!symbol||shares<=0)return toast(\"請輸入股票代號與持有股數\");\n  if(state.holdings.some(h=>h.symbol===symbol))return toast(\"這個股票代號已經加入\");\n\n  const button=$(\"addHolding\");\n  const originalText=button.textContent;\n  button.disabled=true;\n  button.textContent=\"正在辨識股票…\";\n  $(\"symbolStatus\").textContent=\"正在自動判斷台股或美股\";\n  $(\"symbolStatus\").className=\"field-status\";\n\n  try{\n    const detected=await detectStock(symbol);\n    const price=manualPrice>0?manualPrice:detected.price;\n    state.holdings.push({\n      market:detected.market,\n      symbol,\n      shares,\n      price,\n      previousClose:detected.previousClose,\n      pledgeRatio:Math.max(0,Math.min(100,pledge)),\n      beta:null,\n      betaBenchmark:\"\",\n      betaObservations:0,\n      name:detected.name||symbol,\n      updatedAt:manualPrice>0?`手動 ${now()}`:now(),\n      error:\"\"\n    });\n    const newIndex=state.holdings.length-1;\n    try{\n      Object.assign(state.holdings[newIndex],await fetchBeta(symbol,detected.market));\n    }catch(e){\n      state.holdings[newIndex].error=`Beta：${e.message}`;\n    }\n    save();\n    render();\n    $(\"symbol\").value=\"\";\n    $(\"shares\").value=\"\";\n    $(\"manualPrice\").value=\"\";\n    $(\"pledgeRatio\").value=\"\";\n    $(\"symbolStatus\").textContent=`已辨識為${detected.market===\"TW\"?\"台股\":\"美股\"}：${detected.name||symbol}`;\n    $(\"symbolStatus\").className=\"field-status success\";\n    toast(`已加入${detected.market===\"TW\"?\"台股\":\"美股\"} ${symbol}`);\n  }catch(e){\n    $(\"symbolStatus\").textContent=e.message;\n    $(\"symbolStatus\").className=\"field-status error\";\n    toast(e.message);\n  }finally{\n    button.disabled=false;\n    button.textContent=originalText;\n  }\n};\n$(\"refreshAll\").onclick=async()=>{try{const r=await fetch(\"/api/fx\"),d=await r.json();if(d.ok)state.fxRate=n(d.rate)}catch{}for(let i=0;i<state.holdings.length;i++)await refreshHolding(i);save();render();toast(\"更新完成\")};\n$(\"clearHoldings\").onclick=()=>{if(confirm(\"確定刪除全部持股？\")){state.holdings=[];save();render()}};\n$(\"saveCash\").onclick=()=>{state.cashTwd=n($(\"cashTwd\").value);state.cashUsd=n($(\"cashUsd\").value);save();render();toast(\"現金已儲存\")};\n$(\"savePledge\").onclick=()=>{state.pledgeDebt=n($(\"pledgeDebt\").value);save();render();toast(\"質押借款已儲存\")};\n$(\"saveSettings\").onclick=()=>{state.finnhubKey=$(\"finnhubKey\").value.trim();state.fxRate=n($(\"fxRate\").value)||state.fxRate;save();render();toast(\"設定已儲存\")};\n$(\"testWorker\").onclick=async()=>{try{const r=await fetch(\"/api/status\",{cache:\"no-store\"}),d=await r.json();$(\"settingsStatus\").textContent=d.ok?`系統連線正常｜V${d.version}`:`失敗：${d.error}`}catch(e){$(\"settingsStatus\").textContent=`連線失敗：${e.message}`}};\n$(\"saveSnapshot\").onclick=()=>{const date=new Date().toISOString().slice(0,10),total=totals().total,old=state.history.find(x=>x.date===date);old?old.total=total:state.history.push({date,total});save();render();toast(\"今天資產已記錄\")};\nconst PAGE_META={\n  portfolio:{label:\"持股\",icon:\"📈\"},\n  allocation:{label:\"資產配置\",icon:\"🥧\"},\n  cash:{label:\"現金／質押\",icon:\"💰\"},\n  history:{label:\"資產歷史\",icon:\"🕘\"},\n  settings:{label:\"設定\",icon:\"⚙️\"}\n};\n\nfunction openMenu(){\n  $(\"sideMenu\").classList.add(\"open\");\n  $(\"menuOverlay\").classList.add(\"show\");\n  $(\"sideMenu\").setAttribute(\"aria-hidden\",\"false\");\n  $(\"menuButton\").setAttribute(\"aria-expanded\",\"true\");\n  document.body.classList.add(\"menu-open\");\n}\n\nfunction closeMenu(){\n  $(\"sideMenu\").classList.remove(\"open\");\n  $(\"menuOverlay\").classList.remove(\"show\");\n  $(\"sideMenu\").setAttribute(\"aria-hidden\",\"true\");\n  $(\"menuButton\").setAttribute(\"aria-expanded\",\"false\");\n  document.body.classList.remove(\"menu-open\");\n}\n\nfunction switchPage(tab){\n  const meta=PAGE_META[tab]||PAGE_META.portfolio;\n  document.querySelectorAll(\".side-menu-nav button\").forEach(x=>x.classList.toggle(\"active\",x.dataset.tab===tab));\n  document.querySelectorAll(\".tab-panel\").forEach(p=>p.classList.toggle(\"active\",p.id===tab));\n  $(\"currentPageTitle\").textContent=meta.label;\n  $(\"currentPageLabel\").textContent=meta.label;\n  $(\"currentPageIcon\").textContent=meta.icon;\n  closeMenu();\n  window.scrollTo({top:0,behavior:\"smooth\"});\n  render();\n}\n\n$(\"menuButton\").onclick=openMenu;\n$(\"closeMenu\").onclick=closeMenu;\n$(\"menuOverlay\").onclick=closeMenu;\ndocument.querySelectorAll(\".side-menu-nav button\").forEach(b=>b.onclick=()=>switchPage(b.dataset.tab));\ndocument.addEventListener(\"keydown\",e=>{if(e.key===\"Escape\")closeMenu()});\n\nrender();if(\"serviceWorker\"in navigator)navigator.serviceWorker.register(\"./sw.js?v=4.1.0\").catch(()=>{});\n", "style.css": "\n:root{--bg:#07101e;--surface:#101c30;--surface2:#0a1527;--line:#253752;--text:#f8fafc;--muted:#98a8c1;--blue:#2f64e9;--green:#34d399;--red:#fb7185}\n*{box-sizing:border-box}html{background:var(--bg)}body{margin:0;color:var(--text);font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;background:radial-gradient(circle at top,#112443 0,#07101e 35%);min-height:100vh}\nbutton,input,select{font:inherit}.app{max-width:880px;margin:auto;padding:calc(env(safe-area-inset-top) + 18px) 14px calc(env(safe-area-inset-bottom) + 36px)}\n.hero{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}.hero h1{font-size:25px;margin:2px 0}.eyebrow{font-size:11px;color:#70a5ff;letter-spacing:1.6px;margin:0}\n.summary-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}.summary-card{background:rgba(16,28,48,.95);border:1px solid var(--line);border-radius:17px;padding:14px;min-height:102px}.summary-card.total{grid-column:span 2;background:linear-gradient(135deg,#143c87,#1f5edf)}.summary-card span,.summary-card small{display:block}.summary-card span{color:#cbd5e1;font-size:12px}.summary-card strong{display:block;font-size:22px;margin:9px 0 5px}.summary-card.total strong{font-size:31px}.summary-card small{color:#9fb0c8;font-size:11px}\n.tabs{display:flex;overflow:auto;gap:8px;margin:16px 0 12px;padding-bottom:3px}.tabs button{white-space:nowrap;border:1px solid var(--line);background:var(--surface2);color:var(--muted);padding:10px 15px;border-radius:999px}.tabs button.active{background:var(--blue);color:white;border-color:transparent}\n.tab-panel{display:none}.tab-panel.active{display:block}.card{background:rgba(16,28,48,.96);border:1px solid var(--line);border-radius:20px;padding:16px;margin-bottom:12px}.section-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:14px}.section-head h2{font-size:19px;margin:0}.section-head span{font-size:12px;color:var(--muted)}\n.form-grid{display:grid;gap:10px;margin-bottom:10px}.form-grid.two{grid-template-columns:1fr 1fr}.form-grid.three{grid-template-columns:.75fr 1fr 1fr}label{display:block;color:var(--muted);font-size:12px;margin:10px 0}input,select{display:block;width:100%;margin-top:6px;border:1px solid var(--line);background:#071426;color:var(--text);border-radius:13px;padding:12px 13px;font-size:16px;min-height:48px}\nbutton{border:0;border-radius:13px;padding:12px 15px;color:white;font-weight:700;cursor:pointer}.primary{background:var(--blue)}.secondary{background:#172945;border:1px solid var(--line)}.compact{width:auto;padding:10px 14px}.full{width:100%;margin-top:9px}.text-button{background:transparent;padding:4px}.danger-text{color:var(--red)}\n.holding-list:empty:before{content:\"尚未加入持股\";display:block;color:var(--muted);padding:18px 0;text-align:center}.holding{border-top:1px solid var(--line);padding:15px 0}.holding:first-child{border-top:0}.holding-top{display:flex;justify-content:space-between;gap:10px}.holding-symbol{font-size:20px;font-weight:800}.pill{font-size:11px;padding:4px 8px;border-radius:999px;background:#22334e;color:#dbeafe;margin-left:5px}.holding-value{text-align:right;font-weight:800;font-size:18px}.holding-meta{color:var(--muted);font-size:12px;line-height:1.55;margin-top:6px}.holding-error{color:var(--red)}.holding-actions{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:11px}.holding-actions button{background:#172945;border:1px solid var(--line);padding:9px}.holding-actions .remove{background:#411624;color:#fecdd3}\ncanvas{width:100%;height:auto;display:block;max-height:380px}.legend{margin-top:12px}.legend-row,.info-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:11px 0;border-top:1px solid var(--line)}.legend-row:first-child,.info-row:first-child{border-top:0}.info-row input{width:48%;margin:0}\n.history-list{margin-top:10px}.history-item{display:flex;justify-content:space-between;color:var(--muted);font-size:12px;padding:8px 0;border-top:1px solid var(--line)}.status{font-size:12px;color:var(--muted);padding-top:8px}.toast{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom) + 22px);transform:translateX(-50%) translateY(120px);background:#e2e8f0;color:#0f172a;padding:11px 16px;border-radius:999px;font-size:13px;transition:.25s}.toast.show{transform:translateX(-50%) translateY(0)}.positive{color:var(--green)!important}.negative{color:var(--red)!important}\n@media(max-width:560px){.form-grid.two,.form-grid.three{grid-template-columns:1fr}.hero h1{font-size:22px}.summary-card strong{font-size:19px}.summary-card.total strong{font-size:27px}}\n\n.field-status{display:block;margin-top:8px;color:#91a2bd;font-size:.82rem;line-height:1.4}\n.field-status.success{color:#57d38c}\n.field-status.error{color:#ff6b86}\nbutton:disabled{opacity:.65;cursor:wait}\n\n.beta-card{background:linear-gradient(145deg,rgba(47,100,233,.18),rgba(167,139,250,.14))}\n.cute-card{background:linear-gradient(160deg,rgba(24,47,84,.98),rgba(16,28,48,.98))}\n.cute-legend span{display:flex;align-items:center;gap:8px}\n.cute-legend i{display:inline-block;width:11px;height:11px;border-radius:50%;box-shadow:0 0 10px rgba(255,255,255,.2)}\n.beta-display{text-align:center;padding:8px 0 5px}\n.beta-display small{display:block;color:var(--muted);font-size:12px}\n.beta-display strong{display:block;font-size:46px;margin:8px 0}\n.beta-display p{color:#cbd5e1;font-size:13px;line-height:1.5;margin:13px 0 0}\n.beta-meter{height:12px;background:#071426;border:1px solid var(--line);border-radius:999px;overflow:hidden;margin:10px auto 0;max-width:420px}\n.beta-meter span{display:block;height:100%;width:0;background:linear-gradient(90deg,#5eead4,#69a8ff,#a78bfa,#fb7185);border-radius:999px;transition:width .35s ease}\n.beta-note{color:var(--muted);font-size:11px;line-height:1.55;border-top:1px solid var(--line);padding-top:12px;margin-top:12px}\n\n.hero-actions{display:flex;align-items:center;gap:10px}\n.menu-button{\n  width:48px;height:48px;border-radius:16px;border:1px solid var(--line);\n  background:rgba(15,29,51,.92);display:flex;flex-direction:column;\n  align-items:center;justify-content:center;gap:5px;padding:0;\n  box-shadow:0 10px 24px rgba(0,0,0,.18)\n}\n.menu-button span{display:block;width:22px;height:2.5px;border-radius:99px;background:#fff}\n.tabs{display:none!important}\n\n.page-indicator{\n  display:inline-flex;align-items:center;gap:9px;margin:0 0 16px;\n  padding:10px 14px;border:1px solid var(--line);border-radius:999px;\n  background:rgba(16,28,48,.82);color:#dbeafe;font-size:.95rem;\n  box-shadow:0 8px 22px rgba(0,0,0,.12)\n}\n.page-indicator span{font-size:1.15rem}\n\n.menu-overlay{\n  position:fixed;inset:0;background:rgba(1,8,20,.65);backdrop-filter:blur(3px);\n  opacity:0;pointer-events:none;transition:opacity .22s ease;z-index:80\n}\n.menu-overlay.show{opacity:1;pointer-events:auto}\n\n.side-menu{\n  position:fixed;top:0;right:0;width:min(84vw,360px);height:100dvh;\n  background:linear-gradient(180deg,#132542 0%,#0b172a 100%);\n  border-left:1px solid rgba(110,145,198,.28);\n  box-shadow:-22px 0 45px rgba(0,0,0,.38);\n  transform:translateX(105%);transition:transform .25s ease;\n  z-index:90;padding:max(22px,env(safe-area-inset-top)) 18px max(22px,env(safe-area-inset-bottom));\n  display:flex;flex-direction:column\n}\n.side-menu.open{transform:translateX(0)}\nbody.menu-open{overflow:hidden}\n\n.side-menu-head{\n  display:flex;align-items:center;justify-content:space-between;\n  padding:10px 6px 22px;border-bottom:1px solid var(--line)\n}\n.side-menu-head small{display:block;color:var(--muted);font-size:.76rem;margin-bottom:4px}\n.side-menu-head strong{font-size:1.4rem}\n.menu-close{\n  width:42px;height:42px;border-radius:14px;border:1px solid var(--line);\n  background:#172945;color:#fff;font-size:1.75rem;line-height:1\n}\n\n.side-menu-nav{display:grid;gap:10px;padding:20px 0}\n.side-menu-nav button{\n  width:100%;display:flex;align-items:center;gap:14px;text-align:left;\n  padding:16px 18px;border-radius:17px;border:1px solid transparent;\n  background:transparent;color:#b8c6dc;font-size:1.06rem;font-weight:700;\n  transition:.18s ease\n}\n.side-menu-nav button.active{\n  color:#fff;background:linear-gradient(135deg,#2f64e9,#5b8cff);\n  border-color:rgba(255,255,255,.18);box-shadow:0 12px 28px rgba(47,100,233,.28)\n}\n.side-menu-nav button:not(.active):active{background:#172945}\n.menu-icon{\n  width:37px;height:37px;display:grid;place-items:center;border-radius:12px;\n  background:rgba(255,255,255,.08);font-size:1.2rem\n}\n.side-menu-nav button.active .menu-icon{background:rgba(255,255,255,.16)}\n.side-menu-foot{\n  margin-top:auto;color:#71829d;text-align:center;font-size:.78rem;\n  border-top:1px solid var(--line);padding-top:18px\n}\n\n@media(max-width:520px){\n  .hero{align-items:flex-start}\n  .hero-actions{gap:8px}\n  .hero .primary.compact{padding-left:16px;padding-right:16px}\n  .menu-button{width:46px;height:46px;border-radius:15px}\n}\n\n.auto-beta-hint{\n  margin:-2px 0 16px;padding:12px 14px;border:1px solid rgba(105,168,255,.22);\n  border-radius:14px;background:rgba(47,100,233,.08);color:#aebed5;\n  font-size:.79rem;line-height:1.55\n}\n\n.architecture-status{\n  display:flex;gap:14px;align-items:center;margin:4px 0 18px;padding:15px;\n  border:1px solid rgba(94,234,212,.22);border-radius:17px;\n  background:linear-gradient(135deg,rgba(94,234,212,.08),rgba(47,100,233,.08))\n}\n.architecture-status .status-orb{\n  flex:0 0 46px;width:46px;height:46px;border-radius:15px;\n  display:grid;place-items:center;background:rgba(255,255,255,.08);font-size:1.35rem\n}\n.architecture-status strong{display:block;color:#e8f5ff;margin-bottom:4px}\n.architecture-status p{margin:0;color:var(--muted);font-size:.78rem;line-height:1.5}\n", "sw.js": "const C='stock-dashboard-v4-1';\nconst A=['./','./index.html','./style.css?v=4.1.0','./app.js?v=4.1.0','./manifest.webmanifest','./icon.svg'];\nself.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll(A)))});\nself.addEventListener('activate',e=>e.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==C).map(k=>caches.delete(k)))),self.clients.claim()])));\nself.addEventListener('fetch',e=>{\n  if(e.request.method!=='GET'||new URL(e.request.url).pathname.startsWith('/api/'))return;\n  e.respondWith(fetch(e.request,{cache:'no-store'}).then(r=>{\n    const copy=r.clone();caches.open(C).then(c=>c.put(e.request,copy));return r\n  }).catch(()=>caches.match(e.request)))\n});\n", "manifest.webmanifest": "{\n  \"name\": \"投資資產儀表板\",\n  \"short_name\": \"資產儀表板\",\n  \"start_url\": \"./\",\n  \"display\": \"standalone\",\n  \"background_color\": \"#07101e\",\n  \"theme_color\": \"#081222\",\n  \"icons\": [\n    {\n      \"src\": \"icon.svg\",\n      \"sizes\": \"any\",\n      \"type\": \"image/svg+xml\",\n      \"purpose\": \"any maskable\"\n    }\n  ]\n}", "icon.svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 512 512\"><rect width=\"512\" height=\"512\" rx=\"112\" fill=\"#081222\"/><path d=\"M86 360l99-107 73 59 143-166\" fill=\"none\" stroke=\"#4f83ff\" stroke-width=\"39\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><circle cx=\"401\" cy=\"146\" r=\"28\" fill=\"#34d399\"/></svg>"};
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
            service: "eric-portfolio-v4-1",
            version: "4.1.0",
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

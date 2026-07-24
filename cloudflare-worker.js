const ALLOWED_ORIGINS = new Set([
  "https://eric760614-dev.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
]);

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const allowOrigin = ALLOWED_ORIGINS.has(origin)
    ? origin
    : "https://eric760614-dev.github.io";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(request, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(request),
    },
  });
}

function validSymbol(symbol) {
  return /^[0-9A-Z]{2,10}$/.test(symbol);
}

async function getTwseCookie() {
  const home = await fetch("https://mis.twse.com.tw/stock/index?lang=zhHant", {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; StockAssetTool/2.0)",
      "Accept": "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });
  return home.headers.get("set-cookie") || "";
}

async function queryTwse(symbol, cookie) {
  const channels = [`tse_${symbol}.tw`, `otc_${symbol}.tw`].join("|");
  const endpoint = new URL("https://mis.twse.com.tw/stock/api/getStockInfo.jsp");
  endpoint.searchParams.set("ex_ch", channels);
  endpoint.searchParams.set("json", "1");
  endpoint.searchParams.set("delay", "0");
  endpoint.searchParams.set("_", Date.now().toString());

  const response = await fetch(endpoint, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; StockAssetTool/2.0)",
      "Accept": "application/json,text/plain,*/*",
      "Referer": "https://mis.twse.com.tw/stock/index?lang=zhHant",
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
  if (!response.ok) throw new Error(`TWSE HTTP ${response.status}`);
  return response.json();
}

function parseQuote(payload, symbol) {
  const rows = Array.isArray(payload?.msgArray) ? payload.msgArray : [];
  for (const row of rows) {
    if (!row || String(row.c || "").toUpperCase() !== symbol) continue;
    // z: latest traded price; pz: simulated/last matched price; y: previous close.
    const fields = [
      ["z", row.z],
      ["pz", row.pz],
      ["y", row.y],
    ];
    for (const [source, raw] of fields) {
      const price = Number(raw);
      if (Number.isFinite(price) && price > 0) {
        return {
          symbol,
          name: row.n || "",
          market: row.ex === "tse" ? "TWSE" : row.ex === "otc" ? "TPEx" : row.ex || "",
          price,
          source,
          previousClose: Number(row.y) || null,
          time: row.t || null,
          date: row.d || null,
        };
      }
    }
  }
  return null;
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    if (request.method !== "GET") return json(request, { error: "Method not allowed" }, 405);

    const url = new URL(request.url);
    const symbol = (url.searchParams.get("symbol") || "").trim().toUpperCase();
    if (!validSymbol(symbol)) return json(request, { error: "股票代號格式錯誤" }, 400);

    try {
      const cookie = await getTwseCookie();
      const payload = await queryTwse(symbol, cookie);
      const quote = parseQuote(payload, symbol);
      if (!quote) return json(request, { error: "查無報價；非交易時段可能回傳昨收價" }, 404);
      return json(request, quote);
    } catch (error) {
      return json(request, { error: `證交所查價失敗：${error.message || "unknown error"}` }, 502);
    }
  },
};

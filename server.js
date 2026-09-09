const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const TSETMC_BASE = "https://cdn.tsetmc.com/api";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
  "Accept": "application/json,text/plain,text/csv,text/html,*/*",
  "Referer": "https://www.tsetmc.com/",
  "Origin": "https://www.tsetmc.com",
};

function normalizeSymbol(value) {
  return String(value || "")
    .trim()
    .replace(/\u200c/g, "")
    .replace(/\u200f/g, "");
}

async function tseGet(path) {
  const url = `${TSETMC_BASE}${path}`;

  const response = await axios.get(url, {
    headers: HEADERS,
    timeout: 15000,
    validateStatus: () => true,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`TSETMC HTTP ${response.status}`);
  }

  return response.data;
}

// ============================================================
// HOME
// ============================================================

app.get("/", (req, res) => {
  res.json({
    success: true,
    service: "Corevyn Proxy",
    status: "ONLINE",
    endpoints: [
      "/api/tse/:symbol",
      "/api/tse-live/:symbol",
      "/api/tse-history/:symbol",
      "/api/codal/:symbol",
      "/api/fx",
    ],
  });
});

// ============================================================
// SEARCH SYMBOL
// ============================================================

app.get("/api/tse/:symbol", async (req, res) => {
  const symbol = normalizeSymbol(req.params.symbol);

  try {
    const data = await tseGet(
      `/Instrument/GetInstrumentSearch/${encodeURIComponent(symbol)}`
    );

    const results = data?.instrumentSearch || [];

    if (!results.length) {
      return res.status(404).json({
        success: false,
        error: `نماد "${symbol}" پیدا نشد`,
        symbol,
      });
    }

    const result = results[0];

    res.json({
      success: true,
      query: symbol,
      instrument: result,
    });
  } catch (error) {
    console.error("TSE SEARCH ERROR:", error.message);

    res.status(502).json({
      success: false,
      error: error.message,
      symbol,
    });
  }
});

// ============================================================
// FULL LIVE ANALYSIS
// ============================================================

app.get("/api/tse-live/:symbol", async (req, res) => {
  const symbol = normalizeSymbol(req.params.symbol);

  try {
    // --------------------------------------------------------
    // 1. Search
    // --------------------------------------------------------

    const search = await tseGet(
      `/Instrument/GetInstrumentSearch/${encodeURIComponent(symbol)}`
    );

    const results = search?.instrumentSearch || [];

    if (!results.length) {
      return res.status(404).json({
        success: false,
        error: `نماد "${symbol}" پیدا نشد`,
      });
    }

    const instrument = results[0];

    const insCode = instrument.insCode;

    // --------------------------------------------------------
    // 2. Instrument information
    // --------------------------------------------------------

    const infoResponse = await tseGet(
      `/Instrument/GetInstrumentInfo/${insCode}`
    );

    const info = infoResponse?.instrumentInfo || {};

    // --------------------------------------------------------
    // 3. Closing price / live data
    // --------------------------------------------------------

    const priceResponse = await tseGet(
      `/ClosingPrice/GetClosingPriceInfo/${insCode}`
    );

    const price = priceResponse?.closingPriceInfo || {};

    // --------------------------------------------------------
    // 4. Order book
    // --------------------------------------------------------

    let bestLimits = {};

    try {
      const bestResponse = await tseGet(`/BestLimits/${insCode}`);
      bestLimits = bestResponse?.bestLimits || bestResponse || {};
    } catch (e) {
      console.log("BestLimits unavailable:", e.message);
    }

    // --------------------------------------------------------
    // 5. Trade
    // --------------------------------------------------------

    let trade = {};

    try {
      const tradeResponse = await tseGet(`/Trade/GetTrade/${insCode}`);
      trade = tradeResponse?.trade || tradeResponse || {};
    } catch (e) {
      console.log("Trade unavailable:", e.message);
    }

    // --------------------------------------------------------
    // 6. Client type / حقیقی حقوقی
    // --------------------------------------------------------

    let clientType = {};

    try {
      const clientResponse = await tseGet(
        `/ClientType/GetClientType/${insCode}/1/0`
      );

      clientType =
        clientResponse?.clientType ||
        clientResponse ||
        {};
    } catch (e) {
      console.log("ClientType unavailable:", e.message);
    }

    // --------------------------------------------------------
    // PRICE
    // --------------------------------------------------------

    const lastPrice =
      Number(price.pDrCotVal) ||
      Number(price.last) ||
      0;

    const closingPrice =
      Number(price.pClosing) ||
      Number(price.close) ||
      0;

    const yesterday =
      Number(price.priceYesterday) ||
      Number(price.pPriceYesterday) ||
      Number(price.pClosing) ||
      0;

    const change =
      yesterday > 0
        ? lastPrice - yesterday
        : lastPrice - closingPrice;

    const changePercent =
      yesterday > 0
        ? (change / yesterday) * 100
        : 0;

    const volume =
      Number(price.qTotTran5J) ||
      Number(price.zTotTrd) ||
      Number(price.volume) ||
      0;

    const value =
      Number(price.qTotCap) ||
      Number(price.totValue) ||
      0;

    // --------------------------------------------------------
    // LIMITS
    // --------------------------------------------------------

    const bestBuy =
      Number(bestLimits?.[0]?.pMeDem) ||
      Number(bestLimits?.[0]?.buyPrice) ||
      0;

    const bestSell =
      Number(bestLimits?.[0]?.pMeOf) ||
      Number(bestLimits?.[0]?.sellPrice) ||
      0;

    // --------------------------------------------------------
    // FUNDAMENTAL
    // --------------------------------------------------------

    const eps =
      Number(info.eps) ||
      Number(info.deven?.eps) ||
      0;

    const pe =
      Number(info.pe) ||
      Number(info.deven?.pe) ||
      0;

    const nav =
      Number(info.nav) ||
      Number(info.deven?.nav) ||
      0;

    const baseVolume =
      Number(info.baseVolume) ||
      Number(info.deven?.bvol) ||
      0;

    // --------------------------------------------------------
    // ANALYSIS
    // --------------------------------------------------------

    let score = 0;
    const reasons = [];

    if (changePercent >= 3) {
      score += 3;
      reasons.push(`رشد قوی ${changePercent.toFixed(2)}٪`);
    } else if (changePercent >= 1) {
      score += 2;
      reasons.push(`رشد مثبت ${changePercent.toFixed(2)}٪`);
    } else if (changePercent > 0) {
      score += 1;
      reasons.push(`رشد ملایم ${changePercent.toFixed(2)}٪`);
    } else if (changePercent <= -3) {
      score -= 3;
      reasons.push(`افت شدید ${changePercent.toFixed(2)}٪`);
    } else if (changePercent <= -1) {
      score -= 2;
      reasons.push(`افت منفی ${changePercent.toFixed(2)}٪`);
    } else if (changePercent < 0) {
      score -= 1;
      reasons.push(`افت ملایم ${changePercent.toFixed(2)}٪`);
    } else {
      reasons.push("تغییر قیمت تقریباً خنثی است");
    }

    if (baseVolume > 0 && volume > baseVolume) {
      score += 1;
      reasons.push("حجم معاملات بالاتر از حجم مبنا");
    }

    if (nav > 0 && lastPrice > 0) {
      const navGap = ((nav - lastPrice) / nav) * 100;

      if (navGap >= 5) {
        score += 2;
        reasons.push(
          `قیمت حدود ${navGap.toFixed(1)}٪ پایین‌تر از NAV`
        );
      }

      if (navGap <= -5) {
        score -= 2;
        reasons.push(
          `قیمت حدود ${Math.abs(navGap).toFixed(1)}٪ بالاتر از NAV`
        );
      }
    }

    let signal = "NEUTRAL";

    if (score >= 4) {
      signal = "STRONG_BUY";
    } else if (score >= 2) {
      signal = "BUY";
    } else if (score <= -4) {
      signal = "STRONG_SELL";
    } else if (score <= -2) {
      signal = "SELL";
    }

    const confidence = Math.min(
      95,
      Math.max(
        55,
        60 + Math.abs(score) * 7
      )
    );

    // --------------------------------------------------------
    // RESULT
    // --------------------------------------------------------

    res.json({
      success: true,

      symbol: instrument.lVal18AFC || symbol,

      name:
        instrument.lVal30 ||
        info.lVal30 ||
        symbol,

      insCode,

      market: instrument.flow,

      data: {
        current_price: lastPrice,
        closing_price: closingPrice,
        yesterday_close: yesterday,

        change,
        change_percent: Number(changePercent.toFixed(2)),

        volume,
        value,

        best_buy: bestBuy,
        best_sell: bestSell,

        last_update: new Date().toISOString(),
      },

      fundamental: {
        eps,
        pe,
        nav,
        base_volume,
      },

      order_book: bestLimits,

      trade,

      client_type: clientType,

      analysis: {
        signal,
        score,
        confidence,

        reasons,

        recommendation:
          signal === "STRONG_BUY"
            ? "خرید قوی؛ با مدیریت ریسک"
            : signal === "BUY"
            ? "تمایل مثبت؛ بررسی نقطه ورود"
            : signal === "STRONG_SELL"
            ? "فشار فروش بالا؛ احتیاط جدی"
            : signal === "SELL"
            ? "تمایل منفی؛ احتیاط"
            : "خنثی؛ نیاز به تأیید بیشتر",
      },
    });
  } catch (error) {
    console.error("TSE LIVE ERROR:", error);

    res.status(502).json({
      success: false,
      error: error.message,
      symbol,
    });
  }
});

// ============================================================
// HISTORY
// ============================================================

app.get("/api/tse-history/:symbol", async (req, res) => {
  const symbol = normalizeSymbol(req.params.symbol);

  try {
    const search = await tseGet(
      `/Instrument/GetInstrumentSearch/${encodeURIComponent(symbol)}`
    );

    const results = search?.instrumentSearch || [];

    if (!results.length) {
      return res.status(404).json({
        success: false,
        error: `نماد "${symbol}" پیدا نشد`,
      });
    }

    const instrument = results[0];
    const insCode = instrument.insCode;

    const history = await tseGet(
      `/Trade/GetTradeHistory/${insCode}/0/true`
    );

    res.json({
      success: true,
      symbol: instrument.lVal18AFC || symbol,
      insCode,
      history,
    });
  } catch (error) {
    console.error("TSE HISTORY ERROR:", error.message);

    res.status(502).json({
      success: false,
      error: error.message,
      symbol,
    });
  }
});

// ============================================================
// CODAL
// ============================================================

app.get("/api/codal/:symbol", async (req, res) => {
  const symbol = normalizeSymbol(req.params.symbol);

  try {
    const url =
      `https://search.codal.ir/api/search?v=1&q=${encodeURIComponent(symbol)}&t=true`;

    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json,text/plain,*/*",
      },
      timeout: 15000,
      validateStatus: () => true,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`CODAL HTTP ${response.status}`);
    }

    res.json({
      success: true,
      symbol,
      data: response.data,
    });
  } catch (error) {
    console.error("CODAL ERROR:", error.message);

    res.status(502).json({
      success: false,
      error: error.message,
      symbol,
    });
  }
});

// ============================================================
// FX
// ============================================================

app.get("/api/fx", async (req, res) => {
  try {
    const response = await axios.get(
      "https://api.boursyapi.com/v1/symbol/search?query=USD",
      {
        timeout: 15000,
      }
    );

    res.json({
      success: true,
      data: response.data,
    });
  } catch (error) {
    res.status(502).json({
      success: false,
      error: "خطا در دریافت ارز",
      detail: error.message,
    });
  }
});

// ============================================================
// HEALTH
// ============================================================

app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "healthy",
    service: "Corevyn Proxy",
    time: new Date().toISOString(),
  });
});

// ============================================================
// SERVER
// ============================================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Corevyn Proxy running on port ${PORT}`);
});

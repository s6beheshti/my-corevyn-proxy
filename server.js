const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const TSETMC = "https://cdn.tsetmc.com/api";

const headers = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Referer": "https://www.tsetmc.com/"
};

async function tseGet(path) {
  const response = await axios.get(`${TSETMC}${path}`, {
    headers,
    timeout: 15000,
    validateStatus: () => true
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`TSETMC HTTP ${response.status}`);
  }

  return response.data;
}


// ============================================================
// TEST
// ============================================================

app.get("/", (req, res) => {
  res.json({
    success: true,
    service: "Corevyn Proxy",
    status: "ONLINE",
    endpoints: [
      "/api/tse/اهرم",
      "/api/tse-live/اهرم",
      "/api/tse-history/اهرم",
      "/api/codal/اهرم",
      "/api/fx"
    ]
  });
});


// ============================================================
// TSETMC - SEARCH + LIVE DATA
// ============================================================

app.get("/api/tse/:symbol", async (req, res) => {

  const symbol = decodeURIComponent(req.params.symbol).trim();

  try {

    // 1. Search symbol
    const search = await tseGet(
      `/Instrument/GetInstrumentSearch/${encodeURIComponent(symbol)}`
    );

    const list = search?.instrumentSearch || [];

    if (!list.length) {
      return res.status(404).json({
        success: false,
        symbol,
        error: `نماد "${symbol}" پیدا نشد`
      });
    }

    // ترجیح نمادی که نام کوتاهش دقیقاً برابر باشد
    const match =
      list.find(x => x.lVal18AFC === symbol) ||
      list.find(x => x.lVal30 === symbol) ||
      list[0];

    const insCode = match.insCode;

    // 2. Instrument info
    const infoResponse = await tseGet(
      `/Instrument/GetInstrumentInfo/${insCode}`
    );

    // 3. Closing price
    const priceResponse = await tseGet(
      `/ClosingPrice/GetClosingPriceInfo/${insCode}`
    );

    const info = infoResponse?.instrumentInfo || {};
    const price = priceResponse?.closingPriceInfo || {};

    const lastPrice =
      Number(price.pDrCotVal || 0);

    const closePrice =
      Number(price.pClosing || 0);

    const yesterday =
      Number(price.priceYesterday || price.pClosing || 0);

    const firstPrice =
      Number(price.priceFirst || price.pf || 0);

    const minPrice =
      Number(price.priceMin || 0);

    const maxPrice =
      Number(price.priceMax || 0);

    const volume =
      Number(price.qTotTran5J || price.qTotTran || 0);

    const trades =
      Number(price.zTotTran || 0);

    const value =
      Number(price.qTotCap || price.qTotTran5J * lastPrice || 0);

    const change =
      lastPrice - yesterday;

    const changePercent =
      yesterday > 0
        ? Number(((change / yesterday) * 100).toFixed(2))
        : 0;

    // EPS / PE
    const eps = Number(
      info.eps ||
      info.epsTTM ||
      0
    );

    const pe = Number(
      info.pe ||
      info.pePsu ||
      0
    );

    // ========================================================
    // SIGNAL
    // ========================================================

    let score = 0;
    const reasons = [];

    if (changePercent >= 3) {
      score += 3;
      reasons.push(`رشد قوی ${changePercent}%`);
    }
    else if (changePercent >= 1) {
      score += 2;
      reasons.push(`رشد مثبت ${changePercent}%`);
    }
    else if (changePercent > 0) {
      score += 1;
      reasons.push(`رشد جزئی ${changePercent}%`);
    }
    else if (changePercent <= -3) {
      score -= 3;
      reasons.push(`افت شدید ${changePercent}%`);
    }
    else if (changePercent <= -1) {
      score -= 2;
      reasons.push(`افت منفی ${changePercent}%`);
    }
    else if (changePercent < 0) {
      score -= 1;
      reasons.push(`افت جزئی ${changePercent}%`);
    }
    else {
      reasons.push("بدون تغییر قابل‌توجه");
    }

    if (maxPrice > 0 && lastPrice >= maxPrice * 0.98) {
      score += 1;
      reasons.push("نزدیک سقف روز");
    }

    if (minPrice > 0 && lastPrice <= minPrice * 1.02) {
      score -= 1;
      reasons.push("نزدیک کف روز");
    }

    let signal = "NEUTRAL";

    if (score >= 4) signal = "STRONG_BUY";
    else if (score >= 2) signal = "BUY";
    else if (score <= -4) signal = "STRONG_SELL";
    else if (score <= -2) signal = "SELL";

    res.json({
      success: true,

      symbol: match.lVal18AFC || symbol,
      name: match.lVal30 || "",
      insCode,

      market: {
        flow: match.flow,
        flowTitle: match.flowTitle || ""
      },

      data: {
        current_price: lastPrice,
        closing_price: closePrice,
        yesterday_price: yesterday,
        first_price: firstPrice,
        min_price: minPrice,
        max_price: maxPrice,

        change,
        change_percent: changePercent,

        volume,
        trades,
        value,

        last_update: new Date().toISOString()
      },

      fundamental: {
        eps,
        pe
      },

      analysis: {
        signal,
        score,
        confidence: Math.min(
          95,
          60 + Math.abs(score) * 8
        ),
        reasons,
        recommendation: recommendation(signal)
      }
    });

  } catch (error) {

    console.error("TSETMC ERROR:", error.message);

    res.status(502).json({
      success: false,
      symbol,
      error: error.message,
      source: "TSETMC"
    });
  }
});


// ============================================================
// فقط LIVE با InsCode
// ============================================================

app.get("/api/tse-live/:symbol", async (req, res) => {

  const symbol = decodeURIComponent(req.params.symbol).trim();

  try {

    const search = await tseGet(
      `/Instrument/GetInstrumentSearch/${encodeURIComponent(symbol)}`
    );

    const list = search?.instrumentSearch || [];

    if (!list.length) {
      return res.status(404).json({
        success: false,
        error: "نماد پیدا نشد"
      });
    }

    const match =
      list.find(x => x.lVal18AFC === symbol) ||
      list[0];

    const insCode = match.insCode;

    const data = await tseGet(
      `/ClosingPrice/GetClosingPriceInfo/${insCode}`
    );

    res.json({
      success: true,
      symbol: match.lVal18AFC,
      name: match.lVal30,
      insCode,
      data: data.closingPriceInfo || {}
    });

  } catch (error) {

    res.status(502).json({
      success: false,
      error: error.message
    });
  }
});


// ============================================================
// HISTORY
// ============================================================

app.get("/api/tse-history/:symbol", async (req, res) => {

  const symbol = decodeURIComponent(req.params.symbol).trim();

  try {

    const search = await tseGet(
      `/Instrument/GetInstrumentSearch/${encodeURIComponent(symbol)}`
    );

    const list = search?.instrumentSearch || [];

    if (!list.length) {
      return res.status(404).json({
        success: false,
        error: "نماد پیدا نشد"
      });
    }

    const match =
      list.find(x => x.lVal18AFC === symbol) ||
      list[0];

    const insCode = match.insCode;

    const history = await tseGet(
      `/ClosingPrice/GetClosingPriceDailyList/${insCode}/0`
    );

    res.json({
      success: true,
      symbol: match.lVal18AFC,
      name: match.lVal30,
      insCode,
      history
    });

  } catch (error) {

    res.status(502).json({
      success: false,
      error: error.message
    });
  }
});


// ============================================================
// CODAL
// ============================================================

app.get("/api/codal/:symbol", async (req, res) => {

  const symbol = decodeURIComponent(req.params.symbol).trim();

  try {

    const response = await axios.get(
      `https://search.codal.ir/api/search?v=1&q=${encodeURIComponent(symbol)}&t=true`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0",
          "Accept": "application/json, text/plain, */*"
        },
        timeout: 15000
      }
    );

    res.json({
      success: true,
      symbol,
      data: response.data
    });

  } catch (error) {

    res.status(502).json({
      success: false,
      symbol,
      error: "خطا در دریافت اطلاعات کدال"
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
        timeout: 15000
      }
    );

    res.json({
      success: true,
      data: response.data
    });

  } catch (error) {

    res.status(502).json({
      success: false,
      error: "خطا در دریافت ارز"
    });
  }
});


// ============================================================
// HELPERS
// ============================================================

function recommendation(signal) {

  switch (signal) {

    case "STRONG_BUY":
      return "خرید قوی؛ مومنتوم مثبت است";

    case "BUY":
      return "تمایل صعودی؛ بررسی نقطه ورود";

    case "STRONG_SELL":
      return "فشار فروش بالا؛ احتیاط شدید";

    case "SELL":
      return "تمایل نزولی؛ احتیاط";

    default:
      return "روند خنثی؛ نیازمند بررسی بیشتر";
  }
}


// ============================================================
// START
// ============================================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Corevyn Proxy running on port ${PORT}`);
});

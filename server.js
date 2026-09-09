```javascript
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;

const AXIOS_CONFIG = {
  timeout: 20000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36",
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "fa-IR,fa;q=0.9,en;q=0.8",
    "Referer": "https://tsetmc.com/"
  }
};

// ============================================================
// HEALTH
// ============================================================

app.get("/", (req, res) => {
  res.json({
    success: true,
    service: "Corevyn Market Proxy",
    status: "ONLINE",
    time: new Date().toISOString()
  });
});

app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "healthy"
  });
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
      source: "boursyapi",
      data: response.data
    });

  } catch (error) {

    res.status(500).json({
      success: false,
      error: "خطا در دریافت ارز",
      detail: error.message
    });

  }
});

// ============================================================
// CRYPTO
// ============================================================

app.get("/api/crypto", async (req, res) => {

  try {

    const response = await axios.get(
      "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT",
      {
        timeout: 15000
      }
    );

    res.json({
      success: true,
      source: "binance",
      data: response.data
    });

  } catch (error) {

    res.status(500).json({
      success: false,
      error: "خطا در دریافت کریپتو",
      detail: error.message
    });

  }

});

// ============================================================
// TSETMC - SEARCH SYMBOL
// ============================================================

app.get("/api/tse/search/:symbol", async (req, res) => {

  const symbol = decodeURIComponent(req.params.symbol).trim();

  if (!symbol) {
    return res.status(400).json({
      success: false,
      error: "نماد خالی است"
    });
  }

  try {

    const url =
      "https://cdn.tsetmc.com/api/Instrument/GetInstrumentSearch/" +
      encodeURIComponent(symbol);

    const response = await axios.get(url, AXIOS_CONFIG);

    res.json({
      success: true,
      symbol,
      source: "TSETMC",
      data: response.data
    });

  } catch (error) {

    res.status(error.response?.status || 500).json({
      success: false,
      symbol,
      error: "خطا در جستجوی TSETMC",
      http_status: error.response?.status || null,
      detail: error.message
    });

  }

});

// ============================================================
// TSETMC - FULL SYMBOL ANALYSIS
// ============================================================

app.get("/api/tse/:symbol", async (req, res) => {

  const symbol = decodeURIComponent(req.params.symbol).trim();

  if (!symbol) {
    return res.status(400).json({
      success: false,
      error: "نماد خالی است"
    });
  }

  try {

    // --------------------------------------------------------
    // STEP 1 - SEARCH
    // --------------------------------------------------------

    const searchUrl =
      "https://cdn.tsetmc.com/api/Instrument/GetInstrumentSearch/" +
      encodeURIComponent(symbol);

    const searchResponse =
      await axios.get(searchUrl, AXIOS_CONFIG);

    const searchData = searchResponse.data;

    const instruments =
      searchData?.instrumentSearch ||
      searchData?.instrumentSearchList ||
      [];

    if (!instruments.length) {

      return res.status(404).json({
        success: false,
        symbol,
        error: `نماد "${symbol}" در TSETMC پیدا نشد`
      });

    }

    const instrument = instruments[0];

    const insCode =
      instrument.insCode ||
      instrument.insCode1 ||
      instrument.instrumentId;

    if (!insCode) {

      return res.status(500).json({
        success: false,
        symbol,
        error: "کد معاملاتی نماد از TSETMC دریافت نشد",
        search_result: instrument
      });

    }

    const shortName =
      instrument.lVal30 ||
      instrument.zTitad ||
      symbol;

    const fullName =
      instrument.lVal18 ||
      instrument.lVal30 ||
      shortName;

    // --------------------------------------------------------
    // STEP 2 - MARKET WATCH
    // --------------------------------------------------------

    let marketWatch = {};

    try {

      const marketUrl =
        `https://cdn.tsetmc.com/api/MarketWatch/GetMarketWatch/${insCode}`;

      const marketResponse =
        await axios.get(marketUrl, AXIOS_CONFIG);

      marketWatch =
        marketResponse.data?.marketWatch ||
        marketResponse.data ||
        {};

    } catch (error) {

      console.log(
        "MarketWatch failed:",
        error.response?.status,
        error.message
      );

    }

    // --------------------------------------------------------
    // STEP 3 - INSTRUMENT INFO
    // --------------------------------------------------------

    let instrumentInfo = {};

    try {

      const infoUrl =
        `https://cdn.tsetmc.com/api/Instrument/GetInstrumentInfo/${insCode}`;

      const infoResponse =
        await axios.get(infoUrl, AXIOS_CONFIG);

      instrumentInfo =
        infoResponse.data?.instrumentInfo ||
        infoResponse.data ||
        {};

    } catch (error) {

      console.log(
        "InstrumentInfo failed:",
        error.response?.status,
        error.message
      );

    }

    // --------------------------------------------------------
    // STEP 4 - EXTRACT
    // --------------------------------------------------------

    const deven =
      instrumentInfo.deven ||
      {};

    const currentPrice = Number(
      marketWatch.pDrCotVal ||
      deven.pDrCotVal ||
      0
    );

    const yesterdayClose = Number(
      marketWatch.pClosing ||
      deven.pClosing ||
      0
    );

    const volume = Number(
      marketWatch.zTotTrd ||
      deven.zTotTrd ||
      0
    );

    const value = Number(
      marketWatch.qTotTran5J ||
      marketWatch.totValue ||
      deven.qTotTran5J ||
      deven.totValue ||
      0
    );

    const firstPrice = Number(
      marketWatch.pFirst ||
      deven.pFirst ||
      0
    );

    const high = Number(
      marketWatch.pMax ||
      deven.pMax ||
      0
    );

    const low = Number(
      marketWatch.pMin ||
      deven.pMin ||
      0
    );

    // --------------------------------------------------------
    // CHANGE
    // --------------------------------------------------------

    let change = 0;
    let changePercent = 0;

    if (yesterdayClose > 0 && currentPrice > 0) {

      change =
        currentPrice - yesterdayClose;

      changePercent =
        (change / yesterdayClose) * 100;

    }

    // --------------------------------------------------------
    // FUNDAMENTAL
    // --------------------------------------------------------

    const eps = Number(
      instrumentInfo.eps ||
      instrumentInfo.EPS ||
      0
    );

    const pe = Number(
      instrumentInfo.pe ||
      instrumentInfo.PE ||
      0
    );

    const nav = Number(
      instrumentInfo.nav ||
      instrumentInfo.NAV ||
      0
    );

    const baseVolume = Number(
      instrumentInfo.baseVolume ||
      instrumentInfo.baseVol ||
      0
    );

    // --------------------------------------------------------
    // BUY / SELL PRESSURE
    // --------------------------------------------------------

    const buyCount =
      Number(
        marketWatch.qTitMeDem ||
        marketWatch.buyCount ||
        0
      );

    const sellCount =
      Number(
        marketWatch.qTitMeOf ||
        marketWatch.sellCount ||
        0
      );

    // --------------------------------------------------------
    // SIGNAL
    // --------------------------------------------------------

    let score = 0;
    const reasons = [];

    if (changePercent >= 3) {

      score += 3;

      reasons.push(
        `رشد قوی قیمت: +${changePercent.toFixed(2)}%`
      );

    } else if (changePercent >= 0.5) {

      score += 1;

      reasons.push(
        `رشد مثبت: +${changePercent.toFixed(2)}%`
      );

    } else if (changePercent <= -3) {

      score -= 3;

      reasons.push(
        `افت شدید قیمت: ${changePercent.toFixed(2)}%`
      );

    } else if (changePercent <= -0.5) {

      score -= 1;

      reasons.push(
        `افت قیمت: ${changePercent.toFixed(2)}%`
      );

    } else {

      reasons.push("تغییر قیمت فعلاً خنثی است");

    }

    // حجم

    if (baseVolume > 0 && volume > baseVolume * 2) {

      score += 1;

      reasons.push(
        "حجم معاملات بالاتر از حجم مبناست"
      );

    }

    // NAV

    let navDiscount = 0;

    if (nav > 0 && currentPrice > 0) {

      navDiscount =
        ((nav - currentPrice) / nav) * 100;

      if (navDiscount >= 5) {

        score += 2;

        reasons.push(
          `قیمت حدود ${navDiscount.toFixed(1)}% زیر NAV`
        );

      }

      if (navDiscount <= -5) {

        score -= 2;

        reasons.push(
          `قیمت حدود ${Math.abs(navDiscount).toFixed(1)}% بالاتر از NAV`
        );

      }

    }

    // --------------------------------------------------------
    // SIGNAL NAME
    // --------------------------------------------------------

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

    const confidence =
      Math.min(
        95,
        55 + Math.abs(score) * 8
      );

    // --------------------------------------------------------
    // RESULT
    // --------------------------------------------------------

    return res.json({

      success: true,

      source: "TSETMC",

      symbol: shortName,

      full_name: fullName,

      ins_code: insCode,

      updated_at: new Date().toISOString(),

      data: {

        current_price: currentPrice,

        yesterday_close: yesterdayClose,

        first_price: firstPrice,

        high,

        low,

        change,

        change_percent:
          Number(changePercent.toFixed(2)),

        volume,

        value,

        buy_count: buyCount,

        sell_count: sellCount

      },

      fundamental: {

        eps,

        pe,

        nav,

        nav_discount:
          Number(navDiscount.toFixed(2)),

        base_volume: baseVolume

      },

      analysis: {

        signal,

        score,

        confidence,

        reasons,

        recommendation:
          getRecommendation(signal)

      }

    });

  } catch (error) {

    console.error(
      "TSETMC ERROR:",
      error.response?.status,
      error.message
    );

    return res.status(500).json({

      success: false,

      symbol,

      error: "خطا در اتصال به TSETMC",

      http_status:
        error.response?.status || null,

      detail: error.message

    });

  }

});

// ============================================================
// CODAL
// ============================================================

app.get("/api/codal/:symbol", async (req, res) => {

  const symbol =
    decodeURIComponent(req.params.symbol).trim();

  try {

    const url =
      `https://search.codal.ir/api/search?v=1&q=${encodeURIComponent(symbol)}&t=true`;

    const response =
      await axios.get(url, {
        timeout: 20000,
        headers: {
          "User-Agent":
            "Mozilla/5.0"
        }
      });

    res.json({

      success: true,

      source: "CODAL",

      symbol,

      data: response.data

    });

  } catch (error) {

    res.status(500).json({

      success: false,

      symbol,

      error: "خطا در دریافت اطلاعات کدال",

      detail: error.message

    });

  }

});

// ============================================================
// MARKET SUMMARY
// ============================================================

app.get("/api/market", async (req, res) => {

  res.json({

    success: true,

    source: "Corevyn",

    status: "ONLINE",

    modules: {

      tsetmc: true,

      codal: true,

      fx: true,

      crypto: true

    },

    message:
      "Market proxy is ready"

  });

});

// ============================================================
// RECOMMENDATION
// ============================================================

function getRecommendation(signal) {

  switch (signal) {

    case "STRONG_BUY":
      return "🟢 خرید قوی — چند شاخص مثبت هم‌زمان شده‌اند";

    case "BUY":
      return "🟢 خرید — شرایط نسبتاً مثبت است";

    case "STRONG_SELL":
      return "🔴 فروش/کاهش ریسک — فشار منفی بالا";

    case "SELL":
      return "🔴 فروش/احتیاط — شرایط منفی است";

    default:
      return "🟡 خنثی — برای تصمیم‌گیری داده بیشتری لازم است";

  }

}

// ============================================================
// SERVER
// ============================================================

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `Corevyn Proxy running on 0.0.0.0:${PORT}`
    );

  }
);
```

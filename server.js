const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const rahavard = axios.create({
  baseURL: "https://rahavard365.com",
  timeout: 15000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0 Safari/537.36",
    Accept: "application/json, text/plain, */*",
    Referer: "https://rahavard365.com/",
    Origin: "https://rahavard365.com"
  }
});

// ============================================================
// Symbol -> Rahavard Asset ID
// ============================================================

const SYMBOLS = {
  "اهرم": 435
};

// ============================================================
// HOME
// ============================================================

app.get("/", (req, res) => {
  res.json({
    success: true,
    service: "Corevyn Proxy",
    status: "ONLINE",
    source: "Rahavard365",
    endpoints: [
      "/",
      "/api/rahavard/435",
      "/api/rahavard-symbol/اهرم",
      "/api/codal/اهرم",
      "/api/fx",
      "/api/crypto"
    ]
  });
});

// ============================================================
// RAHAVARD - DIRECT ASSET
// ============================================================

app.get("/api/rahavard/:id", async (req, res) => {
  const id = req.params.id;

  try {
    const response = await rahavard.get(`/api/v2/asset/${id}`);

    res.status(200).json({
      success: true,
      source: "Rahavard365",
      asset_id: id,
      data: response.data
    });

  } catch (error) {

    console.error(
      "RAHAVARD ERROR:",
      error.response?.status,
      error.message
    );

    res.status(error.response?.status || 500).json({
      success: false,
      source: "Rahavard365",
      asset_id: id,
      error: "خطا در دریافت اطلاعات ره‌آورد",
      http_status: error.response?.status || null,
      details: error.response?.data || null
    });
  }
});

// ============================================================
// RAHAVARD - SYMBOL
// ============================================================

app.get("/api/rahavard-symbol/:symbol", async (req, res) => {

  const symbol = decodeURIComponent(req.params.symbol).trim();

  const assetId = SYMBOLS[symbol];

  if (!assetId) {
    return res.status(404).json({
      success: false,
      symbol,
      error: `شناسه ره‌آورد برای نماد "${symbol}" ثبت نشده است`,
      available_symbols: Object.keys(SYMBOLS)
    });
  }

  try {

    const response = await rahavard.get(
      `/api/v2/asset/${assetId}`
    );

    res.json({
      success: true,
      source: "Rahavard365",
      symbol,
      asset_id: assetId,
      data: response.data
    });

  } catch (error) {

    console.error(
      "RAHAVARD SYMBOL ERROR:",
      error.response?.status,
      error.message
    );

    res.status(error.response?.status || 500).json({
      success: false,
      symbol,
      asset_id: assetId,
      error: "دریافت اطلاعات نماد از ره‌آورد انجام نشد",
      http_status: error.response?.status || null,
      details: error.response?.data || null
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
        timeout: 15000,
        headers: {
          "User-Agent": "Mozilla/5.0",
          Accept: "application/json, text/plain, */*"
        }
      }
    );

    res.json({
      success: true,
      source: "Codal",
      symbol,
      data: response.data
    });

  } catch (error) {

    console.error(
      "CODAL ERROR:",
      error.response?.status,
      error.message
    );

    res.status(error.response?.status || 500).json({
      success: false,
      symbol,
      error: "خطا در دریافت کدال",
      http_status: error.response?.status || null
    });
  }
});

// ============================================================
// FX - همان بخشی که الان درست کار می‌کند
// ============================================================

app.get("/api/fx", async (req, res) => {

  try {

    const response = await axios.get(
      "https://api.boursyapi.com/v1/symbol/search?query=USD",
      {
        timeout: 15000
      }
    );

    res.json(response.data);

  } catch (error) {

    res.status(500).json({
      success: false,
      error: "خطا در دریافت ارز"
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

    res.json(response.data);

  } catch (error) {

    res.status(500).json({
      success: false,
      error: "خطا در دریافت کریپتو"
    });
  }
});

// ============================================================
// TEST
// ============================================================

app.get("/api/test", (req, res) => {

  res.json({
    success: true,
    message: "Corevyn Proxy is working"
  });

});

// ============================================================
// 404
// ============================================================

app.use((req, res) => {

  res.status(404).json({
    success: false,
    error: "Endpoint not found",
    path: req.originalUrl
  });

});

// ============================================================
// START
// ============================================================

app.listen(PORT, () => {

  console.log(
    `Corevyn Proxy running on port ${PORT}`
  );

});

const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ============================================================
// RAHAVARD CLIENT
// ============================================================

const rahavard = axios.create({
  baseURL: "https://rahavard365.com",
  timeout: 20000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0 Safari/537.36",
    Accept: "application/json, text/plain, */*",
    Referer: "https://rahavard365.com/",
    Origin: "https://rahavard365.com"
  }
});

// ============================================================
// NORMALIZE PERSIAN TEXT
// ============================================================

function normalizeText(value) {
  return String(value || "")
    .trim()
    .replace(/ي/g, "ی")
    .replace(/ى/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/\u200c/g, "")
    .replace(/\s+/g, " ");
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
      "/",
      "/api/rahavard/:id",
      "/api/rahavard-symbol/:symbol",
      "/api/codal/:symbol",
      "/api/fx",
      "/api/crypto",
      "/api/test"
    ]
  });
});

// ============================================================
// RAHAVARD DIRECT ASSET
// ============================================================

app.get("/api/rahavard/:id", async (req, res) => {
  const id = String(req.params.id || "").trim();

  if (!/^\d+$/.test(id)) {
    return res.status(400).json({
      success: false,
      error: "شناسه Asset معتبر نیست"
    });
  }

  try {
    const response = await rahavard.get(`/api/v2/asset/${id}`);

    return res.status(200).json({
      success: true,
      asset_id: id,
      data: response.data
    });

  } catch (error) {
    console.error(
      "RAHAVARD DIRECT ERROR:",
      error.response?.status,
      error.message
    );

    return res.status(error.response?.status || 500).json({
      success: false,
      asset_id: id,
      error: "خطا در دریافت اطلاعات نماد",
      http_status: error.response?.status || null
    });
  }
});

// ============================================================
// EXTRACT ASSET OBJECT
// ============================================================

function extractAsset(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const candidates = [
    payload?.data?.asset,
    payload?.data?.data?.asset,
    payload?.asset,
    payload?.data
  ];

  for (const item of candidates) {
    if (
      item &&
      typeof item === "object" &&
      (
        item.trade_symbol ||
        item.symbol ||
        item.slug ||
        item.id
      )
    ) {
      return item;
    }
  }

  return null;
}

// ============================================================
// SYMBOL MATCH
// ============================================================

function symbolMatches(requested, asset) {
  const q = normalizeText(requested);

  const values = [
    asset?.trade_symbol,
    asset?.symbol,
    asset?.slug,
    asset?.name
  ]
    .filter(Boolean)
    .map(normalizeText);

  return values.some((value) => value === q);
}

// ============================================================
// SEARCH STRATEGY
// ============================================================
//
// IMPORTANT:
// Rahavard's public/internal search endpoint is not publicly
// documented. Therefore we do NOT blindly assign an Asset ID.
//
// We first try several known API patterns.
// Every result is validated against the requested symbol.
// A wrong asset is NEVER accepted.
//
// ============================================================

async function tryRahavardSearch(symbol) {

  const encoded = encodeURIComponent(symbol);

  const attempts = [

    // احتمالات API جست‌وجوی ره‌آورد
    `/api/v2/assets/search?q=${encoded}`,
    `/api/v2/asset/search?q=${encoded}`,
    `/api/v2/search/assets?q=${encoded}`,
    `/api/v2/search?q=${encoded}`,

    // احتمالات query parameter دیگر
    `/api/v2/assets?search=${encoded}`,
    `/api/v2/asset?search=${encoded}`,
    `/api/v2/assets?query=${encoded}`,
    `/api/v2/asset?query=${encoded}`

  ];

  for (const endpoint of attempts) {

    try {

      console.log("RAHAVARD SEARCH TRY:", endpoint);

      const response = await rahavard.get(endpoint);

      const payload = response.data;

      const candidates = [];

      if (Array.isArray(payload)) {
        candidates.push(...payload);
      }

      if (Array.isArray(payload?.data)) {
        candidates.push(...payload.data);
      }

      if (Array.isArray(payload?.data?.items)) {
        candidates.push(...payload.data.items);
      }

      if (Array.isArray(payload?.data?.assets)) {
        candidates.push(...payload.data.assets);
      }

      if (Array.isArray(payload?.results)) {
        candidates.push(...payload.results);
      }

      if (Array.isArray(payload?.data?.results)) {
        candidates.push(...payload.data.results);
      }

      for (const candidate of candidates) {

        const asset =
          candidate?.asset ||
          candidate;

        if (!asset) {
          continue;
        }

        if (!symbolMatches(symbol, asset)) {
          continue;
        }

        const id =
          asset?.id ??
          asset?.asset_id ??
          candidate?.id ??
          candidate?.asset_id;

        if (!id) {
          continue;
        }

        return {
          success: true,
          asset_id: String(id),
          asset
        };
      }

    } catch (error) {

      console.log(
        "RAHAVARD SEARCH FAILED:",
        endpoint,
        error.response?.status || error.message
      );

    }
  }

  return null;
}

// ============================================================
// SYMBOL -> ASSET
// ============================================================

app.get("/api/rahavard-symbol/:symbol", async (req, res) => {

  const symbol = normalizeText(
    decodeURIComponent(req.params.symbol || "")
  );

  if (!symbol) {
    return res.status(400).json({
      success: false,
      error: "نام نماد وارد نشده است"
    });
  }

  try {

    const result = await tryRahavardSearch(symbol);

    if (!result?.success) {

      return res.status(404).json({
        success: false,
        symbol,
        error:
          `نماد "${symbol}" در جست‌وجوی ره‌آورد پیدا نشد`
      });
    }

    // --------------------------------------------------------
    // VERY IMPORTANT VALIDATION
    // --------------------------------------------------------

    if (!symbolMatches(symbol, result.asset)) {

      return res.status(409).json({
        success: false,
        symbol,
        error:
          "نماد پیدا شد اما تطبیق دقیق انجام نشد؛ داده نمایش داده نمی‌شود."
      });
    }

    // --------------------------------------------------------
    // دریافت اطلاعات کامل Asset
    // --------------------------------------------------------

    const detail = await rahavard.get(
      `/api/v2/asset/${result.asset_id}`
    );

    const asset =
      extractAsset(detail.data) ||
      result.asset;

    // دوباره تطبیق می‌کنیم
    if (!symbolMatches(symbol, asset)) {

      return res.status(409).json({
        success: false,
        symbol,
        asset_id: result.asset_id,
        error:
          "اطلاعات نهایی با نماد درخواستی تطبیق ندارد."
      });
    }

    return res.json({
      success: true,
      symbol,
      asset_id: result.asset_id,
      asset,
      data: detail.data
    });

  } catch (error) {

    console.error(
      "RAHAVARD SYMBOL ERROR:",
      error.response?.status,
      error.message
    );

    return res.status(error.response?.status || 500).json({
      success: false,
      symbol,
      error: "دریافت اطلاعات نماد انجام نشد",
      http_status: error.response?.status || null
    });
  }
});

// ============================================================
// CODAL
// ============================================================

app.get("/api/codal/:symbol", async (req, res) => {

  const symbol = normalizeText(
    decodeURIComponent(req.params.symbol || "")
  );

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

    return res.json({
      success: true,
      symbol,
      data: response.data
    });

  } catch (error) {

    console.error(
      "CODAL ERROR:",
      error.response?.status,
      error.message
    );

    return res.status(error.response?.status || 500).json({
      success: false,
      symbol,
      error: "خطا در دریافت کدال",
      http_status: error.response?.status || null
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

    return res.json(response.data);

  } catch (error) {

    return res.status(500).json({
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

    return res.json(response.data);

  } catch (error) {

    return res.status(500).json({
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

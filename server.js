const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const rahavard = axios.create({
  baseURL: "https://rahavard365.com",
  timeout: 20000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    Referer: "https://rahavard365.com/",
    Origin: "https://rahavard365.com"
  }
});

// ============================================================
// CONFIG
// ============================================================

const SYMBOL_ALIASES = {
  "اهرم": {
    id: "18335",
    slug: "اهرم"
  }
};

// ============================================================
// HELPERS
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

function numberValue(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const n = Number(
    String(value)
      .replace(/,/g, "")
      .replace(/٬/g, "")
      .replace(/٫/g, ".")
      .trim()
  );

  return Number.isFinite(n) ? n : null;
}

function formatNumber(value) {
  const n = numberValue(value);

  if (n === null) return "—";

  return n.toLocaleString("en-US", {
    maximumFractionDigits: 2
  });
}

function formatSigned(value) {
  const n = numberValue(value);

  if (n === null) return "—";

  return (
    (n > 0 ? "+" : "") +
    n.toLocaleString("en-US", {
      maximumFractionDigits: 2
    })
  );
}

// ============================================================
// RAHAVARD PAGE
// ============================================================

async function getRahavardPage(id) {
  const response = await rahavard.get(`/asset/${id}/`);

  return response.data;
}

// ============================================================
// EXTRACT NEXT DATA
// ============================================================

function extractNextData(html) {
  if (!html) return null;

  const match = html.match(
    /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
  );

  if (!match) return null;

  try {
    return JSON.parse(match[1]);
  } catch (error) {
    console.error("NEXT_DATA parse error:", error.message);
    return null;
  }
}

// ============================================================
// FIND JSON OBJECT RECURSIVELY
// ============================================================

function findObjectsByKeys(root, requiredKeys) {
  const results = [];

  function walk(value) {
    if (!value || typeof value !== "object") {
      return;
    }

    if (!Array.isArray(value)) {
      const keys = Object.keys(value);

      const matched = requiredKeys.every((key) =>
        keys.some(
          (x) =>
            normalizeText(x).toLowerCase() ===
            normalizeText(key).toLowerCase()
        )
      );

      if (matched) {
        results.push(value);
      }
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item);
      }
    } else {
      for (const key of Object.keys(value)) {
        walk(value[key]);
      }
    }
  }

  walk(root);

  return results;
}

// ============================================================
// FIND VALUE RECURSIVELY
// ============================================================

function findValue(root, names) {
  let found = null;

  const wanted = names.map((x) =>
    normalizeText(x).toLowerCase()
  );

  function walk(value) {
    if (found !== null) return;

    if (!value || typeof value !== "object") {
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item);
        if (found !== null) return;
      }

      return;
    }

    for (const key of Object.keys(value)) {
      const normalizedKey =
        normalizeText(key).toLowerCase();

      if (wanted.includes(normalizedKey)) {
        const candidate = value[key];

        if (
          candidate !== null &&
          candidate !== undefined &&
          candidate !== ""
        ) {
          found = candidate;
          return;
        }
      }

      walk(value[key]);

      if (found !== null) return;
    }
  }

  walk(root);

  return found;
}

// ============================================================
// RESOLVE SYMBOL
// ============================================================

async function resolveSymbol(symbol) {
  const clean = normalizeText(symbol);

  // Known aliases first
  if (SYMBOL_ALIASES[clean]) {
    return {
      symbol: clean,
      asset_id: SYMBOL_ALIASES[clean].id,
      slug: SYMBOL_ALIASES[clean].slug,
      method: "alias"
    };
  }

  // Search engine / Rahavard page search
  //
  // We intentionally don't maintain a giant manual list.
  // For unknown symbols, try the Rahavard site search URL patterns.
  const encoded = encodeURIComponent(clean);

  const candidateUrls = [
    `https://rahavard365.com/search?q=${encoded}`,
    `https://rahavard365.com/search/${encoded}`,
    `https://rahavard365.com/asset/${encoded}/`
  ];

  for (const url of candidateUrls) {
    try {
      const response = await axios.get(url, {
        timeout: 15000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          Referer: "https://rahavard365.com/"
        }
      });

      const html = response.data;

      if (typeof html !== "string") continue;

      const idMatches = [
        ...html.matchAll(
          /\/asset\/(\d+)(?:\/([^"'<>\\s]+))?/gi
        )
      ];

      for (const match of idMatches) {
        const id = match[1];
        const slug = match[2] || "";

        const decodedSlug = decodeURIComponent(slug);

        if (
          normalizeText(decodedSlug) === clean ||
          decodedSlug.includes(clean)
        ) {
          return {
            symbol: clean,
            asset_id: id,
            slug: decodedSlug,
            method: "site-search"
          };
        }
      }
    } catch (error) {
      console.error(
        "Resolve attempt failed:",
        url,
        error.message
      );
    }
  }

  return null;
}

// ============================================================
// EXTRACT ASSET DATA
// ============================================================

function parseRahavardData(html) {
  const nextData = extractNextData(html);

  const source =
    nextData?.props?.pageProps ||
    nextData ||
    {};

  // ----------------------------------------------------------
  // Asset
  // ----------------------------------------------------------

  const assets = findObjectsByKeys(
    source,
    ["trade_symbol"]
  );

  const asset =
    assets[0] ||
    {};

  // ----------------------------------------------------------
  // Basic fields
  // ----------------------------------------------------------

  const symbol =
    asset.trade_symbol ||
    asset.symbol ||
    asset.short_name ||
    findValue(source, [
      "trade_symbol",
      "symbol",
      "short_symbol"
    ]);

  const name =
    asset.name ||
    asset.short_name ||
    findValue(source, [
      "name",
      "title",
      "asset_name"
    ]);

  const exchange =
    asset.exchange?.title ||
    findValue(source, [
      "exchange_title",
      "exchange"
    ]);

  const state =
    asset.instrument_state?.description ||
    asset.state?.title ||
    findValue(source, [
      "instrument_state",
      "state"
    ]);

  // ----------------------------------------------------------
  // Market data
  // ----------------------------------------------------------

  const last =
    findValue(source, [
      "last",
      "last_price",
      "current_price",
      "price",
      "pdr",
      "last_trade_price"
    ]);

  const close =
    findValue(source, [
      "close",
      "closing_price",
      "yesterday",
      "previous_close",
      "closing"
    ]);

  const open =
    findValue(source, [
      "open",
      "opening_price",
      "first_price"
    ]);

  const high =
    findValue(source, [
      "high",
      "highest",
      "high_price"
    ]);

  const low =
    findValue(source, [
      "low",
      "lowest",
      "low_price"
    ]);

  const change =
    findValue(source, [
      "change",
      "price_change"
    ]);

  const changePercent =
    findValue(source, [
      "change_percent",
      "changePercent",
      "percent_change",
      "percentage_change"
    ]);

  const volume =
    findValue(source, [
      "volume",
      "trade_volume",
      "total_volume"
    ]);

  const value =
    findValue(source, [
      "value",
      "trade_value",
      "total_value"
    ]);

  const trades =
    findValue(source, [
      "trades",
      "trade_count",
      "number_of_trades"
    ]);

  // ----------------------------------------------------------
  // Fundamentals
  // ----------------------------------------------------------

  const eps =
    findValue(source, [
      "eps"
    ]);

  const pe =
    findValue(source, [
      "pe",
      "p_e",
      "price_earnings"
    ]);

  const nav =
    findValue(source, [
      "nav",
      "net_asset_value"
    ]);

  // ----------------------------------------------------------
  // Derived change
  // ----------------------------------------------------------

  let finalChange = numberValue(change);

  let finalChangePercent =
    numberValue(changePercent);

  const finalLast =
    numberValue(last);

  const finalClose =
    numberValue(close);

  if (
    finalChange === null &&
    finalLast !== null &&
    finalClose !== null
  ) {
    finalChange =
      finalLast - finalClose;
  }

  if (
    finalChangePercent === null &&
    finalLast !== null &&
    finalClose !== null &&
    finalClose !== 0
  ) {
    finalChangePercent =
      ((finalLast - finalClose) /
        finalClose) *
      100;
  }

  return {
    symbol:
      symbol || null,

    name:
      name || null,

    exchange:
      exchange || null,

    state:
      state || null,

    market: {
      last: numberValue(last),
      close: numberValue(close),
      open: numberValue(open),
      high: numberValue(high),
      low: numberValue(low),

      change:
        finalChange,

      change_percent:
        finalChangePercent,

      volume:
        numberValue(volume),

      value:
        numberValue(value),

      trades:
        numberValue(trades)
    },

    fundamental: {
      eps:
        numberValue(eps),

      pe:
        numberValue(pe),

      nav:
        numberValue(nav)
    }
  };
}

// ============================================================
// RAHAVARD DIRECT
// ============================================================

app.get("/api/rahavard/:id", async (req, res) => {
  const id = req.params.id;

  try {
    const html =
      await getRahavardPage(id);

    const parsed =
      parseRahavardData(html);

    res.json({
      success: true,
      asset_id: id,
      data: parsed
    });

  } catch (error) {
    console.error(
      "RAHAVARD DIRECT ERROR:",
      error.response?.status,
      error.message
    );

    res.status(
      error.response?.status || 500
    ).json({
      success: false,
      asset_id: id,
      error:
        "دریافت اطلاعات نماد انجام نشد",
      details:
        error.message
    });
  }
});

// ============================================================
// RAHAVARD SYMBOL
// ============================================================

app.get(
  "/api/rahavard-symbol/:symbol",
  async (req, res) => {

    const symbol =
      normalizeText(
        decodeURIComponent(
          req.params.symbol
        )
      );

    try {

      const resolved =
        await resolveSymbol(symbol);

      if (!resolved) {

        return res.status(404).json({
          success: false,
          symbol,
          error:
            `نماد "${symbol}" در ره‌آورد پیدا نشد`
        });
      }

      const html =
        await getRahavardPage(
          resolved.asset_id
        );

      const data =
        parseRahavardData(html);

      res.json({
        success: true,
        symbol,
        asset_id:
          resolved.asset_id,
        data,
        resolver:
          resolved.method
      });

    } catch (error) {

      console.error(
        "RAHAVARD SYMBOL ERROR:",
        error.message
      );

      res.status(500).json({
        success: false,
        symbol,
        error:
          "دریافت اطلاعات نماد از ره‌آورد انجام نشد",
        details:
          error.message
      });
    }
  }
);

// ============================================================
// SYMBOL SEARCH / RESOLVE
// ============================================================

app.get(
  "/api/resolve/:symbol",
  async (req, res) => {

    const symbol =
      normalizeText(
        decodeURIComponent(
          req.params.symbol
        )
      );

    try {

      const result =
        await resolveSymbol(symbol);

      if (!result) {

        return res.status(404).json({
          success: false,
          symbol,
          error:
            "نماد پیدا نشد"
        });
      }

      res.json({
        success: true,
        result
      });

    } catch (error) {

      res.status(500).json({
        success: false,
        symbol,
        error:
          error.message
      });
    }
  }
);

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
      "/api/resolve/:symbol",
      "/api/codal/:symbol",
      "/api/fx",
      "/api/crypto",
      "/api/test"
    ]
  });

});

// ============================================================
// CODAL
// ============================================================

app.get(
  "/api/codal/:symbol",
  async (req, res) => {

    const symbol =
      normalizeText(
        decodeURIComponent(
          req.params.symbol
        )
      );

    try {

      const response =
        await axios.get(
          `https://search.codal.ir/api/search?v=1&q=${encodeURIComponent(symbol)}&t=true`,
          {
            timeout: 15000,
            headers: {
              "User-Agent":
                "Mozilla/5.0",
              Accept:
                "application/json,text/plain,*/*"
            }
          }
        );

      res.json({
        success: true,
        symbol,
        data:
          response.data
      });

    } catch (error) {

      console.error(
        "CODAL ERROR:",
        error.message
      );

      res.status(
        error.response?.status || 500
      ).json({
        success: false,
        symbol,
        error:
          "خطا در دریافت کدال"
      });
    }
  }
);

// ============================================================
// FX
// ============================================================

app.get(
  "/api/fx",
  async (req, res) => {

    try {

      const response =
        await axios.get(
          "https://api.boursyapi.com/v1/symbol/search?query=USD",
          {
            timeout: 15000
          }
        );

      res.json(
        response.data
      );

    } catch (error) {

      res.status(500).json({
        success: false,
        error:
          "خطا در دریافت ارز"
      });
    }
  }
);

// ============================================================
// CRYPTO
// ============================================================

app.get(
  "/api/crypto",
  async (req, res) => {

    try {

      const response =
        await axios.get(
          "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT",
          {
            timeout: 15000
          }
        );

      res.json(
        response.data
      );

    } catch (error) {

      res.status(500).json({
        success: false,
        error:
          "خطا در دریافت کریپتو"
      });
    }
  }
);

// ============================================================
// TEST
// ============================================================

app.get(
  "/api/test",
  (req, res) => {

    res.json({
      success: true,
      message:
        "Corevyn Proxy is working"
    });

  }
);

// ============================================================
// 404
// ============================================================

app.use(
  (req, res) => {

    res.status(404).json({
      success: false,
      error:
        "Endpoint not found",
      path:
        req.originalUrl
    });

  }
);

// ============================================================
// START
// ============================================================

app.listen(
  PORT,
  () => {
    console.log(
      `Corevyn Proxy running on port ${PORT}`
    );
  }
);

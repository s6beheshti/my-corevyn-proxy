const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// API برای دلار و ارز (Boursy API)
app.get('/api/fx', async (req, res) => {
  try {
    const response = await axios.get('https://api.boursyapi.com/v1/symbol/search?query=USD');
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: 'خطا در دریافت ارز' });
  }
});

// API برای بیت‌کوین (Binance)
app.get('/api/crypto', async (req, res) => {
  try {
    const response = await axios.get('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: 'خطا در دریافت کریپتو' });
  }
});

// API برای کدال
app.get('/api/codal/:symbol', async (req, res) => {
  const symbol = req.params.symbol;
  try {
    const response = await axios.get(`https://search.codal.ir/api/search?v=1&q=${symbol}&t=true`);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: 'خطا در دریافت کدال' });
  }
});

// API برای TSETMC (بورس)
app.get('/api/tse/:symbol', async (req, res) => {
  const symbol = req.params.symbol;
  try {
    const response = await axios.get(`https://cdn.tsetmc.com/api/Instrument/GetInstrumentSearch/${symbol}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: 'خطا در دریافت داده از بورس' });
  }
});

// تست ساده
app.get('/', (req, res) => {
  res.json({ status: 'Proxy Server is Online ✅' });
});

// پورت
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

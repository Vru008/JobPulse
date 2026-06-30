/* India Markets core — REAL data only (no AI-generated prices).
 *
 * Sources:
 *   - Yahoo Finance chart endpoint (no auth, public) for NIFTY 50, SENSEX,
 *     and top-15 NIFTY constituents by weight (used to compute gainers/losers).
 *   - Moneycontrol RSS for news headlines.
 *
 * Results cached in MongoDB collection "indiamarkets" for 5 minutes so we
 * don't hammer Yahoo on every page load.
 */
const { MongoClient } = require("mongodb");

const NIFTY_TOP_15 = [
  ["RELIANCE.NS", "Reliance Industries"],
  ["TCS.NS", "Tata Consultancy Services"],
  ["HDFCBANK.NS", "HDFC Bank"],
  ["INFY.NS", "Infosys"],
  ["ICICIBANK.NS", "ICICI Bank"],
  ["KOTAKBANK.NS", "Kotak Mahindra Bank"],
  ["HINDUNILVR.NS", "Hindustan Unilever"],
  ["ITC.NS", "ITC"],
  ["LT.NS", "Larsen & Toubro"],
  ["SBIN.NS", "State Bank of India"],
  ["AXISBANK.NS", "Axis Bank"],
  ["BHARTIARTL.NS", "Bharti Airtel"],
  ["BAJFINANCE.NS", "Bajaj Finance"],
  ["ASIANPAINT.NS", "Asian Paints"],
  ["MARUTI.NS", "Maruti Suzuki"],
];

const CACHE_MIN = 5;
const UA = "Mozilla/5.0 (compatible; JobPulse-IndiaMarkets/1.0)";

async function db() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw httpError(500, "MONGODB_URI is not set on the server.");
  if (!global._jpMongoPromise) {
    global._jpMongoPromise = new MongoClient(uri).connect();
  }
  return (await global._jpMongoPromise).db("jobpulse");
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function fetchYahooChart(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Yahoo ${symbol} ${res.status}`);
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) return null;
  const meta = result.meta;
  const closes = (result.indicators?.quote?.[0]?.close || []).filter((x) => x != null);
  const latest = meta.regularMarketPrice ?? closes[closes.length - 1];
  const prev = meta.chartPreviousClose ?? meta.previousClose ?? closes[closes.length - 2];
  if (latest == null || prev == null) return null;
  const change = latest - prev;
  const pct = (change / prev) * 100;
  return {
    symbol,
    price: Number(latest.toFixed(2)),
    prevClose: Number(prev.toFixed(2)),
    change: Number(change.toFixed(2)),
    pct: Number(pct.toFixed(2)),
    currency: meta.currency || "INR",
    marketState: meta.marketState || "",
  };
}

async function fetchIndices() {
  const [nifty, sensex] = await Promise.all([
    fetchYahooChart("^NSEI").catch(() => null),
    fetchYahooChart("^BSESN").catch(() => null),
  ]);
  const out = [];
  if (nifty) out.push({ ...nifty, name: "NIFTY 50" });
  if (sensex) out.push({ ...sensex, name: "SENSEX" });
  return out;
}

async function fetchTopMovers() {
  const results = await Promise.allSettled(
    NIFTY_TOP_15.map(([symbol, name]) =>
      fetchYahooChart(symbol).then((d) => (d ? { ...d, name } : null))
    )
  );
  const stocks = results
    .filter((r) => r.status === "fulfilled" && r.value && Number.isFinite(r.value.pct))
    .map((r) => r.value);
  if (!stocks.length) return { gainers: [], losers: [] };
  const sorted = [...stocks].sort((a, b) => b.pct - a.pct);
  return {
    gainers: sorted.slice(0, 3),
    losers: sorted.slice(-3).reverse(),
  };
}

// Minimal RSS parser — handles CDATA + plain text titles. We avoid pulling
// in a full xml2js dependency since this is a single fixed-shape feed.
function parseRss(xml, max) {
  const out = [];
  const itemRx = /<item>([\s\S]*?)<\/item>/g;
  const tag = (block, name) => {
    const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`));
    if (!m) return "";
    return m[1].replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, "$1").trim();
  };
  let m;
  while ((m = itemRx.exec(xml)) !== null && out.length < max) {
    const t = tag(m[1], "title");
    const link = tag(m[1], "link");
    const date = tag(m[1], "pubDate");
    if (t && link) out.push({ title: t, link, date });
  }
  return out;
}

async function fetchNews() {
  const feeds = [
    { url: "https://www.moneycontrol.com/rss/marketreports.xml", source: "Moneycontrol" },
    { url: "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms", source: "Economic Times" },
  ];
  const all = [];
  for (const feed of feeds) {
    try {
      const res = await fetch(feed.url, { headers: { "User-Agent": UA } });
      if (!res.ok) continue;
      const text = await res.text();
      const items = parseRss(text, 5);
      for (const it of items) all.push({ ...it, source: feed.source });
      if (all.length >= 10) break;
    } catch (_) { /* try next */ }
  }
  return all.slice(0, 5);
}

async function getCached() {
  try {
    const col = (await db()).collection("indiamarkets");
    const doc = await col.findOne({ _id: "latest" });
    if (!doc) return null;
    const age = Date.now() - new Date(doc.updatedAt).getTime();
    if (age > CACHE_MIN * 60000) return null;
    return doc.data;
  } catch (_) { return null; }
}

async function setCached(data) {
  try {
    const col = (await db()).collection("indiamarkets");
    await col.updateOne({ _id: "latest" }, { $set: { data, updatedAt: new Date() } }, { upsert: true });
  } catch (_) { /* non-fatal */ }
}

async function getMarkets(force) {
  if (!force) {
    const cached = await getCached();
    if (cached) return { ...cached, cached: true };
  }
  const [indices, movers, news] = await Promise.all([
    fetchIndices(),
    fetchTopMovers(),
    fetchNews(),
  ]);
  const data = {
    indices,
    gainers: movers.gainers,
    losers: movers.losers,
    news,
    fetchedAt: new Date().toISOString(),
    cached: false,
  };
  await setCached(data);
  return data;
}

module.exports = { getMarkets };

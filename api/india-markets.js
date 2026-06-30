/* Vercel serverless function — GET /api/india-markets
 * Returns real-time NIFTY/SENSEX + top gainers/losers + India business news.
 * No auth required — this is read-only public market data.
 * Use ?force=1 to bypass the 5-min cache.
 */
const { getMarkets } = require("../lib/india-markets-core");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).send("Method Not Allowed");
  try {
    const force = (req.query && req.query.force) === "1";
    const data = await getMarkets(force);
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    res.status(200).json(data);
  } catch (err) {
    res.status(err.status || 500).send(err.message || "Failed to fetch India markets.");
  }
};

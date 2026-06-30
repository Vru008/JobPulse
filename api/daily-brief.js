/* Vercel serverless function — GET /api/daily-brief
 * Returns today's curated 5-item Daily Brief. Cached for the calendar day.
 * Use ?force=1 to regenerate (counts against Gemini quota).
 */
const { getBrief } = require("../lib/daily-brief-core");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).send("Method Not Allowed");
  try {
    const force = (req.query && req.query.force) === "1";
    const data = await getBrief(force);
    res.setHeader("Cache-Control", "public, max-age=300");
    res.status(200).json(data);
  } catch (err) {
    res.status(err.status || 500).send(err.message || "Failed to load daily brief.");
  }
};

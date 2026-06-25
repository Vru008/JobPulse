/* Vercel serverless function — GET /api/jobs?q=...&limit=25
 * Returns deduped, ranked real job listings from free APIs.
 */
const { fetchJobs } = require("../lib/jobs-core");

module.exports = async function handler(req, res) {
  try {
    const q = (req.query && req.query.q) || "";
    const skills = (req.query && req.query.skills) || "";
    const seed = (req.query && req.query.seed) || "";
    const scope = (req.query && req.query.scope) === "global" ? "global" : "us";
    const limit = Math.min(parseInt((req.query && req.query.limit) || "25", 10) || 25, 50);
    const data = await fetchJobs({ q, skills, seed, scope, limit });
    // Edge-cache ~30 min so the feed stays fresh without hammering the sources.
    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=3600");
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ jobs: [], count: 0, error: err.message });
  }
};

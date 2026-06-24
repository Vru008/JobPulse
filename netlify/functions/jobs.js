/* Netlify Functions handler — GET /.netlify/functions/jobs?q=...&limit=25 */
const { fetchJobs } = require("../../lib/jobs-core");

exports.handler = async (event) => {
  try {
    const params = event.queryStringParameters || {};
    const q = params.q || "";
    const limit = Math.min(parseInt(params.limit || "25", 10) || 25, 50);
    const data = await fetchJobs({ q, limit });
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "s-maxage=1800, stale-while-revalidate=3600",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ jobs: [], count: 0, error: err.message }) };
  }
};

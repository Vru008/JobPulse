/* Netlify Functions handler — GET /.netlify/functions/india-markets */
const { getMarkets } = require("../../lib/india-markets-core");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return { statusCode: 405, body: "Method Not Allowed" };
  try {
    const force = (event.queryStringParameters && event.queryStringParameters.force) === "1";
    const data = await getMarkets(force);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return { statusCode: err.status || 500, body: err.message || "Failed to fetch India markets." };
  }
};

/* Netlify Functions handler — GET /.netlify/functions/daily-brief */
const { getBrief } = require("../../lib/daily-brief-core");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return { statusCode: 405, body: "Method Not Allowed" };
  try {
    const force = (event.queryStringParameters && event.queryStringParameters.force) === "1";
    const data = await getBrief(force);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return { statusCode: err.status || 500, body: err.message || "Failed to load daily brief." };
  }
};

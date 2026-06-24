/* Netlify Functions handler — POST /.netlify/functions/tailor
 *
 * Thin wrapper around the shared core so Netlify and Vercel stay in sync.
 * Set GEMINI_API_KEY in Netlify → Site settings → Environment variables.
 */
const { tailor, TailorError } = require("../../lib/tailor-core");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: CORS, body: "Method Not Allowed" };

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (_) {
    return { statusCode: 400, headers: CORS, body: "Invalid JSON body." };
  }

  try {
    const result = await tailor(payload);
    return {
      statusCode: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify(result),
    };
  } catch (err) {
    const status = err instanceof TailorError ? err.status : 500;
    return { statusCode: status, headers: CORS, body: err.message || "Request failed." };
  }
};

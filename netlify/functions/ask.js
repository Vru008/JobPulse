/* Netlify Functions handler — POST /.netlify/functions/ask */
const { ask, AskError } = require("../../lib/ask-core");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: CORS, body: "Method Not Allowed" };
  try {
    const payload = JSON.parse(event.body || "{}");
    const result = await ask(payload);
    return { statusCode: 200, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(result) };
  } catch (err) {
    const status = err instanceof AskError ? err.status : 500;
    return { statusCode: status, headers: CORS, body: err.message || "Request failed." };
  }
};

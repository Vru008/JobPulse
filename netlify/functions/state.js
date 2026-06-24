/* Netlify Functions handler — GET/POST /.netlify/functions/state */
const { getState, setState } = require("../../lib/state-core");

exports.handler = async (event) => {
  const token = (event.headers && (event.headers["x-jobpulse-pass"] || event.headers["X-Jobpulse-Pass"])) || "";
  try {
    if (event.httpMethod === "GET") {
      const data = await getState(token);
      return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data }) };
    }
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      await setState(token, body.data || {});
      return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true }) };
    }
    return { statusCode: 405, body: "Method Not Allowed" };
  } catch (err) {
    return { statusCode: err.status || 500, body: err.message || "Sync failed." };
  }
};

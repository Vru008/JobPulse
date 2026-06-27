/* Netlify Functions handler — GET/POST /.netlify/functions/jobwatch */
const { getWatch, setWatch } = require("../../lib/jobwatch-core");

exports.handler = async (event) => {
  const token = (event.headers && (event.headers["x-jobpulse-pass"] || event.headers["X-Jobpulse-Pass"])) || "";
  try {
    if (event.httpMethod === "GET") {
      const data = await getWatch(token);
      return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data }) };
    }
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const result = await setWatch(token, body);
      return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) };
    }
    return { statusCode: 405, body: "Method Not Allowed" };
  } catch (err) {
    return { statusCode: err.status || 500, body: err.message || "Watcher store failed." };
  }
};

/* Netlify Functions handler — GET/POST /.netlify/functions/glassdoorwatch */
const { getWatch, setWatch, markApplied, unmarkApplied, clearArchive } = require("../../lib/glassdoorwatch-core");

exports.handler = async (event) => {
  const token = (event.headers && (event.headers["x-jobpulse-pass"] || event.headers["X-Jobpulse-Pass"])) || "";
  try {
    if (event.httpMethod === "GET") {
      const data = await getWatch(token);
      return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data }) };
    }
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      let result;
      if (body.action === "markApplied") result = await markApplied(token, body.match);
      else if (body.action === "unmarkApplied") result = await unmarkApplied(token, body.match);
      else if (body.action === "clearArchive") result = await clearArchive(token);
      else result = await setWatch(token, body);
      return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) };
    }
    return { statusCode: 405, body: "Method Not Allowed" };
  } catch (err) {
    return { statusCode: err.status || 500, body: err.message || "Glassdoor watcher store failed." };
  }
};

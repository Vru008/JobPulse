/* Vercel serverless function — GET/POST /api/linkedinwatch
 * Architectural twin of /api/jobwatch but bound to the LinkedIn collection.
 */
const { getWatch, setWatch, markApplied, unmarkApplied } = require("../lib/linkedinwatch-core");

module.exports = async function handler(req, res) {
  const token = req.headers["x-jobpulse-pass"] || "";
  try {
    if (req.method === "GET") {
      const data = await getWatch(token);
      res.status(200).json({ data });
    } else if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") body = JSON.parse(body || "{}");
      body = body || {};
      let result;
      if (body.action === "markApplied") {
        result = await markApplied(token, body.match);
      } else if (body.action === "unmarkApplied") {
        result = await unmarkApplied(token, body.match);
      } else {
        result = await setWatch(token, body);
      }
      res.status(200).json(result);
    } else {
      res.status(405).send("Method Not Allowed");
    }
  } catch (err) {
    res.status(err.status || 500).send(err.message || "LinkedIn watcher store failed.");
  }
};

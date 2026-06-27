/* Vercel serverless function — GET/POST /api/jobwatch
 * GET  -> { data }  (latest watcher results, or null)
 * POST { matches:[...], lastSweep?, mode? } -> { ok:true, count }
 * Auth: header x-jobpulse-pass must equal env SYNC_PASSCODE.
 */
const { getWatch, setWatch } = require("../lib/jobwatch-core");

module.exports = async function handler(req, res) {
  const token = req.headers["x-jobpulse-pass"] || "";
  try {
    if (req.method === "GET") {
      const data = await getWatch(token);
      res.status(200).json({ data });
    } else if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") body = JSON.parse(body || "{}");
      const result = await setWatch(token, body || {});
      res.status(200).json(result);
    } else {
      res.status(405).send("Method Not Allowed");
    }
  } catch (err) {
    res.status(err.status || 500).send(err.message || "Watcher store failed.");
  }
};

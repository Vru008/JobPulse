/* Vercel serverless function — GET/POST /api/state
 * GET  -> { data }  (the user's synced state, or null)
 * POST { data } -> { ok: true }
 * Auth: header x-jobpulse-pass must equal env SYNC_PASSCODE.
 */
const { getState, setState } = require("../lib/state-core");

module.exports = async function handler(req, res) {
  const token = req.headers["x-jobpulse-pass"] || "";
  try {
    if (req.method === "GET") {
      const data = await getState(token);
      res.status(200).json({ data });
    } else if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") body = JSON.parse(body || "{}");
      await setState(token, (body && body.data) || {});
      res.status(200).json({ ok: true });
    } else {
      res.status(405).send("Method Not Allowed");
    }
  } catch (err) {
    res.status(err.status || 500).send(err.message || "Sync failed.");
  }
};

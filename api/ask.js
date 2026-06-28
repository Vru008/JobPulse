/* Vercel serverless function — POST /api/ask
 *
 * Body:  { profile, question, history? }   ->   { answer, model }
 * Set GEMINI_API_KEY in Vercel → Project → Settings → Environment Variables.
 */
const { ask, AskError } = require("../lib/ask-core");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  let payload = req.body;
  if (typeof payload === "string") {
    try { payload = JSON.parse(payload || "{}"); }
    catch (_) { res.status(400).send("Invalid JSON body."); return; }
  }

  try {
    const result = await ask(payload || {});
    res.status(200).json(result);
  } catch (err) {
    const status = err instanceof AskError ? err.status : 500;
    res.status(status).send(err.message || "Request failed.");
  }
};

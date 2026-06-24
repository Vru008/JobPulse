/* Vercel serverless function — POST /api/tailor
 *
 * Body: { resume, company, jobDescription }  ->  { resume, coverLetter }
 * Set GEMINI_API_KEY in Vercel → Project → Settings → Environment Variables.
 */
const { tailor, TailorError } = require("../lib/tailor-core");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  // Vercel parses JSON bodies automatically; fall back if it's a raw string.
  let payload = req.body;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload || "{}");
    } catch (_) {
      res.status(400).send("Invalid JSON body.");
      return;
    }
  }

  try {
    const result = await tailor(payload || {});
    res.status(200).json(result);
  } catch (err) {
    const status = err instanceof TailorError ? err.status : 500;
    res.status(status).send(err.message || "Request failed.");
  }
};

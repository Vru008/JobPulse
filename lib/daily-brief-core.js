/* Daily Brief core — ONE Gemini call per calendar day, cached in MongoDB.
 *
 * Generates 5 curated items for today:
 *   1. Indian startup idea (theme rotates by day-of-week)
 *   2. Notable frontend/React change in the last few weeks
 *   3. Read-of-the-day (one longread suggestion)
 *   4. One real quote (verifiable attribution)
 *   5. One life lesson with reasoning
 *
 * Cached per-day in collection "dailybrief" so we burn at most one Gemini
 * call per 24h. Falls back to gemini-2.0-flash if the default model is rate-
 * limited.
 */
const { MongoClient } = require("mongodb");

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const MODELS = [MODEL, "gemini-2.5-flash-lite", "gemini-2.0-flash"]
  .filter((m, i, a) => a.indexOf(m) === i);

const DAY_THEMES = [
  "B2B SaaS",       // Sun
  "Fintech",        // Mon
  "D2C Consumer",   // Tue
  "Devtools",       // Wed
  "Health-tech",    // Thu
  "Edtech",         // Fri
  "Climate-tech",   // Sat
];

async function db() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw httpError(500, "MONGODB_URI is not set on the server.");
  if (!global._jpMongoPromise) {
    global._jpMongoPromise = new MongoClient(uri).connect();
  }
  return (await global._jpMongoPromise).db("jobpulse");
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function buildPrompt() {
  const theme = DAY_THEMES[new Date().getUTCDay()];
  return `You are a daily-brief curator for Vruttant Patoliya — an Indian-origin
software engineer (React.js frontend, 2+ years), based in Jersey City NJ,
pursuing MS in Information Technology, interested in Indian investment markets.

Generate EXACTLY ONE item in each of these five categories. Be specific,
factual where applicable, never fabricate names/dates/quotes.

1. "startup_idea" — One concrete startup idea for the INDIAN market in the
   ${theme} space. Fields: title, problem, target_user, why_now, mvp.
   Specific India context (UPI, GST, monsoon, MSMEs, etc. where relevant).

2. "frontend_change" — One genuine recent change in the frontend/React
   ecosystem in the last ~30 days (a release, deprecation, RFC, common
   gotcha). Fields: title, what, why_it_matters, source_hint.

3. "read_of_day" — One substantive longread suggestion. Fields: title,
   summary (3 lines), topic, approx_time_min.

4. "quote" — One real quote from a known person with VERIFIABLE attribution.
   Fields: quote, author, context. NEVER fabricate authors or twist quotes.

5. "life_lesson" — One practical life lesson + the reasoning behind it.
   Fields: lesson, reasoning, applies_to.

Output STRICT JSON: an object with keys startup_idea, frontend_change,
read_of_day, quote, life_lesson. Plain text inside fields (no markdown).
No preamble, no trailing commentary.`;
}

async function callGemini() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw httpError(500, "GEMINI_API_KEY is not set on the server.");
  const body = {
    contents: [{ role: "user", parts: [{ text: buildPrompt() }] }],
    generationConfig: { temperature: 0.7, responseMimeType: "application/json" },
  };
  let lastError = "";
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
        );
        if (res.ok) {
          const data = await res.json();
          const txt = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
          return JSON.parse(txt);
        }
        lastError = `${res.status} ${(await res.text()).slice(0, 160)}`;
        if (res.status === 503 || res.status === 429) {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        break;
      } catch (err) {
        lastError = err.message || String(err);
      }
    }
  }
  throw httpError(502, `Gemini unavailable: ${lastError}`);
}

async function getBrief(force) {
  const key = todayKey();
  const col = (await db()).collection("dailybrief");
  if (!force) {
    const cached = await col.findOne({ _id: key });
    if (cached && cached.data) return { ...cached.data, date: key, cached: true };
  }
  const data = await callGemini();
  await col.updateOne(
    { _id: key },
    { $set: { data, updatedAt: new Date() } },
    { upsert: true }
  );
  return { ...data, date: key, cached: false };
}

module.exports = { getBrief };

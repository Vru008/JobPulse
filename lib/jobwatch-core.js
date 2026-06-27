/* Indeed job-watcher results store (MongoDB Atlas).
 *
 * Populated by Vruttant's scheduled Indeed job-watcher (POST, 3x/day) and read by
 * the JobPulse dashboard "Indeed Watcher" tab (GET) — so fresh matches are visible
 * on the phone without the laptop.
 *
 * Stored as ONE document { _id: "latest" } in collection "jobwatch".
 * Auth: x-jobpulse-pass header must equal env SYNC_PASSCODE (same shared secret as state).
 *
 * Env vars (already set for cross-device sync — reused here, nothing new needed):
 *   MONGODB_URI    - Atlas connection string
 *   SYNC_PASSCODE  - must equal the app login passcode
 */
const { MongoClient } = require("mongodb");

// Reuse the same warm connection as state-core across serverless invocations.
async function db() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw httpError(500, "MONGODB_URI is not set on the server.");
  if (!global._jpMongoPromise) {
    global._jpMongoPromise = new MongoClient(uri).connect();
  }
  const client = await global._jpMongoPromise;
  return client.db("jobpulse");
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function checkAuth(token) {
  const expected = process.env.SYNC_PASSCODE;
  if (!expected) throw httpError(500, "SYNC_PASSCODE is not set on the server.");
  if (!token || token !== expected) throw httpError(401, "Unauthorized.");
}

const MAX_MATCHES = 60;

// Stable identity for a posting — the Indeed connector reassigns numeric ids every
// search, so dedupe on company|role|location instead.
function keyOf(m) {
  return ["company", "role", "location"]
    .map((k) => String((m && m[k]) || "").trim().toLowerCase())
    .join("|");
}

async function getWatch(token) {
  checkAuth(token);
  const doc = await (await db()).collection("jobwatch").findOne({ _id: "latest" });
  return doc ? doc.data : null;
}

/* POST body:
 *   { matches: [{ company, role, location, url, fit, note, postedOn }], lastSweep?, mode? }
 * mode "replace" overwrites; default merges new matches ahead of existing (deduped, capped).
 */
async function setWatch(token, body) {
  checkAuth(token);
  const col = (await db()).collection("jobwatch");
  const now = new Date().toISOString();
  const incoming = Array.isArray(body && body.matches) ? body.matches : [];
  const stamped = incoming.map((m) => ({ ...m, firstSeen: m.firstSeen || now }));
  const lastSweep = (body && body.lastSweep) || now;

  let matches = stamped;
  if (!body || body.mode !== "replace") {
    const existing = ((await col.findOne({ _id: "latest" })) || {}).data;
    const prior = (existing && existing.matches) || [];
    const seen = new Set(stamped.map(keyOf));
    matches = [...stamped, ...prior.filter((m) => !seen.has(keyOf(m)))];
  }
  matches = matches.slice(0, MAX_MATCHES);

  const data = { lastSweep, count: matches.length, matches };
  await col.updateOne(
    { _id: "latest" },
    { $set: { data, updatedAt: new Date() } },
    { upsert: true }
  );
  return { ok: true, count: matches.length };
}

module.exports = { getWatch, setWatch };

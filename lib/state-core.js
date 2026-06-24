/* Cross-device sync store (MongoDB Atlas).
 *
 * Holds ONE document with the user's saved/applied/hidden jobs + profile, so the
 * same login sees the same tracker on laptop and phone.
 *
 * Env vars (set in Vercel / Netlify):
 *   MONGODB_URI    - your Atlas connection string
 *   SYNC_PASSCODE  - must equal the app login passcode (simple shared-secret auth)
 *
 * Falls back silently to local-only on the client if these are not set.
 */
const { MongoClient } = require("mongodb");

// Reuse the connection across warm serverless invocations.
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

async function getState(token) {
  checkAuth(token);
  const doc = await (await db()).collection("state").findOne({ _id: "user" });
  return doc ? doc.data : null;
}

async function setState(token, data) {
  checkAuth(token);
  await (await db()).collection("state").updateOne(
    { _id: "user" },
    { $set: { data: data || {}, updatedAt: new Date() } },
    { upsert: true }
  );
  return { ok: true };
}

module.exports = { getState, setState };

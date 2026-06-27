/* Indeed job-watcher results store (MongoDB Atlas).
 *
 * Two buckets:
 *   current — the latest sweep's fresh matches (cap CURRENT_MAX = 5)
 *   archive — everything previously surfaced, newest first (cap ARCHIVE_MAX = 200)
 *
 * On each POST from the scheduled task:
 *   1. Drop any incoming match whose stable key is already in current OR archive.
 *   2. Push the existing current to the front of archive (so old picks stay applyable).
 *   3. Set current to the deduped incoming matches, sliced to CURRENT_MAX.
 *
 * Stable key = company|role|location (lowercased, trimmed). The Indeed connector
 * reassigns numeric ids on every search, so we cannot dedupe on them.
 *
 * Auth: x-jobpulse-pass header must equal env SYNC_PASSCODE.
 * Env (reused from cross-device sync — nothing new to set):
 *   MONGODB_URI, SYNC_PASSCODE
 */
const { MongoClient } = require("mongodb");

const CURRENT_MAX = 5;
const ARCHIVE_MAX = 200;

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

function keyOf(m) {
  return ["company", "role", "location"]
    .map((k) => String((m && m[k]) || "").trim().toLowerCase())
    .join("|");
}

// Normalize what GET returns: old single-bucket docs become {current, archive}.
function normalize(raw) {
  if (!raw) return { lastSweep: null, current: [], archive: [] };
  if (Array.isArray(raw.current) || Array.isArray(raw.archive)) {
    return {
      lastSweep: raw.lastSweep || null,
      current: Array.isArray(raw.current) ? raw.current : [],
      archive: Array.isArray(raw.archive) ? raw.archive : [],
    };
  }
  // Legacy shape: { matches: [...] } — treat the whole thing as archive.
  if (Array.isArray(raw.matches)) {
    return { lastSweep: raw.lastSweep || null, current: [], archive: raw.matches };
  }
  return { lastSweep: null, current: [], archive: [] };
}

async function getWatch(token) {
  checkAuth(token);
  const doc = await (await db()).collection("jobwatch").findOne({ _id: "latest" });
  const data = normalize(doc && doc.data);
  // Expose seen keys so the scheduled task can ask "what have you already shown?"
  // and select genuinely fresh roles before POSTing.
  data.seenKeys = [...data.current, ...data.archive].map(keyOf);
  data.count = data.current.length + data.archive.length;
  return data;
}

/* POST body:
 *   { matches: [...], lastSweep?, mode? }
 *   mode "replace" overwrites both buckets from scratch (used for seeding).
 *   omit mode (default) for the rotation flow above.
 */
async function setWatch(token, body) {
  checkAuth(token);
  const col = (await db()).collection("jobwatch");
  const now = new Date().toISOString();
  const incoming = Array.isArray(body && body.matches) ? body.matches : [];
  const stamped = incoming.map((m) => ({ ...m, firstSeen: m.firstSeen || now }));
  const lastSweep = (body && body.lastSweep) || now;

  let data;
  if (body && body.mode === "replace") {
    data = {
      lastSweep,
      current: stamped.slice(0, CURRENT_MAX),
      archive: stamped.slice(CURRENT_MAX, CURRENT_MAX + ARCHIVE_MAX),
    };
  } else {
    const existing = normalize(((await col.findOne({ _id: "latest" })) || {}).data);
    const seen = new Set([...existing.current, ...existing.archive].map(keyOf));

    // Only keep incoming matches we haven't surfaced before.
    const fresh = [];
    const freshSet = new Set();
    for (const m of stamped) {
      const k = keyOf(m);
      if (seen.has(k) || freshSet.has(k)) continue;
      freshSet.add(k);
      fresh.push(m);
    }

    // Old current goes to the front of archive; dedupe and cap.
    const archiveSeen = new Set();
    const nextArchive = [];
    for (const m of [...existing.current, ...existing.archive]) {
      const k = keyOf(m);
      if (archiveSeen.has(k)) continue;
      archiveSeen.add(k);
      nextArchive.push(m);
      if (nextArchive.length >= ARCHIVE_MAX) break;
    }

    data = {
      lastSweep,
      current: fresh.slice(0, CURRENT_MAX),
      archive: nextArchive,
    };
  }

  await col.updateOne(
    { _id: "latest" },
    { $set: { data, updatedAt: new Date() } },
    { upsert: true }
  );
  return {
    ok: true,
    currentCount: data.current.length,
    archiveCount: data.archive.length,
  };
}

module.exports = { getWatch, setWatch, CURRENT_MAX, ARCHIVE_MAX };

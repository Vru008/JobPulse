/* Glassdoor job-watcher results store (MongoDB Atlas).
 *
 * Architectural twin of lib/linkedinwatch-core.js, bound to its own collection
 * ("glassdoorwatch") so Indeed / LinkedIn / Glassdoor watchers stay independent.
 * Data path: a Vercel cron calls JSearch (Google for Jobs) and keeps only roles
 * whose publisher is Glassdoor before POSTing here.
 *
 * Auth: x-jobpulse-pass header must equal env SYNC_PASSCODE.
 * Env (reused): MONGODB_URI, SYNC_PASSCODE.
 */
const { MongoClient } = require("mongodb");

const CURRENT_MAX = 5;
const ARCHIVE_MAX = 200;
const APPLIED_MAX = 500;
const COLLECTION = "glassdoorwatch";

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

function normalize(raw) {
  if (!raw) return { lastSweep: null, current: [], archive: [], applied: [] };
  if (Array.isArray(raw.current) || Array.isArray(raw.archive) || Array.isArray(raw.applied)) {
    return {
      lastSweep: raw.lastSweep || null,
      current: Array.isArray(raw.current) ? raw.current : [],
      archive: Array.isArray(raw.archive) ? raw.archive : [],
      applied: Array.isArray(raw.applied) ? raw.applied : [],
    };
  }
  if (Array.isArray(raw.matches)) {
    return { lastSweep: raw.lastSweep || null, current: [], archive: raw.matches, applied: [] };
  }
  return { lastSweep: null, current: [], archive: [], applied: [] };
}

async function getWatch(token) {
  checkAuth(token);
  const doc = await (await db()).collection(COLLECTION).findOne({ _id: "latest" });
  const data = normalize(doc && doc.data);
  data.seenKeys = [...data.current, ...data.archive, ...data.applied].map(keyOf);
  data.count = data.current.length + data.archive.length + data.applied.length;
  return data;
}

async function setWatch(token, body) {
  checkAuth(token);
  const col = (await db()).collection(COLLECTION);
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
      applied: [],
    };
  } else {
    const existing = normalize(((await col.findOne({ _id: "latest" })) || {}).data);
    const seen = new Set([...existing.current, ...existing.applied].map(keyOf));

    const fresh = [];
    const freshSet = new Set();
    for (const m of stamped) {
      const k = keyOf(m);
      if (seen.has(k) || freshSet.has(k)) continue;
      freshSet.add(k);
      fresh.push(m);
    }

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
      applied: existing.applied,
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
    appliedCount: data.applied.length,
  };
}

async function markApplied(token, match) {
  checkAuth(token);
  if (!match || !match.company || !match.role) {
    throw httpError(400, "match.company and match.role are required.");
  }
  const col = (await db()).collection(COLLECTION);
  const existing = normalize(((await col.findOne({ _id: "latest" })) || {}).data);
  const targetKey = keyOf(match);
  const now = new Date().toISOString();

  const found =
    existing.current.find((m) => keyOf(m) === targetKey) ||
    existing.archive.find((m) => keyOf(m) === targetKey) ||
    existing.applied.find((m) => keyOf(m) === targetKey) ||
    match;
  const applied = { ...found, appliedAt: now };

  const stripped = (list) => list.filter((m) => keyOf(m) !== targetKey);
  const data = {
    lastSweep: existing.lastSweep,
    current: stripped(existing.current),
    archive: stripped(existing.archive),
    applied: [applied, ...stripped(existing.applied)].slice(0, APPLIED_MAX),
  };
  await col.updateOne({ _id: "latest" }, { $set: { data, updatedAt: new Date() } }, { upsert: true });
  return {
    ok: true,
    currentCount: data.current.length,
    archiveCount: data.archive.length,
    appliedCount: data.applied.length,
  };
}

async function unmarkApplied(token, match) {
  checkAuth(token);
  if (!match || !match.company || !match.role) {
    throw httpError(400, "match.company and match.role are required.");
  }
  const col = (await db()).collection(COLLECTION);
  const existing = normalize(((await col.findOne({ _id: "latest" })) || {}).data);
  const targetKey = keyOf(match);
  const found = existing.applied.find((m) => keyOf(m) === targetKey);
  if (!found) {
    return { ok: true, noop: true, appliedCount: existing.applied.length };
  }
  const { appliedAt, ...rest } = found;
  const data = {
    lastSweep: existing.lastSweep,
    current: existing.current,
    archive: [rest, ...existing.archive].slice(0, ARCHIVE_MAX),
    applied: existing.applied.filter((m) => keyOf(m) !== targetKey),
  };
  await col.updateOne({ _id: "latest" }, { $set: { data, updatedAt: new Date() } }, { upsert: true });
  return {
    ok: true,
    currentCount: data.current.length,
    archiveCount: data.archive.length,
    appliedCount: data.applied.length,
  };
}

async function clearArchive(token) {
  checkAuth(token);
  const col = (await db()).collection(COLLECTION);
  const existing = normalize(((await col.findOne({ _id: "latest" })) || {}).data);
  const data = {
    lastSweep: existing.lastSweep,
    current: existing.current,
    archive: [],
    applied: existing.applied,
  };
  await col.updateOne({ _id: "latest" }, { $set: { data, updatedAt: new Date() } }, { upsert: true });
  return {
    ok: true,
    currentCount: data.current.length,
    archiveCount: 0,
    appliedCount: data.applied.length,
  };
}

module.exports = {
  getWatch, setWatch, markApplied, unmarkApplied, clearArchive,
  CURRENT_MAX, ARCHIVE_MAX, APPLIED_MAX,
};

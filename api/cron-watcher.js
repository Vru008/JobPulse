/* Vercel serverless function — POST /api/cron-watcher
 *
 * Fires automatically from a free GitHub Actions cron (8 AM / 1 PM / 6 PM ET),
 * so the Indeed Watcher tab keeps getting fresh roles even when the user's
 * laptop / Claude Code app is closed.
 *
 * Auth: header x-cron-secret must equal env CRON_SECRET.
 *
 * What it does on each run:
 *   1. Read seenKeys (current + archive) from the watcher store.
 *   2. Call the existing aggregator (lib/jobs-core.fetchJobs) for the user's
 *      profile — Greenhouse/Lever/Ashby company boards + Remotive/Arbeitnow/
 *      RemoteOK + JSearch (when JSEARCH_API_KEY is set).
 *   3. Drop anything already in seenKeys, exclude noise (covered upstream).
 *   4. Pick the top 5 brand-new roles (best fit + freshness) — rotates them
 *      into "current", pushes prior "current" to "archive".
 *   5. Templated note per role — the user can hit "Tailor résumé" on the card
 *      for a real AI-tailored cover letter.
 */
const { fetchJobs } = require("../lib/jobs-core");
const { setWatch, getWatch } = require("../lib/jobwatch-core");

// Vruttant's profile — drives keyword matching + exclusion in fetchJobs.
const PROFILE = {
  q: "Frontend Developer, React Developer, Full Stack Developer, UI Developer, Web Developer, Software Engineer",
  skills: "React, JavaScript, TypeScript, HTML, CSS, Bootstrap, Node.js, REST APIs, Axios, Git",
  scope: "us",
  experience: "Junior to mid level",
  sponsorship: "On F-1 OPT (authorized now), needs future H-1B sponsorship",
};

function keyOf(m) {
  return ["company", "role", "location"]
    .map((k) => String((m && m[k]) || "").trim().toLowerCase())
    .join("|");
}

function draftNote(job) {
  const co = job.company || "the team";
  const t = job.title || "the role";
  return (
    `Hi ${co} team — I'd like to apply for your ${t} position. ` +
    `I bring 2+ years of React.js front-end engineering in JavaScript/HTML5/CSS3 with REST/Axios integration, ` +
    `reusable component architecture, and a track record of shipping responsive UI in collaborative teams. ` +
    `Based in Jersey City, NJ. I'd love to share my portfolio (JobMate, HealthKeeper) — thanks for considering me.`
  );
}

module.exports = async function handler(req, res) {
  // Vercel CRON sends GET by default. Accept either GET or POST.
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const expected = process.env.CRON_SECRET;
  const provided = req.headers["x-cron-secret"] || req.headers["authorization"] || "";
  if (!expected) return res.status(500).send("CRON_SECRET not set on the server.");
  const ok =
    provided === expected ||
    provided === `Bearer ${expected}`;
  if (!ok) return res.status(401).send("Unauthorized.");

  const syncToken = process.env.SYNC_PASSCODE;
  if (!syncToken) return res.status(500).send("SYNC_PASSCODE not set on the server.");

  try {
    // 1. seenKeys from the store
    const watchData = await getWatch(syncToken);
    const seen = new Set((watchData && watchData.seenKeys) || []);

    // 2. aggregator
    const seed = new Date().toISOString().slice(0, 10); // daily seed for rotation
    const feed = await fetchJobs({ ...PROFILE, seed, limit: 50 });
    const candidates = (feed && feed.jobs) || [];

    // 3. dedupe + map to watcher shape
    const fresh = [];
    const usedKeys = new Set();
    for (const job of candidates) {
      const match = {
        company: job.company || "",
        role: job.title || "",
        location: job.location || "",
        url: job.url,
        fit: job.summary
          ? job.summary.slice(0, 140)
          : `${job.mode || ""}${job.salary ? " · " + job.salary : ""}`.trim(),
        postedOn: job.posted || "",
        note: draftNote(job),
      };
      if (!match.url || !match.company || !match.role) continue;
      const k = keyOf(match);
      if (seen.has(k) || usedKeys.has(k)) continue;
      usedKeys.add(k);
      fresh.push(match);
      if (fresh.length >= 5) break;
    }

    // 4. publish — server-side setWatch rotates old current → archive automatically
    const result = await setWatch(syncToken, {
      matches: fresh,
      lastSweep: new Date().toISOString(),
    });

    res.status(200).json({
      ok: true,
      published: fresh.length,
      candidatePool: candidates.length,
      seenBefore: seen.size,
      currentCount: result.currentCount,
      archiveCount: result.archiveCount,
    });
  } catch (err) {
    res.status(err.status || 500).send(err.message || "cron-watcher failed.");
  }
};

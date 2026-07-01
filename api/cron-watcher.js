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

// Rotate the FIRST keyword by day-of-week so JSearch (which only uses the
// leading term) returns a different slice of Google-for-Jobs each day,
// stretching the daily pool of fresh roles past the free-tier ceiling.
function getDailyQuery() {
  const rotations = [
    "Frontend Developer, React Developer, JavaScript Developer, Web Developer, UI Developer, Software Engineer",      // Sun
    "React Developer, Frontend Engineer, Full Stack Developer, UI Developer, Web Developer, Software Engineer",       // Mon
    "Full Stack Developer, Software Engineer, Web Developer, JavaScript Developer, Frontend Developer, UI Engineer",  // Tue
    "Junior Software Engineer, Associate Software Engineer, Frontend Developer, React Developer, Web Developer",      // Wed
    "UI Developer, UX Engineer, Frontend Engineer, React Developer, Web Developer, Software Engineer",                // Thu
    "Web Developer, Frontend Developer, JavaScript Developer, React Developer, Full Stack Developer, Software Engineer", // Fri
    "Software Engineer, Software Developer, Frontend Engineer, Full Stack Developer, React Developer, UI Developer",  // Sat
  ];
  return rotations[new Date().getUTCDay()];
}

// Loosened from the strict "Junior to mid level" — fetchJobs was returning
// only ~24 qualifying candidates which became 0 fresh after dedupe. Letting
// the aggregator return a wider band (entry through mid) ~triples the pool.
// The cron still filters senior-and-up via title keywords below.
const PROFILE = {
  skills: "React, JavaScript, TypeScript, HTML, CSS, Bootstrap, Node.js, REST APIs, Axios, Git",
  scope: "us",
  experience: "Entry to mid level",
  sponsorship: "On F-1 OPT (authorized now), needs future H-1B sponsorship",
};

// Hard-skip clearly senior roles by title.
function isSenior(title) {
  const t = String(title || "").toLowerCase();
  return /\b(senior|sr\.?|staff|principal|lead|architect|manager|head of|director|vp\b|iv\b|level (4|5|6))\b/.test(t);
}

function keyOf(m) {
  return ["company", "role", "location"]
    .map((k) => String((m && m[k]) || "").trim().toLowerCase())
    .join("|");
}

// Hard US/remote-US filter — the aggregator's scope:"us" still leaks remote-global
// listings whose location string is "USA"/"LATAM"/etc. We only want roles a person
// in Jersey City could realistically apply to.
const US_STATE_TOKENS = new Set([
  "al","ak","az","ar","ca","co","ct","de","fl","ga","hi","id","il","in","ia","ks","ky","la","me","md","ma","mi","mn","ms","mo","mt","ne","nv","nh","nj","nm","ny","nc","nd","oh","ok","or","pa","ri","sc","sd","tn","tx","ut","vt","va","wa","wv","wi","wy","dc",
]);
const US_STATE_NAMES = [
  "alabama","alaska","arizona","arkansas","california","colorado","connecticut","delaware","florida","georgia","hawaii","idaho","illinois","indiana","iowa","kansas","kentucky","louisiana","maine","maryland","massachusetts","michigan","minnesota","mississippi","missouri","montana","nebraska","nevada","new hampshire","new jersey","new mexico","new york","north carolina","north dakota","ohio","oklahoma","oregon","pennsylvania","rhode island","south carolina","south dakota","tennessee","texas","utah","vermont","virginia","washington","west virginia","wisconsin","wyoming","district of columbia",
];
const US_PHRASES = ["united states","usa","u.s.","u.s","us only","us-based","us based","(us)","remote us","remote, us","remote-us","anywhere in the us"];
const NON_US_TOKENS = ["latam","latin america","emea","apac","europe","asia","africa","oceania","canada","canadian","mexico","brazil","argentina","peru","colombia","chile","uk","united kingdom","england","scotland","ireland","germany","france","spain","portugal","italy","netherlands","poland","romania","serbia","ukraine","turkey","india","pakistan","china","japan","korea","singapore","philippines","vietnam","indonesia","australia","new zealand","south africa","nigeria","kenya","egypt","israel","uae","dubai"];

function isUsLocation(loc) {
  if (!loc) return false;
  const s = String(loc).toLowerCase().trim();
  if (!s) return false;
  for (const bad of NON_US_TOKENS) {
    if (s.includes(bad)) return false;
  }
  if (s === "remote") return true;
  for (const ph of US_PHRASES) {
    if (s.includes(ph)) return true;
  }
  for (const name of US_STATE_NAMES) {
    if (s.includes(name)) return true;
  }
  // Last: tokenize on non-alpha chars and look for a state abbrev or bare "us".
  for (const tok of s.split(/[^a-z]+/)) {
    if (US_STATE_TOKENS.has(tok) || tok === "us") return true;
  }
  return false;
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
    // 1. Build dedupe set — block only current + applied. Archive is allowed
    //    to resurface because with such a small qualifying-role pool, blocking
    //    skipped-and-archived roles forever guarantees 0 fresh after a few
    //    sweeps. The user can still see "this was archived" via the Archive
    //    tab and skip it again in 2 seconds.
    const watchData = await getWatch(syncToken);
    const seen = new Set([
      ...((watchData && watchData.current) || []),
      ...((watchData && watchData.applied) || []),
    ].map((m) => ["company", "role", "location"]
      .map((k) => String((m && m[k]) || "").trim().toLowerCase())
      .join("|")));

    // 2. aggregator — broader pool + daily-rotated query so dedupe has more
    //    raw material when the user has marked many applied/archived.
    //    Hour-granular seed ("2026-07-01T12") so the 8am/1pm/6pm sweeps each
    //    rotate to a different slice of the 300+ company boards.
    const seed = new Date().toISOString().slice(0, 13);
    const feed = await fetchJobs({ ...PROFILE, q: getDailyQuery(), seed, limit: 120 });
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
      if (isSenior(match.role)) continue;
      if (!isUsLocation(match.location)) continue;
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

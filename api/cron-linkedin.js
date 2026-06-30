/* Vercel serverless function — POST /api/cron-linkedin
 *
 * Fires automatically from GitHub Actions (8 AM / 1 PM / 6 PM ET) so the
 * LinkedIn Watcher tab keeps getting fresh LinkedIn-sourced roles without
 * any laptop dependency.
 *
 * LinkedIn doesn't have a public job-listing API, so this uses the existing
 * JSearch (Google for Jobs) pipeline and keeps only the roles whose publisher
 * is LinkedIn — that subset of LinkedIn that Google indexes. Not 100% of
 * LinkedIn, but no scraping, no ToS issues, no extra paid keys.
 *
 * Auth: header x-cron-secret must equal env CRON_SECRET (same as cron-watcher).
 */
const { fetchJobs } = require("../lib/jobs-core");
const { setWatch, getWatch } = require("../lib/linkedinwatch-core");

function getDailyQuery() {
  const rotations = [
    "Frontend Developer, React Developer, JavaScript Developer, Web Developer, UI Developer, Software Engineer",
    "React Developer, Frontend Engineer, Full Stack Developer, UI Developer, Web Developer, Software Engineer",
    "Full Stack Developer, Software Engineer, Web Developer, JavaScript Developer, Frontend Developer, UI Engineer",
    "Junior Software Engineer, Associate Software Engineer, Frontend Developer, React Developer, Web Developer",
    "UI Developer, UX Engineer, Frontend Engineer, React Developer, Web Developer, Software Engineer",
    "Web Developer, Frontend Developer, JavaScript Developer, React Developer, Full Stack Developer, Software Engineer",
    "Software Engineer, Software Developer, Frontend Engineer, Full Stack Developer, React Developer, UI Developer",
  ];
  return rotations[new Date().getUTCDay()];
}

const PROFILE = {
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

// Same defensive US-only filter the Indeed cron uses, so the LinkedIn list
// doesn't leak global remote roles into the Fresh view.
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
  for (const bad of NON_US_TOKENS) if (s.includes(bad)) return false;
  if (s === "remote") return true;
  for (const ph of US_PHRASES) if (s.includes(ph)) return true;
  for (const name of US_STATE_NAMES) if (s.includes(name)) return true;
  for (const tok of s.split(/[^a-z]+/)) {
    if (US_STATE_TOKENS.has(tok) || tok === "us") return true;
  }
  return false;
}

// LinkedIn-published filter — JSearch tags each role with sourceName like
// "LinkedIn (Google Jobs)" when Google indexed it from LinkedIn. We also
// accept apply URLs pointing at linkedin.com as a fallback.
function isLinkedInRole(job) {
  const sn = String(job.sourceName || job.source || "").toLowerCase();
  const url = String(job.url || "").toLowerCase();
  if (sn.includes("linkedin")) return true;
  if (url.includes("linkedin.com")) return true;
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
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const expected = process.env.CRON_SECRET;
  const provided = req.headers["x-cron-secret"] || req.headers["authorization"] || "";
  if (!expected) return res.status(500).send("CRON_SECRET not set on the server.");
  const ok = provided === expected || provided === `Bearer ${expected}`;
  if (!ok) return res.status(401).send("Unauthorized.");

  const syncToken = process.env.SYNC_PASSCODE;
  if (!syncToken) return res.status(500).send("SYNC_PASSCODE not set on the server.");

  try {
    const watchData = await getWatch(syncToken);
    const seen = new Set((watchData && watchData.seenKeys) || []);

    // only:"jsearch" tells fetchJobs to skip Greenhouse/Lever/Ashby/etc. and
    // call JSearch alone — that's where LinkedIn-published roles live.
    const seed = new Date().toISOString().slice(0, 10);
    const feed = await fetchJobs({ ...PROFILE, q: getDailyQuery(), seed, limit: 120, only: "jsearch" });
    const candidates = (feed && feed.jobs) || [];

    const fresh = [];
    const usedKeys = new Set();
    for (const job of candidates) {
      if (!isLinkedInRole(job)) continue;
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
      if (!isUsLocation(match.location)) continue;
      const k = keyOf(match);
      if (seen.has(k) || usedKeys.has(k)) continue;
      usedKeys.add(k);
      fresh.push(match);
      if (fresh.length >= 5) break;
    }

    const result = await setWatch(syncToken, {
      matches: fresh,
      lastSweep: new Date().toISOString(),
    });

    res.status(200).json({
      ok: true,
      published: fresh.length,
      candidatePool: candidates.length,
      linkedinFiltered: candidates.filter(isLinkedInRole).length,
      seenBefore: seen.size,
      currentCount: result.currentCount,
      archiveCount: result.archiveCount,
    });
  } catch (err) {
    res.status(err.status || 500).send(err.message || "cron-linkedin failed.");
  }
};

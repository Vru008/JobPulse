/* Real job feed — aggregates free, no-key job APIs into one deduped list.
 *
 * Sources (all free, no API key, real apply URLs):
 *   - Remotive   https://remotive.com/api/remote-jobs
 *   - Arbeitnow  https://www.arbeitnow.com/api/job-board-api
 *   - Remote OK  https://remoteok.com/api
 *
 * Used by /api/jobs (Vercel) and netlify/functions/jobs (Netlify).
 */

const DEV_KEYWORDS = [
  "developer", "engineer", "frontend", "front end", "front-end", "backend",
  "back end", "full stack", "fullstack", "software", "web", "react", "node",
  "javascript", "typescript", "python", "java", "ui", "programmer",
];

function stripHtml(html) {
  return (html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function timeAgo(value) {
  const d = new Date(value);
  if (isNaN(d.getTime())) return "Recently";
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  return "30+ days ago";
}

async function getJson(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "JobPulse/1.0 (+https://job-pulse-plum.vercel.app)", ...(opts.headers || {}) },
    });
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/* ---- per-source fetch + normalize (each isolated so one failing is fine) ---- */

async function fromRemotive() {
  const data = await getJson("https://remotive.com/api/remote-jobs?category=software-dev&limit=100");
  return (data.jobs || []).map((j) => ({
    id: `rmtv-${j.id}`,
    title: j.title,
    company: j.company_name,
    location: j.candidate_required_location || "Remote",
    mode: "Remote",
    posted: timeAgo(j.publication_date),
    date: j.publication_date,
    salary: j.salary || "",
    url: j.url,
    source: "remotive",
    sourceName: "Remotive",
    skills: (j.tags || []).slice(0, 6),
    summary: stripHtml(j.description).slice(0, 180),
  }));
}

async function fromArbeitnow() {
  const data = await getJson("https://www.arbeitnow.com/api/job-board-api");
  return (data.data || []).map((j) => ({
    id: `arbn-${j.slug}`,
    title: j.title,
    company: j.company_name,
    location: j.location || (j.remote ? "Remote" : ""),
    mode: j.remote ? "Remote" : "Onsite",
    posted: timeAgo((j.created_at || 0) * 1000),
    date: (j.created_at || 0) * 1000,
    salary: "",
    url: j.url,
    source: "arbeitnow",
    sourceName: "Arbeitnow",
    skills: (j.tags || []).slice(0, 6),
    summary: stripHtml(j.description).slice(0, 180),
  }));
}

async function fromRemoteOk() {
  const data = await getJson("https://remoteok.com/api");
  return (Array.isArray(data) ? data : [])
    .filter((j) => j && j.position && j.id)
    .map((j) => ({
      id: `rmok-${j.id}`,
      title: j.position,
      company: j.company,
      location: j.location || "Remote",
      mode: "Remote",
      posted: timeAgo(j.date),
      date: j.date,
      salary: j.salary_min
        ? `$${Math.round(j.salary_min / 1000)}k-$${Math.round(j.salary_max / 1000)}k`
        : "",
      url: j.url && j.url.startsWith("http") ? j.url : `https://remoteok.com${j.url || ""}`,
      source: "remoteok",
      sourceName: "Remote OK",
      skills: (j.tags || []).slice(0, 6),
      summary: stripHtml(j.description || "").slice(0, 180),
    }));
}

/* ---- relevance scoring against the user's target keywords ---- */

function scoreJob(job, keywords) {
  const title = (job.title || "").toLowerCase();
  const extra = `${(job.skills || []).join(" ")} ${job.summary || ""}`.toLowerCase();
  let score = 0;
  keywords.forEach((kw) => {
    if (!kw) return;
    if (title.includes(kw)) score += 3;
    else if (extra.includes(kw)) score += 1;
  });
  return score;
}

/**
 * Aggregate, dedupe, and rank. Always returns up to `limit` unique jobs.
 * @param {object} opts
 * @param {string} opts.q  comma/space separated target titles or keywords
 * @param {number} opts.limit  default 25
 */
async function fetchJobs({ q = "", limit = 25 } = {}) {
  const userKw = q
    .toLowerCase()
    .split(/[,\n]+/)
    .flatMap((s) => s.trim().split(/\s+/))
    .filter((w) => w.length > 2);
  const keywords = [...new Set([...userKw, ...DEV_KEYWORDS])];

  const results = await Promise.allSettled([fromRemotive(), fromArbeitnow(), fromRemoteOk()]);
  const counts = { remotive: 0, arbeitnow: 0, remoteok: 0 };
  let all = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      const list = r.value.filter((j) => j.title && j.company && j.url);
      all = all.concat(list);
      counts[["remotive", "arbeitnow", "remoteok"][i]] = list.length;
    }
  });

  // Keep only dev-relevant roles (must match at least one keyword).
  const relevant = all.filter((j) => scoreJob(j, keywords) > 0);
  const pool = relevant.length >= limit ? relevant : all;

  // Strict dedupe: same company+title, or same apply URL, only once.
  const seen = new Set();
  const unique = [];
  for (const job of pool) {
    const key = `${(job.company || "").toLowerCase().trim()}::${(job.title || "").toLowerCase().trim()}`;
    const urlKey = (job.url || "").split("?")[0].toLowerCase();
    if (seen.has(key) || seen.has(urlKey)) continue;
    seen.add(key);
    seen.add(urlKey);
    unique.push(job);
  }

  // Rank by relevance, then freshness.
  unique.sort((a, b) => {
    const s = scoreJob(b, keywords) - scoreJob(a, keywords);
    if (s !== 0) return s;
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });

  return {
    jobs: unique.slice(0, limit),
    count: Math.min(unique.length, limit),
    fetchedAt: new Date().toISOString(),
    sources: counts,
  };
}

module.exports = { fetchJobs };

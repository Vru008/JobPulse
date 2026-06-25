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

/* ---- ATS company boards (direct apply links, established = better sponsorship)
   Slugs validated to return live frontend/full-stack roles. Failures are silent,
   so extra names here are harmless. ---- */

const GREENHOUSE = [
  "stripe", "affirm", "databricks", "robinhood", "dropbox", "twilio", "figma",
  "asana", "brex", "pinterest", "reddit", "airtable", "doordash", "lyft",
  "airbnb", "snowflake", "samsara", "benchling", "checkr", "gusto", "coinbase",
  "discord", "instacart", "datadog", "flexport", "webflow", "faire", "sofi",
  "chime", "betterment", "wealthfront", "gemini", "plaid", "lattice", "rippling",
  // validated additions
  "postman", "cloudflare", "elastic", "mongodb", "confluent", "sentry",
  "nerdwallet", "marqeta", "toast", "squarespace", "remitly", "duolingo",
  "coursera", "peloton", "grafanalabs", "airbyte", "retool", "amplitude",
];
const LEVER = ["matchgroup", "ro", "attentive", "kandji", "fivetran", "netlify"];
const ASHBY = ["ramp", "cohere", "linear", "baseten", "modal", "mercury"];

const ATS_NAMES = {
  doordash: "DoorDash", matchgroup: "Match Group", hashicorp: "HashiCorp",
  sofi: "SoFi", airbnb: "Airbnb", openai: "OpenAI", scaleai: "Scale AI",
};
function prettyName(slug) {
  return ATS_NAMES[slug] ||
    slug.replace(/(^|[-_])([a-z])/g, (m, p, c) => (p ? " " : "") + c.toUpperCase());
}

async function fromGreenhouse(slug) {
  const d = await getJson(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`);
  return (d.jobs || []).map((j) => ({
    id: `gh-${slug}-${j.id}`,
    title: j.title,
    company: prettyName(slug),
    location: (j.location && j.location.name) || "See posting",
    mode: /remote/i.test((j.location && j.location.name) || "") ? "Remote" : "Onsite",
    posted: timeAgo(j.updated_at),
    date: j.updated_at,
    salary: "",
    url: j.absolute_url,
    source: "greenhouse",
    sourceName: `Greenhouse · ${prettyName(slug)}`,
    skills: [],
    summary: "",
  }));
}

async function fromLever(slug) {
  const d = await getJson(`https://api.lever.co/v0/postings/${slug}?mode=json`);
  return (Array.isArray(d) ? d : []).map((j) => ({
    id: `lv-${slug}-${j.id}`,
    title: j.text,
    company: prettyName(slug),
    location: (j.categories && j.categories.location) || "See posting",
    mode: /remote/i.test((j.categories && j.categories.location) || "") ? "Remote" : "Onsite",
    posted: timeAgo(j.createdAt),
    date: j.createdAt,
    salary: "",
    url: j.hostedUrl,
    source: "lever",
    sourceName: `Lever · ${prettyName(slug)}`,
    skills: j.categories && j.categories.team ? [j.categories.team] : [],
    summary: (j.descriptionPlain || "").slice(0, 180),
  }));
}

async function fromAshby(slug) {
  const d = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${slug}`);
  return (d.jobs || [])
    .map((j) => ({
      id: `ash-${slug}-${j.id || j.title}`,
      title: j.title,
      company: prettyName(slug),
      location: j.location || "See posting",
      mode: j.isRemote ? "Remote" : "Onsite",
      posted: timeAgo(j.publishedAt || j.updatedAt || Date.now()),
      date: j.publishedAt || j.updatedAt || Date.now(),
      salary: "",
      url: j.jobUrl || j.applyUrl,
      source: "ashby",
      sourceName: `Ashby · ${prettyName(slug)}`,
      skills: j.departmentName ? [j.departmentName] : [],
      summary: "",
    }))
    .filter((x) => x.url);
}

/* ---- more free, no-key job APIs (remote-leaning, add breadth) ---- */

async function fromJobicy() {
  const tags = ["react", "javascript", "front-end"];
  const lists = await Promise.allSettled(
    tags.map((t) => getJson(`https://jobicy.com/api/v2/remote-jobs?count=50&tag=${t}`))
  );
  const out = [];
  lists.forEach((r) => {
    if (r.status !== "fulfilled") return;
    (r.value.jobs || []).forEach((j) => {
      out.push({
        id: `jbcy-${j.id}`,
        title: j.jobTitle,
        company: j.companyName,
        location: j.jobGeo || "Remote",
        mode: "Remote",
        posted: timeAgo(j.pubDate),
        date: j.pubDate,
        salary: "",
        url: j.url,
        source: "jobicy",
        sourceName: "Jobicy",
        skills: Array.isArray(j.jobIndustry) ? j.jobIndustry.slice(0, 4) : [],
        summary: stripHtml(j.jobExcerpt || "").slice(0, 180),
      });
    });
  });
  return out;
}

async function fromHimalayas() {
  const d = await getJson("https://himalayas.app/jobs/api?limit=50");
  return (d.jobs || []).map((j) => ({
    id: `hima-${(j.applicationLink || "").split("/").pop()}`,
    title: j.title,
    company: j.companyName,
    location: Array.isArray(j.locationRestrictions) && j.locationRestrictions.length
      ? j.locationRestrictions.join(", ")
      : "Remote",
    mode: "Remote",
    posted: timeAgo((j.pubDate || 0) * 1000),
    date: (j.pubDate || 0) * 1000,
    salary: j.minSalary
      ? `$${Math.round(j.minSalary / 1000)}k-$${Math.round(j.maxSalary / 1000)}k`
      : "",
    url: j.applicationLink,
    source: "himalayas",
    sourceName: "Himalayas",
    skills: Array.isArray(j.categories) ? j.categories.slice(0, 4) : [],
    summary: stripHtml(j.excerpt || "").slice(0, 180),
  })).filter((x) => x.url);
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

/* ---- exclusions (tuned for an OPT->H-1B junior/mid frontend profile) ---- */

// Seniority / management titles we never want.
const EXCLUDE_TITLE = /\b(senior|sr\.?|staff|principal|lead|leads?|manager|management|director|head\s+of|vp|vice president|architect|distinguished|fellow)\b/i;

// Clearly mismatched stacks (only when no web/JS signal is present).
const MISMATCH_STACK = /\b(\.net|c#|c\+\+|salesforce|sap|abap|cobol|php|drupal|wordpress|ruby on rails|rails|golang|\bgo\b|scala|kotlin|swift|ios developer|android developer|embedded|firmware|devops|sre|data engineer|ml engineer|qa\b|test engineer|sdet)\b/i;
const WEB_SIGNAL = /\b(react|frontend|front[\s-]?end|javascript|typescript|full[\s-]?stack|fullstack|node|web developer|web engineer|ui engineer|ui\/ux)\b/i;

// Sponsorship / authorization blockers in the posting text.
const BLOCK_AUTH = /(no sponsorship|without sponsorship|not (?:be )?able to sponsor|cannot sponsor|do(?:es)? not sponsor|us citizen|u\.s\.? citizen|citizenship required|must be a citizen|security clearance|clearance required|requires? clearance|gc only|green card only|usc only)/i;

// Job-type blockers.
const BLOCK_TYPE = /\b(intern|internship|co-?op|part[\s-]?time|contract|contractor|freelance|temporary|seasonal|apprentice)\b/i;

// Staffing / body-shop style employers (kept conservative).
const BLOCK_COMPANY = /(staffing|recruit|recruiting|recruiter|talent acquisition|consultancy|body ?shop|placement|head ?hunt)/i;

// High years-of-experience requirement (e.g. "8+ YOE", "10+ years").
const HIGH_YOE = /\b([5-9]|1[0-9])\s*\+?\s*(?:years|yoe|yrs)\b/i;

function isExcluded(job) {
  const title = job.title || "";
  const company = job.company || "";
  const blob = `${title} ${(job.skills || []).join(" ")} ${job.summary || ""}`;

  if (EXCLUDE_TITLE.test(title)) return "seniority/lead title";
  if (HIGH_YOE.test(blob)) return "high experience requirement";
  if (BLOCK_AUTH.test(blob)) return "no sponsorship / citizenship / clearance";
  if (BLOCK_TYPE.test(`${title} ${job.summary || ""}`)) return "intern/contract/part-time";
  if (BLOCK_COMPANY.test(company)) return "staffing/recruiting firm";
  if (MISMATCH_STACK.test(title) && !WEB_SIGNAL.test(title)) return "stack mismatch";
  return null;
}

/* ---- fit scoring against the candidate's skills + target titles ---- */

function scoreFit(job, skills, titleKw) {
  const titleL = (job.title || "").toLowerCase();
  const hay = `${titleL} ${(job.skills || []).join(" ")} ${job.summary || ""}`.toLowerCase();

  let skillHits = 0;
  skills.forEach((s) => { if (s && hay.includes(s)) skillHits += 1; });
  const skillPct = skills.length ? skillHits / skills.length : 0.4; // 0..1

  // Title-target match carries most of the weight, so a clean "Frontend
  // Engineer" with no description still scores as a real fit.
  const titleMatch = titleKw.some((t) => t && t.length > 2 && titleL.includes(t));
  let fit = (titleMatch ? 40 : 0) + 10 + Math.round(skillPct * 40);
  if (/\b(react|frontend|front[\s-]?end|front end|full[\s-]?stack|fullstack|ui\/ux|ui engineer)\b/.test(titleL)) fit += 15;
  return { fit: Math.max(0, Math.min(100, fit)), skillHits };
}

function fitBand(fit) {
  if (fit >= 90) return "Perfect";
  if (fit >= 75) return "Strong";
  if (fit >= 60) return "Moderate";
  return "Drop";
}

// Prefer US-based or remote roles (relevant for an OPT->H-1B candidate).
const US_LOCATION = /united states|u\.s\.|\busa?\b|\bremote\b|new york|new jersey|san francisco|bay area|silicon valley|seattle|austin|boston|chicago|los angeles|denver|atlanta|dallas|houston|miami|washington|, ca\b|, ny\b|, tx\b|, wa\b|, ma\b|, nj\b|, il\b|, co\b|, ga\b/i;
function usScore(job) {
  return US_LOCATION.test(job.location || "") ? 1 : 0;
}

// Seeded RNG so the daily rotation is stable within a day but changes each day.
function seededRng(seedStr) {
  let h = 1779033703 ^ String(seedStr).length;
  for (let i = 0; i < String(seedStr).length; i += 1) {
    h = Math.imul(h ^ String(seedStr).charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Every role is VERIFY — silence never means sponsorship.
function sponsorInfo(job) {
  const c = (job.company || "").toLowerCase();
  let likelihood;
  if (/university|college|institute|\.edu|hospital|health system|ixl|chegg|coursera|khan/.test(c)) {
    likelihood = "Higher — cap-exempt / established";
  } else if (["greenhouse", "lever", "ashby"].includes(job.source)) {
    likelihood = "Possible — established company";
  } else {
    likelihood = "Unknown — startups rarely sponsor";
  }
  return {
    status: "VERIFY",
    likelihood,
    verifyUrl: `https://h1bdata.info/index.php?em=${encodeURIComponent(job.company || "")}`,
  };
}

/**
 * Aggregate, exclude, dedupe, score fit, and rank.
 * @param {object} opts
 * @param {string} opts.q       target titles / keywords
 * @param {string} opts.skills  candidate skills (comma separated)
 * @param {number} opts.limit   default 25
 */
async function fetchJobs({ q = "", skills = "", limit = 25, seed = "" } = {}) {
  const titleKw = q.toLowerCase().split(/[,\n]+/).flatMap((s) => s.trim().split(/\s+/)).filter((w) => w.length > 2);
  const keywords = [...new Set([...titleKw, ...DEV_KEYWORDS])];
  const skillList = skills.toLowerCase().split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);

  const feedTasks = [
    ["remotive", fromRemotive()],
    ["arbeitnow", fromArbeitnow()],
    ["remoteok", fromRemoteOk()],
    ["jobicy", fromJobicy()],
    ["himalayas", fromHimalayas()],
    ...GREENHOUSE.map((s) => ["greenhouse", fromGreenhouse(s)]),
    ...LEVER.map((s) => ["lever", fromLever(s)]),
    ...ASHBY.map((s) => ["ashby", fromAshby(s)]),
  ];
  const settled = await Promise.allSettled(feedTasks.map((t) => t[1]));
  const counts = { remotive: 0, arbeitnow: 0, remoteok: 0, jobicy: 0, himalayas: 0, greenhouse: 0, lever: 0, ashby: 0 };
  const excluded = {};
  let all = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      const src = feedTasks[i][0];
      const list = r.value.filter((j) => j.title && j.company && j.url);
      all = all.concat(list);
      counts[src] += list.length;
    }
  });

  // Relevance gate, then strict exclusions.
  const kept = [];
  for (const job of all) {
    if (scoreJob(job, keywords) <= 0) continue;
    const reason = isExcluded(job);
    if (reason) { excluded[reason] = (excluded[reason] || 0) + 1; continue; }
    kept.push(job);
  }

  // Strict dedupe: same company+title, or same apply URL, only once.
  const seen = new Set();
  const unique = [];
  for (const job of kept) {
    const key = `${job.company.toLowerCase().trim()}::${job.title.toLowerCase().trim()}`;
    const urlKey = (job.url || "").split("?")[0].toLowerCase();
    if (seen.has(key) || seen.has(urlKey)) continue;
    seen.add(key);
    seen.add(urlKey);

    const { fit, skillHits } = scoreFit(job, skillList, titleKw);
    if (fit < 60) continue; // honesty rule: drop below the 60 fit band
    job.fit = fit;
    job.fitBand = fitBand(fit);
    job.skillHits = skillHits;
    job.skillsTotal = skillList.length;
    Object.assign(job, { sponsorship: sponsorInfo(job) });
    unique.push(job);
  }

  // Keep fit-band priority (Perfect > Strong > Moderate) and US/remote-first
  // within each band, but rotate within those groups using a daily seed so a
  // fresh slice of equally-good roles surfaces each morning (not the same list).
  const rng = seededRng(seed || new Date().toISOString().slice(0, 10));
  const order = ["Perfect", "Strong", "Moderate"];
  const grouped = {};
  unique.forEach((j) => { (grouped[j.fitBand] || (grouped[j.fitBand] = [])).push(j); });
  const ranked = [];
  order.forEach((band) => {
    const g = grouped[band] || [];
    ranked.push(...shuffle(g.filter(usScore), rng));
    ranked.push(...shuffle(g.filter((j) => !usScore(j)), rng));
  });

  // Cap at 2 roles per company so one employer can't dominate the list.
  const perCompany = {};
  const finalJobs = [];
  for (const job of ranked) {
    const c = job.company.toLowerCase();
    if ((perCompany[c] || 0) >= 2) continue;
    perCompany[c] = (perCompany[c] || 0) + 1;
    finalJobs.push(job);
    if (finalJobs.length >= limit) break;
  }

  return {
    jobs: finalJobs,
    count: finalJobs.length,
    fetchedAt: new Date().toISOString(),
    sources: counts,
    excluded,
  };
}

module.exports = { fetchJobs };

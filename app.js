const authConfig = {
  username: "admin",
  passcodeHash: "9b30ac880d9dd2684f77afd4efed920c243ef214c4e0e23d7ce41a8d666561b6",
};

// Live feeds the dashboard aggregates (toggle on/off in the Sources tab).
// Real jobs are fetched from /api/jobs, which pulls these free APIs server-side.
const sources = [
  {
    id: "remotive",
    name: "Remotive",
    trust: "Curated remote software roles with direct apply links.",
    enabled: true,
  },
  {
    id: "arbeitnow",
    name: "Arbeitnow",
    trust: "Open job board with fresh engineering postings worldwide.",
    enabled: true,
  },
  {
    id: "remoteok",
    name: "Remote OK",
    trust: "High-volume remote-first roles from startups and scale-ups.",
    enabled: true,
  },
];

// Populated at runtime from the live feed (was hardcoded sample data).
let jobs = [];
let loadingJobs = false;
// Global "visa-sponsoring, outside USA" feed (separate tab).
let globalJobs = [];
let loadingGlobal = false;
let globalLoaded = false;
let lastJobDay = ""; // tracks the current "8 AM batch" for auto-refresh

// A new batch of roles each morning at 8 AM local time. Before 8 AM we still
// show yesterday's batch; at/after 8 AM the seed flips, so the feed refreshes.
function jobDaySeed() {
  const now = new Date();
  const ref = new Date(now);
  if (now.getHours() < 8) ref.setDate(ref.getDate() - 1);
  const m = String(ref.getMonth() + 1).padStart(2, "0");
  const d = String(ref.getDate()).padStart(2, "0");
  return `${ref.getFullYear()}-${m}-${d}-8am`;
}

const state = {
  profile: JSON.parse(localStorage.getItem("jobpulse-profile") || "null") || {
    targetTitles: "Frontend Developer, React Developer, Full Stack Developer, Software Engineer, UI/UX Engineer",
    skills: "React, JavaScript, TypeScript, Next.js, Node.js, Tailwind, REST APIs, MongoDB, Express",
    location: "United States, Remote",
    experience: "Junior to mid level",
    salary: "$80k+",
    sponsorship: "On F-1 OPT (authorized now), needs future H-1B sponsorship",
    portfolio: "https://job-mate-nu.vercel.app",
    learning: "TypeScript, Next.js",
  },
  enabledSources: JSON.parse(localStorage.getItem("jobpulse-sources") || "null") || sources.reduce((acc, source) => {
    acc[source.id] = source.enabled;
    return acc;
  }, {}),
  saved: JSON.parse(localStorage.getItem("jobpulse-saved") || "{}"),
  applied: JSON.parse(localStorage.getItem("jobpulse-applied") || "{}"),
  hidden: JSON.parse(localStorage.getItem("jobpulse-hidden") || "{}"),
};

// Make sure every current feed has an on/off entry (handles older saved state).
sources.forEach((source) => {
  if (state.enabledSources[source.id] === undefined) state.enabledSources[source.id] = source.enabled;
});

const elements = {
  views: document.querySelectorAll(".view"),
  navItems: document.querySelectorAll(".nav-item"),
  jobList: document.querySelector("#jobList"),
  trackerList: document.querySelector("#trackerList"),
  sourceGrid: document.querySelector("#sourceGrid"),
  roleFilter: document.querySelector("#roleFilter"),
  modeFilter: document.querySelector("#modeFilter"),
  matchFilter: document.querySelector("#matchFilter"),
  matchLabel: document.querySelector("#matchLabel"),
  searchInput: document.querySelector("#searchInput"),
  multiSearchLink: document.querySelector("#multiSearchLink"),
  template: document.querySelector("#jobCardTemplate"),
  newToday: document.querySelector("#newToday"),
  bestMatch: document.querySelector("#bestMatch"),
  sourceCount: document.querySelector("#sourceCount"),
  readyCount: document.querySelector("#readyCount"),
  loginForm: document.querySelector("#loginForm"),
  loginUser: document.querySelector("#loginUser"),
  loginPasscode: document.querySelector("#loginPasscode"),
  loginError: document.querySelector("#loginError"),
  logoutBtn: document.querySelector("#logoutBtn"),
};

function save(key, value) {
  localStorage.setItem(`jobpulse-${key}`, JSON.stringify(value));
  syncPush();
}

/* ---------- cross-device sync (MongoDB via /api/state) ---------- */

const SYNC_ENDPOINTS = ["/api/state", "/.netlify/functions/state"];

function syncToken() {
  return sessionStorage.getItem("jobpulse-pass") || "";
}

// Pull the cloud copy on login and make it the source of truth on this device.
async function syncPull() {
  const token = syncToken();
  if (!token) return;
  for (const endpoint of SYNC_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, { headers: { "x-jobpulse-pass": token } });
      if (!res.ok) continue;
      const { data } = await res.json();
      if (data) {
        if (data.saved) state.saved = data.saved;
        if (data.applied) state.applied = data.applied;
        if (data.hidden) state.hidden = data.hidden;
        if (data.enabledSources) state.enabledSources = data.enabledSources;
        if (data.profile) state.profile = { ...state.profile, ...data.profile };
        // Persist locally WITHOUT echoing back to the server.
        ["saved", "applied", "hidden"].forEach((k) =>
          localStorage.setItem(`jobpulse-${k}`, JSON.stringify(state[k])));
        localStorage.setItem("jobpulse-sources", JSON.stringify(state.enabledSources));
        localStorage.setItem("jobpulse-profile", JSON.stringify(state.profile));
        renderProfile();
        renderAll();
      }
      return; // a reachable endpoint answered
    } catch (_) { /* try next / stay local */ }
  }
}

// Debounced push of the full state blob after any change.
let syncTimer = null;
function syncPush() {
  const token = syncToken();
  if (!token) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    const data = {
      saved: state.saved,
      applied: state.applied,
      hidden: state.hidden,
      enabledSources: state.enabledSources,
      profile: state.profile,
    };
    for (const endpoint of SYNC_ENDPOINTS) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-jobpulse-pass": token },
          body: JSON.stringify({ data }),
        });
        if (res.ok) return;
      } catch (_) { /* try next / stay local */ }
    }
  }, 600);
}

function isAuthenticated() {
  return sessionStorage.getItem("jobpulse-authenticated") === "true";
}

async function sha256(value) {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function unlockApp() {
  sessionStorage.setItem("jobpulse-authenticated", "true");
  document.body.classList.add("authenticated");
  renderProfile();
  renderAll();
  syncPull();
  loadJobs();
}

function lockApp() {
  sessionStorage.removeItem("jobpulse-authenticated");
  document.body.classList.remove("authenticated");
  elements.loginError.textContent = "";
  elements.loginPasscode.value = "";
  elements.loginUser.focus();
}

function sourceById(sourceId) {
  return sources.find((source) => source.id === sourceId);
}

function queryText() {
  return elements.searchInput.value.trim() || state.profile.targetTitles.split(",")[0].trim();
}

// Real jobs carry their own canonical apply URL.
function applyUrl(job) {
  return job.url || "#";
}

// Coarse role bucket so the role filter stays useful across many live titles.
function classifyRole(title) {
  const t = (title || "").toLowerCase();
  if (/full[\s-]?stack/.test(t)) return "Full Stack Developer";
  if (/front[\s-]?end/.test(t) || /\breact\b|\bvue\b|\bangular\b|ui engineer/.test(t)) return "Frontend Developer";
  if (/back[\s-]?end/.test(t)) return "Backend Developer";
  if (/data|\bml\b|machine learning/.test(t)) return "Data / ML";
  if (/devops|\bsre\b|infrastructure|platform|cloud/.test(t)) return "DevOps / Cloud";
  if (/mobile|ios|android/.test(t)) return "Mobile Developer";
  return "Software Engineer";
}

// Score a live job against the saved profile (skills + target titles).
function computeMatch(job) {
  const skills = (state.profile.skills || "").toLowerCase().split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
  const titles = (state.profile.targetTitles || "").toLowerCase().split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
  const hay = `${job.title} ${(job.skills || []).join(" ")} ${job.summary || ""}`.toLowerCase();

  let hits = 0;
  skills.forEach((s) => { if (s && hay.includes(s)) hits += 1; });
  const base = skills.length ? (hits / skills.length) * 100 : 50;
  const titleBoost = titles.some((t) => t && job.title.toLowerCase().includes(t.split(" ")[0])) ? 12 : 0;
  return Math.max(62, Math.min(98, Math.round(base * 0.5 + 45 + titleBoost)));
}

// Fetch the live feed (Vercel first, Netlify fallback) and render.
async function loadJobs(force = false) {
  loadingJobs = true;
  renderJobs();

  const q = encodeURIComponent(state.profile.targetTitles || "");
  const sk = encodeURIComponent(state.profile.skills || "");
  // 8 AM-local daily seed => a fresh rotation each morning (and a per-day cache
  // key). "Refresh now" passes a timestamp seed to re-roll immediately.
  const seed = force ? `r${Date.now()}` : jobDaySeed();
  if (!force) lastJobDay = jobDaySeed();
  const qs = `q=${q}&skills=${sk}&seed=${encodeURIComponent(seed)}`;
  const endpoints = [`/api/jobs?${qs}`, `/.netlify/functions/jobs?${qs}`];
  let data = null;
  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint);
      if (res.ok) { data = await res.json(); break; }
    } catch (_) { /* try next endpoint */ }
  }

  loadingJobs = false;

  if (!data || !Array.isArray(data.jobs) || !data.jobs.length) {
    jobs = [];
    elements.jobList.innerHTML =
      '<div class="tracker-empty">Could not load live jobs right now. Tap “Refresh now” in a moment.</div>';
    renderMetrics([]);
    return;
  }

  jobs = data.jobs.map((j) => ({
    ...j,
    role: classifyRole(j.title),
    match: typeof j.fit === "number" ? j.fit : computeMatch(j),
  }));
  renderRoles();
  renderAll();

  // LinkedIn/Indeed/Glassdoor via JSearch load separately (slow) and merge in
  // when ready, so the dashboard never waits on it. No-op if no key is set.
  loadJSearchExtra();
}

async function loadJSearchExtra() {
  const q = encodeURIComponent(state.profile.targetTitles || "");
  const sk = encodeURIComponent(state.profile.skills || "");
  const seed = jobDaySeed();
  const qs = `q=${q}&skills=${sk}&seed=${encodeURIComponent(seed)}&scope=us&only=jsearch`;
  let data = null;
  for (const endpoint of [`/api/jobs?${qs}`, `/.netlify/functions/jobs?${qs}`]) {
    try {
      const res = await fetch(endpoint);
      if (res.ok) { data = await res.json(); break; }
    } catch (_) { /* try next */ }
  }
  if (!data || !Array.isArray(data.jobs) || !data.jobs.length) return;

  const have = new Set(jobs.map((j) => `${j.company}::${j.title}`.toLowerCase()));
  const additions = data.jobs
    .filter((j) => !have.has(`${j.company}::${j.title}`.toLowerCase()))
    .map((j) => ({ ...j, role: classifyRole(j.title), match: typeof j.fit === "number" ? j.fit : 70 }));
  if (additions.length) {
    jobs = jobs.concat(additions);
    renderRoles();
    renderAll();
  }
}

function visibleJobs() {
  const minMatch = Number(elements.matchFilter.value);
  const role = elements.roleFilter.value;
  const mode = elements.modeFilter.value;
  const search = elements.searchInput.value.toLowerCase().trim();

  return jobs
    .filter((job) => state.enabledSources[job.source] !== false)
    .filter((job) => !state.hidden[job.id])
    .filter((job) => job.match >= minMatch)
    .filter((job) => role === "all" || job.role === role)
    .filter((job) => mode === "all" || job.mode === mode)
    .filter((job) => {
      if (!search) return true;
      return [job.title, job.company, job.location, job.source, ...(job.skills || [])].join(" ").toLowerCase().includes(search);
    })
    .sort((a, b) => b.match - a.match);
}

function renderMetrics(list) {
  const enabledCount = sources.filter((source) => state.enabledSources[source.id] !== false).length;
  elements.newToday.textContent = list.filter((job) => job.posted === "Today").length;
  elements.bestMatch.textContent = `${list[0]?.match || 0}%`;
  elements.sourceCount.textContent = enabledCount;
  elements.readyCount.textContent = list.length;
}

// Build one job card (shared by the US dashboard and the Global Visa tab).
function createJobCard(job) {
  const node = elements.template.content.cloneNode(true);
  node.querySelector("h3").textContent = job.title;
  node.querySelector(".badge").textContent = sourceById(job.source)?.name || job.sourceName || job.source;
  node.querySelector(".company").textContent = job.company;
  node.querySelector(".meta").textContent = [job.location, job.mode, job.salary, job.posted].filter(Boolean).join(" | ");
  node.querySelector(".score").textContent = `${job.match}%`;
  node.querySelector(".summary").textContent = job.summary || "Open the posting for full details.";
  node.querySelector(".skill-row").innerHTML = (job.skills || []).map((skill) => `<span>${skill}</span>`).join("");

  const bandEl = node.querySelector(".fit-band");
  if (bandEl) {
    const band = job.fitBand || (job.match >= 90 ? "Perfect" : job.match >= 75 ? "Strong" : "Moderate");
    bandEl.textContent = band;
    bandEl.classList.add(`band-${band.toLowerCase()}`);
  }

  // Sponsorship line — US roles point to h1bdata; global roles to the employer.
  const sponsorEl = node.querySelector(".sponsor");
  if (sponsorEl) {
    if (job.isGlobal) {
      sponsorEl.innerHTML =
        `Work visa: <strong>VERIFY with employer</strong> · ` +
        `${job.visaSponsor ? "sponsorship mentioned in posting" : "visa-friendly country"}`;
    } else if (job.sponsorship) {
      sponsorEl.innerHTML =
        `Sponsorship: <strong>VERIFY</strong> · ${job.sponsorship.likelihood} · ` +
        `<a href="${job.sponsorship.verifyUrl}" target="_blank" rel="noreferrer">check h1bdata</a>`;
    }
  }

  const applyLink = node.querySelector(".apply-link");
  applyLink.href = applyUrl(job);
  applyLink.textContent = "Apply";

  const tailorBtn = node.querySelector(".tailor-btn");
  if (tailorBtn) {
    tailorBtn.addEventListener("click", () => {
      sessionStorage.setItem("jobpulse-tailor", JSON.stringify({
        company: job.company,
        title: job.title,
        jobDesc: `${job.title} at ${job.company}\nLocation: ${job.location}\n${job.summary || ""}\n\nFull posting: ${job.url}`,
      }));
      document.querySelector('.nav-item[data-view="resume"]').click();
    });
  }

  const saveBtn = node.querySelector(".save-btn");
  const appliedBtn = node.querySelector(".applied-btn");
  const hideBtn = node.querySelector(".hide-btn");

  saveBtn.classList.toggle("active", Boolean(state.saved[job.id]));
  appliedBtn.classList.toggle("active", Boolean(state.applied[job.id]));

  saveBtn.addEventListener("click", () => {
    state.saved[job.id] = !state.saved[job.id];
    save("saved", state.saved);
    renderAll();
  });

  appliedBtn.addEventListener("click", () => {
    state.applied[job.id] = !state.applied[job.id];
    state.saved[job.id] = true;
    save("applied", state.applied);
    save("saved", state.saved);
    renderAll();
  });

  hideBtn.addEventListener("click", () => {
    state.hidden[job.id] = true;
    save("hidden", state.hidden);
    renderAll();
  });

  return node;
}

function renderJobs() {
  const list = visibleJobs();
  elements.jobList.innerHTML = "";
  list.forEach((job) => elements.jobList.appendChild(createJobCard(job)));

  if (!list.length) {
    elements.jobList.innerHTML = loadingJobs
      ? '<div class="tracker-empty">Loading fresh roles…</div>'
      : '<div class="tracker-empty">No matches with these filters. Lower the match score or turn on more sources.</div>';
  }

  renderMetrics(list);
}

function renderGlobal() {
  const el = document.querySelector("#globalList");
  if (!el) return;
  const list = globalJobs.filter((job) => !state.hidden[job.id]);
  el.innerHTML = "";
  list.forEach((job) => el.appendChild(createJobCard(job)));
  if (!list.length) {
    el.innerHTML = loadingGlobal
      ? '<div class="tracker-empty">Finding visa-sponsoring roles around the world…</div>'
      : '<div class="tracker-empty">No international visa-friendly matches right now. Try “Refresh now” later.</div>';
  }
}

// Load the global (outside-USA, visa-friendly) feed on demand.
async function loadGlobalJobs(force = false) {
  loadingGlobal = true;
  globalLoaded = true;
  renderGlobal();

  const q = encodeURIComponent(state.profile.targetTitles || "");
  const sk = encodeURIComponent(state.profile.skills || "");
  const seed = force ? `r${Date.now()}` : jobDaySeed();
  const qs = `q=${q}&skills=${sk}&seed=${encodeURIComponent(seed)}&scope=global`;
  const endpoints = [`/api/jobs?${qs}`, `/.netlify/functions/jobs?${qs}`];
  let data = null;
  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint);
      if (res.ok) { data = await res.json(); break; }
    } catch (_) { /* try next */ }
  }

  loadingGlobal = false;
  globalJobs = (data && Array.isArray(data.jobs) ? data.jobs : []).map((j) => ({
    ...j,
    isGlobal: true,
    role: classifyRole(j.title),
    match: typeof j.fit === "number" ? j.fit : 70,
  }));
  renderGlobal();
}

function renderSources() {
  elements.sourceGrid.innerHTML = "";
  sources.forEach((source) => {
    const card = document.createElement("article");
    card.className = "source-card";
    card.innerHTML = `
      <header>
        <h3>${source.name}</h3>
        <button class="switch ${state.enabledSources[source.id] !== false ? "active" : ""}" aria-label="Toggle ${source.name}"></button>
      </header>
      <p>${source.trust}</p>
    `;
    card.querySelector("button").addEventListener("click", () => {
      state.enabledSources[source.id] = state.enabledSources[source.id] === false;
      save("sources", state.enabledSources);
      renderAll();
    });
    elements.sourceGrid.appendChild(card);
  });
}

function renderTracker() {
  const tracked = jobs.filter((job) => state.saved[job.id] || state.applied[job.id]);
  elements.trackerList.innerHTML = "";

  if (!tracked.length) {
    elements.trackerList.innerHTML = '<div class="tracker-empty">Saved and applied roles will appear here.</div>';
    return;
  }

  tracked.forEach((job) => {
    const row = document.createElement("article");
    row.className = "job-card";
    row.innerHTML = `
      <div class="job-main">
        <div>
          <div class="job-title-row">
            <h3>${job.title}</h3>
            <span class="badge">${state.applied[job.id] ? "Applied" : "Saved"}</span>
          </div>
          <p class="company">${job.company}</p>
          <p class="meta">${job.location} | ${sourceById(job.source)?.name || job.sourceName || ""} | ${job.match}% match</p>
        </div>
        <a class="primary-btn" href="${applyUrl(job)}" target="_blank" rel="noreferrer">Open</a>
      </div>
    `;
    elements.trackerList.appendChild(row);
  });
}

function renderProfile() {
  Object.entries(state.profile).forEach(([key, value]) => {
    const field = document.querySelector(`#${key}`);
    if (field) field.value = value;
  });
}

function renderRoles() {
  const roles = [...new Set(jobs.map((job) => job.role))];
  const current = elements.roleFilter.value;
  elements.roleFilter.innerHTML = '<option value="all">All roles</option>';
  roles.forEach((role) => {
    const option = document.createElement("option");
    option.value = role;
    option.textContent = role;
    elements.roleFilter.appendChild(option);
  });
  if ([...elements.roleFilter.options].some((o) => o.value === current)) elements.roleFilter.value = current;
}

function updateSearchLink() {
  const query = queryText();
  elements.multiSearchLink.href =
    `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(query)}&location=${encodeURIComponent(state.profile.location || "")}`;
}

function renderAll() {
  elements.matchLabel.textContent = `${elements.matchFilter.value}%`;
  updateSearchLink();
  renderJobs();
  if (globalLoaded) renderGlobal();
  renderSources();
  renderTracker();
}

elements.navItems.forEach((item) => {
  item.addEventListener("click", () => {
    elements.navItems.forEach((nav) => nav.classList.remove("active"));
    elements.views.forEach((view) => view.classList.remove("active"));
    item.classList.add("active");
    document.querySelector(`#${item.dataset.view}`).classList.add("active");
    // Lazy-load the global feed the first time its tab is opened.
    if (item.dataset.view === "global" && !globalLoaded) loadGlobalJobs();
  });
});

["input", "change"].forEach((eventName) => {
  [elements.roleFilter, elements.modeFilter, elements.matchFilter, elements.searchInput].forEach((input) => {
    input.addEventListener(eventName, renderAll);
  });
});

document.querySelector("#saveProfile").addEventListener("click", (event) => {
  event.preventDefault();
  ["targetTitles", "skills", "location", "experience", "salary", "sponsorship", "portfolio", "learning"].forEach((key) => {
    const field = document.querySelector(`#${key}`);
    if (field) state.profile[key] = field.value;
  });
  save("profile", state.profile);
  loadJobs();
});

document.querySelector("#refreshBtn").addEventListener("click", () => {
  state.hidden = {};
  save("hidden", state.hidden);
  loadJobs(true);
});

const refreshGlobalBtn = document.querySelector("#refreshGlobalBtn");
if (refreshGlobalBtn) {
  refreshGlobalBtn.addEventListener("click", () => loadGlobalJobs(true));
}

// Automatic morning refresh: when the 8 AM batch rolls over (or the tab is
// reopened on a new day), reload the feed with no manual action.
function maybeAutoRefresh() {
  if (!isAuthenticated()) return;
  if (lastJobDay && jobDaySeed() !== lastJobDay) {
    loadJobs();
    if (globalLoaded) loadGlobalJobs();
  }
}
setInterval(maybeAutoRefresh, 5 * 60 * 1000); // check every 5 minutes
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") maybeAutoRefresh();
});

elements.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.loginError.textContent = "";

  const username = elements.loginUser.value.trim();
  const passcode = elements.loginPasscode.value;
  const passcodeHash = await sha256(passcode);

  if (username === authConfig.username && passcodeHash === authConfig.passcodeHash) {
    sessionStorage.setItem("jobpulse-pass", passcode); // used as the sync auth token
    unlockApp();
    return;
  }

  elements.loginError.textContent = "That username or passcode is not correct.";
  elements.loginPasscode.value = "";
  elements.loginPasscode.focus();
});

elements.logoutBtn.addEventListener("click", lockApp);

if (isAuthenticated()) {
  unlockApp();
} else {
  lockApp();
}

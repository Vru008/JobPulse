const authConfig = {
  username: "admin",
  // SHA-256 of the login passcode. To change: in a terminal run
  // `printf %s 'YOUR_NEW_PASSCODE' | sha256sum` and replace this value.
  passcodeHash: "2a8610aefdd0028c6bf074dd18721c0ef8bc43241cc7a653d7aedf2036bdf6b3",
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
  // Merge new defaults into any saved profile so a localStorage record from
  // before a new field existed still fills in (otherwise gradDate stays
  // undefined and the AI guesses a wrong year).
  profile: (() => {
    const DEFAULTS = {
      targetTitles: "Frontend Developer, React Developer, Full Stack Developer, Software Engineer, UI/UX Engineer",
      skills: "React, JavaScript, TypeScript, Next.js, Node.js, Tailwind, REST APIs, MongoDB, Express",
      location: "United States, Remote",
      experience: "Junior to mid level",
      salary: "$80k+",
      sponsorship: "On F-1 OPT (authorized now), needs future H-1B sponsorship",
      portfolio: "https://job-mate-nu.vercel.app",
      learning: "TypeScript, Next.js",
      gradDate: "Sept 2026",
    };
    const saved = JSON.parse(localStorage.getItem("jobpulse-profile") || "null") || {};
    return { ...DEFAULTS, ...saved };
  })(),
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

// Switch which view is active. Optionally push a history entry so the browser
// back button steps through tabs instead of leaving the app entirely.
function setActiveView(viewName, options) {
  const item = document.querySelector(`.nav-item[data-view="${viewName}"]`);
  const view = document.querySelector(`#${viewName}`);
  if (!item || !view) return;
  elements.navItems.forEach((nav) => nav.classList.remove("active"));
  elements.views.forEach((v) => v.classList.remove("active"));
  item.classList.add("active");
  view.classList.add("active");
  if (viewName === "global" && !globalLoaded) loadGlobalJobs();
  if (viewName === "watcher" && !watcherLoaded) loadWatcher();
  if (options && options.pushHistory) {
    try { history.pushState({ jpView: viewName }, "", `#${viewName}`); } catch (_) {}
  } else if (options && options.replaceHistory) {
    try { history.replaceState({ jpView: viewName }, "", `#${viewName}`); } catch (_) {}
  }
}

elements.navItems.forEach((item) => {
  item.addEventListener("click", () => {
    setActiveView(item.dataset.view, { pushHistory: true });
  });
});

// Browser back/forward: pop history entries and switch views inside the app
// rather than navigating away. The first popstate after a fresh load may have
// state === null (the initial entry we replaced on boot) — handle that too.
window.addEventListener("popstate", (event) => {
  const view = (event.state && event.state.jpView) ||
               (location.hash || "").replace(/^#/, "") ||
               "dashboard";
  if (document.querySelector(`.nav-item[data-view="${view}"]`)) {
    setActiveView(view, {}); // no history mutation — we are responding to it
  }
});

// On load (and after login), honor a hash like /#watcher so deep links work and
// seed the very first history entry with a known view so back behaves cleanly.
function initialiseViewFromHash() {
  const DEFAULT_VIEW = "watcher"; // Indeed Watcher is the new landing
  const want = (location.hash || "").replace(/^#/, "") || DEFAULT_VIEW;
  const target = document.querySelector(`.nav-item[data-view="${want}"]`) ? want : DEFAULT_VIEW;
  setActiveView(target, { replaceHistory: true });
}
initialiseViewFromHash();

["input", "change"].forEach((eventName) => {
  [elements.roleFilter, elements.modeFilter, elements.matchFilter, elements.searchInput].forEach((input) => {
    input.addEventListener(eventName, renderAll);
  });
});

document.querySelector("#saveProfile").addEventListener("click", (event) => {
  event.preventDefault();
  ["targetTitles", "skills", "location", "experience", "salary", "sponsorship", "portfolio", "learning", "gradDate"].forEach((key) => {
    const field = document.querySelector(`#${key}`);
    if (field) state.profile[key] = field.value;
  });
  save("profile", state.profile);
  loadJobs();
});

// Sidebar "Refresh now" reloads both watcher feeds — the Dashboard view is no
// longer reachable so refreshing /api/jobs would be invisible. Whichever
// watcher tab is open will repaint with the fresh data on completion.
document.querySelector("#refreshBtn").addEventListener("click", () => {
  if (typeof loadWatcher === "function") loadWatcher(true);
  if (typeof loadLinkedin === "function") loadLinkedin(true);
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

  // Always trim — autofill from password managers frequently leaves a trailing
  // space / hidden U+200B-class character that breaks an exact string compare.
  const username = elements.loginUser.value.trim();
  const passcode = elements.loginPasscode.value.trim();
  const passcodeHash = await sha256(passcode);

  // Console breadcrumbs (visible to the user) so login failures are diagnosable
  // without the developer having to be present.
  console.log("[jp-login] submit fired",
    { username, passcodeLength: passcode.length, hashMatches: passcodeHash === authConfig.passcodeHash, userMatches: username === authConfig.username });

  if (username === authConfig.username && passcodeHash === authConfig.passcodeHash) {
    // Lock-in the authenticated state BEFORE doing any optional rendering, so a
    // later non-critical failure (e.g. a render call) can't roll the login back.
    sessionStorage.setItem("jobpulse-authenticated", "true");
    sessionStorage.setItem("jobpulse-pass", "JobPulse2026!");
    document.body.classList.add("authenticated");
    try {
      unlockApp();
    } catch (err) {
      // Logged but swallowed — the user is already in, optional UI can recover
      // on the next interaction or page refresh.
      console.error("[jp-login] unlockApp post-auth render error (login still succeeded):", err);
    }
    return;
  }

  console.warn("[jp-login] rejected", { userMatches: username === authConfig.username, hashMatches: passcodeHash === authConfig.passcodeHash });
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

/* ---------- Indeed Watcher tab (results from the scheduled agent via /api/jobwatch) ---------- */

const WATCH_ENDPOINTS = ["/api/jobwatch", "/.netlify/functions/jobwatch"];
let watcherLoaded = false;

function timeAgo(iso) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function watcherCard(match) {
  const card = document.createElement("article");
  card.className = "job-card";

  const main = document.createElement("div");
  main.className = "job-main";
  const left = document.createElement("div");

  const titleRow = document.createElement("div");
  titleRow.className = "job-title-row";
  const h3 = document.createElement("h3");
  if (match.url) {
    const a = document.createElement("a");
    a.href = match.url;
    a.target = "_blank";
    a.rel = "noreferrer";
    a.textContent = match.role || "Role";
    h3.appendChild(a);
  } else {
    h3.textContent = match.role || "Role";
  }
  titleRow.appendChild(h3);
  if (match.fit) {
    const band = document.createElement("span");
    band.className = "fit-band";
    band.textContent = match.fit;
    titleRow.appendChild(band);
  }
  left.appendChild(titleRow);

  const company = document.createElement("p");
  company.className = "company";
  company.textContent = match.company || "";
  left.appendChild(company);

  const meta = document.createElement("p");
  meta.className = "meta";
  meta.textContent = [match.location, match.postedOn ? `posted ${match.postedOn}` : "", timeAgo(match.firstSeen)]
    .filter(Boolean)
    .join(" · ");
  left.appendChild(meta);

  main.appendChild(left);
  card.appendChild(main);

  if (match.note) {
    const details = document.createElement("details");
    details.className = "watch-note";
    const summary = document.createElement("summary");
    summary.textContent = "Draft application note";
    const p = document.createElement("p");
    p.textContent = match.note;
    details.appendChild(summary);
    details.appendChild(p);
    card.appendChild(details);
  }

  const actions = document.createElement("div");
  actions.className = "job-actions";
  if (match.url) {
    const apply = document.createElement("a");
    apply.className = "apply-link";
    apply.href = match.url;
    apply.target = "_blank";
    apply.rel = "noreferrer";
    apply.textContent = "Apply on Indeed";
    actions.appendChild(apply);
  }

  // Pipe this role into the AI Resume & Cover tab — same hook the dashboard cards use.
  const tailor = document.createElement("button");
  tailor.className = "tailor-btn";
  tailor.type = "button";
  tailor.textContent = "Tailor résumé";
  tailor.addEventListener("click", () => {
    sessionStorage.setItem("jobpulse-tailor", JSON.stringify({
      company: match.company,
      title: match.role,
      jobDesc: `${match.role} at ${match.company}\nLocation: ${match.location || ""}\n${match.fit || ""}\n\nApply: ${match.url || ""}`,
    }));
    document.querySelector('.nav-item[data-view="resume"]').click();
  });
  actions.appendChild(tailor);

  if (match.note) {
    const copy = document.createElement("button");
    copy.className = "ghost-btn";
    copy.type = "button";
    copy.textContent = "Copy note";
    copy.addEventListener("click", () => {
      navigator.clipboard?.writeText(match.note);
      copy.textContent = "Copied ✓";
      setTimeout(() => (copy.textContent = "Copy note"), 1500);
    });
    actions.appendChild(copy);
  }

  // Applied / Un-apply button. In the Applied view it lets the user undo;
  // in Fresh + Archive views it moves the role into Applied.
  const isApplied = watcherView === "applied";
  const applyBtn = document.createElement("button");
  applyBtn.className = "ghost-btn applied-btn" + (isApplied ? " is-applied" : "");
  applyBtn.type = "button";
  applyBtn.textContent = isApplied ? "Un-apply" : "Applied";
  applyBtn.title = isApplied
    ? "Move this role back to Archive."
    : `Mark this role as applied — moves it into the Applied view${match.appliedAt ? "" : ""}.`;
  applyBtn.addEventListener("click", () => watcherMarkApplied(match, !isApplied));
  actions.appendChild(applyBtn);

  card.appendChild(actions);
  return card;
}

let watcherCurrent = [];
let watcherArchive = [];
let watcherApplied = [];
let watcherMeta = { loaded: false, lastSweep: null };
// Which bucket is currently visible in the Watcher tab: "fresh" | "archive" | "applied".
let watcherView = "fresh";

function watchRoleCategory(title) {
  const t = (title || "").toLowerCase();
  if (/(full[ -]?stack)/.test(t)) return "fullstack";
  if (/(\bui\b|\bux\b|user interface|user experience)/.test(t)) return "ui";
  if (t.includes("react")) return "react";
  if (t.includes("front")) return "frontend";
  if (t.includes("web")) return "web";
  return "other";
}

function watchFilter(matches) {
  const q = (document.querySelector("#watchSearch")?.value || "").trim().toLowerCase();
  const role = document.querySelector("#watchRole")?.value || "all";
  const mode = document.querySelector("#watchMode")?.value || "all";
  return matches.filter((m) => {
    if (q && !`${m.role} ${m.company} ${m.location}`.toLowerCase().includes(q)) return false;
    if (role !== "all" && watchRoleCategory(m.role) !== role) return false;
    if (mode !== "all") {
      const remote = /remote/i.test(m.location || "");
      if (mode === "remote" && !remote) return false;
      if (mode === "onsite" && remote) return false;
    }
    return true;
  });
}

// Repaint the Watcher list based on which bucket the user is viewing.
function paintWatcher() {
  const list = document.querySelector("#watcherList");
  const status = document.querySelector("#watcherStatus");
  const heading = document.querySelector("#watcherHeading");
  const archBtn = document.querySelector("#archiveWatcherBtn");
  const appliedBtn = document.querySelector("#appliedWatcherBtn");
  list.innerHTML = "";

  // Header button states reflect the current view.
  if (archBtn) {
    archBtn.textContent = watcherView === "archive"
      ? `Back to fresh (${watcherCurrent.length})`
      : `Archive (${watcherArchive.length})`;
    archBtn.setAttribute("aria-pressed", watcherView === "archive" ? "true" : "false");
  }
  if (appliedBtn) {
    appliedBtn.textContent = watcherView === "applied"
      ? `Back to fresh (${watcherCurrent.length})`
      : `Applied (${watcherApplied.length})`;
    appliedBtn.setAttribute("aria-pressed", watcherView === "applied" ? "true" : "false");
  }
  if (heading) {
    heading.textContent =
      watcherView === "archive" ? "Archive · all previously surfaced roles"
      : watcherView === "applied" ? "Applied · roles you've marked as applied"
      : "Fresh roles from the latest sweep";
  }

  const source =
    watcherView === "archive" ? watcherArchive
    : watcherView === "applied" ? watcherApplied
    : watcherCurrent;

  if (!source.length) {
    if (!watcherMeta.loaded) {
      status.textContent = "Watcher store not reachable yet.";
    } else if (watcherView === "archive") {
      status.textContent = "Archive is empty — older sweeps will collect here as new ones arrive.";
    } else if (watcherView === "applied") {
      status.textContent = "You haven't marked any roles as applied yet. Click 'Applied' on a card after you apply.";
    } else {
      status.textContent = "No fresh matches yet. They appear after the next scheduled sweep (8 AM / 1 PM / 6 PM ET).";
    }
    return;
  }

  const filtered = watchFilter(source);
  const swept = watcherMeta.lastSweep ? ` · last sweep ${timeAgo(watcherMeta.lastSweep)}` : "";
  const label =
    watcherView === "archive" ? "archived role"
    : watcherView === "applied" ? "applied role"
    : "fresh match";
  status.textContent = `Showing ${filtered.length} of ${source.length} ${label}${source.length === 1 ? "" : "s"}${swept}.`;
  filtered.forEach((m) => list.appendChild(watcherCard(m)));
}

function renderWatcher(data) {
  watcherCurrent = (data && data.current) || [];
  watcherArchive = (data && data.archive) || [];
  watcherApplied = (data && data.applied) || [];
  watcherMeta = { loaded: !!data, lastSweep: data && data.lastSweep };
  // Default to the fresh view on every load.
  watcherView = "fresh";
  paintWatcher();
}

async function loadWatcher(force) {
  if (watcherLoaded && !force) return;
  const status = document.querySelector("#watcherStatus");
  status.textContent = "Loading latest matches…";
  const token = syncToken();
  for (const endpoint of WATCH_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, { headers: { "x-jobpulse-pass": token } });
      if (!res.ok) continue;
      const { data } = await res.json();
      watcherLoaded = true;
      renderWatcher(data);
      return;
    } catch (_) { /* try next endpoint */ }
  }
  renderWatcher(null);
}

const refreshWatcherBtn = document.querySelector("#refreshWatcherBtn");
if (refreshWatcherBtn) {
  refreshWatcherBtn.addEventListener("click", () => loadWatcher(true));
}

const archiveWatcherBtn = document.querySelector("#archiveWatcherBtn");
if (archiveWatcherBtn) {
  archiveWatcherBtn.addEventListener("click", () => {
    watcherView = watcherView === "archive" ? "fresh" : "archive";
    paintWatcher();
  });
}

const appliedWatcherBtn = document.querySelector("#appliedWatcherBtn");
if (appliedWatcherBtn) {
  appliedWatcherBtn.addEventListener("click", () => {
    watcherView = watcherView === "applied" ? "fresh" : "applied";
    paintWatcher();
  });
}

// Mark / un-mark a watcher role as applied. Optimistic local update so the UI
// snaps; then sync to the server. Errors fall back gracefully.
async function watcherMarkApplied(match, apply) {
  const action = apply ? "markApplied" : "unmarkApplied";
  const key = ["company", "role", "location"]
    .map((k) => String((match && match[k]) || "").trim().toLowerCase())
    .join("|");

  if (apply) {
    const existing =
      watcherCurrent.find((m) => sameKey(m, key)) ||
      watcherArchive.find((m) => sameKey(m, key)) ||
      match;
    const stamped = { ...existing, appliedAt: new Date().toISOString() };
    watcherCurrent = watcherCurrent.filter((m) => !sameKey(m, key));
    watcherArchive = watcherArchive.filter((m) => !sameKey(m, key));
    watcherApplied = [stamped, ...watcherApplied.filter((m) => !sameKey(m, key))];
  } else {
    const found = watcherApplied.find((m) => sameKey(m, key));
    watcherApplied = watcherApplied.filter((m) => !sameKey(m, key));
    if (found) {
      const { appliedAt, ...rest } = found;
      watcherArchive = [rest, ...watcherArchive.filter((m) => !sameKey(m, key))];
    }
  }
  paintWatcher();

  const token = syncToken();
  const payload = JSON.stringify({
    action,
    match: { company: match.company, role: match.role, location: match.location },
  });
  for (const endpoint of WATCH_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-jobpulse-pass": token },
        body: payload,
      });
      if (res.ok) return;
    } catch (_) { /* try next endpoint */ }
  }
  // If both endpoints failed, refetch so the UI matches reality.
  loadWatcher(true);
}

function sameKey(m, key) {
  return ["company", "role", "location"]
    .map((k) => String((m && m[k]) || "").trim().toLowerCase())
    .join("|") === key;
}

// "Next watcher run" sidebar clock — mirrors the GitHub Actions cron at
// 12:05 / 17:05 / 22:05 UTC (= 8:05 AM / 1:05 PM / 6:05 PM ET in EDT). Shown
// in the user's local timezone so it reads naturally.
const CRON_UTC_HM = [[12, 5], [17, 5], [22, 5]];

function nextSweepDate() {
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (const [h, m] of CRON_UTC_HM) {
    const t = new Date(todayUtc + h * 3600000 + m * 60000);
    if (t > now) return t;
  }
  // All today's runs are in the past — next is tomorrow's first slot.
  const [h, m] = CRON_UTC_HM[0];
  return new Date(todayUtc + 86400000 + h * 3600000 + m * 60000);
}

function formatSweepWhen(d) {
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now.getTime() + 86400000);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today, ${time}`;
  if (isTomorrow) return `Tomorrow, ${time}`;
  return d.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
}

function updateNextSweepDisplay() {
  const el = document.querySelector("#nextSweepTime");
  if (!el) return;
  el.textContent = formatSweepWhen(nextSweepDate());
}

updateNextSweepDisplay();
setInterval(updateNextSweepDisplay, 60 * 1000); // tick every minute so it stays fresh

["input", "change"].forEach((eventName) => {
  ["#watchSearch", "#watchRole", "#watchMode"].forEach((selector) => {
    const field = document.querySelector(selector);
    if (field) field.addEventListener(eventName, paintWatcher);
  });
});

/* ---------- Ask Assistant (Application Q&A) ---------- */

const ASK_ENDPOINTS = ["/api/ask", "/.netlify/functions/ask"];
const CHAT_KEY = "jobpulse-chat";
let chatHistory = [];
try {
  chatHistory = JSON.parse(localStorage.getItem(CHAT_KEY) || "[]");
  if (!Array.isArray(chatHistory)) chatHistory = [];
} catch (_) { chatHistory = []; }

// Build the candidate profile string from the saved Profile fields plus any
// résumé text the user has already uploaded or pasted in Resume & Cover.
function buildAskProfile() {
  const p = (state && state.profile) || {};
  const pastedResume = (document.querySelector("#rResumeText")?.value || "").trim();
  const uploadedResume = (typeof resumeFileText === "string" ? resumeFileText : "").trim();
  const resume = (pastedResume || uploadedResume || "").slice(0, 8000);
  const parts = [];
  if (p.location)     parts.push(`LOCATION: ${p.location}`);
  if (p.experience)   parts.push(`EXPERIENCE LEVEL: ${p.experience}`);
  if (p.sponsorship)  parts.push(`WORK AUTHORIZATION: ${p.sponsorship}`);
  if (p.portfolio)    parts.push(`PORTFOLIO: ${p.portfolio}`);
  if (p.targetTitles) parts.push(`TARGET ROLES: ${p.targetTitles}`);
  if (p.skills)       parts.push(`CORE SKILLS: ${p.skills}`);
  if (p.learning)     parts.push(`CURRENTLY LEARNING: ${p.learning}`);
  if (p.gradDate)     parts.push(`EXPECTED GRADUATION: ${p.gradDate}`);
  if (p.salary)       parts.push(`SALARY TARGET: ${p.salary}`);
  if (resume) {
    parts.push("");
    parts.push("RÉSUMÉ:");
    parts.push(resume);
  }
  return parts.join("\n");
}

function chatScrollToBottom() {
  const list = document.querySelector("#chatHistory");
  if (list) list.scrollTop = list.scrollHeight;
}

function renderChat() {
  const list = document.querySelector("#chatHistory");
  if (!list) return;
  list.innerHTML = "";
  if (!chatHistory.length) {
    const hint = document.createElement("div");
    hint.className = "chat-msg a";
    hint.textContent =
      "Hi! Ask me anything about your job search — interview prep, how to position your React experience for a target company, what to put in a cold email, whether a posting is worth applying to. I'll answer strictly from your profile and résumé — never make things up.";
    list.appendChild(hint);
    return;
  }
  for (const m of chatHistory) {
    const q = document.createElement("div");
    q.className = "chat-msg q";
    q.textContent = m.q;
    list.appendChild(q);
    const a = document.createElement("div");
    let cls = "chat-msg a";
    if (m.pending) cls += " thinking";
    if (m.error) cls += " error";
    a.className = cls;
    a.textContent = m.a || (m.pending ? "Thinking…" : "(no answer)");
    list.appendChild(a);
  }
  chatScrollToBottom();
}

async function sendChat(question) {
  const profile = buildAskProfile();
  if (!profile.trim()) {
    chatHistory.push({
      q: question,
      a: "I don't have your profile yet. Go to the Resume & Cover tab, upload or paste your résumé, then come back and ask. (You can also fill in skills/target roles in the Profile tab.)",
      error: true,
    });
    renderChat();
    return;
  }

  const pending = { q: question, a: "", pending: true };
  chatHistory.push(pending);
  renderChat();

  const recent = chatHistory
    .slice(0, -1)
    .filter((m) => m.a && !m.error)
    .slice(-5)
    .map((m) => ({ q: m.q, a: m.a }));

  let answer = "";
  let failReason = "";
  for (const ep of ASK_ENDPOINTS) {
    try {
      const res = await fetch(ep, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile, question, history: recent }),
      });
      if (!res.ok) {
        failReason = await res.text();
        continue;
      }
      const data = await res.json();
      answer = (data && data.answer) || "";
      if (answer) break;
    } catch (err) {
      failReason = err && err.message ? err.message : "network error";
    }
  }

  pending.pending = false;
  if (answer) {
    pending.a = answer;
  } else {
    pending.a = `Sorry, the assistant couldn't answer right now. (${failReason || "no response"}). Try again in a moment.`;
    pending.error = true;
  }
  // Keep the last 20 exchanges in localStorage so context doesn't bloat.
  try { localStorage.setItem(CHAT_KEY, JSON.stringify(chatHistory.slice(-20))); } catch (_) {}
  renderChat();
}

const chatForm = document.querySelector("#chatForm");
if (chatForm) {
  const sendBtn = document.querySelector("#chatSendBtn");
  chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.querySelector("#chatInput");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = "Asking…"; }
    try { await sendChat(text); }
    finally {
      if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = "Ask"; }
    }
  });
  // Cmd/Ctrl+Enter submits — handy when the textarea has focus.
  document.querySelector("#chatInput")?.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      chatForm.requestSubmit();
    }
  });
  renderChat();
}

const clearChatBtn = document.querySelector("#clearChatBtn");
if (clearChatBtn) {
  clearChatBtn.addEventListener("click", () => {
    if (!chatHistory.length) return;
    if (!confirm("Clear all chat history? This cannot be undone.")) return;
    chatHistory = [];
    try { localStorage.removeItem(CHAT_KEY); } catch (_) {}
    renderChat();
  });
}

/* ---------- LinkedIn Watcher (parallel to Indeed Watcher) ---------- */

const LINKEDIN_ENDPOINTS = ["/api/linkedinwatch", "/.netlify/functions/linkedinwatch"];
let linkedinLoaded = false;
let linkedinCurrent = [];
let linkedinArchive = [];
let linkedinApplied = [];
let linkedinMeta = { loaded: false, lastSweep: null };
let linkedinView = "fresh"; // "fresh" | "archive" | "applied"

function linkedinFilter(matches) {
  const q = (document.querySelector("#linkedinSearch")?.value || "").trim().toLowerCase();
  const role = document.querySelector("#linkedinRole")?.value || "all";
  const mode = document.querySelector("#linkedinMode")?.value || "all";
  return matches.filter((m) => {
    if (q && !`${m.role} ${m.company} ${m.location}`.toLowerCase().includes(q)) return false;
    if (role !== "all" && watchRoleCategory(m.role) !== role) return false;
    if (mode !== "all") {
      const remote = /remote/i.test(m.location || "");
      if (mode === "remote" && !remote) return false;
      if (mode === "onsite" && remote) return false;
    }
    return true;
  });
}

// Card builder mirrors watcherCard with its own Mark-applied wiring so a bug
// in the Indeed card cannot break LinkedIn.
function linkedinCard(match) {
  const card = document.createElement("article");
  card.className = "job-card";

  const main = document.createElement("div");
  main.className = "job-main";
  const left = document.createElement("div");

  const titleRow = document.createElement("div");
  titleRow.className = "job-title-row";
  const h3 = document.createElement("h3");
  if (match.url) {
    const a = document.createElement("a");
    a.href = match.url;
    a.target = "_blank";
    a.rel = "noreferrer";
    a.textContent = match.role || "Role";
    h3.appendChild(a);
  } else {
    h3.textContent = match.role || "Role";
  }
  titleRow.appendChild(h3);
  if (match.fit) {
    const band = document.createElement("span");
    band.className = "fit-band";
    band.textContent = match.fit;
    titleRow.appendChild(band);
  }
  left.appendChild(titleRow);

  const company = document.createElement("p");
  company.className = "company";
  company.textContent = match.company || "";
  left.appendChild(company);

  const meta = document.createElement("p");
  meta.className = "meta";
  meta.textContent = [match.location, match.postedOn ? `posted ${match.postedOn}` : "", timeAgo(match.firstSeen)]
    .filter(Boolean)
    .join(" · ");
  left.appendChild(meta);

  main.appendChild(left);
  card.appendChild(main);

  if (match.note) {
    const details = document.createElement("details");
    details.className = "watch-note";
    const summary = document.createElement("summary");
    summary.textContent = "Draft application note";
    const p = document.createElement("p");
    p.textContent = match.note;
    details.appendChild(summary);
    details.appendChild(p);
    card.appendChild(details);
  }

  const actions = document.createElement("div");
  actions.className = "job-actions";
  if (match.url) {
    const apply = document.createElement("a");
    apply.className = "apply-link";
    apply.href = match.url;
    apply.target = "_blank";
    apply.rel = "noreferrer";
    apply.textContent = "Apply on LinkedIn";
    actions.appendChild(apply);
  }

  const tailor = document.createElement("button");
  tailor.className = "tailor-btn";
  tailor.type = "button";
  tailor.textContent = "Tailor résumé";
  tailor.addEventListener("click", () => {
    sessionStorage.setItem("jobpulse-tailor", JSON.stringify({
      company: match.company,
      title: match.role,
      jobDesc: `${match.role} at ${match.company}\nLocation: ${match.location || ""}\n${match.fit || ""}\n\nApply: ${match.url || ""}`,
    }));
    document.querySelector('.nav-item[data-view="resume"]').click();
  });
  actions.appendChild(tailor);

  if (match.note) {
    const copy = document.createElement("button");
    copy.className = "ghost-btn";
    copy.type = "button";
    copy.textContent = "Copy note";
    copy.addEventListener("click", () => {
      navigator.clipboard?.writeText(match.note);
      copy.textContent = "Copied ✓";
      setTimeout(() => (copy.textContent = "Copy note"), 1500);
    });
    actions.appendChild(copy);
  }

  const isApplied = linkedinView === "applied";
  const applyBtn = document.createElement("button");
  applyBtn.className = "ghost-btn applied-btn" + (isApplied ? " is-applied" : "");
  applyBtn.type = "button";
  applyBtn.textContent = isApplied ? "Un-apply" : "Applied";
  applyBtn.addEventListener("click", () => linkedinMarkApplied(match, !isApplied));
  actions.appendChild(applyBtn);

  card.appendChild(actions);
  return card;
}

function paintLinkedin() {
  const list = document.querySelector("#linkedinList");
  const status = document.querySelector("#linkedinStatus");
  const heading = document.querySelector("#linkedinHeading");
  const archBtn = document.querySelector("#archiveLinkedinBtn");
  const appBtn = document.querySelector("#appliedLinkedinBtn");
  if (!list) return;
  list.innerHTML = "";

  if (archBtn) {
    archBtn.textContent = linkedinView === "archive"
      ? `Back to fresh (${linkedinCurrent.length})`
      : `Archive (${linkedinArchive.length})`;
    archBtn.setAttribute("aria-pressed", linkedinView === "archive" ? "true" : "false");
  }
  if (appBtn) {
    appBtn.textContent = linkedinView === "applied"
      ? `Back to fresh (${linkedinCurrent.length})`
      : `Applied (${linkedinApplied.length})`;
    appBtn.setAttribute("aria-pressed", linkedinView === "applied" ? "true" : "false");
  }
  if (heading) {
    heading.textContent =
      linkedinView === "archive" ? "LinkedIn Archive · previously surfaced roles"
      : linkedinView === "applied" ? "LinkedIn Applied · roles marked as applied"
      : "Fresh LinkedIn roles from the latest sweep";
  }

  const source =
    linkedinView === "archive" ? linkedinArchive
    : linkedinView === "applied" ? linkedinApplied
    : linkedinCurrent;

  if (!source.length) {
    if (!linkedinMeta.loaded) {
      status.textContent = "LinkedIn watcher store not reachable yet.";
    } else if (linkedinView === "archive") {
      status.textContent = "Archive is empty — older LinkedIn sweeps will collect here.";
    } else if (linkedinView === "applied") {
      status.textContent = "No LinkedIn roles marked as applied yet. Click Applied on a card after you apply.";
    } else {
      status.textContent = "No fresh LinkedIn matches yet. JSearch returns fewer LinkedIn-indexed roles than Indeed — try again after the next sweep (8 AM / 1 PM / 6 PM ET).";
    }
    return;
  }

  const filtered = linkedinFilter(source);
  const swept = linkedinMeta.lastSweep ? ` · last sweep ${timeAgo(linkedinMeta.lastSweep)}` : "";
  const label =
    linkedinView === "archive" ? "archived role"
    : linkedinView === "applied" ? "applied role"
    : "fresh match";
  status.textContent = `Showing ${filtered.length} of ${source.length} ${label}${source.length === 1 ? "" : "s"}${swept}.`;
  filtered.forEach((m) => list.appendChild(linkedinCard(m)));
}

function renderLinkedin(data) {
  linkedinCurrent = (data && data.current) || [];
  linkedinArchive = (data && data.archive) || [];
  linkedinApplied = (data && data.applied) || [];
  linkedinMeta = { loaded: !!data, lastSweep: data && data.lastSweep };
  linkedinView = "fresh";
  paintLinkedin();
}

async function loadLinkedin(force) {
  if (linkedinLoaded && !force) return;
  const status = document.querySelector("#linkedinStatus");
  if (status) status.textContent = "Loading latest LinkedIn matches…";
  const token = syncToken();
  for (const endpoint of LINKEDIN_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, { headers: { "x-jobpulse-pass": token } });
      if (!res.ok) continue;
      const { data } = await res.json();
      linkedinLoaded = true;
      renderLinkedin(data);
      return;
    } catch (_) { /* try next endpoint */ }
  }
  renderLinkedin(null);
}

async function linkedinMarkApplied(match, apply) {
  const action = apply ? "markApplied" : "unmarkApplied";
  const key = ["company", "role", "location"]
    .map((k) => String((match && match[k]) || "").trim().toLowerCase())
    .join("|");

  if (apply) {
    const existing =
      linkedinCurrent.find((m) => sameKey(m, key)) ||
      linkedinArchive.find((m) => sameKey(m, key)) ||
      match;
    const stamped = { ...existing, appliedAt: new Date().toISOString() };
    linkedinCurrent = linkedinCurrent.filter((m) => !sameKey(m, key));
    linkedinArchive = linkedinArchive.filter((m) => !sameKey(m, key));
    linkedinApplied = [stamped, ...linkedinApplied.filter((m) => !sameKey(m, key))];
  } else {
    const found = linkedinApplied.find((m) => sameKey(m, key));
    linkedinApplied = linkedinApplied.filter((m) => !sameKey(m, key));
    if (found) {
      const { appliedAt, ...rest } = found;
      linkedinArchive = [rest, ...linkedinArchive.filter((m) => !sameKey(m, key))];
    }
  }
  paintLinkedin();

  const token = syncToken();
  const payload = JSON.stringify({
    action,
    match: { company: match.company, role: match.role, location: match.location },
  });
  for (const endpoint of LINKEDIN_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-jobpulse-pass": token },
        body: payload,
      });
      if (res.ok) return;
    } catch (_) { /* try next */ }
  }
  loadLinkedin(true);
}

// Lazy-load the LinkedIn feed on first nav click — mirrors the Watcher pattern.
elements.navItems.forEach((item) => {
  if (item.dataset.view === "linkedin") {
    item.addEventListener("click", () => { if (!linkedinLoaded) loadLinkedin(); });
  }
});

const refreshLinkedinBtn = document.querySelector("#refreshLinkedinBtn");
if (refreshLinkedinBtn) refreshLinkedinBtn.addEventListener("click", () => loadLinkedin(true));

const archiveLinkedinBtn = document.querySelector("#archiveLinkedinBtn");
if (archiveLinkedinBtn) {
  archiveLinkedinBtn.addEventListener("click", () => {
    linkedinView = linkedinView === "archive" ? "fresh" : "archive";
    paintLinkedin();
  });
}

const appliedLinkedinBtn = document.querySelector("#appliedLinkedinBtn");
if (appliedLinkedinBtn) {
  appliedLinkedinBtn.addEventListener("click", () => {
    linkedinView = linkedinView === "applied" ? "fresh" : "applied";
    paintLinkedin();
  });
}

["input", "change"].forEach((eventName) => {
  ["#linkedinSearch", "#linkedinRole", "#linkedinMode"].forEach((sel) => {
    const field = document.querySelector(sel);
    if (field) field.addEventListener(eventName, paintLinkedin);
  });
});

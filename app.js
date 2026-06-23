const sources = [
  {
    id: "linkedin",
    name: "LinkedIn",
    trust: "Large professional network with broad company coverage.",
    enabled: true,
    search: (query, location) =>
      `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(query)}&location=${encodeURIComponent(location)}`,
  },
  {
    id: "indeed",
    name: "Indeed",
    trust: "High-volume general job board and salary visibility.",
    enabled: true,
    search: (query, location) =>
      `https://www.indeed.com/jobs?q=${encodeURIComponent(query)}&l=${encodeURIComponent(location)}`,
  },
  {
    id: "wellfound",
    name: "Wellfound",
    trust: "Startup roles with clear company and funding context.",
    enabled: true,
    search: (query) => `https://wellfound.com/jobs?keywords=${encodeURIComponent(query)}`,
  },
  {
    id: "builtin",
    name: "Built In",
    trust: "Tech jobs from venture-backed and established companies.",
    enabled: true,
    search: (query) => `https://builtin.com/jobs?search=${encodeURIComponent(query)}`,
  },
  {
    id: "dice",
    name: "Dice",
    trust: "Technology-focused roles with contract and full-time filters.",
    enabled: true,
    search: (query, location) =>
      `https://www.dice.com/jobs?q=${encodeURIComponent(query)}&location=${encodeURIComponent(location)}`,
  },
  {
    id: "weworkremotely",
    name: "We Work Remotely",
    trust: "Curated remote-first jobs across product and engineering.",
    enabled: true,
    search: (query) => `https://weworkremotely.com/remote-jobs/search?term=${encodeURIComponent(query)}`,
  },
  {
    id: "remoteok",
    name: "Remote OK",
    trust: "Remote roles with fast-moving startup listings.",
    enabled: true,
    search: (query) => `https://remoteok.com/remote-${encodeURIComponent(query.replaceAll(" ", "-"))}-jobs`,
  },
  {
    id: "greenhouse",
    name: "Greenhouse Boards",
    trust: "Direct company postings from an applicant tracking system.",
    enabled: true,
    search: (query) => `https://www.google.com/search?q=${encodeURIComponent(`${query} site:boards.greenhouse.io`)}`,
  },
  {
    id: "lever",
    name: "Lever Boards",
    trust: "Direct company postings from an applicant tracking system.",
    enabled: true,
    search: (query) => `https://www.google.com/search?q=${encodeURIComponent(`${query} site:jobs.lever.co`)}`,
  },
  {
    id: "ashby",
    name: "Ashby Boards",
    trust: "Modern company career pages with accurate application links.",
    enabled: true,
    search: (query) => `https://www.google.com/search?q=${encodeURIComponent(`${query} site:jobs.ashbyhq.com`)}`,
  },
];

const jobs = [
  {
    id: "job-1",
    title: "Frontend Developer",
    company: "Northstar Health",
    source: "greenhouse",
    location: "Remote, United States",
    mode: "Remote",
    posted: "Today",
    salary: "$92k-$118k",
    match: 94,
    role: "Frontend Developer",
    skills: ["React", "TypeScript", "REST APIs", "Accessibility"],
    summary: "Build patient-facing dashboards with React, reusable components, and measurable accessibility improvements.",
  },
  {
    id: "job-2",
    title: "Junior Full Stack Engineer",
    company: "CivicGrid",
    source: "lever",
    location: "New York, NY",
    mode: "Hybrid",
    posted: "Today",
    salary: "$82k-$105k",
    match: 88,
    role: "Full Stack Developer",
    skills: ["Next.js", "Node.js", "PostgreSQL", "APIs"],
    summary: "Work across product features, API endpoints, and internal tools for a public-sector SaaS platform.",
  },
  {
    id: "job-3",
    title: "React Developer",
    company: "LedgerLoop",
    source: "builtin",
    location: "Remote, United States",
    mode: "Remote",
    posted: "1 day ago",
    salary: "$90k-$125k",
    match: 91,
    role: "React Developer",
    skills: ["React", "JavaScript", "Design Systems", "Testing"],
    summary: "Own frontend feature delivery for a finance operations product with a mature component library.",
  },
  {
    id: "job-4",
    title: "Software Engineer I",
    company: "BrightCart",
    source: "indeed",
    location: "Austin, TX",
    mode: "Onsite",
    posted: "Today",
    salary: "$78k-$96k",
    match: 76,
    role: "Software Engineer",
    skills: ["JavaScript", "Node.js", "SQL", "Git"],
    summary: "Join a commerce platform team shipping customer workflows, analytics surfaces, and backend integrations.",
  },
  {
    id: "job-5",
    title: "Remote Frontend Engineer",
    company: "Atlas Labs",
    source: "weworkremotely",
    location: "Remote",
    mode: "Remote",
    posted: "2 days ago",
    salary: "$85k-$120k",
    match: 86,
    role: "Frontend Developer",
    skills: ["React", "Tailwind", "TypeScript", "Product UI"],
    summary: "Create polished product surfaces for analytics customers with a small remote engineering team.",
  },
  {
    id: "job-6",
    title: "Associate Web Developer",
    company: "BluePeak Media",
    source: "linkedin",
    location: "Chicago, IL",
    mode: "Hybrid",
    posted: "3 days ago",
    salary: "$70k-$88k",
    match: 72,
    role: "Frontend Developer",
    skills: ["JavaScript", "CSS", "React", "CMS"],
    summary: "Support client web builds, landing pages, reusable UI patterns, and performance improvements.",
  },
  {
    id: "job-7",
    title: "Founding Full Stack Developer",
    company: "SignalHire AI",
    source: "wellfound",
    location: "Remote, North America",
    mode: "Remote",
    posted: "Today",
    salary: "$95k-$135k + equity",
    match: 84,
    role: "Full Stack Developer",
    skills: ["Next.js", "Node.js", "AI APIs", "PostgreSQL"],
    summary: "Build candidate matching tools and hiring workflows at an early-stage recruiting automation startup.",
  },
  {
    id: "job-8",
    title: "TypeScript UI Engineer",
    company: "OpsRiver",
    source: "ashby",
    location: "Remote, United States",
    mode: "Remote",
    posted: "1 day ago",
    salary: "$100k-$130k",
    match: 89,
    role: "Frontend Developer",
    skills: ["TypeScript", "React", "Charts", "Testing"],
    summary: "Develop operational dashboards with dense data tables, charts, and high-quality user interactions.",
  },
];

const state = {
  profile: JSON.parse(localStorage.getItem("jobpulse-profile") || "null") || {
    targetTitles: "Frontend Developer, React Developer, Full Stack Developer, Software Engineer",
    skills: "React, JavaScript, TypeScript, Next.js, Node.js, Tailwind, REST APIs",
    location: "United States, Remote",
    experience: "Junior to mid level",
    salary: "$80k+",
    sponsorship: "No sponsorship needed",
  },
  enabledSources: JSON.parse(localStorage.getItem("jobpulse-sources") || "null") || sources.reduce((acc, source) => {
    acc[source.id] = source.enabled;
    return acc;
  }, {}),
  saved: JSON.parse(localStorage.getItem("jobpulse-saved") || "{}"),
  applied: JSON.parse(localStorage.getItem("jobpulse-applied") || "{}"),
  hidden: JSON.parse(localStorage.getItem("jobpulse-hidden") || "{}"),
};

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
};

function save(key, value) {
  localStorage.setItem(`jobpulse-${key}`, JSON.stringify(value));
}

function sourceById(sourceId) {
  return sources.find((source) => source.id === sourceId);
}

function queryText() {
  return elements.searchInput.value.trim() || state.profile.targetTitles.split(",")[0].trim();
}

function applyUrl(job) {
  const source = sourceById(job.source);
  return source.search(`${job.title} ${job.company}`, job.location);
}

function visibleJobs() {
  const minMatch = Number(elements.matchFilter.value);
  const role = elements.roleFilter.value;
  const mode = elements.modeFilter.value;
  const search = elements.searchInput.value.toLowerCase().trim();

  return jobs
    .filter((job) => state.enabledSources[job.source])
    .filter((job) => !state.hidden[job.id])
    .filter((job) => job.match >= minMatch)
    .filter((job) => role === "all" || job.role === role)
    .filter((job) => mode === "all" || job.mode === mode)
    .filter((job) => {
      if (!search) return true;
      return [job.title, job.company, job.location, job.source, ...job.skills].join(" ").toLowerCase().includes(search);
    })
    .sort((a, b) => b.match - a.match);
}

function renderMetrics(list) {
  const enabledCount = sources.filter((source) => state.enabledSources[source.id]).length;
  elements.newToday.textContent = list.filter((job) => job.posted === "Today").length;
  elements.bestMatch.textContent = `${list[0]?.match || 0}%`;
  elements.sourceCount.textContent = enabledCount;
  elements.readyCount.textContent = list.length;
}

function renderJobs() {
  const list = visibleJobs();
  elements.jobList.innerHTML = "";
  list.forEach((job) => {
    const node = elements.template.content.cloneNode(true);
    node.querySelector("h3").textContent = job.title;
    node.querySelector(".badge").textContent = sourceById(job.source).name;
    node.querySelector(".company").textContent = job.company;
    node.querySelector(".meta").textContent = `${job.location} | ${job.mode} | ${job.salary} | ${job.posted}`;
    node.querySelector(".score").textContent = `${job.match}%`;
    node.querySelector(".summary").textContent = job.summary;
    node.querySelector(".skill-row").innerHTML = job.skills.map((skill) => `<span>${skill}</span>`).join("");

    const applyLink = node.querySelector(".apply-link");
    applyLink.href = applyUrl(job);
    applyLink.textContent = "Apply";

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

    elements.jobList.appendChild(node);
  });

  if (!list.length) {
    elements.jobList.innerHTML = '<div class="tracker-empty">No matches with these filters. Lower the match score or turn on more sources.</div>';
  }

  renderMetrics(list);
}

function renderSources() {
  elements.sourceGrid.innerHTML = "";
  sources.forEach((source) => {
    const card = document.createElement("article");
    card.className = "source-card";
    card.innerHTML = `
      <header>
        <h3>${source.name}</h3>
        <button class="switch ${state.enabledSources[source.id] ? "active" : ""}" aria-label="Toggle ${source.name}"></button>
      </header>
      <p>${source.trust}</p>
    `;
    card.querySelector("button").addEventListener("click", () => {
      state.enabledSources[source.id] = !state.enabledSources[source.id];
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
          <p class="meta">${job.location} | ${sourceById(job.source).name} | ${job.match}% match</p>
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
  elements.roleFilter.innerHTML = '<option value="all">All roles</option>';
  roles.forEach((role) => {
    const option = document.createElement("option");
    option.value = role;
    option.textContent = role;
    elements.roleFilter.appendChild(option);
  });
}

function updateSearchLink() {
  const activeSources = sources.filter((source) => state.enabledSources[source.id]);
  const source = activeSources[0] || sources[0];
  elements.multiSearchLink.href = source.search(queryText(), state.profile.location);
}

function renderAll() {
  elements.matchLabel.textContent = `${elements.matchFilter.value}%`;
  updateSearchLink();
  renderJobs();
  renderSources();
  renderTracker();
}

elements.navItems.forEach((item) => {
  item.addEventListener("click", () => {
    elements.navItems.forEach((nav) => nav.classList.remove("active"));
    elements.views.forEach((view) => view.classList.remove("active"));
    item.classList.add("active");
    document.querySelector(`#${item.dataset.view}`).classList.add("active");
  });
});

["input", "change"].forEach((eventName) => {
  [elements.roleFilter, elements.modeFilter, elements.matchFilter, elements.searchInput].forEach((input) => {
    input.addEventListener(eventName, renderAll);
  });
});

document.querySelector("#saveProfile").addEventListener("click", (event) => {
  event.preventDefault();
  ["targetTitles", "skills", "location", "experience", "salary", "sponsorship"].forEach((key) => {
    state.profile[key] = document.querySelector(`#${key}`).value;
  });
  save("profile", state.profile);
  renderAll();
});

document.querySelector("#refreshBtn").addEventListener("click", () => {
  state.hidden = {};
  save("hidden", state.hidden);
  renderAll();
});

renderRoles();
renderProfile();
renderAll();

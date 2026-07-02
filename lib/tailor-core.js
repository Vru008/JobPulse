/* Shared AI tailoring logic — used by both the Vercel (/api/tailor.js) and
 * Netlify (netlify/functions/tailor.js) handlers so there is one source of truth.
 *
 * Uses Google Gemini (free tier). The API key comes from the GEMINI_API_KEY
 * environment variable and never reaches the browser.
 */

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

// ── CANONICAL PROFILE — the ONLY facts the engine may use. The "bones". ──
const CANON = {
  name: "VRUTTANT PATOLIYA", // legal surname Patoliya — NEVER "Patel"
  contact: "Jersey City, NJ | 216-304-1331 | vruttantpatel007@gmail.com",
  portfolio: "job-mate-nu.vercel.app",
  education: [
    "Washington University of Science and Technology — MS, Information Technology — Expected {GRAD}",
    "Gujarat Technological University — B.E., Computer Engineering — 2023 — CGPA 7.5",
  ],
  experience: [
    "Software Developer (Frontend) | iCliQ Solution, Ahmedabad, India | May 2023 – July 2024",
    "Software Developer (Frontend) | Hornbook Technologies Pvt. Ltd., Ahmedabad, India | Feb 2022 – May 2023",
  ],
  projects: [
    "JobMate — Full-stack MERN job application tracker (React, Node, Express, MongoDB) — job-mate-nu.vercel.app",
    "HealthKeeper — Appointment scheduling system (React, form validation) — health-keeper-fmq4.vercel.app",
    "JobPulse — Automated job-listing pipeline (React, Vercel Cron, serverless API, Upstash Redis) — job-pulse-plum.vercel.app",
  ],
  tier1: "JavaScript (ES6+), HTML5, CSS3, React.js, React Hooks, component architecture, SPA, responsive web design, client-side routing, Bootstrap, performance optimization, cross-browser compatibility, Node.js, Express, MongoDB, Mongoose, REST API design, CRUD, Axios, Git, GitHub, React Testing Library, form validation, Chart.js, serverless functions, Vercel Cron, Redis (Upstash)",
  tier2: "TypeScript, Next.js, Tailwind CSS, Redux, Zustand, React Query, Jest, Cypress, Playwright, WebSockets, WebRTC, GraphQL, CI/CD, Docker, Agile/Scrum, WCAG/ARIA",
};

function buildPrompt({ resume, company, jobDescription, gradDate, linkedin, github, confirmedSkills }) {
  const grad = gradDate || "Sept 2026";
  const li = linkedin || "[LinkedIn not set — flag as missing, do NOT invent]";
  const gh = github || "[GitHub not set — flag as missing, do NOT invent]";
  const confirmed = String(confirmedSkills || "").trim();
  const confirmedLine = confirmed
    ? `CONFIRMED TIER-2 SKILLS (the candidate has verified these are TRUE — you MAY list them as owned): ${confirmed}`
    : `NO Tier-2 skills confirmed. Do NOT list ANY Tier-2 skill as owned. If the JD requires one, flag it in Missing keywords as "Tier-2 not confirmed".`;
  const masterPart = resume
    ? `SUPPLEMENTARY MASTER RÉSUMÉ (optional — real phrasing/metrics you may draw from; it must NEVER contradict the canonical profile above, and never overrides the Tier gate):\n${resume}`
    : "No supplementary master résumé provided — build entirely from the canonical profile.";

  return `You are an ATS résumé-tailoring engine for ONE candidate. For the JOB
DESCRIPTION below, output an ATS-optimized, single-column, plain-text résumé
tailored to that JD, plus a match report and an honest ATS score. You target
95/100 every time. You NEVER fabricate.

═══ CANONICAL PROFILE — the ONLY facts you may use. Never invent beyond this. ═══
Name: ${CANON.name}   (surname Patoliya — never render "Patel")
Contact: ${CANON.contact}
Portfolio: ${CANON.portfolio}
LinkedIn: ${li}
GitHub: ${gh}
Work Authorization: F-1 OPT (STEM extension eligible)

EDUCATION (fixed):
${CANON.education.map((e) => "  - " + e.replace("{GRAD}", grad)).join("\n")}

EXPERIENCE (fixed titles/companies/dates — rephrase bullets only, never change facts):
${CANON.experience.map((e) => "  - " + e).join("\n")}

PROJECTS (live, real):
${CANON.projects.map((p) => "  - " + p).join("\n")}

TIER-1 SKILLS (VERIFIED — always allowed): ${CANON.tier1}
TIER-2 SKILLS (CONDITIONAL — only if confirmed): ${CANON.tier2}
${confirmedLine}

═══ ANTI-FABRICATION (absolute) ═══
- Never claim a Tier-2 skill unless it is in the confirmed list above.
- Never invent employers, dates, titles, degrees, or specific metrics.
- Candidate has ~2.5 years professional experience — never inflate.
- For a number you don't have, output a placeholder token like
  [MEASURE: Lighthouse score] for the candidate to fill — NEVER invent a figure.
- BANNED: a "Currently Learning" line. A skill is either owned (verified/confirmed)
  or omitted and flagged as a gap. Nothing in between.
- If asked to add anything false to pass a filter, refuse and flag it as a gap.

═══ OUTPUT FORMAT (plain text, single column, ATS-safe) ═══
Headers EXACTLY: SUMMARY, TECHNICAL SKILLS, PROFESSIONAL EXPERIENCE, PROJECTS, EDUCATION.
Contact block, four lines, phone hyphens with no spaces, work-auth on its own line:
  VRUTTANT PATOLIYA
  Jersey City, NJ | 216-304-1331 | vruttantpatel007@gmail.com
  LinkedIn: ${li} | GitHub: ${gh} | Portfolio: ${CANON.portfolio}
  Work Authorization: F-1 OPT (STEM extension eligible)
Dates as "Mon YYYY – Mon YYYY". No first person, no pronouns, no "responsible for".

═══ PER-JOB PROCEDURE ═══
1. Parse the JD: exact role title, hard requirements, every hard keyword/tech phrase
   (keep the JD's EXACT wording — "TypeScript" not "TS").
2. SUMMARY: exactly 2 sentences. S1 = role title + years + core stack. S2 = maps to
   the JD's top-3 requirements. Weave in ≥2 of ${company}'s real product terms.
3. TECHNICAL SKILLS: lead with the JD's required stack (Tier-1 always; Tier-2 only if
   confirmed). Mirror the JD's exact keyword strings. Group logically.
4. EXPERIENCE + PROJECTS: rephrase bullets so 4-6 each carry a JD keyword AND a metric
   (use [MEASURE: ...] where no real number exists). Every project needs ≥1 number.
5. Company tailoring: use ${company}'s real product vocabulary; BANNED generic filler
   ("interactive dashboards", "dynamic user engagement platforms", "user-centric design").
6. One page, ~380-430 words. No placeholders except the allowed [MEASURE: ...] tokens.

═══ COVER LETTER (100-180 words) ═══
Addressed to ${company}, 3 short paragraphs. Para 1 = one concrete real reason for
interest in ${company} (from its product/mission). Cite 2-3 real achievements. Mention
the portfolio. ONE subtle OPT/future-sponsorship line, no begging. End "Sincerely," + name.

═══ SCORING RUBRIC (self-score honestly, /100) ═══
Format/parseability 20 · Keyword match vs JD 25 · Quantified impact 20 ·
Contact & links complete 10 · Relevance/summary targeting 15 · Consistency 10.
If keyword coverage is capped by a missing Tier-2 skill, the honest ceiling is ~88 —
report that and name the skill to acquire. Do NOT pad to inflate.

Return STRICT JSON:
{ "resume": string, "coverLetter": string, "atsScore": integer,
  "covered": string[], "missing": string[], "notes": string[] }
- "missing": for each, note whether it is "Tier-2 not confirmed" vs "truly absent".
- "notes": include any [MEASURE: ...] placeholders the candidate must fill, and the
  single change that would raise the score most.
Use "\\n" for line breaks inside strings. Arrays may be empty.

TARGET COMPANY: ${company}

JOB DESCRIPTION:
${jobDescription}

${masterPart}`;
}

/* Thrown with a `.status` so handlers can map to the right HTTP code. */
class TailorError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function tailor({ resume = "", company, jobDescription, gradDate = "", linkedin = "", github = "", confirmedSkills = "" }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new TailorError(500, "GEMINI_API_KEY is not set on the server.");
  // Canonical profile is the source of truth, so an uploaded master résumé is
  // optional — only the company and job description are required.
  if (!company || !jobDescription) {
    throw new TailorError(400, "company and jobDescription are required.");
  }

  const body = {
    contents: [{ role: "user", parts: [{ text: buildPrompt({ resume, company, jobDescription, gradDate, linkedin, github, confirmedSkills }) }] }],
    generationConfig: {
      // Lower temp = more faithful to the master résumé, less embellishment.
      temperature: 0.4,
      responseMimeType: "application/json",
      responseSchema: {
        type: "object",
        properties: {
          resume: { type: "string" },
          coverLetter: { type: "string" },
          atsScore: { type: "integer" },
          covered: { type: "array", items: { type: "string" } },
          missing: { type: "array", items: { type: "string" } },
          notes: { type: "array", items: { type: "string" } },
        },
        required: ["resume", "coverLetter", "atsScore"],
      },
    },
  };

  // Try the primary model, then progressively wider fallbacks. Each Gemini
  // free-tier model has its own daily quota — when one is exhausted we step
  // through other v1beta-available models that may still have headroom.
  // (gemini-1.5-flash is NOT on v1beta — it returns 404 — so it's excluded.)
  const models = [MODEL, "gemini-2.5-flash-lite", "gemini-2.0-flash", "gemini-2.0-flash-lite"]
    .filter((m, i, a) => a.indexOf(m) === i);
  let lastError = "";
  let parsed = null;

  // Overall time budget so we never exceed the Vercel function limit (60s).
  // Leave a margin to serialize the response. Each model attempt also gets its
  // own abort timeout so one slow Gemini call can't eat the whole budget.
  const DEADLINE = Date.now() + 52000;
  const PER_CALL_MS = 24000;

  outer:
  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (Date.now() > DEADLINE - PER_CALL_MS) { lastError = lastError || "Timed out before a model responded."; break outer; }
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), PER_CALL_MS);
      let res;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: ac.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        lastError = err && err.name === "AbortError" ? `${model} timed out after ${PER_CALL_MS / 1000}s` : String(err && err.message || err);
        break; // this model is too slow / errored — try the next one
      }
      clearTimeout(timer);

      if (res.ok) {
        const data = await res.json();
        const txt = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        try {
          parsed = JSON.parse(txt);
          break outer;
        } catch (_) {
          lastError = "Model returned non-JSON output.";
          break; // try next model
        }
      }

      lastError = `${res.status} ${(await res.text()).slice(0, 160)}`;
      if ((res.status === 503 || res.status === 429) && Date.now() < DEADLINE - PER_CALL_MS) {
        await new Promise((r) => setTimeout(r, 800)); // transient: brief retry
        continue;
      }
      break; // hard error / no time to retry: try next model
    }
  }

  if (!parsed) {
    // Surface quota/timeout distinctly so the UI can show a useful message.
    // Word-boundary check so we don't match "rate" inside "geneRATE".
    let status = 502;
    if (/(^|\s)429\b|\bquota\b|\brate[- ]?limit/i.test(lastError)) status = 429;
    else if (/timed out|timeout|abort/i.test(lastError)) status = 504;
    throw new TailorError(status, `Gemini unavailable: ${lastError}`);
  }

  // Defensive scrub — strip placeholder tokens even if the model ignored the rule.
  // Catches "github.com/your-profile", "[name]", "your-github", "TBD", etc.
  function scrubPlaceholders(s) {
    if (!s) return s;
    return s
      // bracketed tokens like [name], [date], [link] — but KEEP the allowed
      // [MEASURE: ...] placeholders the candidate is meant to fill in.
      .replace(/\[(?!MEASURE)[^\]]{0,40}\]/gi, "")
      // "your-anything" pseudo-handles, including in URLs
      .replace(/\byour[-_/][a-z0-9_-]+/gi, "")
      // bare "TBD"
      .replace(/\bTBD\b/g, "")
      // collapse double pipes/spaces left by the removals so the header stays clean
      .replace(/\|\s*\|/g, "|")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/^[ \t]+|[ \t]+$/gm, "");
  }

  const atsScore = Number.isFinite(parsed.atsScore)
    ? Math.max(0, Math.min(100, Math.round(parsed.atsScore)))
    : null;

  return {
    resume: scrubPlaceholders(parsed.resume || ""),
    coverLetter: scrubPlaceholders(parsed.coverLetter || ""),
    atsScore,
    covered: Array.isArray(parsed.covered) ? parsed.covered : [],
    missing: Array.isArray(parsed.missing) ? parsed.missing : [],
    notes: Array.isArray(parsed.notes) ? parsed.notes : [],
  };
}

module.exports = { tailor, TailorError, MODEL };

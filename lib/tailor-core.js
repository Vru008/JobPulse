/* Shared AI tailoring logic — used by both the Vercel (/api/tailor.js) and
 * Netlify (netlify/functions/tailor.js) handlers so there is one source of truth.
 *
 * Uses Google Gemini (free tier). The API key comes from the GEMINI_API_KEY
 * environment variable and never reaches the browser.
 */

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

function buildPrompt({ resume, company, jobDescription, portfolio, gradDate, linkedin, github }) {
  // Contact-detail lines we KNOW (from the Profile tab). The model must use these
  // exact values and never fabricate a handle.
  const known = [];
  if (linkedin) known.push(`LinkedIn: ${linkedin}`);
  if (github) known.push(`GitHub: ${github}`);
  if (portfolio) known.push(`Portfolio: ${portfolio}`);
  const knownContactBlock = known.length
    ? `KNOWN CONTACT LINKS (use these EXACT values in the contact block — do not alter or invent):\n${known.map((k) => "  " + k).join("\n")}`
    : `NO LinkedIn/GitHub/Portfolio links were provided. Use whatever real links exist in the master résumé. If LinkedIn or GitHub is genuinely absent, DO NOT fabricate one — instead flag it in the MATCH REPORT as a missing high-value item (missing LinkedIn+GitHub costs ~5 ATS points).`;

  const gradPart = gradDate
    ? `In the EDUCATION line for the in-progress MS degree, write the status as "(Expected ${gradDate})" EXACTLY VERBATIM. NEVER write "(In Progress)", and NEVER invent a different year — copy ${gradDate} character-for-character.`
    : `gradDate was not provided. For the in-progress MS degree, DO NOT invent a date — write "(Expected — date pending)" and flag in the MATCH REPORT that the candidate should set their Expected graduation date in the Profile tab.`;

  return `You are an ATS résumé-tailoring engine optimizing for a 95/100 ATS score.
You tailor a MASTER RÉSUMÉ to a specific JOB DESCRIPTION for an international
candidate on F-1 OPT (STEM extension eligible). Accuracy over embellishment:
NEVER invent skills, employers, dates, degrees, or metrics not supported by the
master résumé.

═══ OUTPUT FORMAT (mandatory, in this exact order) ═══
Single column, plain text, ATS-safe. No tables, columns, graphics, text boxes,
or emojis. Bullets start with "- ". Standard section headers ONLY:
SUMMARY, TECHNICAL SKILLS, PROFESSIONAL EXPERIENCE, PROJECTS, EDUCATION.

CONTACT BLOCK — format EXACTLY like this, four lines, work-authorization on its
OWN line, phone with NO spaces around hyphens:

  FULL NAME IN CAPS
  City, ST | phone | email
  LinkedIn: <url> | GitHub: <url> | Portfolio: <url>
  Work Authorization: F-1 OPT (STEM extension eligible)

${knownContactBlock}

SUMMARY
- EXACTLY 2 sentences. Sentence 1 targets THIS role's exact title and the JD's top
  3 requirements. Sentence 2 cites the strongest relevant proof (years + a concrete
  project/metric). No first person. Weave in ≥2 of ${company}'s real product terms.

TECHNICAL SKILLS  (mirror the JD's EXACT wording; group like this)
- Languages: <e.g. JavaScript (ES6+), TypeScript, HTML5, CSS3 — only if in master>
- Frontend: <React.js, React Hooks, Next.js, Redux/Context, Tailwind CSS, Bootstrap,
  Responsive Design, Client-side Routing, Performance Optimization, Cross-browser ...>
- Backend: <Node.js, Express, MongoDB, Mongoose, REST API design>
- Testing & Quality: <Jest, React Testing Library, Git, GitHub, CI/CD>
- Practices: <Agile/Scrum, WCAG/ARIA accessibility, UI/UX collaboration>
  RULES: (a) Mirror the JD's exact phrasing — if the JD says "TypeScript" write
  "TypeScript" not "TS". (b) Include a skill ONLY if it already appears in the
  master résumé — never invent. (c) NEVER include a "Currently Learning" line on
  the résumé; only list skills defensible in an interview.

PROFESSIONAL EXPERIENCE
<Title> | <Company, Location>   <Mon YYYY - Mon YYYY>
- Every bullet: strong past-tense verb + a METRIC or a concrete JD keyword, under
  2 lines. At least 2-3 bullets across the résumé must naturally contain standard
  ATS keywords: "accessible (WCAG/ARIA)", "Agile", "unit tested", and "TypeScript"
  (only if true in master). (most recent role up to 5 bullets; older up to 2)

PROJECTS
<Project Name> - <short subtitle> (<key tech>)
- Each project needs ≥1 bullet with a NUMBER (users served, records handled,
  load time X→Ys, Lighthouse score, % reduction). Use real numbers from the
  master résumé; if none exist for a project, keep the claim qualitative rather
  than inventing a figure, and note it. (up to 3 projects, 2 bullets each; include
  JobMate as a full-stack MERN project.)

EDUCATION
<School> - <Degree, field> (Expected ${gradDate || "…"}) | <details>
${gradPart}

═══ TAILORING RULES ═══
- Extract the JD's hard requirements and exact keyword phrases; mirror that exact
  wording in the skills line and in 2-3 experience bullets.
- Use ${company}'s real product vocabulary (its actual product/industry) in the
  SUMMARY (≥2 terms), a domain-relevant skills emphasis, and cover-letter para 1,
  so this résumé reads visibly different from one for any other company. BANNED
  generic filler: "interactive dashboards", "dynamic user engagement platforms",
  "user-centric design". Use the company's real product nouns instead.
- One page, ~380-430 words. Keep the candidate's real name, contact, companies,
  and dates. NO placeholders ever ("your-profile", "[name]", "TBD", brackets).

═══ COVER LETTER (100-180 words) ═══
Business letter addressed to ${company}, 3 short paragraphs. Para 1 gives one
concrete, real reason for interest in ${company} (from its product/mission).
Cite 2-3 real achievements. Mention the portfolio as proof. ONE subtle line about
being authorized to work now on OPT, open to future sponsorship — no begging. End
"Sincerely," + name.

═══ MATCH REPORT (this is what makes the résumé score well) ═══
After the résumé + cover letter, produce a match report:
- "covered": array of JD keywords/requirements the tailored résumé now satisfies.
- "missing": array of JD keywords/requirements the master résumé genuinely does
  NOT support (skills the candidate can't yet claim). NEVER fabricate to fill these.
- "atsScore": integer 0-100, your honest estimate for THIS tailored résumé vs THIS JD.
- If atsScore < 92, the missing[] list MUST explain the specific gap (e.g. "JD
  requires TypeScript; not in master résumé — ship a TS/Next.js/Tailwind project to
  claim it truthfully"). Do NOT pad the résumé to inflate the score.

Return STRICT JSON:
{ "resume": string, "coverLetter": string, "atsScore": integer,
  "covered": string[], "missing": string[], "notes": string[] }
Use "\\n" for line breaks inside strings. Arrays may be empty.

TARGET COMPANY: ${company}

JOB DESCRIPTION:
${jobDescription}

CANDIDATE'S MASTER RÉSUMÉ:
${resume}`;
}

/* Thrown with a `.status` so handlers can map to the right HTTP code. */
class TailorError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function tailor({ resume, company, jobDescription, portfolio = "", gradDate = "", linkedin = "", github = "" }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new TailorError(500, "GEMINI_API_KEY is not set on the server.");
  if (!resume || !company || !jobDescription) {
    throw new TailorError(400, "resume, company and jobDescription are required.");
  }

  const body = {
    contents: [{ role: "user", parts: [{ text: buildPrompt({ resume, company, jobDescription, portfolio, gradDate, linkedin, github }) }] }],
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

  outer:
  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

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
      if (res.status === 503 || res.status === 429) {
        await new Promise((r) => setTimeout(r, 1200)); // transient: retry
        continue;
      }
      break; // hard error: try next model
    }
  }

  if (!parsed) {
    // Surface quota exhaustion as 429 so the UI can show a useful message.
    // Word-boundary check so we don't match "rate" inside "geneRATE".
    const status = /(^|\s)429\b|\bquota\b|\brate[- ]?limit/i.test(lastError) ? 429 : 502;
    throw new TailorError(status, `Gemini unavailable after retries: ${lastError}`);
  }

  // Defensive scrub — strip placeholder tokens even if the model ignored the rule.
  // Catches "github.com/your-profile", "[name]", "your-github", "TBD", etc.
  function scrubPlaceholders(s) {
    if (!s) return s;
    return s
      // bracketed tokens like [name], [date], [link]
      .replace(/\[[^\]]{0,40}\]/g, "")
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

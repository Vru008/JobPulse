/* Shared AI tailoring logic — used by both the Vercel (/api/tailor.js) and
 * Netlify (netlify/functions/tailor.js) handlers so there is one source of truth.
 *
 * Uses Google Gemini (free tier). The API key comes from the GEMINI_API_KEY
 * environment variable and never reaches the browser.
 */

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

function buildPrompt({ resume, company, jobDescription, portfolio, currentlyLearning }) {
  const portfolioPart = portfolio ? ` | ${portfolio}` : "";
  const learningPart = currentlyLearning
    ? `\n- Add a final TECHNICAL SKILLS bullet: "- Currently Learning: ${currentlyLearning}".`
    : "";

  return `You are an expert technical résumé writer helping an international candidate
on F-1 OPT (STEM extension eligible). Rewrite the résumé and write a cover letter,
tailored to the target company and job description. Output a polished, complete,
professional ONE-PAGE résumé — never sparse or placeholder.

FOLLOW THIS EXACT FORMAT AND ORDER (this is mandatory every time):

NAME IN ALL CAPS
phone | email | location | github/links${portfolioPart} | Authorized to work via OPT (STEM extension eligible)

SUMMARY
<3-4 lines: years of experience, strongest relevant project depth tied to THIS
company's domain, full-stack (MERN) experience, and MS in progress. No first person.>

TECHNICAL SKILLS
- Full Stack (MERN): <React, Node.js, Express, MongoDB, Mongoose, REST API design, ...>
- Frontend: <React Hooks, state management, component architecture, SPA, responsive, ...>
- Languages: <JavaScript (ES6+), HTML5, CSS3, ...>
- <DOMAIN> relevant: <name this category after the target company's domain — e.g.
  "Healthcare relevant", "Fintech relevant", "E-commerce relevant" — and list only
  the candidate's real skills/experience that map to that domain>
- Tools & Quality: <Git, GitHub, React Testing Library, Axios, validation, ...>${learningPart}

PROFESSIONAL EXPERIENCE
<Title> | <Company, Location>   <Mon YYYY - Mon YYYY>
- <past-tense action-verb bullet, one line, quantified where possible>
(most recent role: up to 5 bullets; older roles: up to 2)

PROJECTS
<Project Name> - <short subtitle> (<key tech>)
- <one-line bullet>
(up to 3 projects, 2 bullets each; include JobMate as a full-stack MERN project)

EDUCATION
<School> - <Degree, field> (<status, e.g. In Progress>) | <details if any>

HARD RULES:
- Plain text only, single column, ATS-safe. No tables, columns, graphics, or emojis.
  Bullets start with "- ".
- MUST FIT ON ONE PAGE: roughly 380-430 words.
- Mirror the JOB DESCRIPTION's key skills/keywords, but ONLY where the source résumé
  supports them. NEVER invent jobs, employers, dates, degrees, or skills.
- Keep the candidate's real name, contact details, companies, and dates from the source.
- Every section filled with real content — NO placeholders. NEVER write "your-profile",
  "[name]", "[link]", "your-github", "[date]", "TBD", or any bracketed/template token.
  Use ONLY the actual values from the candidate's source résumé. If a value is missing
  from the source (e.g. no github), simply omit it from the header — do not invent one.
- TAILOR FOR THIS COMPANY AGGRESSIVELY, even when the JD is brief. Use what you
  know about ${company} (its actual product, industry, and engineering culture)
  to drive specific product vocabulary into the SUMMARY (≥2 product-specific
  terms), the <DOMAIN> relevant skills bullet (every keyword must reference
  ${company}'s real product surface), and the cover letter Para 1. The same
  candidate's résumé for ${company} must read VISIBLY DIFFERENT from one
  written for any other company — different summary sentences, different
  domain bullet keywords, different cover-letter hook.

  Concrete examples of the product vocabulary you must use (do not copy these
  verbatim — use them as the bar for specificity for the actual ${company}):
  · Reddit       → communities, subreddits, threaded discussions, voting,
                   content moderation, feeds, real-time comments
  · Figma        → design systems, canvas, vector editing, multiplayer cursors,
                   real-time collaboration, accessibility tokens, prototypes
  · Stripe       → payments, checkout, API design, idempotency, webhooks,
                   latency-sensitive UI, dashboards
  · Replit       → collaborative code editors, language servers, education-tech
                   UX, IDE plugins, real-time multi-user sessions
  · Affirm       → BNPL, credit decisioning UX, checkout flows, regulatory UI,
                   accessibility, conversion optimization
  · Robinhood    → trading flows, market data, real-time price updates,
                   portfolio dashboards, regulatory disclosures
  · Verkada      → operator dashboards, video streaming UI, IoT device fleets,
                   real-time alerts, large-table virtualization
  · Ramp         → expense management, spend dashboards, fintech onboarding,
                   data-dense tables, automation UX
  · Trek Bicycle → e-commerce, product configurators, customer dealer portals,
                   responsive imagery, conversion-optimized PDPs
  · Allara       → women's health platforms, telehealth UI, accessible forms,
                   member-facing dashboards
  Generic phrases like "interactive dashboards", "dynamic user engagement
  platforms", "user-centric design" are BANNED — they signal you did not
  actually tailor. Use the company's real product nouns.

COVER LETTER (100-180 words):
- Standard business letter, addressed to ${company}. 3 short paragraphs.
- Reference the specific role and 2-3 concrete, real achievements from the résumé.
- Para 1 MUST include one concrete reason this candidate is interested in ${company}
  specifically, drawn from what you know about their product or mission (not a
  generic "your innovative work"). The paragraph for ${company} should read very
  differently from one written for another company.
- Mention the portfolio/live project as proof of full-stack ability.
- Include ONE subtle, professional line about being authorized to work now on OPT
  and openness to a role that supports future sponsorship. Do not overstate or beg.
- Confident, specific, not generic. End with "Sincerely," then the candidate name.

NOTES (honesty checks — do NOT fix these silently, just report them):
- If EDUCATION shows an expected/"Exp." or missing graduation date, do NOT invent
  one. Add a note telling the candidate to add the real date.
- Add a note for any important JD requirement the résumé does not clearly support.

Return STRICT JSON: { "resume": string, "coverLetter": string, "notes": string[] }.
Use "\\n" for line breaks inside the strings. "notes" may be an empty array.

TARGET COMPANY: ${company}

JOB DESCRIPTION:
${jobDescription}

CANDIDATE'S CURRENT RÉSUMÉ:
${resume}`;
}

/* Thrown with a `.status` so handlers can map to the right HTTP code. */
class TailorError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function tailor({ resume, company, jobDescription, portfolio = "", currentlyLearning = "" }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new TailorError(500, "GEMINI_API_KEY is not set on the server.");
  if (!resume || !company || !jobDescription) {
    throw new TailorError(400, "resume, company and jobDescription are required.");
  }

  const body = {
    contents: [{ role: "user", parts: [{ text: buildPrompt({ resume, company, jobDescription, portfolio, currentlyLearning }) }] }],
    generationConfig: {
      temperature: 0.6,
      responseMimeType: "application/json",
      responseSchema: {
        type: "object",
        properties: {
          resume: { type: "string" },
          coverLetter: { type: "string" },
          notes: { type: "array", items: { type: "string" } },
        },
        required: ["resume", "coverLetter"],
      },
    },
  };

  // Try the primary model, then a fallback, each retried once on overload/limits.
  const models = [MODEL, "gemini-2.5-flash-lite"].filter((m, i, a) => a.indexOf(m) === i);
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

  if (!parsed) throw new TailorError(502, `Gemini unavailable after retries: ${lastError}`);

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

  return {
    resume: scrubPlaceholders(parsed.resume || ""),
    coverLetter: scrubPlaceholders(parsed.coverLetter || ""),
    notes: Array.isArray(parsed.notes) ? parsed.notes : [],
  };
}

module.exports = { tailor, TailorError, MODEL };

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
- Every section filled with real content — no "[placeholder]".

COVER LETTER (100-180 words):
- Standard business letter, addressed to ${company}. 3 short paragraphs.
- Reference the specific role and 2-3 concrete, real achievements from the résumé.
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

  return {
    resume: parsed.resume || "",
    coverLetter: parsed.coverLetter || "",
    notes: Array.isArray(parsed.notes) ? parsed.notes : [],
  };
}

module.exports = { tailor, TailorError, MODEL };

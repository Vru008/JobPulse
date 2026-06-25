/* Shared AI tailoring logic — used by both the Vercel (/api/tailor.js) and
 * Netlify (netlify/functions/tailor.js) handlers so there is one source of truth.
 *
 * Uses Google Gemini (free tier). The API key comes from the GEMINI_API_KEY
 * environment variable and never reaches the browser.
 */

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

function buildPrompt({ resume, company, jobDescription, portfolio, currentlyLearning }) {
  const portfolioLine = portfolio
    ? `\n- ALWAYS include this portfolio/live-project link in the résumé header contact
  line: ${portfolio}. In the cover letter, reference it as a working full-stack MERN
  app (React 19 + Express + MongoDB) — frame it as full-stack credibility, not
  frontend-only.`
    : "";
  const learningLine = currentlyLearning
    ? `\n- Add a final line in CORE SKILLS: "Currently Learning: ${currentlyLearning}".`
    : "";

  return `You are an expert technical résumé writer and career coach helping an
international candidate on F-1 OPT (authorized to work now) who will need future
H-1B sponsorship. Rewrite the résumé and write a cover letter, tailored to the
target company and the specific job description. The output must look like a
polished, complete, professional one-page résumé — never sparse or placeholder.

HARD RULES (Applicant Tracking System safe):
- Plain text only. Single column. No tables, columns, graphics, emojis, or
  special characters. Standard Arial/Liberation-Sans-style plain text.
- MUST FIT ON ONE PAGE: keep the whole résumé to roughly 430-540 words.
- Use these EXACT uppercase section headings, each on its own line, in this order:
  PROFESSIONAL SUMMARY, CORE SKILLS, EXPERIENCE, PROJECTS, EDUCATION.
  Include PROJECTS and CERTIFICATIONS only if the source résumé supports them.
- Line 1 = candidate's name. Line 2 = contact details
  (email | phone | location | links) exactly as found in the source résumé.${portfolioLine}${learningLine}
- PROFESSIONAL SUMMARY: 2-3 punchy lines, tailored to this role. No "I" / first person.
- CORE SKILLS: 1-2 lines, comma-separated, front-loaded with the JD's key skills.
- EXPERIENCE: for each role show "Title, Company (dates)" then 2-4 bullets.
  Keep ONLY the most relevant roles so it fits one page. Bullets start with "- "
  and a strong past-tense action verb, are ONE line each, and keep quantified
  results (numbers, %, scale) from the source.
- Mirror the important keywords/skills from the JOB DESCRIPTION, but ONLY if the
  source résumé supports them. NEVER invent jobs, employers, dates, degrees, or
  skills the candidate does not have.
- Every section must be filled with real, substantive content from the source —
  no empty headings, no "[placeholder]", no lorem ipsum.
- Do NOT mention visa, OPT, work authorization, or sponsorship ANYWHERE in the
  résumé — that belongs only in the cover letter and application form fields.

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

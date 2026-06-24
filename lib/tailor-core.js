/* Shared AI tailoring logic — used by both the Vercel (/api/tailor.js) and
 * Netlify (netlify/functions/tailor.js) handlers so there is one source of truth.
 *
 * Uses Google Gemini (free tier). The API key comes from the GEMINI_API_KEY
 * environment variable and never reaches the browser.
 */

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

function buildPrompt({ resume, company, jobDescription }) {
  return `You are an expert technical résumé writer and career coach. Rewrite the
candidate's résumé and write a cover letter, tailored to the target company and
the specific job description.

HARD RULES (Applicant Tracking System safe):
- Plain text only. Single column. No tables, columns, graphics, or special characters.
- Use these EXACT uppercase section headings in the résumé, each on its own line:
  PROFESSIONAL SUMMARY, CORE SKILLS, EXPERIENCE, EDUCATION (add PROJECTS or
  CERTIFICATIONS only if the source résumé supports them).
- The very first line is the candidate's name; the next line is contact details
  (email | phone | location | links) exactly as found in the source résumé.
- Bullets start with "- " and a strong action verb; keep quantified results.
- Mirror the important keywords and skills from the JOB DESCRIPTION, but ONLY if
  the candidate's source résumé actually supports them. NEVER invent jobs,
  employers, dates, degrees, or skills the candidate does not have.
- Keep it truthful and concise (résumé ~1 page of text).

COVER LETTER:
- Standard business letter, addressed to ${company}. 3 short paragraphs.
- Reference the specific role and 2-3 concrete, real achievements from the résumé.
- Confident, specific, not generic. End with "Sincerely," then the candidate name.

Return STRICT JSON with two string fields: "resume" and "coverLetter".
Use "\\n" for line breaks inside the strings.

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

async function tailor({ resume, company, jobDescription }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new TailorError(500, "GEMINI_API_KEY is not set on the server.");
  if (!resume || !company || !jobDescription) {
    throw new TailorError(400, "resume, company and jobDescription are required.");
  }

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

  const body = {
    contents: [{ role: "user", parts: [{ text: buildPrompt({ resume, company, jobDescription }) }] }],
    generationConfig: {
      temperature: 0.6,
      responseMimeType: "application/json",
      responseSchema: {
        type: "object",
        properties: { resume: { type: "string" }, coverLetter: { type: "string" } },
        required: ["resume", "coverLetter"],
      },
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new TailorError(502, `Gemini error: ${detail.slice(0, 400)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    throw new TailorError(502, "Model returned non-JSON output.");
  }

  return { resume: parsed.resume || "", coverLetter: parsed.coverLetter || "" };
}

module.exports = { tailor, TailorError, MODEL };

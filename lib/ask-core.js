/* Shared "Ask Assistant" logic — used by the Vercel (/api/ask) and Netlify
 * (/.netlify/functions/ask) handlers.
 *
 * One job: answer a single application-related question for the candidate,
 * grounded STRICTLY in the candidate's own profile. Never invent skills,
 * employers, or projects the candidate doesn't actually have.
 *
 * Uses Google Gemini (free tier) — same model + env var as tailor-core.
 */

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

class AskError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function buildPrompt({ profile, question, history }) {
  const recent = Array.isArray(history) && history.length
    ? `RECENT CONVERSATION (oldest first):\n${history.slice(-6).map((h) => `Q: ${h.q}\nA: ${h.a}`).join("\n\n")}\n\n`
    : "";

  return `You are an experienced job-search advisor for an international software-engineering candidate on F-1 OPT (STEM extension eligible). The candidate is using a private app and asking you ONE specific question about their job applications, interviews, résumés, cover letters, or career strategy.

STRICT GROUNDING RULES (these are non-negotiable):
- Use ONLY what is in the CANDIDATE PROFILE below — their actual experience, skills, projects, education, location, and authorization status.
- NEVER invent or assume skills, employers, projects, achievements, dates, or credentials that are not present in the profile. If the profile does not contain something the question needs, say so honestly and suggest what they could add to their profile.
- Do not make up company names or fake quotes.
- Be specific and actionable. Reference the candidate's REAL projects and skills by name when relevant ("your JobMate dashboard", "your 2 yrs at iCliQ", etc.).
- Use second person ("you", "your résumé"). Confident, friendly, and direct — not generic.
- Keep the answer concise (typically 80–180 words) unless the question explicitly asks for something longer (e.g. "draft a full cover letter").
- For questions about salary, sponsorship, or legal/visa specifics, give general guidance grounded in the profile but remind them to verify with the employer / a qualified advisor.

OUTPUT FORMAT:
- Plain text only. Short paragraphs and/or "- " bullets where helpful. No markdown headers, no code fences.
- If a question is too vague to answer well, ask ONE clarifying follow-up question instead of guessing.

${recent}CANDIDATE PROFILE:
${profile}

QUESTION:
${question}`;
}

async function ask({ profile, question, history }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new AskError(500, "GEMINI_API_KEY is not set on the server.");
  if (!profile || !question) {
    throw new AskError(400, "profile and question are required.");
  }
  if (String(question).length > 4000) {
    throw new AskError(400, "Question is too long (max 4000 chars).");
  }

  const body = {
    contents: [{ role: "user", parts: [{ text: buildPrompt({ profile, question, history }) }] }],
    generationConfig: { temperature: 0.5, responseMimeType: "text/plain" },
  };

  const models = [MODEL, "gemini-2.5-flash-lite"].filter((m, i, a) => a.indexOf(m) === i);
  let lastError = "";
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
        if (txt.trim()) return { answer: txt.trim(), model };
        lastError = "empty response";
        break;
      }

      lastError = `${res.status} ${(await res.text()).slice(0, 160)}`;
      if (res.status === 503 || res.status === 429) {
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
      break;
    }
  }
  throw new AskError(502, `Gemini unavailable after retries: ${lastError}`);
}

module.exports = { ask, AskError, MODEL };

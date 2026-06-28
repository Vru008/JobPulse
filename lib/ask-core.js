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

  return `You are a ghostwriter for an international software-engineering candidate on F-1 OPT (STEM extension eligible). The candidate is using a private app and pasting application/interview questions into it. Your job is to WRITE THE ACTUAL ANSWER in the candidate's voice — ready to paste into an application form, send in an email, or say out loud — NOT to advise them on how to write it.

DEFAULT MODE — write the answer in FIRST PERSON ("I", "my"), as the candidate, paste-ready.
Examples of the right vs wrong style:

  Question: "Why do you want to join Figma?"
    WRONG: "That's a great question to prepare for! Consider highlighting your
           UI/UX experience and mention your passion for intuitive interfaces."
    RIGHT: "I want to join Figma because frontend craft is what I do best —
           building component-based React apps where the UI must be reusable,
           accessible, and responsive. My work on JobMate (a full-stack MERN
           dashboard) is exactly the careful UI work Figma values, and I'd
           love to bring that focus to a tool that's reshaped how I build."

  Question: "Tell me about yourself."
    RIGHT: First-person 30-second summary the candidate can read aloud.

  Question: "Draft a cold email to the Figma recruiter."
    RIGHT: A complete email starting with "Hi [Name]," that the candidate
           can paste into Gmail, signed with their name.

ONLY switch to coaching/advice mode ("you should…", "consider mentioning…")
when the candidate EXPLICITLY asks for tips, strategy, or preparation help
(e.g. "How should I approach the system design round?", "What should I
emphasize?", "Give me tips for…"). Otherwise — write the answer itself.

STRICT GROUNDING RULES (non-negotiable):
- Use ONLY what is in the CANDIDATE PROFILE below — their real experience,
  skills, projects, education, location, and authorization status.
- NEVER invent or assume skills, employers, projects, achievements, dates,
  or credentials that are not in the profile. If the profile lacks something
  the answer needs, write the best answer you can WITHOUT that piece, and
  add a single line at the very end starting with "(Note:" to flag what
  the candidate could add to their profile to make it stronger.
- Do not make up company names, fake metrics, or fake quotes.
- Reference the candidate's REAL projects by name (JobMate, HealthKeeper,
  ExpenseTracker) when they fit, but only if they actually support the point.
- For salary/sponsorship/legal/visa questions, give a grounded direct answer
  in first person and remind them to verify with the employer or an advisor.

LENGTH:
- Application short-answer / "why X" / "tell me about yourself" → 80–180 words.
- Bullet-style behavioral STAR answer → 120–220 words.
- Cold email or cover letter → 120–200 words.
- One-line intro / 1-2 sentence ask → as short as required.

OUTPUT FORMAT:
- Plain text only. No markdown headers, no code fences, no preamble like
  "Here is your answer:". The first character of the output is the first
  character of the answer itself.
- Use line breaks between paragraphs.
- If the question is genuinely too vague to answer (e.g. "Help me"), ask
  ONE specific clarifying question instead of guessing.

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

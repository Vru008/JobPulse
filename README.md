# JobPulse MVP

Open `index.html` in a browser, or run a local static server if Python is installed:

```bash
py -m http.server 5173
```

Then visit `http://localhost:5173`.

## Private login

The app now shows a login screen before the dashboard.

- Username: `admin`
- Passcode: `JobPulse2026!`

To change the login, edit `authConfig` at the top of `app.js`. The passcode is stored as a SHA-256 hash, so generate a new hash before publishing.

Important: this is client-side privacy for a static MVP. It hides the app from casual visitors, but it is not strong security because static site files can be inspected in the browser. For true "only me" access after deployment, use hosting-level protection such as Netlify password protection, Cloudflare Access, Vercel/Supabase auth, or convert the app to a backend-backed product.

## AI résumé & cover letter (free)

The **Resume & Cover** tab takes your current résumé (upload PDF/Word or paste),
a **company name**, and the **job description**, then uses AI to produce an
ATS-strong résumé and matching cover letter that you download as **PDF**.

- The AI runs in a serverless function (`netlify/functions/tailor.js`) so the
  API key is **never** exposed in the browser.
- It uses **Google Gemini**, which has a **free tier** — no charge for normal use.
- Résumé parsing (pdf.js / mammoth) and PDF export (jsPDF) happen in the browser.

The serverless function ships in two formats so it runs on either host with no
code changes — `api/tailor.js` (Vercel) and `netlify/functions/tailor.js`
(Netlify). Both share the logic in `lib/tailor-core.js`. The front end calls
`/api/tailor` first and falls back to the Netlify path.

### One-time setup (free)

1. Get a free Gemini API key: https://aistudio.google.com/app/apikey
2. Deploy this repo (zero-config) on **Vercel** *or* **Netlify** — empty build command.
3. Add the environment variable on your host:
   - **Vercel:** Project → Settings → Environment Variables → `GEMINI_API_KEY = <your key>`
   - **Netlify:** Site settings → Environment variables → `GEMINI_API_KEY = <your key>`
   - Optional: `GEMINI_MODEL` (default `gemini-2.5-flash`).
4. **Redeploy** so the variable is picked up. The Resume tab now generates real,
   tailored documents.

> Note: the free tier quota is **per Google Cloud project, per model**. If you
> see a 429 "RESOURCE_EXHAUSTED", that model's daily quota is used up — switch
> `GEMINI_MODEL` (e.g. `gemini-2.5-flash-lite`) or use a key from a fresh project.

Local note: `py -m http.server` serves the static UI but the AI endpoint returns
"Offline" (no functions). Use `vercel dev` or `netlify dev` to run the function locally.

The app stores profile, saved jobs, applied jobs, and hidden jobs in browser
local storage. A real daily job feed still needs a backend/cron worker, because
static hosting alone cannot run scheduled imports every day.

## What is built

- Daily job dashboard with match score, source, salary, location, and apply link.
- Editable profile for titles, skills, location, experience, salary, and sponsorship.
- Trusted source toggles for LinkedIn, Indeed, Wellfound, Built In, Dice, We Work Remotely, Remote OK, Greenhouse, Lever, and Ashby.
- Filters for role, work mode, minimum match, and text search.
- Save, applied, and hide actions stored in browser local storage.
- Real outbound links to trusted job boards or direct ATS search pages.

## Next Claude Code Prompt

Build this static MVP into a production app:

1. Convert `outputs/jobpulse` to a Next.js app.
2. Add Supabase/Postgres tables: profiles, sources, jobs, saved_jobs, applications.
3. Add a daily cron worker that imports jobs from allowed APIs/RSS feeds and company ATS pages.
4. Deduplicate jobs by company, title, location, and canonical URL.
5. Rank jobs against the user profile using skill/title/location scoring first.
6. Keep every apply button pointed to the original source URL.
7. Add auth, daily email digest, and application status tracking.

Do not scrape websites that forbid scraping. Prefer APIs, RSS feeds, company career page integrations, and compliant search links.

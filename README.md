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
local storage.

## Live job feed

The dashboard shows **real** jobs, not sample data. `/api/jobs` (Vercel) /
`/.netlify/functions/jobs` (Netlify), backed by `lib/jobs-core.js`, aggregates
free, no-key sources server-side:

- **ATS company boards** — Greenhouse, Lever, Ashby for ~55 established,
  sponsor-friendlier companies (Stripe, Robinhood, Affirm, Figma, Cloudflare,
  Reddit, …) with **direct apply links**
- **Remotive**, **Arbeitnow**, **Remote OK**, **Jobicy**, **Himalayas** — broad
  remote software roles

It excludes senior/lead, no-sponsorship/citizenship/clearance, intern/contract,
stack-mismatch, and staffing-firm roles; scores a fit band; marks every role
**Sponsorship: VERIFY**; prefers US/remote; caps 2 per company. LinkedIn, Indeed,
Glassdoor, and YC are intentionally omitted — they block fetching and forbid
scraping (no free API). To add Indeed-style breadth legally, plug in the free
Adzuna API (set `ADZUNA_APP_ID` / `ADZUNA_APP_KEY`).

It filters to your target titles, **strictly dedupes** (by company+title and by
canonical apply URL — no repeats), ranks by relevance then freshness, and returns
**25**. Because it fetches live on each load (edge-cached ~30 min), the feed is
fresh every morning with no cron job. Every "Apply" button opens the **original
posting URL**. No key or env var is required for the feed.

## What is built

- Live daily dashboard (25 deduped real roles) with match score, source, salary, location, and real apply link.
- AI Resume & Cover tab: tailor your résumé to a company + job, export PDF.
- Editable profile for titles, skills, location, experience, salary, and sponsorship.
- Source toggles (Remotive, Arbeitnow, Remote OK), filters for role/mode/match/search.
- Save, applied, and hide actions stored in browser local storage.

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

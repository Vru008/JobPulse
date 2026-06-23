# JobPulse MVP

Open `index.html` in a browser, or run a local static server if Python is installed:

```bash
py -m http.server 5173
```

Then visit `http://localhost:5173`.

## Deploy

This version is a static MVP, so it can be deployed directly from GitHub.

- GitHub Pages: deploy from the repository root.
- Netlify: connect the repo and leave the build command empty. The included `netlify.toml` publishes the root folder.
- Vercel: import the repo as a static project and leave the build command empty.

The current app stores profile, saved jobs, applied jobs, and hidden jobs in browser local storage. A real daily job feed needs a backend/cron worker, because static hosting alone cannot run scheduled imports every day.

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

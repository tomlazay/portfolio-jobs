# Portfolio Jobs Board

A lightweight, self-hosted job board that aggregates open roles from every company in your portfolio — no backend, no database, no paid services. Add a row to a Google Sheet and the job card appears automatically.

**Live example:** [jobs.companyon.vc](https://jobs.companyon.vc)

---

## How It Works

```
Google Sheet (your company list)
        ↓
Vercel Edge Function  (api/jobs.js)
  → detects ATS platform from URL
  → fetches jobs from each platform's API
  → returns unified JSON + site config
        ↓
Browser  (index.html + js/app.js)
  → renders job cards
  → live search + cascading filters
  → shareable URLs (?company=Acme&dept=Engineering)
```

The Edge Function runs on Cloudflare Workers via Vercel — this means all outbound requests originate from Cloudflare IPs, which bypasses Cloudflare bot protection on third-party job boards. Results are cached at the CDN edge for 24 hours.

---

## Supported ATS Platforms

Platform detection is automatic — just paste the company's job board URL into the Google Sheet and the right fetcher is chosen.

| Platform | URL pattern |
|---|---|
| Ashby | `jobs.ashbyhq.com/{handle}` |
| Lever | `jobs.lever.co/{handle}` |
| Greenhouse | `boards.greenhouse.io/{handle}` or `job-boards.greenhouse.io/{handle}` |
| Workable | `apply.workable.com/{handle}` |
| SmartRecruiters | `careers.smartrecruiters.com/{handle}` |
| Recruitee | `{handle}.recruitee.com` |
| BambooHR | `{handle}.bamboohr.com` |
| Pinpoint | `{handle}.pinpointhq.com` |
| Workday | `{tenant}.wd{N}.myworkdayjobs.com/...` |
| Polymer | `jobs.polymer.co/{slug}` |
| Dover | `app.dover.com/jobs/{handle}` |
| Teamtailor | `{company}.teamtailor.com` |
| Breezy HR | `{handle}.breezy.hr` |
| Rippling ATS | `ats.rippling.com/{board-slug}/jobs` |
| micro1 | `www.micro1.ai/jobs` |
| Notion | `{workspace}.notion.site/{page}` |
| Custom / unknown | any `/careers/`, `/open-roles/`, or `/about/careers/` page |

> **Greenhouse note:** Use the direct board URL (`boards.greenhouse.io/{handle}`), not the company's redirect URL (e.g. `lattice.com/careers`). The redirect URL does not match the platform detector.

---

## Repository Structure

```
portfolio-jobs/
├── index.html          # Page shell — update FORK comments for your branding
├── css/
│   └── styles.css      # All styles — edit :root variables to rebrand
├── js/
│   └── app.js          # Client: render, filter, cache, URL-param, normalisation
├── api/
│   ├── jobs.js         # Vercel Edge Function: fetches all job boards in parallel
│   └── test-scrapers.mjs   # Manual smoke-test script for ATS fetchers
├── logo.svg            # FORK: replace with your firm's SVG logo
├── favicon.ico / .png  # FORK: replace with your icons
├── SETUP.md            # Step-by-step deploy guide
└── USER_GUIDE.md       # Non-technical setup guide
```

---

## Quick Start (Technical)

### 1 — Fork the repo

Click **Fork** on GitHub. This creates your own copy you can deploy and modify.

### 2 — Set up your Google Sheet

See [SETUP.md](./SETUP.md) for the full sheet schema.  The short version:

| Column | Required | Notes |
|---|---|---|
| `name` | ✅ | Company display name |
| `url` | ✅ | Job board URL (any supported platform) |
| `homepageUrl` | Recommended | Company website — used for automatic logo fetching |
| `logoUrl` | Optional | Manual logo URL override |

Then: **File → Share → Publish to web → Sheet 1 → CSV → Publish**.
Copy the URL — this is your `SHEET_CSV_URL`.

### 3 — Deploy to Vercel

1. Connect your forked repo at [vercel.com/new](https://vercel.com/new)
2. No build settings needed — Vercel auto-detects the Edge Function
3. In **Settings → Environment Variables**, add:
   ```
   SHEET_CSV_URL = <your published CSV URL>
   ```
4. Redeploy

### 4 — Customize branding

| What | Where |
|---|---|
| Brand colors | `:root` variables in `css/styles.css` |
| Hero text / footer | `index.html` (static) or Google Sheet config tab (runtime override) |
| Logo | Replace `logo.svg`; update `src` in `index.html` and `og:image` meta tag |
| Favicon | Replace `favicon.ico` and `favicon.png` |
| Site title / SEO | `<title>` and `<meta>` tags in `index.html` |

---

## Architecture Notes (for Claude / AI assistants)

This section is written for Claude or other AI assistants that may be asked to extend or debug this codebase.

### `api/jobs.js` — Edge Function

The entry point is the default export `handler(req)`. On each request it:

1. Checks `SHEET_CSV_URL` env var is set, returns 500 if not.
2. Calls `fetchCompanies()` and `fetchConfig()` in parallel — both parse CSV tabs from the Google Sheet.
3. Runs `fetchOneCompany(company)` for every company via `Promise.allSettled` (all in parallel; one company's failure never blocks the others).
4. `fetchOneCompany` is an if/else chain that matches the company's URL against a regex for each supported ATS platform and calls the corresponding `fetch{Platform}Jobs()` function.
5. Logo resolution: simultaneously fetches each company's homepage to extract a structured logo (Schema.org JSON-LD → SVG favicon → apple-touch-icon). Google Favicons API is always sent as a client-side fallback in `data-fallback`.
6. Returns `{ jobs, companies, config, errors, fetchedAt }` as JSON with a 24h CDN cache header.

**Adding a new ATS platform:**
1. Write `fetchXxxJobs(handle, companyName)` returning `Promise<Job[]>`.
2. Add a regex branch to the `fetchOneCompany` if/else chain.
3. Ensure each returned job has at minimum: `{ title, company, url, logoUrl: '' }`.

**Job schema** (all fields optional except title/company/url):
```js
{
  title, company, department, location, type, workMode,
  compensation, equity, url, logoUrl, logoFallback
}
```

### `js/app.js` — Frontend

Pure vanilla JS, no frameworks. Key responsibilities:

- `fetchJobs()` — fetches `/api/jobs`, serves from localStorage cache (5 min TTL) on repeat visits.
- `applyConfig(config)` — applies `siteTitle`, `heroHeadline`, `heroSubtext`, `footerText` from the API config object.
- `normalizeJobs()` — canonicalises location strings (US state abbreviations, city aliases), department names, and job types so filter dropdowns stay clean.
- `updateFilters()` — cascading/dependent filter logic: each dropdown only shows options valid given all other active filters.
- `syncUrlParams()` / `applyUrlParams()` — shareable filter URLs (`?company=Acme&dept=Engineering&loc=Remote`).
- `logoFallback(img)` — client-side logo cascade: primary → `data-fallback` (Google Favicons) → text initial badge.

**Extending normalisation:** `LOCATION_ALIASES` and `DEPT_ALIASES` objects in `app.js` map variant strings to canonical labels. Add entries to either map to consolidate new aliases that appear in the filter dropdowns.

### Google Sheet schema

**Tab 1 (gid=0) — Companies:**
Columns read by header name (case-insensitive, spaces/hyphens/underscores stripped).
Accepted header synonyms: `name` / `company`; `url` / `jobspagesource` / `jobsurl` / `boardurl`.

**Tab 2 (gid=1) — Config:**
Two columns: `key` and `value`. Supported keys: `siteTitle`, `heroHeadline`, `heroSubtext`, `footerText`.
If this tab is absent the HTML defaults are used.

---

## Local Development

```bash
npm install -g vercel
vercel dev
```

Then open `http://localhost:3000`. The Edge Function runs locally; set `SHEET_CSV_URL` in a `.env` file at the repo root.

```
# .env
SHEET_CSV_URL=https://docs.google.com/spreadsheets/d/.../export?format=csv&gid=0
```

---

## License

MIT — fork freely, customize for your firm, keep or remove the attribution.

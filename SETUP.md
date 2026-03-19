# Setup Guide — Portfolio Jobs Board

This guide covers everything you need to fork and run your own instance of this job board. For a non-technical step-by-step walkthrough (including GitHub, Vercel, and Google Sheets setup from scratch), see [USER_GUIDE.docx](./USER_GUIDE.docx).

---

## Quick Start

1. Fork this repository on GitHub
2. Create a Google Sheet with your companies list (see below)
3. Deploy to Vercel and set the `SHEET_CSV_URL` environment variable
4. Replace `logo.svg` with your firm's logo file
5. Update brand colors in `css/styles.css` (CSS custom properties under `:root`)

---

## 1. Google Sheet Setup

### Companies Tab (required — Tab 1, gid=0)

The first sheet tab drives the company list. Add one row per portfolio company.

| Column | Required | Description |
|---|---|---|
| `name` | ✅ | Company display name (e.g. `Acme Corp`) |
| `url` | ✅ | Job board URL — the ATS page for this company (see platform table below) |
| `homepageUrl` | Recommended | Company website (e.g. `https://acme.com`) — used for automatic logo fetching. Required for logos on ATS-hosted companies (Ashby, Lever, Greenhouse, etc.) |
| `logoUrl` | Optional | Manual logo URL override — takes priority over all auto-fetched logos |

> Column headers are read case-insensitively. Spaces, underscores, and hyphens in header names are ignored. Common synonyms are also accepted: `company` for `name`, `jobsPageSource` / `boardUrl` for `url`.

**Supported job board URL formats:**

| Platform | URL format | Notes |
|---|---|---|
| Ashby | `https://jobs.ashbyhq.com/{handle}` | |
| Lever | `https://jobs.lever.co/{handle}` | |
| Greenhouse | `https://boards.greenhouse.io/{handle}` | Use the direct board URL, not the company's redirect URL |
| Workable | `https://apply.workable.com/{handle}` | |
| SmartRecruiters | `https://careers.smartrecruiters.com/{handle}` | |
| Recruitee | `https://{handle}.recruitee.com` | |
| BambooHR | `https://{handle}.bamboohr.com` | |
| Pinpoint | `https://{handle}.pinpointhq.com` | |
| Workday | `https://{tenant}.wd{N}.myworkdayjobs.com/[locale/]{board}` | Any Workday URL shape works |
| Polymer | `https://jobs.polymer.co/{slug}` | |
| Dover | `https://app.dover.com/jobs/{handle}` | |
| Teamtailor | `https://{company}.teamtailor.com` | |
| Breezy HR | `https://{handle}.breezy.hr` | |
| Rippling ATS | `https://ats.rippling.com/{board-slug}/jobs` | |
| micro1 | `https://www.micro1.ai/jobs` | See note below |
| Notion | `https://{workspace}.notion.site/{page}` | Must be a public Notion page with a database of jobs |
| Custom | Any URL with `/careers/`, `/open-roles/`, or `/about/careers/` | Falls back to link scraping |

> **micro1 note:** By default only micro1's own internal "Core team" roles are fetched — not contractor/marketplace listings. The fetcher requests up to 100 jobs per page and caps at 5 pages to stay within the Edge Runtime's time budget. See `fetchMicro1Jobs()` in `api/jobs.js` to change the filter or pagination limits.

> **Greenhouse note:** Paste the direct board URL (`boards.greenhouse.io/yourcompany`), not the company's vanity redirect (e.g. `yourcompany.com/careers`). Vanity URLs are not matched by the platform detector and fall through to the generic scraper.

---

### Publishing the Sheet (required)

The Edge Function reads the sheet as a public CSV export. You must enable this:

1. In Google Sheets: **File → Share → Publish to web**
2. In the first dropdown, choose **Sheet 1**
3. In the second dropdown, choose **Comma-separated values (.csv)**
4. Click **Publish**, then **OK** to confirm
5. Copy the URL — it ends in `...export?format=csv&gid=0`

This is your `SHEET_CSV_URL` value for Step 2.

> **Tip:** If you later make changes to the sheet you do not need to re-publish — the published URL always reflects the current content.

---

### Config Tab (optional — Tab 2, gid=1)

Add a **second tab** to the same spreadsheet with two columns: `key` and `value`. These values are read at runtime and override the HTML defaults — no code editing required.

| key | Example value | What it controls |
|---|---|---|
| `siteTitle` | `Portfolio Careers \| Acme Ventures` | Browser tab title |
| `heroHeadline` | `Jobs in Our Portfolio` | Main page heading (last word gets the brand highlight colour) |
| `heroSubtext` | `Explore open roles across our portfolio companies` | Sub-heading below the headline |
| `footerText` | `© 2026 Acme Ventures` | Footer copyright line |

You must also publish this tab to CSV:
1. **File → Share → Publish to web**
2. Choose **Sheet 2**, format **CSV**, click **Publish**
3. The backend reads it automatically from the same spreadsheet (gid=1) — no extra URL to configure.

---

## 2. Vercel Environment Variables

In your Vercel project dashboard: **Settings → Environment Variables → Add new**.

| Variable | Required | Value |
|---|---|---|
| `SHEET_CSV_URL` | ✅ | Your published Google Sheet CSV URL (Tab 1 / gid=0) |
| `KV_REST_API_URL` | Recommended | Added automatically when you connect Upstash (see Section 8) |
| `KV_REST_API_TOKEN` | Recommended | Added automatically when you connect Upstash (see Section 8) |
| `CRON_SECRET` | Recommended | Any random string (~20 chars). Protects the scheduled cache refresh from being triggered by outside parties. |

If `SHEET_CSV_URL` is not set, the API returns a 500 error with a message directing you to this guide.

`KV_REST_API_URL`, `KV_REST_API_TOKEN`, and `CRON_SECRET` are only required if you set up the KV cache (Section 8). Without them, the job board falls back to live scraping on every request, which works but is slower for first-time visitors.

After adding variables, trigger a new deployment: **Deployments → Redeploy**.

---

## 3. Branding

### Quick-Start: One File to Edit, One Command to Run

All firm-specific values are centralized in **`fork-config.json`** at the repo root. Edit that file, then run:

```bash
python scripts/generate-og.py
```

The script regenerates `og-image.png` with your logo and colors, and automatically patches all matching meta tags in `index.html`. Commit both files.

**`fork-config.json` fields:**

| Field | Description | Example |
|---|---|---|
| `firmName` | Your firm's display name | `"Acme Ventures"` |
| `siteUrl` | Your deployed site URL (no trailing slash) | `"https://jobs.acme.vc"` |
| `pageTitle` | Browser tab / social card title | `"Portfolio Careers \| Acme Ventures"` |
| `description` | Meta description and social card subtitle | `"Explore open roles across…"` |
| `twitterHandle` | X/Twitter handle (include `@`) | `"@acmevc"` |
| `ogImageHeadline` | Large text on the OG image | `"Portfolio Careers"` |
| `ogImageTagline` | Smaller text below the headline on the OG image | `"Explore open roles across our portfolio"` |
| `logoFile` | Logo filename at repo root | `"logo.svg"` |
| `accentColor` | Hex accent color used on the OG image | `"#4300EC"` |
| `bgColor` | Hex background color used on the OG image | `"#0A1541"` |
| `publishedDate` | Launch date for LinkedIn's "Publish date" field (`YYYY-MM-DD`) | `"2026-03-06"` |

> **Requirements for `generate-og.py`:** Python 3.8+, Pillow, cairosvg.
> Install with: `pip install Pillow cairosvg`
> For best typography: install the Lato font (`sudo apt install fonts-lato` on Linux, or `brew install --cask font-lato` on Mac). The script falls back gracefully to the system font if Lato is unavailable.

---

### Logo

Replace `logo.svg` in the repo root with your firm's SVG logo file. Update `logoFile` in `fork-config.json` if you use a different filename, then re-run `generate-og.py`.

Also replace `favicon.ico` and `favicon.png` with your own icons.

### Brand Colors

Edit the CSS custom properties at the top of `css/styles.css` under `:root`:

```css
:root {
  --brand-primary:   #4300EC;   /* main accent — buttons, tag highlights, logo badge */
  --brand-light:     #20A3FF;   /* secondary accent color */
  --hero-bg-from:    #0A1541;   /* hero gradient — start color */
  --hero-bg-mid:     #120840;   /* hero gradient — mid color */
  --hero-bg-to:      #0d1850;   /* hero gradient — end color */
  --page-bg:         #F4F7FF;   /* page background */
}
```

Six values control the entire visual identity of the site. Set `accentColor` and `bgColor` in `fork-config.json` to matching values so the OG image stays in sync.

### Hero Text & Footer

**Option A (no code edit):** Set the `heroHeadline`, `heroSubtext`, and `footerText` keys in the Google Sheet config tab. These override the HTML at runtime without touching any files.

**Option B (code edit):** Edit directly in `index.html` — update `<h1 id="hero-headline">`, `<p id="hero-subtext">`, and `<span class="footer-copy" id="footer-copy">`.

### SEO / Open Graph

Running `python scripts/generate-og.py` handles all meta tags automatically from `fork-config.json`. If you need to patch `index.html` manually, update these tags:

- `<title>` — browser tab and search result title
- `<meta name="description">` — search result snippet
- `<link rel="canonical">` — your deployed domain
- `og:url`, `og:site_name`, `og:title`, `og:description`, `og:image` — social share preview
- `twitter:site` — your Twitter/X handle (or remove this tag)
- `article:author` — firm name shown by LinkedIn's link preview as the article author
- `article:published_time` — ISO 8601 datetime shown by LinkedIn as the publication date (driven by `publishedDate` in `fork-config.json`)

---

## 4. Adding Portfolio Companies

1. Add a new row to your Google Sheet with `name`, `url`, and (recommended) `homepageUrl`
2. That's it — no code changes needed. The next API request picks up the new company automatically.

Logos are fetched automatically in this priority order:
1. `logoUrl` column in the sheet (manual override — always wins)
2. Schema.org Organization logo from the homepage (`homepageUrl`)
3. SVG favicon from the homepage
4. `/apple-touch-icon.png` on the company domain
5. Google Favicons API (client-side fallback — always resolves)
6. Company initial letter on a brand-color badge (final fallback)

---

## 5. Adding a New ATS Platform

Platform-specific fetchers are standalone `async function fetch{Platform}Jobs(...)` functions in `api/jobs.js`. To add a new platform:

1. Write a `fetchXxxJobs(handle, companyName)` function that returns `Promise<Job[]>`. Each job object must include at minimum:
   ```js
   { title, company, url, logoUrl: '' }
   ```
   See the existing fetchers for the full optional field list (`department`, `location`, `type`, `workMode`, `compensation`, `equity`).

2. Add a URL-pattern regex to the `fetchOneCompany` if/else chain in the main handler.

3. Test with the smoke test script:
   ```bash
   node api/test-scrapers.mjs
   ```

---

## 6. Local Development

```bash
npm install -g vercel
vercel dev
```

Set `SHEET_CSV_URL` in a `.env` file at the repo root:

```
SHEET_CSV_URL=https://docs.google.com/spreadsheets/d/.../export?format=csv&gid=0
```

Open `http://localhost:3000`.

---

## 7. Deployment Notes

- **Vercel** is the recommended host. The `config = { runtime: 'edge' }` export in `api/jobs.js` targets Vercel's Edge Runtime (Cloudflare Workers), which gives the outbound fetch requests Cloudflare IPs — useful for many bot-detection systems. Do not move the function to a different runtime without testing.
- **Timeout budget**: The Edge Runtime has a 30-second wall-clock limit per request. Every `fetch()` call in `api/jobs.js` has an `AbortSignal.timeout()` (8 s per request, 20 s per company via `withCompanyTimeout()`). If you add new ATS fetchers, follow the same pattern to avoid 504 errors.
- **CDN caching**: The API response includes `s-maxage=86400` (24 hours). Vercel's CDN caches it globally. Redeploy or call `vercel --force` to bust the cache if you need an immediate refresh.
- **First-load latency**: The Edge Function live-scrapes all ATS endpoints on every cache miss, which takes 3–8 seconds depending on how many portfolio companies you have. Vercel's CDN cache (`s-maxage=86400`) helps for repeat visitors in the same region, but a new region or a fresh deployment means the first visitor sees the full scrape time. Set up the KV cache (Section 8) to eliminate this for all visitors.
- **KV cache**: When `KV_REST_API_URL` and `KV_REST_API_TOKEN` are set, the handler checks Upstash before scraping. A cache hit returns in ~50 ms. A cron job refreshes the cache every 4 hours so it never expires between visits. A GitHub Actions workflow warms the cache immediately after every deployment so even the very first post-deploy visitor gets a fast response.

---

## 8. Performance: KV Cache Setup (Upstash)

By default the job board scrapes all ATS endpoints on every request. This takes 3–8 seconds for portfolios with many companies. The KV cache stores a pre-built copy of the job data in Upstash (a managed Redis service) so all visitors — in any browser, any region, at any time — get an instant response after the cache is first populated.

The cache is kept fresh by a Vercel Cron job that runs every 4 hours. A GitHub Actions workflow (`warm-cache.yml`) warms the cache immediately after each deployment so there is never a cold window for real visitors.

### 8.1 Create an Upstash Database

1. In your Vercel project dashboard, click **Storage** in the top navigation.
2. Click **Browse Marketplace** and select **Upstash**.
3. From the Upstash dropdown, select **Redis**.
4. Configure the new database:
   - **Region:** `iad1` (US East — lowest latency to Vercel's default region)
   - **Eviction:** Off (jobs data must not be silently evicted)
   - **Plan:** Free (sufficient for this use case)
5. Click **Create and Continue**, then **Create Database** on the confirmation screen.

### 8.2 Connect the Database to Your Project

6. On the **Connect a Project** screen, select your `portfolio-jobs` project.
7. **Important:** Find the **Custom Environment Variable Prefix** field and delete any value that is already there (e.g. `STORAGE`). Leave it completely blank. If you leave `STORAGE` in the field, Vercel creates variables named `STORAGE_KV_REST_API_URL` instead of `KV_REST_API_URL`, and the integration will not work.
8. Click **Connect**.

Vercel now automatically adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` to your project's environment variables.

### 8.3 Add CRON_SECRET

9. In your Vercel project, go to **Settings → Environment Variables**.
10. Add a new variable:
    - **Name:** `CRON_SECRET`
    - **Value:** Any random string of 16–20 characters (letters, numbers, symbols). Generate one at [randomkeygen.com](https://randomkeygen.com) or create your own.
11. Click **Save**.

> **Security note:** Keep `CRON_SECRET` private. It prevents outside parties from triggering a forced cache refresh on your endpoint. Do not share it in chat, email, or commit it to the repository.

### 8.4 Redeploy

12. Go to **Deployments** in your Vercel project dashboard.
13. Find the most recent deployment, click the **⋯** (three dots) menu, and click **Redeploy**.
14. Leave **"Use existing build cache"** unchecked so the new environment variables are picked up.

After the redeploy completes, GitHub Actions automatically calls `/api/jobs` to warm the cache (via the `warm-cache.yml` workflow). Within about 30–60 seconds of the deployment finishing, the cache is populated and all subsequent visitors will get instant results.

### How It Works After Setup

| Scenario | Load time |
|---|---|
| First visitor after deployment | ~50 ms — cache warmed by GitHub Actions |
| Any subsequent visitor (any browser, any country) | ~50 ms — served from Upstash |
| Cache refresh (every 4 hours, automatic) | Background — visitors are never blocked |
| KV env vars not set (fallback mode) | 3–8 s — live scrape, same as original behaviour |

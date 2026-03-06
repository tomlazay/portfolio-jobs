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

> **micro1 note:** By default only micro1's own internal "Core team" roles are fetched — not contractor/marketplace listings. See the `fetchMicro1Jobs()` function in `api/jobs.js` for instructions on changing this filter.

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

If `SHEET_CSV_URL` is not set, the API returns a 500 error with a message directing you to this guide.

After adding the variable, trigger a new deployment: **Deployments → Redeploy**.

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

- **Vercel** is the recommended host. The `config = { runtime: 'edge' }` export in `api/jobs.js` targets Vercel's Edge Runtime (Cloudflare Workers), which gives the outbound fetch requests Cloudflare IPs — bypassing bot protection on some job boards. Do not move the function to a different runtime without testing.
- **CDN caching**: The API response includes `s-maxage=86400` (24 hours). Vercel's CDN caches it globally. Redeploy or call `vercel --force` to bust the cache if you need an immediate refresh.
- **Cold starts**: The Edge Runtime has no cold start penalty unlike Serverless Functions — the first visitor after a cache miss gets a fast response.

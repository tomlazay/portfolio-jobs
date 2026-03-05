# Setup Guide — Portfolio Jobs Board

This guide covers everything you need to fork and run your own instance of this job board.

---

## Quick Start

1. Fork this repository on GitHub
2. Create a Google Sheet with your companies list (see below)
3. Deploy to Vercel and set the `SHEET_CSV_URL` environment variable
4. Replace `companyon-logo.svg` with your firm's logo
5. Update brand colors in `css/styles.css` (six `:root` variables)

---

## 1. Google Sheet Setup

### Companies Tab (required)

The main sheet tab (gid=0) drives the company list. Required columns are **name** and **url**; additional columns are read automatically by header name.

| Column | Required | Description |
|---|---|---|
| `name` | ✅ | Company display name (e.g. `Acme Corp`) |
| `url` | ✅ | Job board URL — the ATS page for this company |
| `homepageUrl` | Optional | Company website (e.g. `https://acme.com`) — used for automatic logo fetching via Clearbit. **Required for logos on ATS-hosted companies** (Ashby, Lever, Polymer, Dover, etc.) |

> **Logo note:** Custom-domain companies (those using `/careers/`, `/open-roles/`, etc.) get logos automatically from their job board URL. ATS-hosted companies need a `homepageUrl` column value to get a logo.

**Supported job board URL formats:**

| Platform | URL format |
|---|---|
| Ashby | `https://jobs.ashbyhq.com/{handle}` |
| Lever | `https://jobs.lever.co/{handle}` |
| Polymer | `https://jobs.polymer.co/{slug}` |
| Dover | `https://app.dover.com/jobs/{handle}` |
| Teamtailor | `https://{company}.teamtailor.com/jobs` |
| Breezy HR | `https://{handle}.breezy.hr` |
| Rippling | `https://ats.rippling.com/{board-slug}/jobs` |
| micro1 | `https://www.micro1.ai/jobs` _(see note below)_ |
| Custom | Any company website with `/careers/`, `/open-roles/`, or `/about/careers/` |

> **micro1 note:** By default, only micro1's own "Core team" internal hiring is shown — not contractor/client marketplace postings. See the comment block in `api/jobs.js` → `fetchMicro1Jobs()` for instructions on changing this filter.

### Publishing the Sheet

1. In Google Sheets: **File → Share → Publish to web**
2. Choose **Sheet 1**, format **CSV**, click **Publish**
3. Copy the URL — it will end in `/export?format=csv&gid=0`

This is your `SHEET_CSV_URL`.

---

### Config Tab (optional)

Add a **second tab** to the same spreadsheet (gid=1) with two columns: `key` and `value`. This lets you control page copy without editing code.

| key | value | Description |
|---|---|---|
| `siteTitle` | `Portfolio Careers \| My Firm` | Browser tab title |
| `heroHeadline` | `Jobs in Our Portfolio` | Main page heading (last word gets brand highlight) |
| `heroSubtext` | `Explore open roles across our portfolio companies` | Subheading |
| `footerText` | `Copyright 2026 My Firm LLC` | Footer copyright line |

Publish this tab to CSV as well (same spreadsheet, **Sheet 2** → CSV). The backend automatically reads it from the same spreadsheet as the companies tab (gid=1).

---

## 2. Vercel Environment Variables

In your Vercel project dashboard: **Settings → Environment Variables**

| Variable | Required | Value |
|---|---|---|
| `SHEET_CSV_URL` | ✅ | Your published Google Sheet CSV URL (companies tab, gid=0) |

> If `SHEET_CSV_URL` is not set, the code falls back to the Companyon sheet URL in the source — set this variable before going live.

---

## 3. Branding

### Logo

Replace `companyon-logo.svg` in the repo root with your firm's SVG logo. The `<img>` tag in `index.html` references it as `companyon-logo.svg` — update the `src` attribute (or the `<!-- FORK: -->` comment in the HTML) if you rename the file.

Also update `favicon.ico` and `favicon.png` with your own icons.

### Colors

Edit the six CSS custom properties at the top of `css/styles.css` under `:root`:

```css
:root {
  --brand-primary:   #4300EC;   /* main accent (buttons, tags, logo badge) */
  --brand-light:     #20A3FF;   /* secondary blue */
  --hero-bg-from:    #0A1541;   /* hero gradient start */
  --hero-bg-mid:     #120840;   /* hero gradient mid */
  --hero-bg-to:      #0d1850;   /* hero gradient end */
  --page-bg:         #F4F7FF;   /* page background */
  /* ... (see file for full list) */
}
```

### Hero Text

Edit directly in `index.html` (`<h1 id="hero-headline">` and `<p id="hero-subtext">`), or set the `heroHeadline` / `heroSubtext` keys in your Google Sheet config tab — the sheet values override the HTML at runtime.

---

## 4. Adding a New Company

1. Add a row to your Google Sheet with `name`, `url`, and (recommended) `homepageUrl`
2. That's it — no code changes needed

Company logos are fetched automatically via [Clearbit](https://clearbit.com/logo) using the `homepageUrl` domain. If Clearbit doesn't have a logo for that domain, the badge falls back to the company's initial letter on a brand-color background.

---

## 5. Adding a New Job Board Platform

Platform-specific fetchers live in `api/jobs.js`. Each is a standalone `async function fetch{Platform}Jobs(...)` that returns an array of job objects. To add a new platform:

1. Write a `fetchXxxJobs(url, companyName)` function following the existing pattern
2. Add a URL-pattern match to the `fetchOneCompany` if/else chain in the main handler
3. Ensure each returned job object includes the `logoUrl: ''` field (the handler fills it in)

See the existing fetchers (Ashby, Lever, Polymer, etc.) for reference.

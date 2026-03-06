# Contributing to Portfolio Jobs Board

Thanks for your interest in contributing. This project is maintained by [Companyon Ventures](https://companyon.vc) and open to contributions from anyone.

The most impactful contributions are **new ATS platform scrapers** — each one makes the job board immediately useful to any firm whose portfolio companies use that platform. We also welcome bug fixes, normalisation improvements (location aliases, department mappings), and documentation updates.

---

## Adding a New ATS Platform Scraper

This is the highest-value contribution type and the pattern is straightforward. Each platform is a self-contained function in `api/jobs.js`.

### 1. Understand the job object schema

Every scraper returns an array of job objects. All fields except `title`, `company`, and `url` are optional — include whatever the platform's API provides.

```js
{
  title:        string,   // Job title — required
  company:      string,   // Company name — required
  url:          string,   // Direct link to the job posting — required
  department:   string,   // e.g. "Engineering", "Sales"
  location:     string,   // e.g. "Boston, MA" or "Remote"
  type:         string,   // "Full time" | "Part-time" | "Contract"
  workMode:     string,   // "Remote" | "Hybrid" | "On-site"
  compensation: string,   // e.g. "$120K – $150K"
  equity:       boolean,  // true if the role offers equity
  logoUrl:      '',       // Always set to '' — the main handler fills this in
  logoFallback: '',       // Always set to '' — the main handler fills this in
}
```

### 2. Write the fetcher function

Add your function near the other platform-specific fetchers in `api/jobs.js`. Follow this structure:

```js
// ── {PlatformName} ─────────────────────────────────────────────────
// API: {describe the endpoint used}
// Docs / discovery notes: {link to API docs, or how you found the endpoint}
async function fetch{PlatformName}Jobs(handle, companyName) {
  const url = `https://api.{platform}.com/jobs/${handle}`;
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`${companyName}: ${res.status}`);
  const data = await res.json();

  return (data.jobs || []).map(j => ({
    title:      j.title       || '',
    company:    companyName,
    department: j.department  || '',
    location:   j.location    || '',
    type:       j.employment_type || '',
    workMode:   j.remote ? 'Remote' : '',
    url:        j.absolute_url || j.url || '',
    logoUrl:    '',
    logoFallback: '',
  }));
}
```

Key rules:
- **Always set a timeout** — `AbortSignal.timeout(8000)` prevents one slow platform from blocking the entire response.
- **Use minimal request headers on JSON APIs** — send only `Accept: application/json`. Do not spread `SCRAPE_HEADERS` (the browser-fingerprint object) into API fetch calls. Cloudflare Workers have a non-browser TLS fingerprint; pairing that with full browser UA/sec-ch-ua headers triggers bot-detection heuristics on platforms that run Cloudflare themselves (resulting in 403s).
- **Never throw on empty results** — if a company has 0 open jobs, return `[]` rather than throwing. Only throw on genuine API errors (non-2xx status, unexpected response shape).
- **Set `logoUrl: ''` and `logoFallback: ''`** — the main handler fills these in from the company's homepage; don't try to source logos inside the fetcher.
- **Map raw fields defensively** — use `|| ''` fallbacks; assume any field could be missing or null.

### 3. Add the URL pattern to `fetchOneCompany`

In the `fetchOneCompany` if/else chain (search for `fetchOneCompany` in `api/jobs.js`), add a branch for your platform:

```js
} else if (/{platform-domain-regex}/.test(url)) {
  const handle = url.match(/{capture-group}/)[1];
  return fetch{PlatformName}Jobs(handle, company.name);
```

Place it before the final `else` (the generic custom scraper fallback).

### 4. Add a smoke test

In `api/test-scrapers.mjs`, add a test entry with a real company that currently has open jobs on that platform:

```js
{ name: 'Company Name', url: 'https://platform.com/company-handle', platform: 'PlatformName' },
```

Then run:
```bash
node api/test-scrapers.mjs
```

All existing tests should still pass and your new entry should return at least one job.

### 5. Open a PR

- Branch name: `feat/scraper-{platform-name}` (e.g. `feat/scraper-jobvite`)
- PR title: `feat: add {PlatformName} scraper`
- PR description: include the platform name, the URL pattern, and the name of the test company you used

---

## Other Contribution Types

**Location / department normalisation**

`LOCATION_ALIASES` and `DEPT_ALIASES` in `js/app.js` map variant strings to canonical labels. If you notice filter dropdown pollution (e.g. "New York City" and "New York, NY" appearing as separate options), adding an entry to these maps is a one-line fix and a very welcome PR.

**Bug fixes**

If a scraper breaks because a platform changed their API, a fix PR is always welcome. Include a note about what changed.

**Documentation**

Corrections, clarifications, and additions to `README.md`, `SETUP.md`, and `USER_GUIDE.docx` are appreciated.

---

## What We're Not Looking For

- Changes to Companyon-specific branding (those live in our private fork)
- New dependencies (the project is intentionally zero-dependency on the frontend)
- Breaking changes to the job object schema without a clear migration path

---

## Development Setup

```bash
npm install -g vercel
vercel dev
```

Set `SHEET_CSV_URL` in a `.env` file at the repo root. See `SETUP.md` for the full format.

---

## Questions?

Open an issue or reach out via the repo discussion tab. We try to review PRs within a week.

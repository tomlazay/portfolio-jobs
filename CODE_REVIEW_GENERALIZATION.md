# Code Review: Generalization & Open-Source Readiness
**portfolio-jobs** — v1.0.0
_Reviewed March 2026_

---

## Summary

The codebase is well-structured and the platform-specific fetchers (Ashby, Lever, Polymer, Dover, Teamtailor, Breezy, Rippling, micro1, Custom) are already generalized by design — any firm on those platforms just works. The main barriers to open-sourcing are the CompanyOn-specific branding and configuration that are scattered across multiple files, the manual company logo system that requires touching JS and CSS for each new company, one filtering behavior that is specific to how CompanyOn uses micro1, and a few hardcoded constants that should be environment variables. None of these are deep architectural problems; they're mostly surface-level cleanups.

---

## 1. Company Logo Badges

This is the area requiring the most design thought. Currently every company needs a manual entry in `COMPANY_CONFIG` in `app.js` (logo URL + CSS class name) AND a matching `.logo-{name}` CSS rule in `styles.css` for the badge background color. That's two files to update every time a company is added.

### Approaches

**Option A — Clearbit Logo API (recommended for auto-discovery)**
Clearbit offers a free, unauthenticated endpoint: `https://logo.clearbit.com/{domain}`. Pass the company's homepage domain and you get a high-quality PNG logo back. No API key, no setup. The backend (or frontend) could derive the domain from the job board URL (e.g., `jobs.ashbyhq.com/posh` → strip the ATS prefix → look up the company's home domain). The main limitation is that Clearbit's coverage isn't 100%, so a fallback to the initial-letter badge is still needed, and you still need the badge background color somehow.

**Option B — Google Sheet "logo URL" column (explicit control)**
Add a `logoUrl` column to the Google Sheet. The operator fills in whatever URL they want — could be a Clearbit URL, a CDN URL, a logo from the company's website, anything. The `fetchCompanies()` parser already handles multiple columns; it just needs to read this extra field and include it in the response payload. The frontend then uses it directly from the API response, eliminating `COMPANY_CONFIG` entirely for logos.

**Option C — Google Sheet "home page URL" column + automatic logo fetch**
The user's proposed approach. Add a `homepageUrl` column like `https://posh.com`. The backend then uses that domain to fetch the logo via Clearbit (`logo.clearbit.com/{domain}`) or Google's favicon service (`google.com/s2/favicons?domain={domain}&sz=64`). This makes logo management zero-config for the operator after filling in the sheet. Works well combined with a text-fallback for misses.

**Option D — Extract logos from the job platform APIs**
Ashby's API already returns `orgTheme.logoImageUrl` on each job posting. Lever has a `logo` field on the company object. These are already there in the raw API response — the fetchers just currently discard them. Mining these would give logos for free for Ashby and Lever companies without any sheet column. Polymer, Dover, etc. would still need a fallback.

**Recommendation:** Combine C and D. Add `homepageUrl` to the Google Sheet for all companies, use that for Clearbit lookups as the primary source, and pull `orgTheme.logoImageUrl` from Ashby and `logo` from Lever responses as a high-fidelity override when present. Keep the initial-letter badge as a final fallback. This eliminates `COMPANY_CONFIG` and the per-company CSS classes entirely.

**Badge background color:** The remaining problem is the badge background — white logos need a dark bg, dark logos need a white bg. Options are (a) add a `logoBg` column to the sheet as a hex color, (b) always use a neutral mid-gray, (c) detect dominant color from the logo image client-side with a small canvas trick. Option (a) is the simplest and most reliable for a fork.

---

## 2. Hardcoded Configuration Constants

### `SHEET_CSV_URL` (api/jobs.js, line 31)

This is the single biggest blocker for a fork. It's a hardcoded string in the source code. It should become a Vercel environment variable: `process.env.SHEET_CSV_URL`. The fork operator sets this in their Vercel project dashboard and never touches the source code. A clear `README` section on how to set this up is all that's needed.

### `CACHE_KEY = 'companyon_jobs_v1'` (app.js, line 70)

This localStorage cache key is branded. When a fork is deployed under a different domain this is harmless, but it's still a code smell. It should be something generic like `portfolio_jobs_cache_v1`, or better yet, derived from the page's hostname so different deploys on the same browser never share stale cache.

### `Access-Control-Allow-Origin: '*'` (api/jobs.js, line 1081)

This is correct for a public API, but worth calling out: if the operator wants to restrict the API to their own domain, this should also be an environment variable (`ALLOWED_ORIGIN`).

---

## 3. Frontend Branding (index.html)

Four spots are CompanyOn-specific:

- `<title>Portfolio Careers | CompanyOn Ventures</title>` — should reference a config variable
- `<img src="companyon-logo.svg" ...>` — the hero logo file
- `<h1>Jobs in Our <span>Portfolio</span></h1>` — the hero headline
- `Copyright 2026 Companyon Ventures Management LLC` — the footer text

All four are in a single HTML file so a fork just edits these once. The cleanest approach for a truly config-driven setup would be to pull these from the API response (the backend could include a `config` object from the Google Sheet's second tab or a separate config sheet). But honestly, for a fork scenario "edit four lines in index.html" is totally acceptable. The more important thing is marking these clearly in the source with comments like `<!-- FORK: update to your firm name -->`.

---

## 4. CSS Design Tokens (css/styles.css)

The CSS is already well-structured for rebranding. All colors are CSS custom properties under `:root` with comments explaining which are CompanyOn brand colors (lines 17–35). A fork just changes those variables. No structural changes needed here — this is already done right.

The per-company `.logo-*` CSS classes (lines 242–254) are the only CSS that would be eliminated once logo handling moves to a data-driven approach (see Section 1).

---

## 5. micro1 "Core Team" Filter

The `fetchMicro1Jobs()` function filters for jobs tagged `"Core team"` — meaning it only returns micro1's *own internal hiring*, not the contractor/client postings on their public job board. This is a very specific policy CompanyOn chose: they include micro1 as a portfolio company and want their full-time roles, not the contractor marketplace listings.

For a general open-source fork this behavior is confusing and should be generalized. The simplest approach is to support a per-company `filter` column in the Google Sheet (e.g., `micro1:core-team-only`), or just document the current behavior clearly so other operators can modify the filter if they use micro1 differently. The `inferDepartmentFromTitle()` helper is similarly micro1-specific but is useful for any platform that doesn't expose a structured department field.

---

## 6. `fetchCompanies()` Column Rigidity

Currently `fetchCompanies()` parses exactly 2 CSV columns: `name` and `url`. Adding any of the proposed new columns (logo URL, home page URL, badge background, etc.) requires updating this function. The fix is trivial — parse all columns by header name (row 0) rather than by index, returning a keyed object per company. That way new columns can be added to the sheet and read in the backend without any code changes.

---

## 7. Platform Detection (fetchOneCompany)

The `if/else` chain in `fetchOneCompany` (api/jobs.js, lines 1096–1133) is fine and readable at its current size. If the platform count grows significantly, a registry pattern (array of `{ pattern: /regex/, handler: fn }` objects) would be cleaner. Not urgent, but worth doing when the 10th or 11th platform is added.

---

## 8. What Is Already Well-Generalized (Don't Touch)

- All eight platform-specific fetchers (Ashby, Lever, Polymer, Dover, Teamtailor, Breezy, Rippling, Custom) work for any company on that platform with zero modification.
- The custom-page scraper supports `/open-roles/`, `/about/careers/`, and `/careers/` paths generically, with embedded Rippling and Breezy widget detection.
- `formatSalary()` and `extractCompensationFromHtml()` are fully generic.
- The job schema (`company, title, department, location, type, workMode, compensation, equity, url`) is clean and platform-neutral.
- The frontend filter, search, URL-param, and cache logic are all generic.
- `STATE_ABBR` and `normalizeLocation()` are US-focused but not company-specific.
- The `Promise.allSettled` parallel fetch pattern with per-company error isolation is production-quality and should stay as-is.

---

## Prioritized Change List

**Must-do before publishing:**
1. Move `SHEET_CSV_URL` to a Vercel environment variable (`process.env.SHEET_CSV_URL`)
2. Mark the 4 branding spots in `index.html` with `<!-- FORK: ... -->` comments
3. Add a `SETUP.md` or README section explaining the required env var and sheet structure
4. Either generalize or clearly document the micro1 Core Team filter behavior

**High-value improvements:**
5. Add `homepageUrl` column to the Google Sheet schema; update `fetchCompanies()` to parse all columns by header name
6. Use Clearbit (`logo.clearbit.com/{domain}`) + Ashby/Lever native logo fields to auto-populate logos; eliminate `COMPANY_CONFIG` and per-company `.logo-*` CSS classes
7. Add optional `logoBg` hex column to the Google Sheet for badge background color
8. Rename `CACHE_KEY` to something generic or hostname-derived

**Nice to have (low urgency):**
9. Replace `fetchOneCompany`'s if/else chain with a platform registry
10. Add `ALLOWED_ORIGIN` env variable for API CORS control
11. Extract hero headline and footer text from a Google Sheet config tab so even those don't require a code edit

---

_Platform-specific fetcher code (Ashby, Lever, Polymer, Dover, Teamtailor, Breezy, Rippling, micro1, Custom) is intentionally kept as-is — this is the core value of the codebase and each module is already self-contained._

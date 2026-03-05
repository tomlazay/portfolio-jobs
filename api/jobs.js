// ============================================================
//  api/jobs.js — Vercel Edge Function (runtime: 'edge')
//
//  Runs on Cloudflare's edge network so outbound fetch() requests
//  originate from Cloudflare IPs, which bypasses Cloudflare bot
//  protection on third-party job boards (e.g. jobs.polymer.co).
//
//  Reads company list from Google Sheet, fetches live jobs
//  from each company's job board, and returns a unified list.
//
//  Supported platforms (auto-detected from URL):
//   - Ashby      (jobs.ashbyhq.com/{handle})
//   - Lever      (jobs.lever.co/{handle})
//   - Polymer    (jobs.polymer.co/{company})
//   - Dover      (app.dover.com/jobs/{handle})
//   - Teamtailor ({company}.teamtailor.com)
//   - Breezy HR  ({handle}.breezy.hr)
//   - Rippling   (ats.rippling.com/.../{board-slug}/jobs)
//   - micro1.ai  (www.micro1.ai/jobs — Next.js SPA; tries __NEXT_DATA__,
//                 public API, then static link scraping as fallback)
//   - Notion     ({workspace}.notion.site/{page} — uses Notion's internal
//                 loadCachedPageChunkV2 + queryCollection APIs; no auth required
//                 for public pages; filters to Status === "Open" automatically)
//   - Custom     (any other URL — scrapes /open-roles/ or /about/careers/
//                 links; auto-detects embedded Rippling or Breezy widgets)
//
//  Cached 24 hrs via Vercel CDN (s-maxage header).
// ============================================================

// Tell Vercel to run this function on the Edge (Cloudflare Workers) runtime.
// This is required for outbound fetch() to originate from Cloudflare IPs.
export const config = { runtime: 'edge' };

// ── Configuration ────────────────────────────────────────────
// Set SHEET_CSV_URL as a Vercel environment variable pointing to your
// Google Sheet's "Published to web" CSV export URL (gid=0, companies tab).
// A hardcoded fallback is kept here so existing Companyon deploys continue
// working without touching Vercel settings.  See SETUP.md for instructions.
const SHEET_CSV_URL =
  process.env.SHEET_CSV_URL ||
  'https://docs.google.com/spreadsheets/d/1xWYzNKkfUYV18CL7DpX_Q_HstHuJR6-i76Jqxd9cRXs/export?format=csv&gid=0';

// Ashby employmentType → display label
const ASHBY_TYPE_MAP = {
  FullTime:   'Full time',
  PartTime:   'Part-time',
  Contract:   'Contract',
  Temporary:  'Contract',
  Internship: 'Part-time',
};

// Ashby / Lever workplaceType → display label
const MODE_MAP = {
  // Ashby
  OnSite:  'On-site',
  Hybrid:  'Hybrid',
  Remote:  'Remote',
  // Lever (lowercase)
  'on-site': 'On-site',
  hybrid:    'Hybrid',
  remote:    'Remote',
};

// Common fetch headers for HTML scraping — full browser fingerprint to bypass bot protection
const SCRAPE_HEADERS = {
  'User-Agent':                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Accept':                    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language':           'en-US,en;q=0.9',
  'Accept-Encoding':           'gzip, deflate, br',
  'Cache-Control':             'no-cache',
  'Pragma':                    'no-cache',
  'sec-ch-ua':                 '"Google Chrome";v="121", "Not;A=Brand";v="8", "Chromium";v="121"',
  'sec-ch-ua-mobile':          '?0',
  'sec-ch-ua-platform':        '"macOS"',
  'sec-fetch-dest':            'document',
  'sec-fetch-mode':            'navigate',
  'sec-fetch-site':            'none',
  'sec-fetch-user':            '?1',
  'upgrade-insecure-requests': '1',
};

// ── Fetch company list from Google Sheet ─────────────────────
// Parses all columns by header name (case-insensitive), so new columns
// can be added to the sheet without code changes.
// Required columns : name  (or: company)
//                    url   (or: jobspagesource, jobspage, jobsurl, jobboardurl, boardurl)
// Optional columns : homepageUrl  (company website; used for structured logo lookup)
//                                 e.g. https://posh.com — NOT the ATS job board URL
async function fetchCompanies() {
  const res = await fetch(SHEET_CSV_URL, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Sheet fetch failed: ${res.status}`);
  const csv = await res.text();

  const lines = csv.trim().split('\n');
  const parseRow = line => (line.match(/(\".*?\"|[^,]+)/g) || [])
    .map(c => c.replace(/^\"|\"$/g, '').trim());

  // Normalise header names: lowercase, strip spaces/underscores/hyphens
  const headers = parseRow(lines[0]).map(h => h.toLowerCase().replace(/[\s_-]+/g, ''));

  const get = (cols, ...keys) => {
    for (const k of keys) {
      const i = headers.indexOf(k);
      if (i >= 0 && cols[i]) return cols[i];
    }
    return '';
  };

  return lines.slice(1)
    .map(line => {
      const cols = parseRow(line);
      // Accept common alternate header names so forks don't need to rename columns
      const name = get(cols, 'name', 'company');
      const url  = get(cols, 'url', 'jobspagesource', 'jobspage', 'jobsurl', 'jobboardurl', 'boardurl');
      if (!name || !url) return null;
      return {
        name,
        url,
        homepageUrl:  get(cols, 'homepageurl', 'homepage', 'website'),
        logoOverride: get(cols, 'logourl', 'logo'),  // optional per-company logo URL override
      };
    })
    .filter(Boolean);
}

// ── Fetch site config from Google Sheet (second tab, gid=1) ──
// The config tab must have two columns: "key" and "value".
// Supported keys:
//   siteTitle    — browser tab title  (e.g. "Portfolio Careers | My Firm")
//   heroHeadline — page main heading   (e.g. "Jobs in Our Portfolio")
//   heroSubtext  — page sub-heading    (e.g. "Explore open roles across our portfolio")
//   footerText   — footer copyright    (e.g. "Copyright 2026 My Firm LLC")
// Returns {} silently if the tab is missing, empty, or can't be parsed.
async function fetchConfig() {
  const configUrl = SHEET_CSV_URL.replace(/gid=\d+/, 'gid=1');
  try {
    const res = await fetch(configUrl, { redirect: 'follow' });
    if (!res.ok) return {};
    const csv = await res.text();
    const config = {};
    csv.trim().split('\n').slice(1).forEach(line => {
      const cols = (line.match(/(\".*?\"|[^,]+)/g) || [])
        .map(c => c.replace(/^\"|\"$/g, '').trim());
      if (cols[0] && cols[1]) config[cols[0]] = cols[1];
    });
    return config;
  } catch (_) {
    return {};
  }
}

// ── Derive logo URLs for a company ────────────────────────────
// Cascade (server picks the best available primary, client has a guaranteed fallback):
//   1. Sheet "logoUrl" column override (manually curated — always wins).
//   2. ATS-provided logoUrl (e.g. Ashby API returns one for many companies).
//   3. Schema.org Organization.logo from homepage JSON-LD — Google's rich-result
//      spec requires this to be a clean image on a light/transparent background.
//   4. SVG favicon from homepage — vector, scales perfectly at any badge size.
//   5. /apple-touch-icon.png on the company domain — 180×180px but may have
//      dark or heavily branded backgrounds (e.g. app icons).
//   Fallback (client-side, via data-fallback attribute):
//      Google Favicons API — always returns something, even for obscure domains.
// ATS-hosted boards (Ashby, Lever, etc.) can't be used for logo domain derivation —
// fill in homepageUrl for those companies so structured logo sources can be fetched.
const ATS_DOMAINS = /ashbyhq\.com|lever\.co|polymer\.co|dover\.com|teamtailor\.com|breezy\.hr|rippling\.com|micro1\.ai|notion\.site|notion\.so/;

function getLogoDomain(company) {
  const homeUrl = (company.homepageUrl || '').trim();
  if (homeUrl) {
    const d = homeUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
    if (d) return d;
  }
  const url = (company.url || '').trim();
  if (url && !ATS_DOMAINS.test(url)) {
    const d = url.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
    if (d) return d;
  }
  return '';
}

// Returns the apple-touch-icon URL (used only when structured logo sources are unavailable).
function deriveAppleTouchIcon(company) {
  if (company.logoOverride) return company.logoOverride;
  const domain = getLogoDomain(company);
  return domain ? `https://${domain}/apple-touch-icon.png` : '';
}

// Returns the Google Favicons URL — always resolves, used as client-side data-fallback.
function deriveLogoFallback(company) {
  const domain = getLogoDomain(company);
  return domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=128` : '';
}

// ── Fetch structured logo from a company homepage ─────────────
// Reads the first ~15 KB of the homepage (enough to cover any <head> block)
// and looks for two high-confidence logo sources, in order:
//
//   1. Schema.org Organization.logo (JSON-LD)
//      Companies include this for Google rich results. Google's own guidelines
//      require it to be "a clean image on a transparent, white, or light-colored
//      background" — exactly what we want for badges.
//      Handles: string URL, ImageObject {url/contentUrl}, @graph arrays,
//               multi-type arrays (["Organization","Corporation"]).
//
//   2. SVG favicon (<link rel="icon" type="image/svg+xml">)
//      A vector icon scales perfectly at any badge size and is always a clean mark.
//      Many modern companies ship an SVG favicon specifically for this reason.
//
// Returns an absolute URL string, or '' if neither source is found.
// Times out after 3 s so it never blocks the response.
async function fetchLogoFromHomepage(homeUrl) {
  if (!homeUrl) return '';
  try {
    const resp = await fetch(homeUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; portfolio-jobs-bot/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok) return '';

    // Stream the first 15 KB and stop at </head> — no need to read the body.
    const reader = resp.body?.getReader();
    if (!reader) return '';
    const decoder = new TextDecoder();
    let html = '';
    let bytesRead = 0;
    const LIMIT = 15_000;
    while (bytesRead < LIMIT) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      bytesRead += value.byteLength;
      if (html.includes('</head>')) break;
    }
    reader.cancel().catch(() => {});

    // Helper: resolve protocol-relative and root-relative URLs against the homepage origin.
    const origin = homeUrl.match(/^(https?:\/\/[^/]+)/)?.[1] || '';
    function resolveUrl(raw) {
      if (!raw || typeof raw !== 'string') return '';
      const s = raw.trim();
      if (s.startsWith('//'))   return `https:${s}`;
      if (s.startsWith('/'))    return origin ? `${origin}${s}` : '';
      return s.startsWith('http') ? s : '';
    }

    // ── Source 1: Schema.org Organization.logo (JSON-LD) ─────
    // Scan all <script type="application/ld+json"> blocks in the page head.
    const jsonLdRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let jm;
    while ((jm = jsonLdRe.exec(html)) !== null) {
      let data;
      try { data = JSON.parse(jm[1]); } catch { continue; }

      // Normalise: a single object or a @graph array both become a flat list.
      const items = Array.isArray(data?.['@graph']) ? data['@graph']
                  : data ? [data] : [];

      for (const item of items) {
        if (!item || !item.logo) continue;
        // Accept: Organization, Corporation, LocalBusiness, Brand (and arrays thereof)
        const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type'] || ''];
        const isOrg = types.some(t => /^(Organization|Corporation|LocalBusiness|Brand)$/i.test(t));
        if (!isOrg) continue;

        // logo can be a URL string or an ImageObject with url/contentUrl
        const logoSrc = typeof item.logo === 'string' ? item.logo
                      : item.logo?.url || item.logo?.contentUrl || '';
        const resolved = resolveUrl(logoSrc);
        if (resolved) return resolved;
      }
    }

    // ── Source 2: SVG favicon ─────────────────────────────────
    // Match <link rel="icon" type="image/svg+xml" href="..."> in either attribute order.
    const svgIcon = html.match(/<link[^>]+type=["']image\/svg\+xml["'][^>]+href=["']([^"']+)["'][^>]*>/i)
                 || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+type=["']image\/svg\+xml["'][^>]*>/i)
                 || html.match(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+\.svg(?:\?[^"']*)?)["'][^>]*>/i)
                 || html.match(/<link[^>]+href=["']([^"']+\.svg(?:\?[^"']*)?)["'][^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/i);
    if (svgIcon) {
      const resolved = resolveUrl(svgIcon[1]);
      if (resolved) return resolved;
    }

    return ''; // no structured logo found — caller falls back to apple-touch-icon
  } catch {
    return ''; // timeout, DNS failure, non-HTML, etc.
  }
}

// ── Ashby ─────────────────────────────────────────────────────
async function fetchAshbyJobs(handle, companyName) {
  // includeCompensation=true adds job.compensation object with structured salary data.
  // Without it, no compensation fields are returned in the listing.
  const res = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${handle}?includeCompensation=true`);
  if (!res.ok) throw new Error(`Ashby fetch failed for "${handle}": ${res.status}`);
  const data = await res.json();

  // Ashby may return an org-level logo in the response. Try common paths.
  // If not present, handler will use Schema.org/SVG logo from homepageUrl (or apple-touch-icon).
  const ashbyLogo = data.logoUrl || data.jobBoard?.logoUrl
                 || data.jobBoard?.logoWordmarkUrl || data.organization?.logoUrl || '';

  return (data.jobs || []).map(job => {
    // Only surface compensation when the company opted in to displaying it.
    // job.compensation.scrapeableCompensationSalarySummary is a clean salary-only string
    // e.g. "$180K - $220K". Fall back to compensationTierSummary (may include equity note)
    // stripped of the equity suffix.
    let rawComp = '';
    if (job.shouldDisplayCompensationOnJobPostings && job.compensation) {
      rawComp = job.compensation.scrapeableCompensationSalarySummary
             || (job.compensation.compensationTierSummary || '').split(' • ')[0]
             || '';
    }

    // Detect equity from compensation tier components (EquityCashValue / EquityPercentage)
    const hasEquity = !!(job.compensation?.compensationTiers?.some(tier =>
      tier.components?.some(c => c.compensationType?.startsWith('Equity'))
    ));

    return {
      company:      companyName,
      title:        (job.title || '').trim(),
      department:   job.department || '',
      location:     job.location   || '',
      type:         ASHBY_TYPE_MAP[job.employmentType] || 'Full time',
      workMode:     job.isRemote ? 'Remote' : (MODE_MAP[job.workplaceType] || 'On-site'),
      compensation: formatSalary(rawComp),
      equity:       hasEquity,
      url:          job.jobUrl || `https://jobs.ashbyhq.com/${handle}`,
      logoUrl:      ashbyLogo,   // handler fills in Schema.org/SVG/apple-touch-icon logo if empty
    };
  });
}

// ── Lever ─────────────────────────────────────────────────────
async function fetchLeverJobs(handle, companyName) {
  const res = await fetch(`https://api.lever.co/v0/postings/${handle}?mode=json`);
  if (!res.ok) throw new Error(`Lever fetch failed for "${handle}": ${res.status}`);
  const data = await res.json();

  return (Array.isArray(data) ? data : []).map(job => {
    // salaryRange: { min: 80000, max: 120000, currency: "USD", interval: "per year" }
    const sr   = job.salaryRange;
    let comp   = '';
    if (sr && (sr.min || sr.max)) {
      const fmt  = n => n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${n}`;
      comp = sr.min && sr.max
        ? `${fmt(sr.min)} – ${fmt(sr.max)}`
        : sr.min ? `${fmt(sr.min)}+` : `Up to ${fmt(sr.max)}`;
    }
    return {
      company:      companyName,
      title:        (job.text || '').trim(),
      department:   job.categories?.team       || '',
      location:     job.categories?.location   || '',
      type:         job.categories?.commitment || 'Full-time',
      workMode:     MODE_MAP[job.workplaceType] || 'On-site',
      compensation: comp,
      equity:       false,
      url:          job.hostedUrl || `https://jobs.lever.co/${handle}`,
      logoUrl:      '',   // handler fills in Schema.org/SVG/apple-touch-icon logo
    };
  });
}

// ── Polymer ───────────────────────────────────────────────────
// Polymer job boards are Next.js apps at jobs.polymer.co/{slug}.
// Companies sometimes rename (e.g. Lendica → Daylit) but keep their old
// Polymer slug, so the Google Sheet URL may redirect to a different slug.
// Strategy (tried in order):
//   1. Public REST API  — api.polymer.co/v1/hire/organizations/{slug}/jobs
//      (tried with original slug first, then redirect-resolved slug if different)
//   2. __NEXT_DATA__    — JSON embedded in the page <script> tag
//   3. Link scraping    — parse <a href="/{slug}/{id}"> from HTML as last resort
async function fetchPolymerJobs(pageUrl, companyName) {
  const baseUrl     = pageUrl.split('#')[0].split('?')[0];
  const inputSlug   = baseUrl.replace(/.*polymer\.co\//, '').replace(/\/$/, '');

  // Helper: try the Polymer public REST API for a given slug (paginated).
  // Returns { jobs: [...], rawSample } on success, or null on HTTP error.
  async function tryPolymerApi(slug) {
    const PER_PAGE  = 50;
    const apiJobs   = [];
    let   apiPage   = 1;
    let   rawSample = null;   // first-page raw data for diagnostics
    // Denylist approach: exclude clearly inactive statuses; include everything else.
    // An allowlist would silently drop jobs if Polymer uses an unexpected status value.
    const INACTIVE = new Set(['draft', 'archived', 'closed', 'expired', 'deleted', 'inactive', 'removed', 'filled']);
    while (true) {
      const apiUrl = `https://api.polymer.co/v1/hire/organizations/${slug}/jobs`
                   + `?page=${apiPage}&per_page=${PER_PAGE}`;
      // Use minimal headers for the REST API — avoid Origin/Referer which can
      // trigger CORS pre-flight rejection from an unexpected server origin.
      const apiRes = await fetch(apiUrl, {
        headers: {
          'Accept':          'application/json',
          'Accept-Language': SCRAPE_HEADERS['Accept-Language'],
          'User-Agent':      SCRAPE_HEADERS['User-Agent'],
        },
      });
      if (!apiRes.ok) {
        // Log actual status so we can distinguish 401/403/404 in error reports
        console.warn(`Polymer API ${apiRes.status} for slug "${slug}" (page ${apiPage})`);
        return null;   // signal HTTP failure to caller
      }

      const apiData = await apiRes.json();
      if (apiPage === 1) rawSample = apiData;
      const page = Array.isArray(apiData)       ? apiData
                 : Array.isArray(apiData.jobs)  ? apiData.jobs
                 : Array.isArray(apiData.data)  ? apiData.data
                 : [];

      apiJobs.push(...page
        .filter(j => !INACTIVE.has((j.status || '').toLowerCase()))
        .map(job => ({
          company:      companyName,
          title:        job.title || job.name || '',
          department:   job.department || job.category || job.team || '',
          location:     job.location   || job.city     || '',
          type:         job.employment_type || job.employmentType || job.kind || job.type || 'Full-time',
          workMode:     (job.remote || job.isRemote) ? 'Remote' : (job.work_mode || job.workMode || 'On-site'),
          compensation: job.salary || job.compensation || '',
          equity:       false,
          url:          job.url || job.apply_url || job.applyUrl
                        || (job.id ? `https://jobs.polymer.co/${slug}/${job.id}` : ''),
          logoUrl:      '',
        }))
      );

      if (page.length < PER_PAGE) break;
      apiPage++;
    }
    return { jobs: apiJobs, rawSample };
  }

  // ── Strategy 1a: API with the slug from the Google Sheet ────
  let apiDiag = null;   // raw API response for diagnostics if all strategies fail
  let apiStatus = null;
  try {
    const result = await tryPolymerApi(inputSlug);
    if (result) {
      apiDiag = result.rawSample;
      if (result.jobs.length > 0) return result.jobs;
    }
  } catch (e) {
    apiStatus = e.message;   // fall through
  }

  // ── Strategies 2 & 3 require the HTML page ──────────────────
  // fetch() follows redirects automatically; .url gives the final URL.
  // This is critical for renamed companies (e.g. sheet has /daylit but
  // Polymer redirects to /lendica — slug mismatch breaks link scraping).
  const htmlRes = await fetch(baseUrl, { headers: SCRAPE_HEADERS });
  if (!htmlRes.ok) {
    throw new Error(
      `Polymer: HTML fetch failed for "${companyName}" (${baseUrl}): HTTP ${htmlRes.status}`
    );
  }
  const html = await htmlRes.text();

  // Resolve the effective slug from the final URL after any redirect
  const finalUrl      = htmlRes.url || baseUrl;
  const resolvedSlug  = finalUrl.replace(/.*polymer\.co\//, '').replace(/[/?#].*$/, '') || inputSlug;

  // ── Strategy 1b: API retry with the redirect-resolved slug ──
  if (resolvedSlug !== inputSlug) {
    try {
      const result = await tryPolymerApi(resolvedSlug);
      if (result) {
        if (!apiDiag) apiDiag = result.rawSample;
        if (result.jobs.length > 0) return result.jobs;
      }
    } catch (_) { /* fall through */ }
  }

  // ── Strategy 2: __NEXT_DATA__ (Next.js server-side props) ───
  const ndMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (ndMatch) {
    try {
      const nd   = JSON.parse(ndMatch[1]);
      const pp   = nd?.props?.pageProps || {};
      const list = Array.isArray(pp.jobs)               ? pp.jobs
                 : Array.isArray(pp.organization?.jobs) ? pp.organization.jobs
                 : Array.isArray(pp.data?.jobs)         ? pp.data.jobs
                 : Array.isArray(pp.initialJobs)        ? pp.initialJobs
                 : [];
      if (list.length > 0) {
        return list.map(job => ({
          company:      companyName,
          title:        job.title || job.name || '',
          department:   job.department || job.category || job.team || '',
          location:     job.location   || job.city     || '',
          type:         job.employment_type || job.employmentType || job.kind || job.type || 'Full-time',
          workMode:     (job.remote || job.isRemote) ? 'Remote' : (job.work_mode || job.workMode || 'On-site'),
          compensation: job.salary || job.compensation || '',
          equity:       false,
          url:          job.url || job.apply_url || job.applyUrl
                        || (job.id ? `https://jobs.polymer.co/${resolvedSlug}/${job.id}` : ''),
          logoUrl:      '',
        }));
      }
    } catch (_) { /* fall through */ }
  }

  // ── Strategy 3: link scraping using the resolved slug ───────
  const jobs = [];
  const linkRegex = new RegExp(
    `href="((?:https://jobs\\.polymer\\.co)?/${resolvedSlug}/[\\w-]+)"[^>]*>([\\s\\S]*?)<\\/a>`, 'gi'
  );
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];

    // Strip tags → newlines, decode entities, remove boilerplate.
    // Split on newlines BEFORE collapsing whitespace (collapsing first would
    // destroy the tag-derived line breaks). Also split on "·" separators that
    // Polymer uses to pack multiple meta fields into a single element.
    const parts = match[2]
      .replace(/<[^>]+>/g, '\n')
      .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
      .replace(/View job/gi, '')
      .split('\n')
      .flatMap(s => s.split(/\s*·\s*/))        // "Full-time · Boston, MA · $80K"
      .map(s => s.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    if (parts.length < 1 || parts[0].length < 3) continue;

    const jobUrl = href.startsWith('http') ? href : `https://jobs.polymer.co${href}`;

    // Pattern-based field extraction (order-independent — Polymer's HTML structure
    // varies across companies and job types, so fixed indices are unreliable).
    const title      = parts[0];
    const typeSnip   = parts.find(p => /^(full[\s-]?time|part[\s-]?time|contract|intern)/i.test(p));
    const salarySnip = parts.find(p => /\d+\s*K|\$\s*\d|USD/i.test(p));
    // Location: looks like "City, ST" or "Remote" (has a comma, or is exactly "Remote")
    const locationSnip = parts.slice(1).find(p =>
      p !== typeSnip && p !== salarySnip && (p.includes(',') || /^remote$/i.test(p))
    );

    jobs.push({
      company:      companyName,
      title,
      department:   '',
      location:     locationSnip || '',
      type:         typeSnip    || 'Full-time',
      workMode:     /remote/i.test(locationSnip || '') ? 'Remote' : 'On-site',
      compensation: salarySnip ? formatSalary(salarySnip) : '',
      equity:       false,
      url:          jobUrl,
      logoUrl:      '',
    });
  }

  if (jobs.length === 0 && html.length > 0) {
    const hasNextData = html.includes('__NEXT_DATA__');
    const apiSample = apiDiag
      ? JSON.stringify(apiDiag).slice(0, 300)
      : (apiStatus || '(API returned HTTP error — check Vercel logs for status code)');
    throw new Error(
      `Polymer: no jobs found for "${companyName}". ` +
      `Input slug: ${inputSlug}, resolved slug: ${resolvedSlug}. ` +
      `__NEXT_DATA__ present: ${hasNextData}. ` +
      `API result: ${apiSample}. ` +
      `HTML preview: ${html.slice(0, 300)}`
    );
  }

  return jobs;
}

// ── Dover ─────────────────────────────────────────────────────
// Strategy 1 (API): GET /api/v1/careers-page-slug/{handle} → UUID,
//   then GET /api/v1/job-groups/{uuid}/job-groups → jobs array.
// Strategy 2 (HTML): if API returns HTML/fails, fetch the page and
//   extract jobs from __NEXT_DATA__ (Dover uses Next.js).
async function fetchDoverJobs(handle, companyName) {
  const pageUrl = `https://app.dover.com/jobs/${handle}`;

  // Map a raw Dover job object (from either API or __NEXT_DATA__) to our schema
  function mapDoverJob(job, urlOverride) {
    const loc = (job.locations || [])
      .map(l => l.location_option?.display_name || l.display_name || '')
      .filter(Boolean).join(', ');
    return {
      company:      companyName,
      title:        (job.title || '').trim(),
      department:   job.department || job.team || '',
      location:     loc || job.location || '',
      type:         'Full-time',
      workMode:     job.is_remote ? 'Remote' : 'On-site',
      compensation: '',
      equity:       false,
      url:          urlOverride || job.url || job.apply_url
                    || (job.id ? `${pageUrl}/${job.id}` : pageUrl),
      logoUrl:      '',
    };
  }

  // ── Strategy 1: REST API (careers-page-slug → job-groups) ───
  // Dover's slug API is case-sensitive; try original then title-cased.
  async function tryDoverApi() {
    const candidates = [
      handle,
      handle.charAt(0).toUpperCase() + handle.slice(1),
    ];
    const unique = [...new Set(candidates)];

    for (const candidate of unique) {
      try {
        const slugRes = await fetch(
          `https://app.dover.com/api/v1/careers-page-slug/${candidate}`,
          { headers: { 'Accept': 'application/json', ...SCRAPE_HEADERS } }
        );
        if (!slugRes.ok) continue;
        const ct = slugRes.headers.get('content-type') || '';
        if (!ct.includes('json')) continue;   // HTML error page
        const slugData = await slugRes.json();
        const uuid = slugData.id;
        if (!uuid) continue;

        const jobsRes = await fetch(
          `https://app.dover.com/api/v1/job-groups/${uuid}/job-groups`,
          { headers: { 'Accept': 'application/json', ...SCRAPE_HEADERS } }
        );
        if (!jobsRes.ok) continue;
        const jct = jobsRes.headers.get('content-type') || '';
        if (!jct.includes('json')) continue;
        const data = await jobsRes.json();

        const jobs = [];
        for (const group of (Array.isArray(data) ? data : [])) {
          for (const job of (group.jobs || [])) {
            if (!job.is_published || job.is_sample) continue;
            jobs.push(mapDoverJob(job));
          }
        }
        return jobs;   // success (may be empty if no open roles)
      } catch (_) { /* try next candidate */ }
    }
    return null;   // all candidates failed
  }

  // ── Strategy 2: HTML page (__NEXT_DATA__ + link scraping) ────
  async function tryDoverHtml() {
    const htmlRes = await fetch(pageUrl, { headers: SCRAPE_HEADERS });
    if (!htmlRes.ok) throw new Error(`Dover HTML fetch failed for "${companyName}": HTTP ${htmlRes.status}`);
    const html = await htmlRes.text();

    // 2a. __NEXT_DATA__ — present when Dover uses SSR (preferred)
    const ndMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (ndMatch) {
      try {
        const nd = JSON.parse(ndMatch[1]);
        const pp = nd?.props?.pageProps || {};
        // Try multiple possible shapes Dover's pageProps may use
        const rawJobs = Array.isArray(pp.jobs)       ? pp.jobs
                      : Array.isArray(pp.jobPostings) ? pp.jobPostings
                      : pp.careersPage?.job_groups?.flatMap(g => g.jobs || [])
                     || pp.jobGroups?.flatMap(g => g.jobs || [])
                     || [];
        if (rawJobs.length > 0) {
          return rawJobs
            .filter(j => j.is_published !== false && !j.is_sample)
            .map(job => mapDoverJob(job));
        }
      } catch (_) { /* fall through to link scraping */ }
    }

    // 2b. Link scraping — Dover job links: /{handle}/careers/{uuid}
    // e.g. href="/allstacks/careers/1977474b-7ac4-4a9d-a56b-7eac98558a24"
    const jobs = [];
    const linkRe = new RegExp(
      `href="((?:https://app\\.dover\\.com)?/${handle}/careers/([\\w-]+))"[^>]*>([\\s\\S]*?)</a>`, 'gi'
    );
    let m;
    while ((m = linkRe.exec(html)) !== null) {
      const href  = m[1].startsWith('http') ? m[1] : `https://app.dover.com${m[1]}`;
      const label = m[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (!label || label.length < 3) continue;
      jobs.push({
        company:      companyName,
        title:        label,
        department:   '',
        location:     '',
        type:         'Full-time',
        workMode:     'On-site',
        compensation: '',
        equity:       false,
        url:          href,
      });
    }
    if (jobs.length > 0) return jobs;

    throw new Error(
      `Dover: no jobs found for "${companyName}" via HTML scraping. ` +
      `__NEXT_DATA__ present: ${!!ndMatch}. ` +
      `HTML preview: ${html.slice(0, 300)}`
    );
  }

  // Try API first; fall back to HTML scraping
  const apiResult = await tryDoverApi();
  if (apiResult !== null) return apiResult;

  return await tryDoverHtml();
}

// ── Teamtailor ────────────────────────────────────────────────
// Teamtailor job boards are hosted at {company}.teamtailor.com/jobs
// Job cards link to ABSOLUTE URLs: https://{company}.teamtailor.com/jobs/{id}-{slug}
// Rendered text (browser) format: "Title\nDept · Location · WorkMode"
async function fetchTeamtailorJobs(pageUrl, companyName) {
  const baseUrl = pageUrl.split('#')[0].split('?')[0];

  const res = await fetch(baseUrl, { headers: SCRAPE_HEADERS });
  if (!res.ok) throw new Error(`Teamtailor fetch failed for "${companyName}": ${res.status}`);
  const html = await res.text();

  const jobs = [];
  // Links are absolute: href="https://roadsync.teamtailor.com/jobs/7307629-account-executive"
  const linkRegex = /href="(https?:\/\/[^"]+teamtailor\.com\/jobs\/\d+-[^"#?]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const seen = new Set();
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    if (seen.has(href)) continue;
    seen.add(href);

    // Strip all tags, decode entities, collapse whitespace
    const rawText = match[2]
      .replace(/<svg[\s\S]*?<\/svg>/gi, '')  // remove SVG icons
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&middot;/g, '·')
      .replace(/&#183;/g, '·').replace(/\u00b7/g, '·')
      .replace(/[ \t]+/g, ' ')               // collapse spaces (keep newlines for now)
      .replace(/\n\s*/g, '\n')
      .trim();

    // Browser renders as: "Title\nDept · Location · WorkMode"
    // The \n separates title from the metadata line
    const newlineIdx = rawText.indexOf('\n');
    const title = (newlineIdx > 0 ? rawText.slice(0, newlineIdx) : rawText).trim();
    const meta  = (newlineIdx > 0 ? rawText.slice(newlineIdx + 1) : '').trim();

    if (!title || title.length < 2) continue;

    // Meta formats Teamtailor uses:
    //   3-part: "Dept · Location · WorkMode"   (most common)
    //   2-part: "Location · WorkMode"           (no dept on some cards)
    //   2-part: "Dept · WorkMode"               (no location)
    // Detect by checking whether the last part is a known work-mode value.
    const KNOWN_MODES = new Set(['remote', 'hybrid', 'on-site', 'on site', 'in office', 'in-office', 'flexible']);
    const metaParts = meta.split(/\s*·\s*/).map(s => s.trim()).filter(Boolean);

    let dept = '', location = '', wm = '';
    if (metaParts.length >= 3) {
      [dept, location, wm] = metaParts;
    } else if (metaParts.length === 2) {
      const lastIsMode = KNOWN_MODES.has(metaParts[1].toLowerCase());
      const firstHasComma = metaParts[0].includes(',');  // "Atlanta, GA" → location
      if (lastIsMode && firstHasComma) {
        // "Atlanta, GA · Hybrid" — no dept
        [location, wm] = metaParts;
      } else if (lastIsMode) {
        // "Engineering · Hybrid" — dept + mode, no location
        [dept, wm] = metaParts;
      } else {
        // "Dept · Location" — no work-mode listed
        [dept, location] = metaParts;
      }
    } else if (metaParts.length === 1) {
      if (KNOWN_MODES.has(metaParts[0].toLowerCase())) wm = metaParts[0];
      else dept = metaParts[0];
    }
    const workMode = MODE_MAP[wm.toLowerCase()] || (wm || 'On-site');

    jobs.push({
      company:      companyName,
      title,
      department:   dept,
      location,
      type:         'Full-time',
      workMode,
      compensation: '',
      equity:       false,
      url:          href,   // already absolute
      logoUrl:      '',
    });
  }

  return jobs;
}

// ── Rippling ATS ──────────────────────────────────────────────
// Rippling job boards are Next.js apps at ats.rippling.com/.../{board-slug}/jobs
// All job data is SSR-embedded in window.__NEXT_DATA__.
async function fetchRipplingJobs(boardSlug, companyName) {
  // Try both URL patterns Rippling uses
  const urls = [
    `https://ats.rippling.com/en-GB/${boardSlug}/jobs`,
    `https://ats.rippling.com/${boardSlug}/jobs`,
  ];

  let html = '';
  for (const url of urls) {
    const res = await fetch(url, { headers: SCRAPE_HEADERS });
    if (res.ok) { html = await res.text(); break; }
  }
  if (!html) throw new Error(`Rippling fetch failed for "${companyName}"`);

  // Extract __NEXT_DATA__ JSON
  const ndMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!ndMatch) throw new Error(`Rippling: __NEXT_DATA__ not found for "${companyName}"`);

  let nextData;
  try { nextData = JSON.parse(ndMatch[1]); }
  catch { throw new Error(`Rippling: failed to parse __NEXT_DATA__ for "${companyName}"`); }

  // Job data lives in dehydratedState.queries — find the one with "job-posts"
  const queries = nextData?.props?.pageProps?.dehydratedState?.queries || [];
  let items = [];
  for (const q of queries) {
    const key = JSON.stringify(q.queryKey || q.queryHash || '');
    if (key.includes('job-post') || key.includes('job_post')) {
      items = q.state?.data?.items || q.state?.data || [];
      if (Array.isArray(items) && items.length) break;
    }
  }

  const RIPPLING_MODE = {
    REMOTE:  'Remote',
    HYBRID:  'Hybrid',
    ON_SITE: 'On-site',
    ONSITE:  'On-site',
  };

  return items.map(job => {
    const loc = (job.locations || []).map(l => l.name || l.city || '').filter(Boolean).join(', ');
    const wt  = (job.locations?.[0]?.workplaceType || '').toUpperCase();
    // Rippling may provide a compensationRange object {min, max, currency} or a salary string
    const cr   = job.compensationRange || job.salaryRange || {};
    let comp   = job.salary || job.compensation || '';
    if (!comp && (cr.min || cr.max)) {
      const fmt = n => n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${n}`;
      comp = cr.min && cr.max
        ? `${fmt(cr.min)} – ${fmt(cr.max)}`
        : cr.min ? `${fmt(cr.min)}+` : `Up to ${fmt(cr.max)}`;
    }
    return {
      company:      companyName,
      title:        (job.name || '').trim(),
      department:   job.department?.name || '',
      location:     loc,
      type:         'Full-time',
      workMode:     RIPPLING_MODE[wt] || 'On-site',
      compensation: formatSalary(comp),
      equity:       false,
      url:          job.url || `https://ats.rippling.com/${boardSlug}/jobs/${job.id}`,
      logoUrl:      '',
    };
  });
}

// ── Breezy HR ─────────────────────────────────────────────────
// Breezy HR exposes a public JSON API at https://{handle}.breezy.hr/json
async function fetchBreezyJobs(handle, companyName) {
  const res = await fetch(`https://${handle}.breezy.hr/json`, {
    headers: { 'Accept': 'application/json', ...SCRAPE_HEADERS },
  });
  if (!res.ok) throw new Error(`Breezy fetch failed for "${companyName}": ${res.status}`);
  const data = await res.json();

  const BREEZY_REMOTE = { remote: 'Remote', hybrid: 'Hybrid', 'on-site': 'On-site' };

  return (Array.isArray(data) ? data : []).map(job => {
    const loc      = job.location?.name || '';
    const isRemote = job.location?.is_remote || false;
    const remVal   = (job.location?.remote_details?.value || '').toLowerCase();
    const workMode = isRemote ? (BREEZY_REMOTE[remVal] || 'Remote') : 'On-site';

    return {
      company:      companyName,
      title:        (job.name || '').trim(),
      department:   job.department || '',
      location:     loc,
      type:         job.type?.name || 'Full-time',
      workMode,
      compensation: job.salary || '',
      equity:       false,
      url:          job.url || `https://${handle}.breezy.hr`,
      logoUrl:      '',
    };
  });
}

// ── Custom careers page ───────────────────────────────────────
// Supports:
//   /open-roles/{slug}    (north.cloud style — relative links)
//   /about/careers/{slug} (ziflow.com style — absolute links)
//   /careers/{slug}       (generic — relative or absolute)
//
// Auto-detects embedded Rippling or Breezy HR widgets and
// delegates to the appropriate handler when no static links found.
async function fetchCustomJobs(pageUrl, companyName) {
  const baseUrl     = pageUrl.split('#')[0].split('?')[0];
  const domainMatch = baseUrl.match(/^(https?:\/\/[^/]+)/);
  const domain      = domainMatch ? domainMatch[1] : '';

  const res = await fetch(baseUrl, { headers: SCRAPE_HEADERS });
  if (!res.ok) throw new Error(`Custom page fetch failed for "${companyName}": ${res.status}`);
  const html = await res.text();

  const jobs = [];
  // Match relative (/open-roles/slug) OR absolute (https://domain.com/careers/slug) job links.
  // The inner platform group is non-capturing (?:) so match[2] is the link text.
  const linkRegex = /href="((?:https?:\/\/[^"]+)?\/(?:open-roles|about\/careers|careers)\/[^"#?]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const seen = new Set();
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    if (seen.has(href)) continue;
    seen.add(href);

    const rawText = match[2]
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|li|h[1-6]|section|article|span)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&nbsp;/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n[ \t]*/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const parts = rawText.split(/\n|\s{2,}/).map(s => s.trim()).filter(Boolean);

    // Remove description blobs (>100 chars) and UI button labels
    const UI_NOISE = /^(apply|apply now|view job|view role|learn more|see details|read more)$/i;
    const cleanParts = parts.filter(p => p.length <= 100 && !UI_NOISE.test(p));

    if (cleanParts.length >= 1 && cleanParts[0].length > 2) {
      // Detect category-before-title layouts (e.g. Ziflow):
      // Score each of the first two parts against the URL slug.
      // If parts[1] matches the slug better, it's the real title and parts[0] is the dept.
      const slugWords = (href.split('/').pop() || '').replace(/-/g, ' ').toLowerCase();
      const score     = s => s.toLowerCase().split(/\s+/).filter(w => w.length > 2 && slugWords.includes(w)).length;
      const titleIdx  = (slugWords && cleanParts.length > 1 && score(cleanParts[1]) > score(cleanParts[0])) ? 1 : 0;

      // href may be absolute (https://...) or relative (/path/slug)
      const jobUrl = href.startsWith('http') ? href : `${domain}${href}`;
      jobs.push({
        company:      companyName,
        title:        cleanParts[titleIdx],
        department:   titleIdx > 0 ? cleanParts[0] : '',
        location:     cleanParts[titleIdx + 1] || '',
        type:         cleanParts[titleIdx + 2] || 'Full-time',
        workMode:     cleanParts[titleIdx + 3] || 'Hybrid',
        compensation: '',
        equity:       false,
        url:          jobUrl,
        logoUrl:      '',   // derived from page domain by deriveLogoUrl() in handler
      });
    }
  }

  // ── Per-job compensation extraction ──────────────────────────
  // Fetch each individual job page in parallel and scan for a "Compensation"
  // heading section. Failures are silently ignored so a single slow/blocked
  // page doesn't break the whole response.
  if (jobs.length > 0) {
    await Promise.allSettled(jobs.map(async job => {
      try {
        const jobRes = await fetch(job.url, { headers: SCRAPE_HEADERS });
        if (!jobRes.ok) return;
        const jobHtml = await jobRes.text();
        const comp = extractCompensationFromHtml(jobHtml);
        if (comp) job.compensation = comp;
      } catch {
        // non-fatal
      }
    }));
  }

  // ── Embedded platform fallbacks ──────────────────────────────
  // If no static links found, check whether the page embeds a known
  // ATS widget and delegate to the correct handler.
  if (jobs.length === 0) {
    // Rippling ATS — e.g. fullcast.com/careers embeds ats.rippling.com/{slug}/jobs
    const ripplingMatch = html.match(
      /ats\.rippling\.com\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?([a-z][a-z0-9-]+)\/jobs/
    );
    if (ripplingMatch) {
      return fetchRipplingJobs(ripplingMatch[1], companyName);
    }

    // Breezy HR — e.g. arpio.io/careers embeds {handle}.breezy.hr/embed
    const breezyMatch = html.match(/https?:\/\/([a-z0-9-]+)\.breezy\.hr\/embed/);
    if (breezyMatch) {
      return fetchBreezyJobs(breezyMatch[1], companyName);
    }
  }

  return jobs;
}

// ── micro1.ai ─────────────────────────────────────────────────
// micro1 is a contractor staffing platform with two distinct job types:
//   1. "Core team" jobs — micro1's own internal full-time hiring
//   2. Client/contractor postings — marketplace jobs placed by client companies
//
// ── FILTER BEHAVIOR (how to customise) ──────────────────────
// This function currently returns ONLY Core team jobs (micro1's own hiring).
// This is appropriate when micro1 is a portfolio company and you want to
// surface its direct employment opportunities — not the contractor marketplace.
//
// To return ALL jobs (client + contractor + Core team):
//   Remove the `if (!isCoreTeam) continue;` line below.
//
// To return only contractor/client postings (not micro1's own hiring):
//   Change the condition to `if (isCoreTeam) continue;`
//
// The `inferDepartmentFromTitle()` helper below is used because micro1 does
// not expose a structured department field on Core team roles.
//
// API endpoint: https://prod-api.micro1.ai/api/v1/job/portal (POST)
// Individual posting pages: https://jobs.micro1.ai/post/{UUID}
//
// Infer a department string from a job title for platforms (e.g. micro1)
// that don't expose a structured department field.
// Returns a department string matching the site's filter tags, or '' if unknown.
function inferDepartmentFromTitle(title) {
  const t = (title || '').toLowerCase();

  // Engineering — developers, MTS, AI/ML, forward-deployed, robotics/research labs
  if (/\b(engineer|developer|dev\b|fullstack|full.?stack|frontend|front.?end|backend|back.?end|software|ai\/ml|machine learning|member of technical staff|\bmts\b|forward deployed|robotics|research lab)\b/.test(t))
    return 'Engineering';

  // Design
  if (/\b(designer|ui\/ux|ux|ui\b|visual design|creative)\b/.test(t))
    return 'Design';

  // Sales — explicit "sales", "client partner", "account executive/manager"
  if (/\b(sales|client partner|account executive|account manager)\b/.test(t))
    return 'Sales';

  // Business Development — partnerships, BDR, SDR
  if (/\b(partnerships?|business development|bdr|sdr)\b/.test(t))
    return 'Business Development';

  // Product
  if (/\b(product manager|product lead|product owner)\b/.test(t))
    return 'Product';

  // Marketing
  if (/\b(marketing|content|social media|brand|growth|copywriter)\b/.test(t))
    return 'Marketing';

  // Data & Analytics
  if (/\b(data scientist|data analyst|analytics|intelligence analyst)\b/.test(t))
    return 'Data & Analytics';

  // Finance
  if (/\b(finance|financial|accountant|accounting|controller|cfo)\b/.test(t))
    return 'Finance';

  // Operations — project/program leads, ops, admin, personal assistant, chief of staff
  if (/\b(strategic project|project manager|project lead|program manager|operations|ops\b|personal assistant|chief of staff|coordinator)\b/.test(t))
    return 'Operations';

  return '';
}

async function fetchMicro1Jobs(companyName) {
  const BASE = 'https://prod-api.micro1.ai/api/v1/job/portal';
  const LIMIT = 18;
  const allJobs = [];
  let page = 1;
  let totalSeen = 0;          // total jobs seen across all pages (for diagnostics)
  let sampleIsMicro1 = null;  // sample is_micro1_account value for diagnostics

  // API requires Origin/Referer headers matching the Webflow frontend.
  // The XHR call from micro1.ai frontend uses POST (not GET), hence
  // bare GET requests get "Cannot GET" 404 from Express.
  const MICRO1_HEADERS = {
    ...SCRAPE_HEADERS,
    'Accept':       'application/json',
    'Content-Type': 'application/json',
    'Origin':       'https://www.micro1.ai',
    'Referer':      'https://www.micro1.ai/',
  };

  while (true) {
    const url = `${BASE}?page=${page}&limit=${LIMIT}&keyword=`;
    const res = await fetch(url, {
      method:  'POST',
      headers: MICRO1_HEADERS,
      body:    JSON.stringify({ action: 'get_all_jobs', page, limit: LIMIT, keyword: '' }),
    });

    // Capture body text first so we can include it in error messages
    const rawText = await res.text();
    if (!res.ok) {
      throw new Error(`micro1 API HTTP ${res.status} — ${rawText.slice(0, 300)}`);
    }

    let json;
    try {
      json = JSON.parse(rawText);
    } catch (e) {
      throw new Error(`micro1 API: invalid JSON — ${rawText.slice(0, 300)}`);
    }

    // API returns { data: { jobs: [...], total: N } } or similar — probe defensively
    const list = Array.isArray(json)            ? json
               : Array.isArray(json.data)       ? json.data
               : Array.isArray(json.jobs)       ? json.jobs
               : Array.isArray(json.data?.jobs) ? json.data.jobs
               : Array.isArray(json.data?.data) ? json.data.data
               : Array.isArray(json.results)    ? json.results
               : Array.isArray(json.items)      ? json.items
               : Array.isArray(json.list)       ? json.list
               : [];

    // If we got a 200 but couldn't find a list, surface the structure as an error
    if (!list.length) {
      const topKeys = typeof json === 'object' && json !== null ? Object.keys(json).join(', ') : typeof json;
      const nestedKeys = (json?.data && typeof json.data === 'object')
        ? 'data={' + Object.keys(json.data).join(', ') + '}'
        : '';
      throw new Error(`micro1 API: empty/unrecognised response. Keys: ${topKeys}${nestedKeys ? ' ' + nestedKeys : ''}. Preview: ${rawText.slice(0, 200)}`);
    }

    totalSeen += list.length;

    // Capture a sample is_micro1_account value for diagnostics (first job on first page)
    if (sampleIsMicro1 === null && list.length > 0) {
      sampleIsMicro1 = list[0].is_micro1_account;
    }

    for (const job of list) {
      // Core team (micro1-internal) jobs are tagged with "Core team" in job_tags.
      // Client/contractor postings either have no tags or different tags.
      const tags = Array.isArray(job.job_tags) ? job.job_tags : [];
      const isCoreTeam = tags.some(t => /^core\s*team$/i.test(t));
      if (!isCoreTeam) continue;

      // micro1 API field names: job_id, job_name, apply_url, engagement_type, location_type
      const id     = job.job_id || job.id || job.uuid || job._id || '';
      const jobUrl = job.apply_url || job.url || job.applyUrl
                   || (id ? `https://jobs.micro1.ai/post/${id}` : '');
      if (!jobUrl) continue;

      const title = job.job_name || job.title || job.name || job.job_title || '';
      if (!title) continue;

      const locType  = (job.location_type || job.work_type || job.work_mode || '').toLowerCase();
      const isRemote = locType.includes('remote') || job.remote === true || job.is_remote === true;

      // For Core team jobs, engagement_type is the actual employment type.
      // Only label as Contract if the field itself contains the word "contract".
      const engType = (job.engagement_type || '').toLowerCase();
      let jobType;
      if (engType.includes('contract')) {
        // e.g. "contract full-time" or "contract" → "Contract (Full-time)" or "Contract"
        const hours = engType.replace(/contract/i, '').trim();
        jobType = hours ? `Contract (${hours.charAt(0).toUpperCase() + hours.slice(1)})` : 'Contract';
      } else if (engType) {
        // e.g. "full-time" → "Full-time"
        jobType = engType.charAt(0).toUpperCase() + engType.slice(1);
      } else {
        jobType = 'Full-time';
      }

      // ideal_yearly_compensation is now an object {min, max} in whole dollars.
      // e.g. {min: 140000, max: 280000} → "$140K – $280K"
      const comp = job.ideal_yearly_compensation;
      let rawComp = job.salary || job.compensation || '';
      if (!rawComp && comp && typeof comp === 'object') {
        const lo = comp.min != null ? Math.round(Number(comp.min) / 1000) : null;
        const hi = comp.max != null ? Math.round(Number(comp.max) / 1000) : null;
        if (lo && hi) rawComp = `$${lo}K – $${hi}K`;
        else if (hi)  rawComp = `$${hi}K`;
        else if (lo)  rawComp = `$${lo}K`;
      } else if (!rawComp && typeof comp === 'string') {
        rawComp = comp.replace(/\/yr\b/i, '').trim();
      }

      allJobs.push({
        company:      companyName,
        title,
        department:   job.department || job.category || job.team || inferDepartmentFromTitle(title),
        location:     job.location   || job.city     || '',
        type:         jobType,
        workMode:     isRemote ? 'Remote' : 'On-site',
        compensation: formatSalary(rawComp),
        equity:       false,
        url:          jobUrl,
        logoUrl:      '',   // handler fills in Schema.org/SVG/apple-touch-icon logo
      });
    }

    // Stop if we've received fewer items than the page limit (last page)
    const total = json.total || json.data?.total || json.meta?.total || Infinity;
    if (list.length < LIMIT || allJobs.length >= total) break;
    page++;
  }

  // Diagnostic: if we fetched jobs but none passed the Core team filter,
  // surface key field values from the first job so we can identify the right filter.
  if (allJobs.length === 0 && totalSeen > 0) {
    throw new Error(
      `micro1: ${totalSeen} jobs fetched but none passed Core team filter (job_tags includes "Core team"). ` +
      `Sample is_micro1_account = ${JSON.stringify(sampleIsMicro1)}. ` +
      `Check job_tags field on the API response.`
    );
  }

  return allJobs;
}

// ── Notion ────────────────────────────────────────────────────
// Notion job boards are client-side rendered — the 15KB HTML shell contains
// no job data. Instead we use Notion's internal API (the same endpoints the
// browser calls), which works for public pages without any auth token.
//
// Flow:
//   1. POST loadCachedPageChunkV2  → get block tree → find all
//      collection_view blocks (one per department section on the board).
//   2. POST queryCollection (reducer format) for each collection →
//      returns job page blocks with all custom properties.
//   3. Parse title, Status, Location, Employment from block properties.
//   4. Filter to Status === "Open" (skip Closed roles automatically).
//   5. Build job URL: https://{domain}/{title-slug}-{blockId-no-hyphens}
//
// Block data is double-nested in the recordMap:
//   rm.block[id].value.value  →  the actual block object
//   rm.collection[id].value.value  →  the actual collection object
async function fetchNotionJobs(boardUrl, companyName) {
  const urlObj = new URL(boardUrl);
  const domain = urlObj.hostname; // e.g. "knowify.notion.site"

  // Extract raw 32-hex page ID from the URL path
  const rawId = boardUrl.match(/([0-9a-f]{32})(?:[?#]|$)/i)?.[1];
  if (!rawId) throw new Error(`Notion: cannot extract page ID from URL: ${boardUrl}`);

  // Notion's internal API requires the hyphenated UUID format
  const pageId = [rawId.slice(0,8), rawId.slice(8,12), rawId.slice(12,16), rawId.slice(16,20), rawId.slice(20)].join('-');

  const apiBase = `https://${domain}/api/v3`;
  const hdrs = {
    'Content-Type': 'application/json',
    'User-Agent':   'Mozilla/5.0 (compatible; portfolio-jobs-bot/1.0)',
  };

  // Helper: unwrap the double-nested Notion recordMap entry
  // New Notion API wraps values as { value: { value: block, role } }
  const unwrap = entry => entry?.value?.value ?? entry?.value ?? null;

  // Step 1: load page block tree to discover all collection_view blocks
  const chunkRes = await fetch(`${apiBase}/loadCachedPageChunkV2`, {
    method: 'POST',
    headers: hdrs,
    body: JSON.stringify({
      pageId,
      limit: 100,
      cursor: { stack: [] },
      chunkNumber: 0,
      verticalColumns: false,
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!chunkRes.ok) throw new Error(`Notion loadCachedPageChunkV2 HTTP ${chunkRes.status} for ${companyName}`);
  const chunkData = await chunkRes.json();
  const rm = chunkData.recordMap || {};

  // Find every collection_view block (each represents one department section)
  const cvBlocks = Object.entries(rm.block || {})
    .map(([id, entry]) => ({ id, block: unwrap(entry) }))
    .filter(({ block }) => block?.type === 'collection_view' && block.collection_id);

  if (cvBlocks.length === 0) {
    const totalBlocks = Object.keys(rm.block || {}).length;
    throw new Error(`Notion: 0 collection_view blocks found (${totalBlocks} total blocks) for ${companyName}`);
  }

  // Build collectionId → department name map from the page chunk
  const deptNames = {};
  for (const [collId, entry] of Object.entries(rm.collection || {})) {
    const coll = unwrap(entry);
    if (coll?.name) deptNames[collId] = coll.name[0]?.[0] || '';
  }

  // Step 2: query each collection for its job listings (in parallel)
  const collectionResults = await Promise.allSettled(cvBlocks.map(async ({ block }) => {
    const collectionId = block.collection_id;
    const viewId = block.view_ids?.[0];
    if (!viewId) return [];

    const qcRes = await fetch(`${apiBase}/queryCollection`, {
      method: 'POST',
      headers: hdrs,
      body: JSON.stringify({
        collection:     { id: collectionId },
        collectionView: { id: viewId },
        query: { sort: [], filter: { operator: 'and', filters: [] }, aggregations: [] },
        loader: {
          type: 'reducer',
          reducers: {
            collection_group_results: {
              type:        'results',
              limit:       100,
              searchQuery: '',
              userTimeZone: 'America/New_York',
            },
          },
          sort:        [],
          searchQuery: '',
          userTimeZone: 'America/New_York',
        },
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!qcRes.ok) throw new Error(`Notion queryCollection HTTP ${qcRes.status} for collection ${collectionId} (${companyName})`);

    const qcData  = await qcRes.json();
    const qcRm    = qcData.recordMap || {};
    const dept    = deptNames[collectionId] || '';

    // Get property schema for this collection (maps propId → { name, type })
    const collVal = unwrap(qcRm.collection?.[collectionId]);
    const schema  = collVal?.schema || {};

    // Identify property IDs for the fields we care about
    let statusKey = null, locationKey = null, employmentKey = null;
    for (const [k, v] of Object.entries(schema)) {
      const n = (v.name || '').toLowerCase();
      if (n === 'status')     statusKey     = k;
      if (n === 'location')   locationKey   = k;
      if (n === 'employment') employmentKey = k;
    }

    // Ordered list of job page block IDs returned by the reducer
    const blockIds = qcData.result?.reducerResults?.collection_group_results?.blockIds || [];
    const sectionJobs = [];

    for (const blockId of blockIds) {
      const bVal = unwrap(qcRm.block?.[blockId]);
      if (!bVal || bVal.type !== 'page') continue;

      const props  = bVal.properties || {};
      const title  = props.title?.[0]?.[0] || '';
      if (!title) continue;

      const status     = statusKey     ? (props[statusKey]?.[0]?.[0]     || '') : '';
      const location   = locationKey   ? (props[locationKey]?.[0]?.[0]   || '') : '';
      const employment = employmentKey ? (props[employmentKey]?.[0]?.[0] || '') : '';

      // Only surface open roles
      if (status && status.toLowerCase() !== 'open') continue;

      // Build the job's permalink: {domain}/{title-slug}-{idNoHyphens}
      const idNoHyphens = blockId.replace(/-/g, '');
      const slug        = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const jobUrl      = `https://${domain}/${slug}-${idNoHyphens}`;

      sectionJobs.push({
        title,
        department: dept,
        location,
        jobType: employment || 'Full-time',
        url:     jobUrl,
        companyName,
      });
    }
    return sectionJobs;
  }));

  // If every collection query failed, surface the first error so it appears in
  // the API's errors[] array rather than silently returning an empty list.
  const fulfilled  = collectionResults.filter(r => r.status === 'fulfilled');
  const rejected   = collectionResults.filter(r => r.status === 'rejected');
  if (fulfilled.length === 0 && rejected.length > 0) {
    throw rejected[0].reason;
  }

  return fulfilled.flatMap(r => r.value);
}

// ── Helpers ───────────────────────────────────────────────────

// Scan a job-description HTML page for a "Compensation" section heading
// and extract any salary range found in the following paragraph(s).
// Returns a formatted string like "$100K – $200K", or '' if nothing found.
//
// Handles headings wrapped in inline tags, e.g.:
//   <h2><strong>Compensation</strong></h2>
//   <p>The base pay for this role is: 100k-200k per year.</p>
function extractCompensationFromHtml(html) {
  const headingRe = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi;
  let hm;
  while ((hm = headingRe.exec(html)) !== null) {
    const plain = hm[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!/^compensation$/i.test(plain)) continue;

    // Grab text up to the next heading (cap at 1 500 chars to avoid runaway)
    const after   = html.slice(hm.index + hm[0].length);
    const nextH   = after.search(/<h[1-6][\s>]/i);
    const section = (nextH >= 0 ? after.slice(0, nextH) : after.slice(0, 1500))
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // $X,000 – $Y,000  or  $XK – $YK  (dash or prose "and" as separator)
    // e.g. "$80,000 - $120,000", "$90K – $130K", "between $80,000 and $120,000"
    const dollarRange = section.match(/\$\s*[\d,]+[KkMm]?\s*(?:[-–—]|\s+and\s+)\s*\$\s*[\d,]+[KkMm]?/i);
    if (dollarRange) return formatSalary(dollarRange[0].replace(/\s+and\s+/i, ' – '));

    // XK – YK  (no dollar sign: "100k-200k", "100K - 200K")
    const kRange = section.match(/\d+\s*[KkMm]\s*[-–—]\s*\d+\s*[KkMm]/);
    if (kRange) return formatSalary(kRange[0]);

    // Hourly: "$45/hr", "$45 per hour"
    const hourly = section.match(/\$\s*(\d+(?:\.\d+)?)\s*(?:\/\s*hr|per\s+h(?:ou)?r|an\s+h(?:ou)?r)/i);
    if (hourly) return `$${hourly[1]}/hr`;

    break; // found the heading but no parseable salary
  }
  return '';
}

function formatSalary(raw) {
  if (!raw) return '';

  // Already in compact K/M notation (e.g. "$80K – $100K" or "$180K - $220K"):
  // normalise the separator to an en-dash so all platforms render consistently.
  if (/^\$\d+[KkMm]\s*[–-]\s*\$\d+[KkMm]$/.test(raw.trim()))
    return raw.trim().replace(/\s*[-–]\s*/, ' – ');

  // Ashby: "$80,000 – $120,000 USD" or "$80,000 – $120,000 USD a year"
  // Extract dollar amounts with commas, convert to K notation
  const dollarNums = raw.match(/\$\s*([\d,]+)/g);
  if (dollarNums && dollarNums.length >= 2) {
    const toK = s => {
      const n = parseInt(s.replace(/[$,\s]/g, ''), 10);
      return n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${n}`;
    };
    return `${toK(dollarNums[0])} – ${toK(dollarNums[1])}`;
  }
  if (dollarNums && dollarNums.length === 1) {
    const n = parseInt(dollarNums[0].replace(/[$,\s]/g, ''), 10);
    return n >= 1000 ? `$${Math.round(n / 1000)}K` : dollarNums[0];
  }

  // Polymer / Breezy: "80K - 100K USD a year" or "20 USD an hour"
  const kNums = raw.match(/\d+\s*K/gi);
  if (kNums && kNums.length >= 2) return `$${kNums[0].toUpperCase().replace(/\s/,'')} – $${kNums[1].toUpperCase().replace(/\s/,'')}`;
  if (kNums && kNums.length === 1) return `$${kNums[0].toUpperCase().replace(/\s/,'')}`;

  // Hourly: "20 USD an hour" → "20 USD/hr"
  if (/\bUSD\b.*\bh(ou)?r/i.test(raw) || /\bper\s+h(ou)?r/i.test(raw)) {
    const n = raw.match(/\d+/)?.[0];
    return n ? `$${n}/hr` : raw.trim();
  }

  // Fallback: return as-is, stripping trailing "USD", "a year", "per year" noise
  return raw.replace(/\s+(USD|a year|per year|annually)\s*$/i, '').trim();
}

// ── Main handler ─────────────────────────────────────────────
// Uses Web API Request/Response (required by Edge Runtime).
export default async function handler(req) {
  const HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control':               's-maxage=86400, stale-while-revalidate=86400',
    'Content-Type':                'application/json',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: HEADERS });

  try {
    // Fetch company list and site config in parallel (both are fast CSV fetches).
    const [companies, config] = await Promise.all([fetchCompanies(), fetchConfig()]);

    // Fetch all companies IN PARALLEL — dramatically faster than the old
    // sequential for-await loop (total time ≈ slowest single fetch, not sum).
    async function fetchOneCompany(company) {
      const url = company.url;

      if (/jobs\.ashbyhq\.com\/([^/?#\s]+)/.test(url)) {
        const handle = url.match(/jobs\.ashbyhq\.com\/([^/?#\s]+)/)[1];
        return fetchAshbyJobs(handle, company.name);

      } else if (/jobs\.lever\.co\/([^/?#\s]+)/.test(url)) {
        const handle = url.match(/jobs\.lever\.co\/([^/?#\s]+)/)[1];
        return fetchLeverJobs(handle, company.name);

      } else if (/jobs\.polymer\.co\//.test(url)) {
        return fetchPolymerJobs(url, company.name);

      } else if (/app\.dover\.com\/jobs\/([^/?#\s]+)/.test(url)) {
        const handle = url.match(/app\.dover\.com\/jobs\/([^/?#\s]+)/)[1];
        return fetchDoverJobs(handle, company.name);

      } else if (/teamtailor\.com/.test(url)) {
        return fetchTeamtailorJobs(url, company.name);

      } else if (/[a-z0-9-]+\.breezy\.hr/.test(url)) {
        const handle = url.match(/([a-z0-9-]+)\.breezy\.hr/)[1];
        return fetchBreezyJobs(handle, company.name);

      } else if (/ats\.rippling\.com/.test(url)) {
        // Extract board slug — strip any leading locale segment (e.g. "en-GB")
        // URL shapes:
        //   ats.rippling.com/en-GB/{board-slug}/jobs  → slug is segment after locale
        //   ats.rippling.com/{board-slug}/jobs        → slug is first segment
        const parts = url.replace(/^https?:\/\/ats\.rippling\.com\//, '').split('/');
        const slug = /^[a-z]{2}(-[A-Z]{2})?$/.test(parts[0]) ? parts[1] : parts[0];
        return slug ? fetchRipplingJobs(slug, company.name) : Promise.resolve([]);

      } else if (/micro1\.ai/.test(url)) {
        return fetchMicro1Jobs(company.name);

      } else if (/notion\.site\/|notion\.so\//.test(url)) {
        return fetchNotionJobs(url, company.name);

      } else {
        // Generic custom page scraper (/open-roles/, /about/careers/, /careers/)
        return fetchCustomJobs(url, company.name);
      }
    }

    // Run job fetches and homepage logo fetches in parallel — no extra wall-clock cost.
    // wall-clock cost — both races finish roughly at the same time.
    const [results, ogImages] = await Promise.all([
      Promise.allSettled(companies.map(fetchOneCompany)),
      Promise.all(companies.map(company => {
        // Skip homepage fetch when a manual override or ATS logo is already available
        // (those are already correct; fetching the homepage would be wasted work).
        if (company.logoOverride) return Promise.resolve('');
        const domain = getLogoDomain(company);
        if (!domain) return Promise.resolve('');
        const homeUrl = (company.homepageUrl || '').trim() || `https://${domain}`;
        return fetchLogoFromHomepage(homeUrl);
      })),
    ]);

    const allJobs = [];
    const errors  = [];
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        const company      = companies[i];
        const ogImage      = ogImages[i] || '';
        // Logo cascade (see deriveAppleTouchIcon / fetchLogoFromHomepage comments):
        //   1. Sheet logoOverride   — manually curated, highest trust.
        //   2. ATS-provided logoUrl — already set on individual job objects.
        //   3. Schema.org logo / SVG favicon from homepage (fetchLogoFromHomepage).
        //   4. apple-touch-icon    — fallback when structured sources are absent.
        // Google Favicons is always the client-side data-fallback (never fails).
        const primaryLogo  = company.logoOverride || ogImage || deriveAppleTouchIcon(company);
        const fallbackLogo = deriveLogoFallback(company);
        result.value.forEach(job => {
          if (!job.logoUrl)      job.logoUrl      = primaryLogo;
          if (!job.logoFallback) job.logoFallback = fallbackLogo;
        });
        allJobs.push(...result.value);
      } else {
        const { name, url } = companies[i];
        console.error(`Error fetching ${name} (${url}):`, result.reason?.message);
        errors.push({ company: name, url, error: result.reason?.message || String(result.reason) });
      }
    });

    return new Response(
      JSON.stringify({
        jobs:      allJobs,
        companies: companies.map(c => c.name),
        config,      // site config from Google Sheet config tab (gid=1)
        errors,
        fetchedAt: new Date().toISOString(),
      }),
      { headers: HEADERS }
    );
  } catch (err) {
    console.error('Handler error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: HEADERS }
    );
  }
}

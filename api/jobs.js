// ============================================================
//  api/jobs.js — Vercel Serverless Function
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
//   - Custom     (any other URL — scrapes /open-roles/ or /about/careers/
//                 links; auto-detects embedded Rippling or Breezy widgets)
//
//  Cached 24 hrs via Vercel CDN (s-maxage header).
// ============================================================

const SHEET_CSV_URL =
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

// Common fetch headers for HTML scraping — browser-like to avoid 403s
const SCRAPE_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control':   'no-cache',
};

// ── Fetch company list from Google Sheet ─────────────────────
async function fetchCompanies() {
  const res = await fetch(SHEET_CSV_URL, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Sheet fetch failed: ${res.status}`);
  const csv = await res.text();

  return csv
    .trim()
    .split('\n')
    .slice(1)
    .map(line => {
      const cols = line.match(/(\".*?\"|[^,]+)/g) || [];
      const name = (cols[0] || '').replace(/^\"|\"$/g, '').trim();
      const url  = (cols[1] || '').replace(/^\"|\"$/g, '').trim();
      return name && url ? { name, url } : null;
    })
    .filter(Boolean);
}

// ── Ashby ─────────────────────────────────────────────────────
async function fetchAshbyJobs(handle, companyName) {
  const res = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${handle}`);
  if (!res.ok) throw new Error(`Ashby fetch failed for "${handle}": ${res.status}`);
  const data = await res.json();

  return (data.jobs || []).map(job => ({
    company:      companyName,
    title:        (job.title || '').trim(),
    department:   job.department || '',
    location:     job.location   || '',
    type:         ASHBY_TYPE_MAP[job.employmentType] || 'Full time',
    workMode:     job.isRemote ? 'Remote' : (MODE_MAP[job.workplaceType] || 'On-site'),
    compensation: '',
    equity:       false,
    url:          job.jobUrl || `https://jobs.ashbyhq.com/${handle}`,
  }));
}

// ── Lever ─────────────────────────────────────────────────────
async function fetchLeverJobs(handle, companyName) {
  const res = await fetch(`https://api.lever.co/v0/postings/${handle}?mode=json`);
  if (!res.ok) throw new Error(`Lever fetch failed for "${handle}": ${res.status}`);
  const data = await res.json();

  return (Array.isArray(data) ? data : []).map(job => ({
    company:      companyName,
    title:        (job.text || '').trim(),
    department:   job.categories?.team       || '',
    location:     job.categories?.location   || '',
    type:         job.categories?.commitment || 'Full-time',
    workMode:     MODE_MAP[job.workplaceType] || 'On-site',
    compensation: '',
    equity:       false,
    url:          job.hostedUrl || `https://jobs.lever.co/${handle}`,
  }));
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

  // Helper: try the Polymer public REST API for a given slug (paginated)
  // Returns: array of mapped jobs (may be empty), or null if HTTP error
  async function tryPolymerApi(slug) {
    const PER_PAGE = 50;
    const apiJobs  = [];
    let   apiPage  = 1;
    let   rawSample = null;   // keep first page raw data for diagnostics
    while (true) {
      const apiUrl = `https://api.polymer.co/v1/hire/organizations/${slug}/jobs`
                   + `?page=${apiPage}&per_page=${PER_PAGE}`;
      const apiRes = await fetch(apiUrl, {
        headers: { 'Accept': 'application/json', 'User-Agent': SCRAPE_HEADERS['User-Agent'] },
      });
      if (!apiRes.ok) return null;   // signal failure to caller

      const apiData = await apiRes.json();
      if (apiPage === 1) rawSample = apiData;   // save for diagnostics
      const page = Array.isArray(apiData)       ? apiData
                 : Array.isArray(apiData.jobs)  ? apiData.jobs
                 : Array.isArray(apiData.data)  ? apiData.data
                 : [];

      // Exclude clearly inactive/closed jobs; include everything else
      // (using a denylist so unknown status values don't silently drop jobs)
      const INACTIVE = new Set(['draft', 'archived', 'closed', 'expired', 'deleted', 'inactive', 'removed', 'filled']);
      const active = page.filter(j => {
        const s = (j.status || '').toLowerCase();
        return !INACTIVE.has(s);
      });

      // mapJob needs the slug for fallback URLs — capture it in closure
      apiJobs.push(...active.map(job => ({
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
      })));

      if (page.length < PER_PAGE) break;
      apiPage++;
    }
    return apiJobs;   // may be empty array if org exists but has no active jobs
  }

  // ── Strategy 1a: API with the slug from the Google Sheet ────
  let apiRawSample = null;
  try {
    const result = await tryPolymerApi(inputSlug);
    if (result && result.length > 0) return result;
    apiRawSample = rawSample;   // capture for diagnostics if we fall through
  } catch (_) { /* fall through */ }

  // ── Strategies 2 & 3 require the HTML page ──────────────────
  // fetch() follows redirects automatically; .url gives the final URL.
  // This is critical for renamed companies (e.g. sheet has /daylit but
  // Polymer redirects to /lendica — slug mismatch breaks link scraping).
  const htmlRes = await fetch(baseUrl, {
    headers: {
      'User-Agent':      SCRAPE_HEADERS['User-Agent'],
      'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
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
      if (result && result.length > 0) return result;
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
    const href    = match[1];
    const rawText = match[2]
      .replace(/<[^>]+>/g, '\n')
      .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
      .replace(/View job/gi, '').replace(/\s+/g, ' ')
      .trim();

    const parts = rawText.split(/\s{2,}|\n/).map(s => s.trim()).filter(Boolean);
    if (parts.length < 1 || parts[0].length < 3) continue;

    const salaryIdx = parts.findIndex(p => /\d+K|\$|USD/i.test(p));
    const salary    = salaryIdx >= 0 ? formatSalary(parts[salaryIdx]) : '';
    const jobUrl    = href.startsWith('http') ? href : `https://jobs.polymer.co${href}`;

    jobs.push({
      company:      companyName,
      title:        parts[0],
      department:   '',
      location:     parts[2] || '',
      type:         parts[1] || 'Full-time',
      workMode:     'On-site',
      compensation: salary,
      equity:       false,
      url:          jobUrl,
    });
  }

  if (jobs.length === 0 && html.length > 0) {
    const hasNextData = html.includes('__NEXT_DATA__');
    // Include raw API sample in the error to help diagnose format mismatches
    const apiSample = (() => {
      try {
        const r = jobs._rawSample || null;
        if (!r) return '(API returned null/error)';
        const s = JSON.stringify(r);
        return s.length > 300 ? s.slice(0, 300) + '…' : s;
      } catch (_) { return '(serialize error)'; }
    })();
    throw new Error(
      `Polymer: no jobs found for "${companyName}". ` +
      `Input slug: ${inputSlug}, resolved slug: ${resolvedSlug}. ` +
      `__NEXT_DATA__ present: ${hasNextData}. ` +
      `API sample: ${apiSample}. ` +
      `HTML preview: ${html.slice(0, 200)}`
    );
  }

  return jobs;
}

// ── Dover ─────────────────────────────────────────────────────
// Dover exposes a clean REST API for careers pages.
// Step 1: GET /api/v1/careers-page-slug/{handle}  → { "id": "<UUID>", ... }
// Step 2: GET /api/v1/job-groups/{uuid}/job-groups → [{ jobs: [...] }]
async function fetchDoverJobs(handle, companyName) {
  const pageUrl = `https://app.dover.com/jobs/${handle}`;

  // Step 1 — resolve handle → UUID
  const slugRes = await fetch(
    `https://app.dover.com/api/v1/careers-page-slug/${handle}`,
    { headers: { 'Accept': 'application/json', ...SCRAPE_HEADERS } }
  );
  if (!slugRes.ok) throw new Error(`Dover slug API failed for "${companyName}": ${slugRes.status}`);
  const slugData = await slugRes.json();
  const uuid = slugData.id;
  if (!uuid) throw new Error(`Dover: no UUID returned for "${companyName}"`);

  const apiRes = await fetch(
    `https://app.dover.com/api/v1/job-groups/${uuid}/job-groups`,
    { headers: { 'Accept': 'application/json' } }
  );
  if (!apiRes.ok) throw new Error(`Dover API failed for "${companyName}": ${apiRes.status}`);
  const data = await apiRes.json();

  const jobs = [];
  // Response is an array of job-groups; each has a .jobs array
  for (const group of (Array.isArray(data) ? data : [])) {
    for (const job of (group.jobs || [])) {
      if (!job.is_published || job.is_sample) continue;

      const loc = (job.locations || [])
        .map(l => l.location_option?.display_name || '')
        .filter(Boolean)
        .join(', ');

      jobs.push({
        company:      companyName,
        title:        (job.title || '').trim(),
        department:   '',
        location:     loc,
        type:         'Full-time',
        workMode:     'On-site',
        compensation: '',
        equity:       false,
        url:          `${pageUrl}/${job.id}`,
      });
    }
  }
  return jobs;
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
    return {
      company:      companyName,
      title:        (job.name || '').trim(),
      department:   job.department?.name || '',
      location:     loc,
      type:         'Full-time',
      workMode:     RIPPLING_MODE[wt] || 'On-site',
      compensation: '',
      equity:       false,
      url:          job.url || `https://ats.rippling.com/${boardSlug}/jobs/${job.id}`,
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
      });
    }
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
// micro1 is a contractor staffing platform. The API returns all jobs
// (client postings + micro1's own "Core team" internal hiring).
// We filter for micro1's own roles using is_micro1_account === true,
// with a tag-name fallback in case the flag behaves differently.
// API endpoint: https://prod-api.micro1.ai/api/v1/job/portal (POST)
// Individual posting pages: https://jobs.micro1.ai/post/{UUID}
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
      // Core team (micro1-internal) jobs have ideal_yearly_compensation set to a truthy
      // but non-numeric value. Client contractor jobs always have a real number there
      // (micro1 calculates pay rates for those). This is the reliable distinguishing signal.
      const comp       = job.ideal_yearly_compensation;
      const isCoreTeam = comp !== null && comp !== undefined && comp !== '' && isNaN(Number(comp));
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

      allJobs.push({
        company:      companyName,
        title,
        department:   job.department || job.category || job.team || '',
        location:     job.location   || job.city     || '',
        type:         jobType,
        workMode:     isRemote ? 'Remote' : 'On-site',
        // comp is non-numeric for core team jobs, so skip the $NaNK formatting
        compensation: job.salary || job.compensation || '',
        equity:       false,
        url:          jobUrl,
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
      `micro1: ${totalSeen} jobs fetched but none passed Core team filter. ` +
      `Sample is_micro1_account = ${JSON.stringify(sampleIsMicro1)}. ` +
      `Check company_name / tags / is_core_team fields on the API response.`
    );
  }

  return allJobs;
}

// ── Helpers ───────────────────────────────────────────────────
function formatSalary(raw) {
  // "80K - 100K USD a year" → "$80K – $100K"
  const nums = raw.match(/\d+K/gi);
  if (nums && nums.length >= 2) return `$${nums[0].toUpperCase()} – $${nums[1].toUpperCase()}`;
  if (nums && nums.length === 1) return `$${nums[0].toUpperCase()}`;
  return raw;
}

// ── Main handler ─────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=86400');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const companies = await fetchCompanies();
    const allJobs   = [];
    const errors    = [];

    for (const company of companies) {
      const url = company.url;   // declared outside try so catch block can reference it
      try {

        if (/jobs\.ashbyhq\.com\/([^/?#\s]+)/.test(url)) {
          const handle = url.match(/jobs\.ashbyhq\.com\/([^/?#\s]+)/)[1];
          allJobs.push(...await fetchAshbyJobs(handle, company.name));

        } else if (/jobs\.lever\.co\/([^/?#\s]+)/.test(url)) {
          const handle = url.match(/jobs\.lever\.co\/([^/?#\s]+)/)[1];
          allJobs.push(...await fetchLeverJobs(handle, company.name));

        } else if (/jobs\.polymer\.co\//.test(url)) {
          allJobs.push(...await fetchPolymerJobs(url, company.name));

        } else if (/app\.dover\.com\/jobs\/([^/?#\s]+)/.test(url)) {
          const handle = url.match(/app\.dover\.com\/jobs\/([^/?#\s]+)/)[1];
          allJobs.push(...await fetchDoverJobs(handle, company.name));

        } else if (/teamtailor\.com/.test(url)) {
          allJobs.push(...await fetchTeamtailorJobs(url, company.name));

        } else if (/[a-z0-9-]+\.breezy\.hr/.test(url)) {
          const handle = url.match(/([a-z0-9-]+)\.breezy\.hr/)[1];
          allJobs.push(...await fetchBreezyJobs(handle, company.name));

        } else if (/ats\.rippling\.com/.test(url)) {
          // Extract board slug — strip any leading locale segment (e.g. "en-GB")
          // URL shapes:
          //   ats.rippling.com/en-GB/{board-slug}/jobs  → slug is segment after locale
          //   ats.rippling.com/{board-slug}/jobs        → slug is first segment
          const parts = url.replace(/^https?:\/\/ats\.rippling\.com\//, '').split('/');
          // If the first segment looks like a locale (xx-XX or xx), skip it
          const slug = /^[a-z]{2}(-[A-Z]{2})?$/.test(parts[0]) ? parts[1] : parts[0];
          if (slug) {
            allJobs.push(...await fetchRipplingJobs(slug, company.name));
          }

        } else if (/micro1\.ai/.test(url)) {
          allJobs.push(...await fetchMicro1Jobs(company.name));

        } else {
          // Generic custom page scraper (/open-roles/, /about/careers/, /careers/)
          allJobs.push(...await fetchCustomJobs(url, company.name));
        }
      } catch (err) {
        console.error(`Error fetching ${company.name} (${url}):`, err.message);
        errors.push({ company: company.name, url, error: err.message });
      }
    }

    res.json({
      jobs:      allJobs,
      companies: companies.map(c => c.name),
      errors,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Handler error:', err);
    res.status(500).json({ error: err.message });
  }
}

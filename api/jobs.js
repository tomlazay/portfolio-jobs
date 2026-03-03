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
//   - Custom     (any other URL — scrapes /open-roles/ or /about/careers/
//                 links; auto-detects embedded Rippling or Breezy widgets)
//
//  Cached 15 min via Vercel CDN (s-maxage header).
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
async function fetchPolymerJobs(pageUrl, companyName) {
  const baseUrl = pageUrl.split('#')[0].split('?')[0];

  const res = await fetch(baseUrl, { headers: SCRAPE_HEADERS });
  if (!res.ok) throw new Error(`Polymer fetch failed for "${companyName}": ${res.status}`);
  const html = await res.text();

  const jobs = [];
  // Polymer job links: href="/company/numeric-id" OR href="https://jobs.polymer.co/company/numeric-id"
  const companySlug = baseUrl.replace(/.*polymer\.co\//, '').replace(/\/$/, '');
  const linkRegex = new RegExp(
    `href="((?:https://jobs\\.polymer\\.co)?/${companySlug}/\\d+)"[^>]*>([\\s\\S]*?)<\\/a>`, 'gi'
  );
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const href    = match[1];
    const rawText = match[2]
      .replace(/<[^>]+>/g, '\n')
      .replace(/&amp;/g, '&')
      .replace(/&nbsp;/g, ' ')
      .replace(/View job/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Text format: "Title  Type  Location  Salary  Equity"
    const parts = rawText.split(/\s{2,}|\n/).map(s => s.trim()).filter(Boolean);
    if (parts.length < 1 || parts[0].length < 3) continue;

    // Detect which part is salary (contains K or USD or $)
    const salaryIdx = parts.findIndex(p => /\d+K|\$|USD/i.test(p));
    const salary    = salaryIdx >= 0 ? formatSalary(parts[salaryIdx]) : '';

    // href may be absolute (https://jobs.polymer.co/...) or relative (/slug/id)
    const jobUrl = href.startsWith('http') ? href : `https://jobs.polymer.co${href}`;

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
      .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#183;/g, '·')
      .replace(/\u00b7/g, '·')
      .replace(/[ \t]+/g, ' ')               // collapse spaces (keep newlines for now)
      .replace(/\n\s*/g, '\n')
      .trim();

    // Browser renders as: "Title\nDept · Location · WorkMode"
    // The \n separates title from the metadata line
    const newlineIdx = rawText.indexOf('\n');
    const title = (newlineIdx > 0 ? rawText.slice(0, newlineIdx) : rawText).trim();
    const meta  = (newlineIdx > 0 ? rawText.slice(newlineIdx + 1) : '').trim();

    if (!title || title.length < 2) continue;

    // Meta: "Sales · Atlanta, GA · Hybrid"
    const metaParts = meta.split(/\s*·\s*/).map(s => s.trim()).filter(Boolean);
    const dept     = metaParts[0] || '';
    const location = metaParts[1] || '';
    const wm       = metaParts[2] || '';
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
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const parts = rawText.split(/\s{2,}/).map(s => s.trim()).filter(Boolean);
    if (parts.length >= 1 && parts[0].length > 2) {
      // href may be absolute (https://...) or relative (/path/slug)
      const jobUrl = href.startsWith('http') ? href : `${domain}${href}`;
      jobs.push({
        company:      companyName,
        title:        parts[0],
        department:   '',
        location:     parts[1] || '',
        type:         parts[2] || 'Full-time',
        workMode:     parts[3] || 'Hybrid',
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
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const companies = await fetchCompanies();
    const allJobs   = [];
    const errors    = [];

    for (const company of companies) {
      try {
        const url = company.url;

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

        } else {
          // Generic custom page scraper (/open-roles/, /about/careers/, /careers/)
          allJobs.push(...await fetchCustomJobs(url, company.name));
        }
      } catch (err) {
        console.error(`Error fetching ${company.name}:`, err.message);
        errors.push({ company: company.name, error: err.message });
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

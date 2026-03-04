/* ============================================================
   app.js — Render, Filter & URL-param Logic
   Jobs are now fetched live from /api/jobs (Vercel function).
   ============================================================ */

// ── Company logo / badge config ───────────────────────────────
// Add an entry here for each new company to set its logo + badge colour.
// If a company has no entry, a text fallback is shown automatically.
const COMPANY_CONFIG = {
  POSH: {
    logoUrl:   'https://app.ashbyhq.com/api/images/org-theme-wordmark/06fc6f03-fc47-4801-9d96-04d7db0270de/42c725d4-e44d-40f6-9169-1f662c6e8dc3/81d4c492-920a-4150-888f-ddf264037875.png',
    logoClass: 'logo-posh',
  },
  North: {
    logoUrl:   '/logos/north-logo.svg',
    logoClass: 'logo-north',
  },
  Sent: {
    logoUrl:   'https://app.ashbyhq.com/api/images/org-theme-wordmark/776013c9-4de4-4cdd-b5a7-0ab17b9791d8/d3fbe472-82d1-4fc9-9c37-5322c55db2f8/76cbf1d4-20f2-4898-acd8-d37de9156af1.png',
    logoClass: 'logo-sent',
  },
  Cyvl: {
    logoUrl:   'https://app.ashbyhq.com/api/images/org-theme-wordmark/9467653c-17ee-4657-ab6a-7e00dffbd287/2b05a9c8-159b-4e81-acb0-b1b54e0fa478/5f1f21e6-6abf-4d28-aec5-718b2d77c480.png',
    logoClass: 'logo-cyvl',
  },
  Flex: {
    logoUrl:   'https://lever-client-logos.s3.us-west-2.amazonaws.com/5015e948-36ab-4fc9-9aa4-6a006728f2e2-1693924947628.png',
    logoClass: 'logo-flex',
  },
  Daylit: {
    logoUrl:   'https://inflow-public.s3.amazonaws.com/company-logos/rpir2q831nuncesanw4cbmy1geyv.png',
    logoClass: 'logo-daylit',
  },
  Allstacks: {
    logoUrl:   'https://storage.googleapis.com/dover-django/client-logos/d0146d97-c838-4200-8596-7ebd43c29d73-1724783651-logo',
    logoClass: 'logo-allstacks',
  },
  RoadSync: {
    logoUrl:   'https://roadsync.com/wp-content/themes/roadsyncwp/assets/img/logo-white.svg',
    logoClass: 'logo-roadsync',
  },
  Ziflow: {
    logoUrl:   'https://www.ziflow.com/hubfs/Ziflow%20logo%20-%20let%20your%20content%20flow.svg',
    logoClass: 'logo-ziflow',
  },
  Fullcast: {
    logoUrl:   'https://www.fullcast.com/wp-content/uploads/2025/01/Fullcast-logo-white.svg',
    logoClass: 'logo-fullcast',
  },
  Arpio: {
    logoUrl:   'https://arpio.io/wp-content/uploads/2022/09/arpio-logo.svg',
    logoClass: 'logo-arpio',
  },
  Apty: {
    logoUrl:   'https://apty.ai/wp-content/uploads/2025/03/logo.svg',
    logoClass: 'logo-apty',
  },
  ENDVR: {
    logoUrl:   'https://endvr.io/assets/endvr-logo-B8qymlBx.webp',
    logoClass: 'logo-endvr',
  },
};

// ── App state ─────────────────────────────────────────────────
let ALL_JOBS = [];

// ── Fetch jobs from serverless API ───────────────────────────
async function fetchJobs() {
  showLoading(true);
  try {
    const res = await fetch('/api/jobs');
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const data = await res.json();

    ALL_JOBS = normalizeJobs(data.jobs || []);

    // Update hero stats
    const companyCount = document.getElementById('company-count');
    const totalCount   = document.getElementById('total-count');
    if (companyCount) companyCount.textContent = new Set(ALL_JOBS.map(j => j.company)).size;
    if (totalCount)   totalCount.textContent   = ALL_JOBS.length;

    // Populate footer "Last Updated" timestamp
    const lastUpdatedEl = document.getElementById('last-updated');
    if (lastUpdatedEl && data.fetchedAt) {
      const d = new Date(data.fetchedAt);
      lastUpdatedEl.textContent = d.toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
      });
    }

    // Apply any URL params (shareable links) before first render
    applyUrlParams();

    // update() will call updateFilters() which populates all dropdowns,
    // then render the matching jobs.
    update();
  } catch (err) {
    showLoading(false);
    showError(err.message);
  }
}

// ── Loading / error states ────────────────────────────────────
function showLoading(on) {
  const el = document.getElementById('loading-state');
  if (el) el.style.display = on ? 'flex' : 'none';
}

function showError(msg) {
  showLoading(false);
  const list = document.getElementById('jobs-list');
  if (list) list.innerHTML =
    `<div class="load-error">⚠️ Could not load jobs — ${msg}. Please try refreshing.</div>`;
}

// ── Location & Department normalisation ──────────────────────

// Full US state name → 2-letter postal abbreviation.
// Used to shorten "Boston, Massachusetts" → "Boston, MA" etc.
const STATE_ABBR = {
  'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
  'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
  'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
  'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
  'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
  'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
  'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
  'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT',
  'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV',
  'wisconsin': 'WI', 'wyoming': 'WY', 'district of columbia': 'DC',
};

// Replaces any full state name in a location string with its abbreviation.
// e.g. "Boston, Massachusetts" → "Boston, MA"
//      "Chicago, Illinois"     → "Chicago, IL"
// Only matches state names that follow a comma (i.e. the state portion of
// "City, State"), so standalone city names like "Washington" or already-
// abbreviated strings like "New York, NY" are left untouched.
function abbreviateStates(str) {
  const pattern = Object.keys(STATE_ABBR)
    .sort((a, b) => b.length - a.length)
    .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  return str.replace(new RegExp(`,\\s*(${pattern})\\b`, 'gi'),
    (_, state) => `, ${STATE_ABBR[state.toLowerCase()]}`);
}

// Canonical map for known location variants (case-insensitive key lookup).
// Add entries here whenever new aliases appear in the filter dropdown.
const LOCATION_ALIASES = {
  'new york city':  'New York, NY',
  'new york ny':    'New York, NY',
  'new york, ny':   'New York, NY',
  'new york':       'New York, NY',
  'nyc':            'New York, NY',
};

function normalizeLocation(raw) {
  const key = (raw || '').toLowerCase().trim();
  // 1. Check explicit alias map first
  const aliased = LOCATION_ALIASES[key];
  if (aliased) return aliased;
  // 2. Abbreviate any full state names found in the string
  return abbreviateStates(raw);
}

// Run once after ALL_JOBS is populated to canonicalise location strings.
function normalizeJobs(jobs) {
  return jobs.map(j => ({ ...j, location: normalizeLocation(j.location) }));
}

// ── Location matching helper ──────────────────────────────────
// "Remote" is a special pseudo-location — matches jobs where workMode is Remote.
// All other values do a substring match on job.location.
function matchesLocation(job, loc) {
  if (!loc) return true;
  if (loc === 'Remote') return (job.workMode || '').toLowerCase() === 'remote';
  return job.location.toLowerCase().includes(loc.toLowerCase());
}

// ── Dependent/cascading filter logic ─────────────────────────
// Returns the subset of ALL_JOBS that pass every active filter
// EXCEPT the one identified by `excludeKey`.  Used to compute
// what options are valid for each dropdown given everything else.
function getFilteredExcluding(excludeKey) {
  const q       = (document.getElementById('search-input')   || {}).value?.toLowerCase().trim() || '';
  const company = excludeKey === 'company'  ? '' : (document.getElementById('filter-company')  || {}).value || '';
  const dept    = excludeKey === 'dept'     ? '' : (document.getElementById('filter-dept')     || {}).value || '';
  const loc     = excludeKey === 'location' ? '' : (document.getElementById('filter-location') || {}).value || '';
  const type    = excludeKey === 'type'     ? '' : (document.getElementById('filter-type')     || {}).value || '';

  return ALL_JOBS.filter(job => {
    const hay = `${job.title} ${job.company} ${job.department} ${job.location}`.toLowerCase();
    if (q       && !hay.includes(q))                              return false;
    if (company && job.company !== company)                       return false;
    if (dept    && job.department !== dept)                       return false;
    if (!matchesLocation(job, loc))                               return false;
    if (type    && job.type.replace('-',' ').toLowerCase() !==
                   type.replace('-',' ').toLowerCase())           return false;
    return true;
  });
}

// Re-populate every filter dropdown so its options only show values
// that exist in the jobs still reachable after applying all other filters.
// Called on every update so dropdowns always stay in sync with the data.
function updateFilters() {
  const unique = (jobs, key) =>
    [...new Set(jobs.map(j => j[key]).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  fillSelect('filter-company',  unique(getFilteredExcluding('company'),  'company'));
  fillSelect('filter-dept',     unique(getFilteredExcluding('dept'),     'department'));
  fillSelect('filter-type',     unique(getFilteredExcluding('type'),     'type'));

  // Location: real location values + synthetic "Remote" entry if any remote jobs exist
  const locJobs    = getFilteredExcluding('location');
  const locValues  = unique(locJobs, 'location');
  const hasRemote  = locJobs.some(j => (j.workMode || '').toLowerCase() === 'remote');
  if (hasRemote && !locValues.includes('Remote')) {
    // Insert 'Remote' in its correct alphabetical position (between Q... and S...)
    const idx = locValues.findIndex(v => v.localeCompare('Remote', undefined, { sensitivity: 'base' }) > 0);
    if (idx === -1) locValues.push('Remote'); else locValues.splice(idx, 0, 'Remote');
  }
  fillSelect('filter-location', locValues);
}

function fillSelect(id, values) {
  const sel = document.getElementById(id);
  if (!sel) return;
  const prev = sel.value;
  while (sel.options.length > 1) sel.remove(1);   // keep "All X" placeholder
  values.forEach(v => {
    const opt = document.createElement('option');
    opt.value       = v;
    opt.textContent = v;
    sel.appendChild(opt);
  });
  // Restore previously selected value if it still exists in the new option set
  if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
}

// ── URL params — shareable filter links ──────────────────────
// Reads ?q=&company=&dept=&loc=&type= and pre-fills the controls.
function applyUrlParams() {
  const p = new URLSearchParams(window.location.search);
  setValue('search-input',    p.get('q'));
  setValue('filter-company',  p.get('company'));
  setValue('filter-dept',     p.get('dept'));
  setValue('filter-location', p.get('loc'));
  setValue('filter-type',     p.get('type'));
}

function setValue(id, val) {
  if (!val) return;
  const el = document.getElementById(id);
  if (el) el.value = val;
}

// Writes current filter state back to the URL (no page reload).
function syncUrlParams() {
  const params = new URLSearchParams();
  const get = id => (document.getElementById(id) || {}).value || '';

  const q       = get('search-input').trim();
  const company = get('filter-company');
  const dept    = get('filter-dept');
  const loc     = get('filter-location');
  const type    = get('filter-type');

  if (q)       params.set('q',       q);
  if (company) params.set('company', company);
  if (dept)    params.set('dept',    dept);
  if (loc)     params.set('loc',     loc);
  if (type)    params.set('type',    type);

  const qs = params.toString();
  history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
}

// ── Render ────────────────────────────────────────────────────
function renderJobs(jobs) {
  showLoading(false);

  const list        = document.getElementById('jobs-list');
  const noResults   = document.getElementById('no-results');
  const visCount    = document.getElementById('visible-count');
  const searchCount = document.getElementById('search-count');

  list.innerHTML = '';

  if (!jobs.length) {
    noResults.style.display = 'block';
    if (visCount)    visCount.textContent    = '0';
    if (searchCount) searchCount.textContent = '0 jobs';
    return;
  }

  noResults.style.display = 'none';
  if (visCount)    visCount.textContent    = jobs.length;
  if (searchCount) searchCount.textContent = `${jobs.length} job${jobs.length !== 1 ? 's' : ''}`;

  jobs.forEach(job => {
    const card = document.createElement('a');
    card.className = 'job-card';
    card.href      = job.url;
    card.target    = '_blank';
    card.rel       = 'noopener noreferrer';

    const salaryHTML = job.compensation
      ? `<div class="job-comp">${job.compensation}</div>` : '';
    const equityHTML = job.equity
      ? `<div class="job-comp-equity">Offers equity</div>` : '';

    const cfg       = COMPANY_CONFIG[job.company] || {};
    const logoUrl   = cfg.logoUrl   || '';
    const logoClass = cfg.logoClass || 'logo-default';

    const logoInner = logoUrl
      ? `<img class="company-logo-img" src="${logoUrl}" alt="${job.company}" loading="lazy">`
      : `<span class="logo-text-fallback">${job.company.charAt(0)}</span>`;

    card.innerHTML = `
      <div class="company-logo-wrap ${logoClass}">
        ${logoInner}
      </div>
      <div class="job-info">
        <div class="job-title">${job.title}</div>
        <div class="job-company">${job.company}</div>
        <div class="job-meta">
          ${job.location   ? `<span class="job-tag tag-location">📍 ${job.location}</span>`  : ''}
          ${job.type       ? `<span class="job-tag tag-type">${job.type}</span>`              : ''}
          ${job.workMode   ? `<span class="job-tag tag-mode">${job.workMode}</span>`          : ''}
          ${job.department ? `<span class="job-tag tag-dept">${job.department}</span>`        : ''}
        </div>
      </div>
      <div class="job-right">
        <div>${salaryHTML}${equityHTML}</div>
        <a class="apply-btn" href="${job.url}" target="_blank" rel="noopener noreferrer"
           onclick="event.stopPropagation()">Apply →</a>
      </div>
    `;

    list.appendChild(card);
  });
}

// ── Filter ────────────────────────────────────────────────────
function getFiltered() {
  const q       = (document.getElementById('search-input')    || {}).value?.toLowerCase().trim() || '';
  const company = (document.getElementById('filter-company')  || {}).value || '';
  const dept    = (document.getElementById('filter-dept')     || {}).value || '';
  const loc     = (document.getElementById('filter-location') || {}).value || '';
  const type    = (document.getElementById('filter-type')     || {}).value || '';

  return ALL_JOBS.filter(job => {
    const hay = `${job.title} ${job.company} ${job.department} ${job.location}`.toLowerCase();
    if (q       && !hay.includes(q))                              return false;
    if (company && job.company !== company)                       return false;
    if (dept    && job.department !== dept)                       return false;
    if (!matchesLocation(job, loc))                               return false;
    if (type    && job.type.replace('-',' ').toLowerCase() !==
                   type.replace('-',' ').toLowerCase())           return false;
    return true;
  });
}

function update() {
  updateFilters();   // re-compute dropdown options from the current filter context
  syncUrlParams();
  renderJobs(getFiltered());
}

function clearFilters() {
  ['search-input', 'filter-company', 'filter-dept', 'filter-location', 'filter-type']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  update();
}

// ── Wire up events ────────────────────────────────────────────
document.getElementById('search-input').addEventListener('input', update);
['filter-company', 'filter-dept', 'filter-location', 'filter-type']
  .forEach(id => document.getElementById(id).addEventListener('change', update));

// ── Boot ─────────────────────────────────────────────────────
fetchJobs();

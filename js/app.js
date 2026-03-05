/* ============================================================
   app.js — Render, Filter & URL-param Logic
   Jobs are now fetched live from /api/jobs (Vercel function).
   ============================================================ */

// ── App state ─────────────────────────────────────────────────
let ALL_JOBS = [];

// ── Client-side job cache (localStorage) ─────────────────────
// Renders cached jobs instantly, then refreshes in the background.
// TTL: 5 minutes. Cache is keyed so a new deploy busts it automatically.
const CACHE_KEY = 'portfolio_jobs_cache_v1';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes in ms

function cacheLoad() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { data, savedAt } = JSON.parse(raw);
    if (Date.now() - savedAt > CACHE_TTL) return null; // expired
    return data;
  } catch (_) { return null; }
}

function cacheSave(data) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data, savedAt: Date.now() })); }
  catch (_) { /* storage full or private-browsing — silently skip */ }
}

// ── Apply site config from API response ──────────────────────
// Reads the `config` object returned by the API (sourced from the Google
// Sheet config tab) and populates page title, hero copy, and footer text.
// Falls back silently to whatever is in the HTML if a key is absent.
function applyConfig(config) {
  if (!config) return;

  if (config.siteTitle) document.title = config.siteTitle;

  const heroEl = document.getElementById('hero-headline');
  if (heroEl && config.heroHeadline) {
    // Highlight the last word of the headline with the brand <span> (as in the HTML default)
    const words = config.heroHeadline.trim().split(' ');
    const last  = words.pop();
    heroEl.innerHTML = words.length ? `${words.join(' ')} <span>${last}</span>` : `<span>${last}</span>`;
  }

  const subtextEl = document.getElementById('hero-subtext');
  if (subtextEl && config.heroSubtext) subtextEl.textContent = config.heroSubtext;

  const footerEl = document.getElementById('footer-copy');
  if (footerEl && config.footerText) footerEl.textContent = config.footerText;
}

function applyJobData(data) {
  ALL_JOBS = normalizeJobs(data.jobs || []);
  applyConfig(data.config);

  const companyCount = document.getElementById('company-count');
  const totalCount   = document.getElementById('total-count');
  if (companyCount) companyCount.textContent = new Set(ALL_JOBS.map(j => j.company)).size;
  if (totalCount)   totalCount.textContent   = ALL_JOBS.length;

  const lastUpdatedEl = document.getElementById('last-updated');
  if (lastUpdatedEl && data.fetchedAt) {
    const d = new Date(data.fetchedAt);
    lastUpdatedEl.textContent = d.toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    });
  }
}

// ── Fetch jobs from serverless API ───────────────────────────
async function fetchJobs() {
  // Show cached data immediately (no spinner) if we have a fresh copy.
  const cached = cacheLoad();
  if (cached) {
    applyJobData(cached);
    applyUrlParams();
    update();
    showLoading(false);
    // Refresh in the background so the next load is also fast.
    fetchJobs.background = true;
  } else {
    showLoading(true);
  }

  try {
    const res = await fetch('/api/jobs');
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const data = await res.json();

    cacheSave(data);
    applyJobData(data);

    if (!fetchJobs.background) {
      // First (cold) load — apply URL params and render now.
      applyUrlParams();
    }
    // Re-render with fresh data (also handles the background-refresh case).
    update();
  } catch (err) {
    if (!fetchJobs.background) {
      showLoading(false);
      showError(err.message);
    }
    // Background refresh failure: silently ignore — stale data is still shown.
  } finally {
    showLoading(false);
    fetchJobs.background = false;
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
  'new york city':         'New York, NY',
  'new york ny':           'New York, NY',
  'new york, ny':          'New York, NY',
  'new york':              'New York, NY',
  'nyc':                   'New York, NY',
  // NYC boroughs / neighbourhoods that should roll up to the city
  'brooklyn':              'New York, NY',
  'brooklyn, ny':          'New York, NY',
  'brooklyn, new york':    'New York, NY',
  'dumbo, brooklyn':       'New York, NY',
  'dumbo':                 'New York, NY',
  'manhattan':             'New York, NY',
  'manhattan, ny':         'New York, NY',
  'queens':                'New York, NY',
  'queens, ny':            'New York, NY',
  'bronx':                 'New York, NY',
  'the bronx':             'New York, NY',
  'staten island':         'New York, NY',
  // Boston metro area
  'somerville':            'Boston, MA',
  'somerville, ma':        'Boston, MA',
  'cambridge':             'Boston, MA',
  'cambridge, ma':         'Boston, MA',
};

function normalizeLocation(raw) {
  if (!raw) return raw;
  // 1. Strip emoji characters (e.g. "New York 🗽" → "New York")
  const stripped = raw.replace(/\p{Emoji}/gu, '').trim();
  const key = stripped.toLowerCase();
  // 2. Check explicit alias map
  const aliased = LOCATION_ALIASES[key];
  if (aliased) return aliased;
  // 3. Abbreviate any full state names found in the string
  return abbreviateStates(stripped);
}

// Canonical department map — collapses naming variants from different ATS
// platforms into a consistent set of filter labels.
// Add entries here whenever new aliases appear in the filter dropdown.
const DEPT_ALIASES = {
  // Engineering
  'software development':    'Engineering',
  'product & engineering':   'Engineering',

  // Customer Success
  'customer support':        'Customer Success',
  'customer experience':     'Customer Success',
  'customer service':        'Customer Success',

  // Operations
  'admin':                   'Operations',
  'administration':          'Operations',

  // Business Development
  'partnerships':            'Business Development',
  'partnership':             'Business Development',

  // Marketing
  'growth':                  'Marketing',
  'community':               'Marketing',
  'content':                 'Marketing',
  'brand':                   'Marketing',

  // Suppress generic catch-all
  'other':                   '',
};

function normalizeDepartment(raw) {
  if (!raw) return raw;
  const key = raw.trim().toLowerCase();
  // Check alias map (returns '' for suppressed entries like "Other")
  if (Object.prototype.hasOwnProperty.call(DEPT_ALIASES, key)) {
    return DEPT_ALIASES[key];
  }
  // Keep original (preserve capitalisation from the source)
  return raw.trim();
}

// Canonical job-type map — collapses spelling/casing variants from different
// job boards into a single consistent label.
function normalizeJobType(raw) {
  if (!raw) return raw;
  const s = raw.trim();
  // Full-time variants: "Full time", "Full-Time", "Fulltime", "full-time", etc.
  if (/^full[\s-]?time$/i.test(s))         return 'Full-time';
  // Part-time variants
  if (/^part[\s-]?time$/i.test(s))         return 'Part-time';
  // Contract + full-time hours
  if (/contract.*full[\s-]?time/i.test(s)) return 'Contract (Full-time)';
  // Contract + part-time hours
  if (/contract.*part[\s-]?time/i.test(s)) return 'Contract (Part-time)';
  // Plain contract
  if (/^contract$/i.test(s))               return 'Contract';
  return s;
}

// Run once after ALL_JOBS is populated to canonicalise location, department,
// and job-type strings.
function normalizeJobs(jobs) {
  return jobs.map(j => ({
    ...j,
    location:   normalizeLocation(j.location),
    department: normalizeDepartment(j.department),
    type:       normalizeJobType(j.type),
  }));
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

// ── Logo fallback ─────────────────────────────────────────────
// Called by onerror on company logo <img> elements.
// Cascade: primary (apple-touch-icon) → data-fallback (Google Favicons) → text initial.
function logoFallback(img) {
  // Step 1: try the secondary source stored in data-fallback
  const fallback = img.dataset.fallback;
  if (fallback && img.src !== fallback) {
    img.dataset.fallback = ''; // clear to prevent an infinite onerror loop
    img.src = fallback;
    return;
  }
  // Step 2: all image sources exhausted — show initial-letter badge
  const wrap = img.parentElement;
  if (!wrap) return;
  wrap.className = 'company-logo-wrap logo-text';
  const initial = (img.alt || '?').charAt(0).toUpperCase();
  wrap.innerHTML = `<span class="logo-text-fallback">${initial}</span>`;
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

    // Logo: primary source (apple-touch-icon) → fallback (Google Favicons) → text initial.
    // logoFallback() handles the cascade automatically via data-fallback.
    const logoUrl     = job.logoUrl || '';
    const logoFallUrl = job.logoFallback || '';
    const badgeClass  = logoUrl ? 'logo-img' : 'logo-text';

    const logoInner = logoUrl
      ? `<img class="company-logo-img" src="${logoUrl}" alt="${job.company}" loading="lazy" data-fallback="${logoFallUrl}" onerror="logoFallback(this)">`
      : `<span class="logo-text-fallback">${job.company.charAt(0).toUpperCase()}</span>`;

    card.innerHTML = `
      <div class="company-logo-wrap ${badgeClass}">
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

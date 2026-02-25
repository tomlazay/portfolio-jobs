/* ============================================================
   app.js — Render & Filter Logic
   You shouldn't need to edit this often. To add a new company,
   add entries to jobs.js and then add the company's logo text
   and CSS class name to the LOGOS and LOGO_CLASS objects below.
   ============================================================ */

// ── Company logo config ──────────────────────────────────────
// LOGOS:     text shown inside the logo badge
// LOGO_CLASS: matches a .logo-<name> rule in styles.css
const LOGOS = {
  POSH:  'POSH',
  North: 'N↑',
  Sent:  'SND',
};

const LOGO_CLASS = {
  POSH:  'logo-posh',
  North: 'logo-north',
  Sent:  'logo-sent',
};

// ── Render ───────────────────────────────────────────────────
function renderJobs(jobs) {
  const list       = document.getElementById('jobs-list');
  const noResults  = document.getElementById('no-results');
  const visCount   = document.getElementById('visible-count');
  const searchCount = document.getElementById('search-count');

  list.innerHTML = '';

  if (!jobs.length) {
    noResults.style.display = 'block';
    visCount.textContent    = '0';
    searchCount.textContent = '0 jobs';
    return;
  }

  noResults.style.display = 'none';
  visCount.textContent    = jobs.length;
  searchCount.textContent = jobs.length + ' job' + (jobs.length !== 1 ? 's' : '');

  jobs.forEach(job => {
    const card = document.createElement('a');
    card.className = 'job-card';
    card.href      = job.url;
    card.target    = '_blank';
    card.rel       = 'noopener noreferrer';

    const salaryHTML = job.compensation
      ? `<div class="job-comp">${job.compensation}</div>`
      : '';
    const equityHTML = job.equity
      ? `<div class="job-comp-equity">Offers Equity</div>`
      : '';

    card.innerHTML = `
      <div class="company-logo ${LOGO_CLASS[job.company] || ''}">${LOGOS[job.company] || job.company[0]}</div>
      <div class="job-info">
        <div class="job-title">${job.title}</div>
        <div class="job-company">${job.company}</div>
        <div class="job-meta">
          ${job.location ? `<span class="job-tag tag-location">📍 ${job.location}</span>` : ''}
          ${job.type     ? `<span class="job-tag tag-type">${job.type}</span>`             : ''}
          ${job.workMode ? `<span class="job-tag tag-mode">${job.workMode}</span>`          : ''}
          <span class="job-tag tag-dept">${job.department}</span>
        </div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        ${salaryHTML}${equityHTML}
      </div>
      <a class="apply-btn" href="${job.url}" target="_blank" rel="noopener noreferrer"
         onclick="event.stopPropagation()">Apply →</a>
    `;

    list.appendChild(card);
  });
}

// ── Filter ───────────────────────────────────────────────────
function getFiltered() {
  const q       = document.getElementById('search-input').value.toLowerCase().trim();
  const company = document.getElementById('filter-company').value;
  const dept    = document.getElementById('filter-dept').value;
  const loc     = document.getElementById('filter-location').value;
  const type    = document.getElementById('filter-type').value;

  return JOBS.filter(job => {
    const haystack = `${job.title} ${job.company} ${job.department} ${job.location} ${job.compensation}`.toLowerCase();
    if (q       && !haystack.includes(q))                               return false;
    if (company && job.company !== company)                             return false;
    if (dept    && job.department !== dept)                             return false;
    if (loc     && !job.location.toLowerCase().includes(loc.toLowerCase())) return false;
    if (type    && job.type !== type)                                   return false;
    return true;
  });
}

function update()       { renderJobs(getFiltered()); }
function clearFilters() {
  ['search-input', 'filter-company', 'filter-dept', 'filter-location', 'filter-type']
    .forEach(id => { document.getElementById(id).value = ''; });
  update();
}

// ── Wire up events ───────────────────────────────────────────
document.getElementById('search-input').addEventListener('input', update);
['filter-company', 'filter-dept', 'filter-location', 'filter-type']
  .forEach(id => document.getElementById(id).addEventListener('change', update));

// ── Initial render ───────────────────────────────────────────
renderJobs(JOBS);

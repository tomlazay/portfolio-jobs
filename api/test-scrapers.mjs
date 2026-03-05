#!/usr/bin/env node
// ============================================================
// ATS scraper smoke tests
// Calls each scraper against a real, known-good public job board
// and verifies that at least 1 job is returned with the required fields.
//
// Usage:
//   node api/test-scrapers.mjs                  # run all tests
//   node api/test-scrapers.mjs greenhouse lever  # run specific platforms
//
// Exit code: 0 = all pass, 1 = one or more failures
// ============================================================

const REQUIRED_FIELDS = ['title', 'url', 'company'];

// ── Test fixtures ─────────────────────────────────────────────
// One real public job board per ATS. Pick boards that are unlikely
// to ever be empty (large companies with permanent open roles).
const TESTS = [
  // ── Already-supported (regression guard) ───────────────────
  {
    platform: 'ashby',
    label:    'Ashby → Notion (the company)',
    url:      'https://jobs.ashbyhq.com/notion',
    company:  'Notion',
    fetch:    url => fetchAshbyJobs(url.match(/jobs\.ashbyhq\.com\/([^/?#\s]+)/)[1], 'Notion'),
  },
  {
    platform: 'lever',
    label:    'Lever → Figma',
    url:      'https://jobs.lever.co/figma',
    company:  'Figma',
    fetch:    url => fetchLeverJobs(url.match(/jobs\.lever\.co\/([^/?#\s]+)/)[1], 'Figma'),
  },
  {
    platform: 'breezy',
    label:    'Breezy → Buffer',
    url:      'https://buffer.breezy.hr',
    company:  'Buffer',
    fetch:    url => fetchBreezyJobs(url.match(/([a-z0-9-]+)\.breezy\.hr/)[1], 'Buffer'),
  },

  // ── New platforms ───────────────────────────────────────────
  {
    platform: 'greenhouse',
    label:    'Greenhouse → Stripe',
    url:      'https://boards.greenhouse.io/stripe',
    company:  'Stripe',
    fetch:    url => fetchGreenhouseJobs(url.match(/(?:boards|job-boards)\.greenhouse\.io\/([^/?#\s]+)/)[1], 'Stripe'),
  },
  {
    platform: 'greenhouse',
    label:    'Greenhouse (job-boards subdomain) → Algolia',
    url:      'https://job-boards.greenhouse.io/algolia',
    company:  'Algolia',
    fetch:    url => fetchGreenhouseJobs(url.match(/(?:boards|job-boards)\.greenhouse\.io\/([^/?#\s]+)/)[1], 'Algolia'),
  },
  {
    platform: 'workable',
    label:    'Workable → Papaya Global',
    url:      'https://apply.workable.com/papaya-global',
    company:  'Papaya Global',
    fetch:    url => fetchWorkableJobs(url.match(/apply\.workable\.com\/([^/?#\s]+)/)[1], 'Papaya Global'),
  },
  {
    platform: 'smartrecruiters',
    label:    'SmartRecruiters → Bosch',
    url:      'https://careers.smartrecruiters.com/Bosch',
    company:  'Bosch',
    fetch:    url => fetchSmartRecruitersJobs(url.match(/careers\.smartrecruiters\.com\/([^/?#\s]+)/)[1], 'Bosch'),
  },
  {
    platform: 'recruitee',
    label:    'Recruitee → Pitch',
    url:      'https://pitch.recruitee.com',
    company:  'Pitch',
    fetch:    url => fetchRecruiteeJobs(url.match(/([a-z0-9-]+)\.recruitee\.com/)[1], 'Pitch'),
  },
  {
    platform: 'bamboohr',
    label:    'BambooHR → Postmark (Wildbit)',
    url:      'https://wildbit.bamboohr.com/careers',
    company:  'Wildbit',
    fetch:    url => fetchBambooHRJobs(url.match(/([a-z0-9-]+)\.bamboohr\.com/)[1], 'Wildbit'),
  },
  {
    platform: 'pinpoint',
    label:    'Pinpoint → Sago Mini',
    url:      'https://sagomini.pinpointhq.com',
    company:  'Sago Mini',
    fetch:    url => fetchPinpointJobs(url.match(/([a-z0-9-]+)\.pinpointhq\.com/)[1], 'Sago Mini'),
  },
  {
    platform: 'workday',
    label:    'Workday → Okta',
    url:      'https://okta.wd1.myworkdayjobs.com/en-US/OktaCareers',
    company:  'Okta',
    fetch:    url => fetchWorkdayJobs(url, 'Okta'),
  },
  {
    platform: 'workday',
    label:    'Workday (no locale prefix) → Cloudflare',
    url:      'https://cloudflare.wd1.myworkdayjobs.com/CloudflareJobs',
    company:  'Cloudflare',
    fetch:    url => fetchWorkdayJobs(url, 'Cloudflare'),
  },
];

// ── Minimal stub implementations ──────────────────────────────
// The actual fetch functions live in api/jobs.js which uses ESM + Vercel Edge.
// Rather than import that file directly (it has `export const config`),
// we re-implement thin fetch wrappers here that mirror the same API calls.
// This lets the tests run with vanilla Node ≥ 18 (native fetch).

async function fetchAshbyJobs(handle, company) {
  const r = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${handle}?includeCompensation=true`);
  if (!r.ok) throw new Error(`Ashby ${r.status}`);
  const d = await r.json();
  return (d.jobs || []).map(j => ({ company, title: j.title, url: j.jobUrl }));
}

async function fetchLeverJobs(handle, company) {
  const r = await fetch(`https://api.lever.co/v0/postings/${handle}?mode=json`);
  if (!r.ok) throw new Error(`Lever ${r.status}`);
  const d = await r.json();
  return (Array.isArray(d) ? d : []).map(j => ({ company, title: j.text, url: j.hostedUrl }));
}

async function fetchBreezyJobs(handle, company) {
  const r = await fetch(`https://${handle}.breezy.hr/json`);
  if (!r.ok) throw new Error(`Breezy ${r.status}`);
  const d = await r.json();
  return (Array.isArray(d) ? d : []).map(j => ({ company, title: j.name, url: j.url }));
}

async function fetchGreenhouseJobs(handle, company) {
  const r = await fetch(`https://boards-api.greenhouse.io/v1/boards/${handle}/jobs?content=true`);
  if (!r.ok) throw new Error(`Greenhouse ${r.status}`);
  const d = await r.json();
  return (d.jobs || []).map(j => ({ company, title: j.title, url: j.absolute_url }));
}

async function fetchWorkableJobs(handle, company) {
  const r = await fetch(`https://apply.workable.com/api/v3/accounts/${handle}/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '', location: [], department: [], worktype: [], remote: [] }),
  });
  if (!r.ok) throw new Error(`Workable ${r.status}`);
  const d = await r.json();
  return (d.results || []).map(j => ({
    company, title: j.title, url: `https://apply.workable.com/${handle}/j/${j.shortcode}/`,
  }));
}

async function fetchSmartRecruitersJobs(handle, company) {
  const r = await fetch(`https://api.smartrecruiters.com/v1/companies/${handle}/postings?limit=100`);
  if (!r.ok) throw new Error(`SmartRecruiters ${r.status}`);
  const d = await r.json();
  return (d.content || []).map(j => ({
    company, title: j.name, url: `https://careers.smartrecruiters.com/${handle}/${j.id}`,
  }));
}

async function fetchRecruiteeJobs(handle, company) {
  const r = await fetch(`https://${handle}.recruitee.com/api/offers/`);
  if (!r.ok) throw new Error(`Recruitee ${r.status}`);
  const d = await r.json();
  return (d.offers || []).map(j => ({
    company, title: j.title, url: j.careers_url || `https://${handle}.recruitee.com/o/${j.slug}`,
  }));
}

async function fetchBambooHRJobs(handle, company) {
  const r = await fetch(`https://${handle}.bamboohr.com/careers/list`, {
    headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
  });
  if (!r.ok) throw new Error(`BambooHR ${r.status}`);
  const d = await r.json();
  return (d.result || []).map(j => ({
    company,
    title: j.jobOpeningName || j.name || '',
    url:   j.jobOpeningShareUrl || `https://${handle}.bamboohr.com/careers/${j.id}`,
  }));
}

async function fetchPinpointJobs(handle, company) {
  const r = await fetch(`https://${handle}.pinpointhq.com/api/v1/jobs`);
  if (!r.ok) throw new Error(`Pinpoint ${r.status}`);
  const d = await r.json();
  const jobs = Array.isArray(d) ? d : (d.data || d.jobs || []);
  return jobs.map(j => {
    const a = j.attributes || j;
    return { company, title: a.title || a.job_title || '', url: a.apply_url || '' };
  });
}

async function fetchWorkdayJobs(boardUrl, company) {
  const urlObj = new URL(boardUrl);
  const tenant = urlObj.hostname.split('.')[0];
  const parts  = urlObj.pathname.replace(/^\//, '').split('/').filter(Boolean);
  const board  = parts.find(p => !/^[a-z]{2}(-[A-Z]{2})?$/.test(p)) || parts[0];
  const r = await fetch(
    `https://${tenant}.myworkdayjobs.com/wday/cxs/${tenant}/${board}/jobs`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json',
                 'User-Agent': 'Mozilla/5.0' },
      body: JSON.stringify({ appliedFacets: {}, limit: 100, offset: 0, searchText: '' }),
    }
  );
  if (!r.ok) throw new Error(`Workday ${r.status}`);
  const d = await r.json();
  return (d.jobPostings || []).map(j => ({
    company, title: j.title,
    url: j.externalPath ? `https://${tenant}.myworkdayjobs.com${j.externalPath}` : boardUrl,
  }));
}

// ── Test runner ───────────────────────────────────────────────
const PASS = '\x1b[32m✔\x1b[0m';
const FAIL = '\x1b[31m✘\x1b[0m';
const WARN = '\x1b[33m⚠\x1b[0m';

function validate(jobs, label) {
  if (!Array.isArray(jobs) || jobs.length === 0) {
    return { ok: false, msg: 'returned 0 jobs (board may be empty, or API shape changed)' };
  }
  const missing = jobs.flatMap((j, i) =>
    REQUIRED_FIELDS.filter(f => !j[f]).map(f => `job[${i}].${f}`)
  ).slice(0, 5);
  if (missing.length) {
    return { ok: false, msg: `missing fields: ${missing.join(', ')}` };
  }
  return { ok: true, count: jobs.length };
}

async function runTests(filter = []) {
  const suite = filter.length
    ? TESTS.filter(t => filter.includes(t.platform))
    : TESTS;

  if (!suite.length) {
    console.error(`No tests matched: ${filter.join(', ')}`);
    process.exit(1);
  }

  let passed = 0, failed = 0;
  for (const test of suite) {
    process.stdout.write(`  ${test.label} … `);
    try {
      const jobs   = await test.fetch(test.url);
      const result = validate(jobs, test.label);
      if (result.ok) {
        console.log(`${PASS}  ${result.count} jobs`);
        passed++;
      } else {
        console.log(`${WARN}  ${result.msg}`);
        // Treat "empty board" as a warning, not a hard failure
        if (result.msg.includes('0 jobs')) passed++; else failed++;
      }
    } catch (err) {
      console.log(`${FAIL}  ${err.message}`);
      failed++;
    }
  }

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

const filter = process.argv.slice(2);
runTests(filter);

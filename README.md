# CompanyOn Ventures — Portfolio Jobs Board

A lightweight, static job board that aggregates open roles across portfolio companies. No backend, no dependencies — just HTML, CSS, and vanilla JS.

## Project Structure

```
portfolio-jobs/
├── index.html        # Page structure (rarely needs editing)
├── css/
│   └── styles.css    # All styles — edit this to change the design
├── js/
│   ├── jobs.js       # Job data — edit this to add/remove roles
│   └── app.js        # Render & filter logic
└── README.md
```

## How to Update Jobs

Open `js/jobs.js` and add, edit, or remove entries from the `JOBS` array. Each job follows this shape:

```js
{
  company:      "POSH",
  title:        "Senior Engineer",
  department:   "Engineering",
  location:     "New York City",
  type:         "Full time",      // Full time | Part-time | Contract
  workMode:     "Hybrid",         // On-site | Hybrid | Remote
  compensation: "$180K – $220K",  // or "" if not disclosed
  equity:       true,
  url:          "https://jobs.ashbyhq.com/posh/abc123"
}
```

## How to Add a New Company

1. **Add jobs** in `js/jobs.js` with the new company name
2. **Add logo config** in `js/app.js` — add an entry to `LOGOS` (badge text) and `LOGO_CLASS` (CSS class name)
3. **Add logo styles** in `css/styles.css` — add a `.logo-<name>` rule under the `/* ── COMPANY LOGOS ── */` section
4. **Add filter option** in `index.html` — add an `<option>` to the `#filter-company` select

## How to Retheme

Open `css/styles.css` and edit the CSS variables at the top of the file under `:root { }`. You can change brand colors, hero gradient, card styles, and individual company logo colors without touching any other code.

## Deployment

This is a plain static site — deploy anywhere:
- **Vercel**: connect the GitHub repo, zero config needed
- **Netlify**: drag and drop the folder at drop.netlify.com
- **GitHub Pages**: enable Pages in repo settings, set source to `main` branch

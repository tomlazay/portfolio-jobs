/* ============================================================
   jobs.js — Portfolio Job Data
   Add, remove, or edit jobs here. Each entry follows this schema:

   {
     company:      "Company Name",   // must match a key in LOGOS and LOGO_CLASS (app.js)
     title:        "Job Title",
     department:   "Department",
     location:     "City, State",
     type:         "Full time" | "Part-time" | "Contract",
     workMode:     "On-site" | "Hybrid" | "Remote",
     compensation: "$100K – $130K",  // leave "" if not disclosed
     equity:       true | false,
     url:          "https://apply-link.com"
   }

   To add a new company: add entries here, then add its logo
   config in the LOGOS and LOGO_CLASS objects in app.js, and
   add a .logo-<name> rule in css/styles.css.
   ============================================================ */

const JOBS = [

  // ── POSH ──────────────────────────────────────────────────
  { company:"POSH", title:"Community Manager, Campus Growth", department:"Community", location:"New York City", type:"Full time", workMode:"On-site", compensation:"$110K – $120K", equity:true, url:"https://jobs.ashbyhq.com/posh/881dc34c-33ed-4443-b03b-8cf7b4ea5785" },
  { company:"POSH", title:"Lead Category Launcher, New Verticals", department:"Community", location:"New York City", type:"Full time", workMode:"On-site", compensation:"$170K – $190K", equity:true, url:"https://jobs.ashbyhq.com/posh/129395d3-fffc-44a0-b5c7-58304b95f28d" },
  { company:"POSH", title:"Senior Community Manager, Brand Sponsorships", department:"Community", location:"New York City", type:"Full time", workMode:"On-site", compensation:"$130K – $150K", equity:true, url:"https://jobs.ashbyhq.com/posh/ce18b88c-7fdd-43d9-8c53-47bc81be53dc" },
  { company:"POSH", title:"Senior Data Engineer", department:"Data & Analytics", location:"New York City", type:"Full time", workMode:"On-site", compensation:"$180K – $220K", equity:true, url:"https://jobs.ashbyhq.com/posh/ded0fa44-a5b6-4bbb-be18-2e7efcd8e380" },
  { company:"POSH", title:"Senior Data Engineer, Personalization", department:"Data & Analytics", location:"New York City", type:"Full time", workMode:"On-site", compensation:"$180K – $220K", equity:true, url:"https://jobs.ashbyhq.com/posh" },
  { company:"POSH", title:"Senior Data Scientist", department:"Data & Analytics", location:"New York City", type:"Full time", workMode:"On-site", compensation:"$200K – $220K", equity:true, url:"https://jobs.ashbyhq.com/posh" },
  { company:"POSH", title:"Engineering Manager", department:"Engineering", location:"New York City", type:"Full time", workMode:"On-site", compensation:"$250K – $280K", equity:true, url:"https://jobs.ashbyhq.com/posh" },
  { company:"POSH", title:"Senior React Native Engineer – Consumer", department:"Engineering", location:"New York City", type:"Full time", workMode:"On-site", compensation:"$180K – $220K", equity:true, url:"https://jobs.ashbyhq.com/posh" },
  { company:"POSH", title:"Senior Software Engineer", department:"Engineering", location:"New York City", type:"Full time", workMode:"On-site", compensation:"$180K – $220K", equity:true, url:"https://jobs.ashbyhq.com/posh" },
  { company:"POSH", title:"Senior Software Engineer, Backend (AI)", department:"Engineering", location:"New York City", type:"Full time", workMode:"On-site", compensation:"$200K – $225K", equity:true, url:"https://jobs.ashbyhq.com/posh" },
  { company:"POSH", title:"Software Engineer – Internal Tooling", department:"Engineering", location:"New York City", type:"Full time", workMode:"Hybrid", compensation:"$145K – $160K", equity:true, url:"https://jobs.ashbyhq.com/posh" },
  { company:"POSH", title:"Head of Product", department:"Product & Design", location:"New York City", type:"Full time", workMode:"On-site", compensation:"$300K – $325K", equity:true, url:"https://jobs.ashbyhq.com/posh" },
  { company:"POSH", title:"Account Executive", department:"Sales", location:"New York City", type:"Full time", workMode:"On-site", compensation:"$100K – $110K", equity:true, url:"https://jobs.ashbyhq.com/posh" },
  { company:"POSH", title:"GTM Engineer", department:"Sales", location:"New York City", type:"Full time", workMode:"On-site", compensation:"$130K – $150K", equity:true, url:"https://jobs.ashbyhq.com/posh" },
  { company:"POSH", title:"Partnerships Manager", department:"Sales", location:"New York City", type:"Full time", workMode:"On-site", compensation:"$100K – $110K", equity:true, url:"https://jobs.ashbyhq.com/posh" },
  { company:"POSH", title:"Sales Enablement Specialist", department:"Sales", location:"New York City", type:"Full time", workMode:"On-site", compensation:"$100K – $120K", equity:true, url:"https://jobs.ashbyhq.com/posh" },

  // ── NORTH ─────────────────────────────────────────────────
  { company:"North", title:"Sr. Software Engineer Back End", department:"Engineering", location:"Brooklyn, NY / US Remote", type:"Full-time", workMode:"Hybrid", compensation:"", equity:false, url:"https://www.north.cloud/open-roles/senior-software-engineer-1" },
  { company:"North", title:"Software Engineer, QA", department:"Engineering", location:"In-office or US Remote", type:"Contract", workMode:"Hybrid", compensation:"", equity:false, url:"https://www.north.cloud/careers#open-roles" },
  { company:"North", title:"Sr. Software Engineer, Platform", department:"Engineering", location:"Brooklyn, NY", type:"Full-time", workMode:"Hybrid", compensation:"", equity:false, url:"https://www.north.cloud/careers#open-roles" },
  { company:"North", title:"Sales Development Representative", department:"GTM", location:"New York, NY", type:"Full-time", workMode:"Hybrid", compensation:"", equity:false, url:"https://www.north.cloud/careers#open-roles" },
  { company:"North", title:"Account Executive", department:"GTM", location:"New York, NY", type:"Full-time", workMode:"Hybrid", compensation:"", equity:false, url:"https://www.north.cloud/careers#open-roles" },
  { company:"North", title:"Marketing Intern", department:"Marketing", location:"Dumbo, Brooklyn", type:"Part-time", workMode:"Hybrid", compensation:"", equity:false, url:"https://www.north.cloud/careers#open-roles" },

  // ── SENT ──────────────────────────────────────────────────
  { company:"Sent", title:"Recruiter", department:"Admin", location:"New York City", type:"Full time", workMode:"On-site", compensation:"$100K – $130K", equity:true, url:"https://jobs.ashbyhq.com/sent" },
  { company:"Sent", title:"VP of Finance", department:"Admin", location:"New York City", type:"Full time", workMode:"On-site", compensation:"$200K – $240K", equity:true, url:"https://jobs.ashbyhq.com/sent" },
  { company:"Sent", title:"Developer Relations", department:"Marketing", location:"New York City", type:"Full time", workMode:"On-site", compensation:"$150K – $200K", equity:true, url:"https://jobs.ashbyhq.com/sent" },
  { company:"Sent", title:"Growth Engineer", department:"Marketing", location:"New York City", type:"Full time", workMode:"On-site", compensation:"$130K – $180K", equity:true, url:"https://jobs.ashbyhq.com/sent" },
  { company:"Sent", title:"Growth Engineer (Entry-Level)", department:"Marketing", location:"New York City", type:"Full time", workMode:"On-site", compensation:"$90K – $120K", equity:true, url:"https://jobs.ashbyhq.com/sent" },
  { company:"Sent", title:"Business Development, Partnerships", department:"Partnerships", location:"New York City", type:"Full time", workMode:"On-site", compensation:"$130K – $170K", equity:true, url:"https://jobs.ashbyhq.com/sent" },
  { company:"Sent", title:"Account Executive", department:"Sales", location:"New York City", type:"Full time", workMode:"On-site", compensation:"$220K – $300K", equity:true, url:"https://jobs.ashbyhq.com/sent" },

];

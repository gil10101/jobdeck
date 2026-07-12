# Search Queries for Job Scraper

<!-- Configured for Gil Lu (Brooklyn, NY). Update via /setup --section search as priorities change. -->

## Candidate snapshot
- **Who:** Gil Lu — M.S. Information Systems / Data Analytics (CUNY Baruch, Aug 2026), current Data Analytics Intern at NYC Aging.
- **Targets (priority order):** (1) Data Analyst / BI / Analytics Engineer, (2) Data Engineer, (3) Junior DBA / data-platform, (4) Data Scientist **internships** (incl. Winter 2026).
- **Timing:** New-grad full-time (2026) **and** internships/co-ops.
- **Location:** NYC within ~25 mi + fully-remote US; will commute 30–45 min from Bayside, Queens into Long Island (Nassau) and to Newark, NJ.
- **Company size:** **Exclude 1–50 employees** — prefer 50+.
- **Recency:** Postings from the **last 1–2 weeks** only.
- **Work auth:** U.S. citizen/PR — no sponsorship needed (drop citizen-only clearance roles; H1B-sponsor status irrelevant).
- **Applying:** Submit on the **company's own careers page** (aggregator links point there); log each application in `job_search_tracker.csv`.

## Search Sites (modular — add/remove freely)

The scraper auto-discovers CLI portals under `.agents/skills/*/SKILL.md`. Boards without a CLI are searched via `WebSearch` using the `site:` queries below.

| Board | Mode | How it runs |
|-------|------|-------------|
| **jobright.ai** | CLI (primary, **personalized + AI fit score**) | `bun run .agents/skills/jobright-search/cli/src/cli.ts recommend` / `search -q "…"` — see its SKILL.md. Run first; its scores are a strong pre-filter. |
| **LinkedIn** | CLI | `bun run .agents/skills/linkedin-search/cli/src/cli.ts search -q "…" -l "…"` — see its SKILL.md. |
| **freehire.dev** | CLI (tech aggregator) | `bun run .agents/skills/freehire-search/cli/src/cli.ts …` — see its SKILL.md. Good for data/eng roles. |
| **Indeed** | WebSearch `site:` | Cloudflare-walled; no CLI. Use the `site:indeed.com` queries below. |
| **Handshake** | WebSearch `site:` (limited) | SSO-walled (Google + school login) — no automated listing access. Only publicly-indexed `site:joinhandshake.com` postings are reachable; for the real feed, log in manually. |
| **Glassdoor** | Company research (not listings) | PerimeterX-walled for jobs. Used during `/apply` for **company reviews, ratings, and salary** via WebFetch/WebSearch, not as a source of new postings. |

**Run order for `/scrape`:** jobright CLI → LinkedIn CLI → freehire CLI → Indeed/Handshake WebSearch. Dedup across all, then present by fit.

### CLI invocation cheatsheet (translate the queries below into flags)

```bash
# jobright — personalized feed; exclude tiny cos (1-50) and stale (>14d)
bun run .agents/skills/jobright-search/cli/src/cli.ts recommend --min-size 51 --maxage 14 --limit 25 --format json
bun run .agents/skills/jobright-search/cli/src/cli.ts search -q "data analyst" --min-size 51 --maxage 14 --format json

# LinkedIn — NYC + Remote, last 14 days
bun run .agents/skills/linkedin-search/cli/src/cli.ts search -q "data analyst" -l "New York City Metropolitan Area" --jobage 14 --format json
bun run .agents/skills/linkedin-search/cli/src/cli.ts search -q "data engineer" -l "Remote" --jobage 14 --format json

# freehire — tech/data roles
bun run .agents/skills/freehire-search/cli/src/cli.ts search --query "data engineer" --format json
```

## Query Categories

Queries are grouped by priority. Run the top 3 categories by default; run all on `/scrape broad`. Combine with location terms where the site supports it.

### Priority 1: Data Analyst / BI / Analytics Engineer (strongest fit)

```
site:indeed.com "data analyst" (New York OR remote)
site:indeed.com "business intelligence analyst" New York
site:indeed.com "analytics engineer" (New York OR remote)
site:joinhandshake.com "data analyst" New York
```
CLI keywords: `data analyst`, `business intelligence analyst`, `BI analyst`, `analytics engineer`, `reporting analyst`, `product analyst`

### Priority 2: Data Engineer / Junior Data Engineer

```
site:indeed.com "data engineer" (New York OR remote) (AWS OR dbt OR Spark)
site:indeed.com "junior data engineer" (New York OR remote)
site:indeed.com "analytics engineer" dbt New York
site:joinhandshake.com "data engineer" (New York OR remote)
```
CLI keywords: `data engineer`, `junior data engineer`, `analytics engineer`, `ETL developer`, `data platform engineer`

### Priority 3: Junior DBA / Data Platform (honest gap on production-DBA ops)

```
site:indeed.com "junior database administrator" (New York OR remote)
site:indeed.com ("database developer" OR "SQL developer") New York
```
CLI keywords: `database developer`, `SQL developer`, `junior DBA`, `data platform`

### Priority 4: Data Scientist — Internships (incl. Winter 2026)

Full-time DS is a stretch; scope DS to internships/co-ops.

```
site:indeed.com "data scientist" intern (New York OR remote)
site:indeed.com "data science" (internship OR co-op) 2026 (New York OR remote)
site:joinhandshake.com "data science" internship New York
```
CLI keywords: `data scientist intern`, `data science internship`, `machine learning intern`, `data analyst intern`, `data science co-op`

## Location Filter

Verify each result sits in an acceptable area:
- **Ideal:** All 5 NYC boroughs (Manhattan, Brooklyn, Queens, Bronx, Staten Island) + any **fully-remote US** role
- **Acceptable:** Nassau County / western Long Island within ~30–45 min of Bayside, Queens (Great Neck, Manhasset, Garden City, Mineola, New Hyde Park, Hempstead); Newark NJ; Jersey City / Hoboken
- **Borderline (commute-dependent):** further Nassau / western Suffolk, lower Westchester, further NJ
- **Too far / relocation required:** deep Suffolk LI, upstate NY, CT, or any out-of-metro role that is **not** remote → skip

## Date Filter

Only include jobs posted within the last **14 days** (1–2 weeks), or with an application deadline that has not yet passed. If a posting date can't be determined, include it but flag as "date unknown". For internships, also surface Winter 2026 / Summer 2026 postings even if the start date is further out.

## Hard filters (drop before presenting)
- **Company size 1–50 employees** → drop (avoid very early-stage startups). Jobright: `--min-size 51`. For LinkedIn/freehire (no size field), check company size before presenting and drop sub-50; flag when size is unknown.
- Requires a **security clearance** Gil does not hold → drop (jobright's `clearanceRequired`/`citizenOnly` flags help here)
- Requires **relocation** and is not remote → drop
- Older than ~14 days → drop
- Deal-breaker role shape: heavy on-call/ops firefighting, or sales/consulting with significant travel → drop or flag

## Adapting Queries

If the user gives a focus area (e.g. `/scrape data engineer`), select that category's queries and generate 2-3 custom ones for the focus. Proactively surface adjacent roles from Gil's profile when a category runs thin — e.g. "analytics engineer" bridges his BI + dbt/Spark skills, and "data platform" bridges toward DBA.

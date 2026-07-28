---
name: jobright-search
version: 1.0.0
description: >
  Use this skill to pull the user's personalized, AI-fit-scored job feed from
  Jobright.ai. Unlike a keyword scraper, Jobright matches jobs to the user's own
  profile and returns a fit score (0-100) per posting. Authenticated with the
  user's own Jobright account. Trigger phrases: jobright, my job matches,
  recommended jobs, matched jobs, personalized jobs, what jobs match me,
  find jobs, job search, new jobs.
context: fork
allowed-tools: Bash(bun run .agents/skills/jobright-search/cli/src/cli.ts *)
---

# Jobright Search Skill

Pull the user's **personalized, AI-fit-scored** job feed from [Jobright.ai](https://jobright.ai).
Jobright is a matching product: it ranks jobs against the user's own profile and returns a
**fit score (0-100)** and a match band ("Strong Match" / "Good Match") for each posting, plus
rich metadata (salary, seniority, core skills, work-authorization flags, applicant count,
company info, and a direct apply link).

> This is an **authenticated** portal skill. It logs in with the user's own Jobright account
> and reads their private recommendation feed. It is different from the public scrapers
> (LinkedIn, freehire): the results are already tailored to the user, so scores are meaningful.

## Warning: personal use only

This uses the user's **own** Jobright account against Jobright's private backend API
(`swan-api.jobright.ai`). Keep volume low, never share the session, and do not use it for bulk
data collection. Run it on your own responsibility.

## Credentials setup (one-time)

The CLI reads credentials from, in order:

1. Environment variables `JOBRIGHT_EMAIL` and `JOBRIGHT_PASSWORD`, or
2. `credentials.json` at the skill root (`.agents/skills/jobright-search/credentials.json`):

   ```json
   { "email": "you@example.com", "password": "your-password" }
   ```

`credentials.json` and the cached session (`.session.json`) are **gitignored** and never
committed. Copy `credentials.example.json` to `credentials.json` to get started. The session
cookie is cached and reused automatically; the CLI logs in again when it expires.

## When to use this skill

- Get the user's personalized, fit-scored job matches
- Filter that matched feed by keyword, location, remote type, minimum fit score, or recency
- As one source in the `/scrape` multi-portal search (its fit scores are a strong signal)

## Commands

### Personalized feed (primary)

```bash
bun run .agents/skills/jobright-search/cli/src/cli.ts recommend [flags]
```

### Keyword-filtered feed

```bash
bun run .agents/skills/jobright-search/cli/src/cli.ts search -q "<terms>" [flags]
```

`search` pulls a larger slice of the personalized feed and filters it **client-side** by
keyword. Jobright's feed is already personalized, so this narrows *your matches* by term — it
does not run a separate global keyword search across all of Jobright.

### Flags (both commands)

- `--query <text>` / `-q <text>` — keep only jobs whose title/summary/skills contain **all** terms.
- `--location <text>` / `-l <text>` — keep only jobs whose location contains the text (e.g. `"New York"`, `"Remote"`).
- `--remote <mode>` — `remote` | `hybrid` | `onsite` (matches Jobright's `workModel`).
- `--min-score <n>` — keep only jobs with fit score `>= n` (0-100).
- `--maxage <days>` — keep only jobs posted within N days (use `14` for `/scrape`).
- `--limit <n>` / `-n <n>` — max jobs to return. Default `30`.
- `--refresh` — ask Jobright to re-rank the feed (slower, freshest).
- `--format <fmt>` — `json` (default) | `table` | `plain`.

Every result already includes full detail (summary, core skills, salary, work-auth flags,
apply link). Use `--format plain` to read it — there is **no separate `detail` command**.

## Usage examples

```bash
# Top 30 personalized matches, scannable table
bun run .agents/skills/jobright-search/cli/src/cli.ts recommend --limit 30 --format table

# Data-analyst matches in New York posted in the last 2 weeks
bun run .agents/skills/jobright-search/cli/src/cli.ts search -q "data analyst" -l "New York" --maxage 14 --format table

# Only strong matches (score >= 85), full detail
bun run .agents/skills/jobright-search/cli/src/cli.ts recommend --min-score 85 --format plain

# Remote-only matches, JSON for programmatic use
bun run .agents/skills/jobright-search/cli/src/cli.ts recommend --remote remote --format json
```

## Output

`json` (default) emits `{ "results": [...], "meta": {...} }`. Each result:

| Field | Meaning |
|-------|---------|
| `id` | Jobright job id |
| `title`, `company`, `location`, `workModel` | core posting fields |
| `score`, `match` | Jobright's AI fit score (0-100) and band |
| `seniority`, `employmentType`, `salary` | role metadata |
| `date`, `posted`, `applicants` | recency + competition signal |
| `h1bSponsor`, `citizenOnly`, `workAuthRequired`, `clearanceRequired` | work-authorization flags |
| `skills`, `summary` | core JD skills and a short summary |
| `applyLink`, `jobrightUrl` | direct apply link and the Jobright posting page |

`table` is for quick human scanning; `plain` prints full detail per job.

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process
exits with code `1` (e.g. `NO_CREDS`, `LOGIN_FAILED`).

## Notes

- Auth is a cookie session (`SESSION_ID`), captured on login and cached in `.session.json`.
- The `score` field is Jobright's own AI fit rating against the user's profile — treat it as a
  strong pre-filter signal, but still run the repo's own fit evaluation before applying.
- Work-authorization flags (`citizenOnly`, `clearanceRequired`, `h1bSponsor`) are surfaced so
  postings the user is ineligible for can be filtered early.
- The feed reflects the profile configured **inside Jobright** — keep that profile current for
  the best matches.

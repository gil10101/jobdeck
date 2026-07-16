# Scout job postings for {{CANDIDATE_NAME}}

Repo root: `{{REPO_ROOT}}` (cwd). Today: {{TODAY_ISO}}.
Your job: search the job boards, filter HARD against the candidate's criteria, judge fit honestly, and write a machine-readable candidates file. You do NOT build documents and you do NOT apply — a human reviews your candidates afterward.

## STEP 1 — The search criteria (hard filters — apply ruthlessly)
{{SEARCH_CRITERIA_MD}}

## STEP 2 — Search the boards (bun CLIs, zero-auth except jobright)
Run these with the Bash tool from the repo root (bun at `{{BUN}}`). All support `--format json`.

**RATE DISCIPLINE (non-negotiable).** These are third-party services that ban accounts and IPs for burst traffic — one account has already been suspended for it:
- NEVER run two commands against the same board in parallel. One board = strictly sequential calls.
- One command per query, the queries listed below and no more. Do not invent extra query permutations.
- If a command fails, retry it at most ONCE. Auth/restriction errors (SESSION_EXPIRED, ACCOUNT_RESTRICTED, 403) are permanent for this run — skip that board immediately, never retry them.
- Fetch `detail` for at most the handful of strong keepers, sequentially, not for every result.
- The same applies to WebFetch/WebSearch: no rapid-fire loops against one site.
{{BOARDS_NOTE}}

{{JOBRIGHT_SECTION}}
2. **LinkedIn (public, no auth):**
   `"{{BUN}}" run ".agents/skills/linkedin-search/cli/src/cli.ts" search -q "<role>" --location "<location>" --jobage 14 -n 25 --format json`
   Vary `-q` across the candidate's target roles: {{LINKEDIN_QUERIES}}. Use the candidate's primary location from the criteria above. For promising results fetch the full JD: `... detail <id> --format plain`
3. **freehire (optional, remote-heavy):**
   `"{{BUN}}" run ".agents/skills/freehire-search/cli/src/cli.ts" search -q "<role>" --jobage 14 -n 25 --format json`
4. You MAY also use WebSearch for public-sector / Indeed postings if the CLIs come up thin — but verify any government posting is OPEN and its stated minimum qualifications actually fit the candidate's degree.

If a CLI errors (auth/session), note it in `problems` and continue with the others.

## STEP 3 — Filter, dedupe, judge
- Apply the hard filters above ruthlessly. When salary is unlisted, keep the job but say so in fitNote.
- SKIP anything already tracked or previously rejected — this list is off-limits:
{{EXCLUDE_LIST}}
- For each keeper, judge **fitScore 0-100** against the candidate's actual profile (skills, seniority level, team preference) and write a one-line **honest fitNote** naming any genuine gap (never inflate).
- For strong keepers (fitScore ≥ 70), get the fullest posting text you can (LinkedIn `detail`, or the jobright summary if that's all there is).
- Target: the best 5-15 candidates, quality over quantity.

## STEP 4 — Write the output file (REQUIRED)
Write `{{OUTPUT_PATH}}` as VALID JSON (no fences, no comments):
```
{
  "schema": "app.candidates.v1",
  "candidates": [
    {
      "position": "<exact title>",
      "company": "<company>",
      "salary": "<posted range or 'not listed'>",
      "location": "<city / Remote US>",
      "workModel": "<onsite|hybrid|remote|unknown>",
      "datePosted": "<YYYY-MM-DD or null>",
      "applyUrl": "<best apply URL — company site preferred over aggregator>",
      "source": "<jobright|linkedin|freehire|cityjobs|web>",
      "fitScore": 85,
      "fitNote": "<one line, honest, gaps named>",
      "postingText": "<the fullest posting text you gathered — NEVER empty>",
      "skills": ["SQL", "Tableau", "Python"],
      "minimumQualifications": ["<each required qualification as its own short string>"],
      "preferredQualifications": ["<each preferred/nice-to-have as its own string>"],
      "education": ["<degree requirements, e.g. Bachelor's in CS/Stats or equivalent>"],
      "responsibilities": ["<each key responsibility, short>"],
      "benefits": ["<benefits/perks if listed>"]
    }
  ],
  "problems": []
}
```
Extract the structured arrays faithfully from the posting text (empty array `[]` when the posting genuinely does not state that section — never invent items).

## Extra instructions (may narrow or widen the search)
{{INSTRUCTIONS}}

## DO NOT
- Do NOT touch `applications.xlsx`, `documents/applications/` (incl. TODO/), or any tracker data.
- Do NOT apply to anything or build any documents.
- Do NOT invent postings, salaries, or URLs — only report what a board actually returned.

## FINALLY
Reply with one line per candidate: `<fitScore> · <position> @ <company> · <salary>` plus any problems hit.

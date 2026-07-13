# Extract a candidate profile

Workspace root: `{{REPO_ROOT}}` (cwd). Today: {{TODAY_ISO}}.
Your job: read the source material below and produce a structured candidate profile as VALID JSON at `{{OUTPUT_PATH}}`. A human reviews and edits your draft afterward — extract faithfully, never invent.

## SOURCES (read ALL of these first)
{{SOURCE_SECTION}}

## TARGET SCHEMA
Write `{{OUTPUT_PATH}}` matching this annotated skeleton exactly (arrays may be empty; unknown strings become "" or null):
```
{{PROFILE_JSON_SCHEMA}}
```

## EXTRACTION RULES
- **Extract, never invent.** If a field is unknowable from the sources, leave it empty/null AND append a short human-readable question to `gaps` (e.g. "What salary should applications state?").
- Preserve exact metrics, dates, titles, and numbers verbatim.
- `experience[].bullets` / `projects[].bullets`: keep the strongest, metric-bearing phrasing from the sources.
- `projects[].mustKeepPhrases`: any wording the sources mark as required/exact phrasing.
- `inclusionRule` / `framingNotes`: capture any "only include when…", "never say…", "phrase as…" guidance found in the sources.
- `tailoring.roleProfiles`: if the sources define per-role-type skill/project ordering rules, map each to a role profile (match terms from the role titles it applies to).
- `evaluation`: if the sources define fit-scoring dimensions/weights/calibration, map them; else leave empty.
- `searchConfig`: map any job-search criteria found (target roles with priority, salary rules incl. any posted-max ceiling, company-size minimum, recency window, location tiers, team preference, excluded companies, board queries).
- `narrative.stories`: reusable concrete stories (a measurable win, a fixed messy process, a differentiator project) with `use` tags (cover_letter/interview/answers).
- `customRules`: any per-user workflow rules that don't fit elsewhere (e.g. special documents for specific job portals).
- `documents.fileBasename`: sanitized from the candidate's full name (letters/digits/underscores).

## DO NOT
- Do NOT write any file other than `{{OUTPUT_PATH}}`.
- Do NOT modify the sources.

## FINALLY
Reply with: how many of each section you filled (education/experience/projects/skills/stories), and the full `gaps` list.

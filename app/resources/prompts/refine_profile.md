# Refine a candidate profile draft

Workspace root: `{{REPO_ROOT}}` (cwd). Today: {{TODAY_ISO}}.
The candidate reviewed their profile draft and answered follow-up questions. Merge each answer into the correct fields and write the COMPLETE updated profile as VALID JSON to `{{OUTPUT_PATH}}`.

## CURRENT DRAFT
```json
{{DRAFT_JSON}}
```

## CANDIDATE ANSWERS
{{ANSWERS_SECTION}}

## MERGE RULES
- Apply ONLY what the answers state. Change nothing the answers do not cover. Never invent.
- One answer may touch several fields (e.g. "M.S. student graduating Aug 2026, available now" → `identity.status` AND `searchConfig.availability`).
- Preserve exact numbers, dates, and phrasing from the answers.
- After merging, set `gaps` to `[]` — questions the candidate left unanswered are dismissed, do not carry them over.
- Output must keep the exact schema of the draft (same keys and types, `schema`/`revision`/`updatedAt` unchanged).

## DO NOT
- Do NOT write any file other than `{{OUTPUT_PATH}}`.
- Do NOT re-read source documents — the draft plus the answers are your only inputs.

## FINALLY
Reply with a short list of each field you changed and why.

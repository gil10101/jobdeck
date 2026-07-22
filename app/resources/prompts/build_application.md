# Build ONE job-application folder for {{CANDIDATE_NAME}}

Workspace root: `{{REPO_ROOT}}` (cwd — work ONLY inside it). Today: {{TODAY_ISO}}.
Build a complete, tailored application folder from the posting below, then write a machine-readable report. Everything you need to know about the candidate is IN THIS PROMPT — do not look for profile files.

- SLUG (folder name — use EXACTLY this): `{{SLUG}}`
- Apply URL: {{APPLY_URL}}
- Company hint: {{COMPANY_HINT}} · Role hint: {{ROLE_HINT}}
- LaTeX (run from inside the folder): {{LATEX_LINE}}
- Output file stem: `{{FILE_BASENAME}}` → `{{FILE_BASENAME}}_Resume.tex`, `{{FILE_BASENAME}}_Cover_Letter.tex`

## THE JOB POSTING (provided in full — do NOT fetch it from a job board; you MAY WebFetch the apply URL only to confirm details)
<posting>
{{POSTING_TEXT}}
</posting>

{{IMAGES_SECTION}}

{{PROFILE_MD}}

{{MASTER_CONTEXT_MD}}
{{USER_NOTES_MD}}
{{TAILORING_RULES_MD}}

## STEP 1 — Learn the document pattern
- Read the master résumé: `{{MASTER_RESUME_PATH}}` — copy its preamble/macros EXACTLY (including any `glyphtounicode` ATS block).
- {{EXAMPLE_FOLDER_LINE}}

## STEP 2 — Create folder `applications/{{SLUG}}/`
All files go in this folder. Do NOT create files anywhere else.

## STEP 3 — `{{FILE_BASENAME}}_Resume.tex` (tailored for THIS posting)
- Apply the TAILORING RULES above: pick the matching role profile, order skills/projects accordingly, and pick the 2-3 most relevant projects (respect every INCLUSION RULE, VERBATIM REQUIRED phrase, and FRAMING note in the profile).
- Reword experience/project bullets to mirror THIS posting's exact terms where truthfully applicable. Keep every metric exactly as stated in the profile.

## STEP 4 — Compile & verify the résumé
From inside the folder, compile per the LaTeX instruction above. Confirm it is exactly 1 page. If 2 pages, trim the least-relevant bullet and recompile until exactly 1 page (if badly underfull, add truthful profile content). Delete `.aux/.log/.out`. Grep the `.tex` to confirm no `---` or `—`.

## STEP 5 — `{{FILE_BASENAME}}_Cover_Letter.tex` (ALWAYS — every application gets one)
Self-contained article document matching the résumé's font.
{{COVER_LETTER_STYLE_MD}}
Stories to build on:
{{COVER_LETTER_STORIES_MD}}
Compile per the LaTeX instruction above to exactly 1 page (signature must fit). Delete aux files.

## STEP 6 — `application_answers.md`
Structure: H1 `# Application Answers - <Company>, <Role>`, a `**Apply at:**` line, `## Copy-paste fields` as a 2-column pipe table, a tailored `## "Why this role?"` (3-4 sentences, specific), 2 likely screening Q&A, trailing `_Status: NOT yet submitted..._` line.
{{ANSWERS_INFO_MD}}

## STEP 7 — `job_posting.md`
Summarize the posting: H1 `# <Role> - <Company>`, bulleted metadata block (`- **Company:**`, `- **Location:**`, `- **Salary:**`, `- **Source / apply:**`, `- **Captured:** {{TODAY_ISO}}`), then `## Responsibilities`, `## Required qualifications`, and `## Fit note (honest)` — name genuine gaps explicitly; never stuff keywords.

## STEP 8 — Candidate-specific extra rules
{{EXTRA_RULES_MD}}

## STEP 9 — Reviewer self-pass (adversarial, REQUIRED)
Re-read the posting and your drafts as a skeptical reviewer:
1. Build a keyword taxonomy from the posting: hard skills, tools, domain terms, soft signals.
2. Classify each keyword: `covered` (already in the résumé truthfully) / `edited-in` (candidate truthfully has it — apply an exact old→new edit to surface it, then recompile) / `gap-honest` (candidate lacks it — leave visible, NEVER stuff).
3. Verify every company-specific claim in the cover letter is supported by the posting or a WebFetch of the apply URL.

## STEP 10 — ATS text-layer gate
{{PDFTOTEXT_LINE}}

## STEP 11 — `report.json` (REQUIRED — the app accepts the build only if this validates)
Write `applications/{{SLUG}}/report.json` as VALID JSON (no fences):
```
{
  "schema": "app.report.v1",
  "slug": "{{SLUG}}",
  "position": "<exact role title>",
  "company": "<company name>",
  "salary": "<posted range or 'not listed'>",
  "location": "<city/remote>",
  "datePosted": "<YYYY-MM-DD; when the posting only shows a relative age ('1 week ago'), compute the approximate date from today's date instead of using null; null only when there is no age signal at all>",
  "applyUrl": "<best apply URL>",
  "coverLetter": true,
  "resumePages": 1,
  "coverLetterPages": 1,
  "noEmDashes": "confirmed",
  "cityjobsMessage": false,
  "fitNote": "<one line, honest, gaps named>",
  "problems": [],
  "keywordCoverage": [
    { "keyword": "<from step 9>", "status": "covered|edited-in|gap-honest", "where": "<résumé section or 'absent'>" }
  ],
  "atsCheck": "passed|skipped|<problem description>",
  "files": {
    "resumePdf": "{{FILE_BASENAME}}_Resume.pdf",
    "coverLetterPdf": "{{FILE_BASENAME}}_Cover_Letter.pdf",
    "answers": "application_answers.md",
    "posting": "job_posting.md"
  }
}
```
Report page counts and checks TRUTHFULLY (the app re-verifies files on disk).

`problems` is ONLY for issues the user must act on or know about: a failed check, an unverifiable claim, a missing input. Successful workarounds, expected data gaps, and explanations of how you did something are NOT problems — omit them; an empty array is the normal result.

## DO NOT
- Do NOT touch anything in `applications/TODO/` (the app renames processed files).
- Do NOT create files outside `applications/{{SLUG}}/`.
- Do NOT invent skills, experience, metrics, or company facts.

## FINALLY
Reply with a 6-line summary: folder, résumé pages, cover-letter pages, no_em_dashes, salary, one-line fit note.

# Build ONE job-application folder for Gil Lu

Repo root: `{{REPO_ROOT}}` (work ONLY inside it). Today: {{TODAY_ISO}}.
You are given the full job-posting text below. Build a complete, tailored application folder matching the quality of the completed example, then write a machine-readable report.

- SLUG (folder name — use EXACTLY this, do not invent your own): `{{SLUG}}`
- Apply URL: {{APPLY_URL}}
- Company hint: {{COMPANY_HINT}} · Role hint: {{ROLE_HINT}}
- pdflatex: `{{PDFLATEX}}` (run from inside the folder, `-interaction=nonstopmode`, TWICE per document)

## THE JOB POSTING (provided in full — do NOT fetch it from a job board; you MAY WebFetch the apply URL only to confirm details)
<posting>
{{POSTING_TEXT}}
</posting>

{{IMAGES_SECTION}}

## STEP 1 — Learn the pattern (Read these first)
- `cv/main_example.tex` — Gil's master résumé (article-based, 1 page, ATS). Use its exact preamble/macros/`glyphtounicode` block.
- `{{EXAMPLE_FOLDER}}/` — a COMPLETED example. Read `Gil_Lu_Resume.tex`, `Gil_Lu_Cover_Letter.tex`, `application_answers.md`, `job_posting.md`. Replicate this structure and quality.
- `.claude/skills/job-application-assistant/05-cv-templates.md` — per-role tailoring rules (skills-by-role, projects-by-role).
- `CLAUDE.md` — Gil's full profile + rules (Candidate Profile, Job Search Configuration).

## STEP 2 — Create folder `documents/applications/{{SLUG}}/`
All files go in this folder. Do NOT create files anywhere else.

## STEP 3 — `Gil_Lu_Resume.tex` (tailored for THIS posting)
- Copy the master's preamble/macros EXACTLY (incl. the `\ifdefined\pdfgentounicode` ATS block, lmodern).
- Tailor Skills + Projects to the role per `05-cv-templates.md` (Data Analyst → Languages / Data Visualization & Reporting / Analytics & Statistics / Databases & Data Pipelines / Certifications; Data Engineer → lead with pipelines/cloud; adjust honestly by role type).
- Projects: pick the 2-3 most relevant (Churn / Orchid / Bertram; Orchid wording must match the master exactly: "for students and data analysts", "warehouses such as Snowflake, BigQuery, and PostgreSQL", AI assistant that "reads and writes SQL and Python").
- Experience: NYC Aging (Feb 2026 -- May 2026) + MetaBronx (+ Teacher Aide at A+ Academy ONLY for education/K-12/school-setting roles). **Reword bullets to mirror THIS posting's exact terms** where truthfully applicable. Keep all numbers (86.9%, 7,000+, 40+).
- **HARD RULES:** never fabricate a skill/experience Gil lacks; **NO em-dashes** — the characters `—` and `---` must NOT appear anywhere (use commas/periods; date ranges use `--`); exactly 1 page.

## STEP 4 — Compile & verify the résumé
From inside the folder run pdflatex TWICE. Confirm the log says `(1 page`. If 2 pages, trim the least-relevant bullet and recompile until exactly 1 page (and if badly underfull, add a truthful project/cert). Delete `.aux/.log/.out`. Grep the `.tex` to confirm no `---` or `—`.

## STEP 5 — `Gil_Lu_Cover_Letter.tex` (ALWAYS — every application gets one)
Copy the example's cover-letter model (self-contained article, same font as the résumé): **formal register** (no casual sign-offs; close with "I would welcome the opportunity to discuss how I can contribute to [company]"), ~250-280 words, **no em-dashes**, two concrete stories (churn 86.9% win + NYC Aging data-request process fix) plus the Orchid differentiator, mirror a couple of the posting's phrases. Compile with pdflatex TWICE to exactly 1 page (signature must fit). Delete aux files.

## STEP 6 — `application_answers.md`
Copy the example's structure exactly: H1 `# Application Answers - <Company>, <Role>`, `**Apply at:**` line, `## Copy-paste fields` pipe table, tailored `## "Why this role?"` (3-4 sentences, specific, no em-dashes), 2 likely screening Q&A, trailing `_Status: NOT yet submitted..._` line.
Gil's saved info: email gillu1212@gmail.com; phone 929-427-4470; Brooklyn, NY 11220; linkedin.com/in/gil-lu; github.com/gil10101; gillu.me; **U.S. citizen — no sponsorship**; **desired salary $60,000**; **available immediately (full-time/part-time/internship)**; M.S. Information Systems Data Analytics (CUNY Baruch, expected Aug 2026); B.S. Computer Science (CUNY Brooklyn College, May 2025).

## STEP 7 — `job_posting.md`
Summarize the posting: H1 `# <Role> - <Company>`, then a bulleted metadata block (`- **Company:**`, `- **Location:**`, `- **Salary:**`, `- **Source / apply:**`, `- **Captured:** {{TODAY_ISO}}`), then `## Responsibilities`, `## Required qualifications`, and `## Fit note (honest)` — call out genuine gaps explicitly; never stuff keywords.

## STEP 8 — NYC city-agency roles only
If the posting is from cityjobs.nyc.gov (or clearly an NYC city agency), also write `message_to_hiring_team.md` (~110-130 words, formal, no em-dashes, references the attached resume and cover letter).

## STEP 9 — `report.json` (REQUIRED — the app reads this to accept the build)
Write `documents/applications/{{SLUG}}/report.json` as VALID JSON (no comments, no markdown fences) exactly matching this schema:
```
{
  "schema": "app.report.v1",
  "slug": "{{SLUG}}",
  "position": "<exact role title>",
  "company": "<company name>",
  "salary": "<posted range or 'not listed'>",
  "location": "<city/remote>",
  "datePosted": "<YYYY-MM-DD or null>",
  "applyUrl": "<best apply URL>",
  "coverLetter": true,
  "resumePages": 1,
  "coverLetterPages": 1,
  "noEmDashes": "confirmed",
  "cityjobsMessage": false,
  "fitNote": "<one line, honest, gaps named>",
  "problems": [],
  "files": {
    "resumePdf": "Gil_Lu_Resume.pdf",
    "coverLetterPdf": "Gil_Lu_Cover_Letter.pdf",
    "answers": "application_answers.md",
    "posting": "job_posting.md"
  }
}
```
Report page counts and the em-dash check TRUTHFULLY (the app re-verifies files on disk). List any problems you hit in `problems`.

## DO NOT
- Do NOT touch `applications.xlsx` (the app owns the tracker).
- Do NOT touch anything in `documents/applications/TODO/` (the app renames processed files).
- Do NOT create files outside `documents/applications/{{SLUG}}/`.

## FINALLY
Reply with a 6-line summary: folder, résumé pages, cover-letter pages, no_em_dashes, salary, one-line fit note.

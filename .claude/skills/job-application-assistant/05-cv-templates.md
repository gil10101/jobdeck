# CV Templates and Tailoring Guide

Gil's résumé uses a custom **ATS-friendly single-column `article` template** — all black, exactly
1 page. This replaces the stock moderncv/banking flow. Master file: `cv/main_example.tex`.

## One folder per application (Gil's workflow)
Each application gets its own **self-contained folder** so Gil can open it, grab everything, submit, and move on:

```
documents/applications/<company>_<role>_<MM_DD>/     e.g. nyc_HPD_data_analyst_07_11/
├── Gil_Lu_Resume.tex     # tailored copy of the master (edit + recompile here)
├── Gil_Lu_Resume.pdf     # the file Gil uploads (clean recruiter-facing name)
├── application_answers.md # every common form field pre-filled + drafted short answers
├── job_posting.md        # the JD, captured for reference
└── (cover_letter.pdf/.tex only if the posting requires one)
```

Name the PDF `Gil_Lu_Resume.pdf` (a human/ATS may see the filename — never `main_<company>.pdf`).
Compile in-place with pdflatex (TinyTeX). Do NOT scatter tailored CVs in `cv/` — that's only the master.
`documents/applications/**` is gitignored (personal).

## Hard rules (non-negotiable)

- **Exactly 1 page.** Not 2, not a page-and-a-bit. Fill the page — **no large empty space at the bottom**.
- **All black.** No color anywhere.
- **No summary / objective / profile statement.** Start straight into Education.
- **No references section.**
- **Section names:** `Skills` (never "Technical Skills"/"Core Competencies"), `Projects` (never "Selected Projects").
- **Section order:** Header → **Education → Skills → Experience → Projects.** Skills sit up top for ATS keyword density.

## Compile & verify

Compile with **pdflatex, run twice** (for hyperref). On this machine pdflatex is TinyTeX:
`%APPDATA%\TinyTeX\bin\windows\pdflatex.exe`. xelatex/lualatex also work (the `\pdfgentounicode`
line is guarded with `\ifdefined`).

```bash
pdflatex -interaction=nonstopmode main_<company>.tex   # twice
```

Expected: `Output written on main_<company>.pdf (1 page, ...)`. **Any count other than 1 is a failure.**

### Template mechanics (already in main_example.tex)
- Packages: `geometry` (0.4in/0.6in margins), `enumitem`, `hyperref[hidelinks]`, `fontawesome5`, `lmodern`.
- **ATS ligature fix (keep it):** `\ifdefined\pdfgentounicode \input{glyphtounicode} \pdfgentounicode=1 \fi` — without this the text layer extracts `efficiency`→`eciency`, `Snowflake`→`Snowake` (garbled to a parser).
- Macros: `\resumesection{}` (bold + rule), `\resumeentry{title}{date}{subtitle}{right}` (ends its own paragraph, so consecutive entries never collide), `\projectentry{name}{link}`, and the `resumelist` bullet environment.

## Per-role tailoring — DO THIS FOR EVERY APPLICATION

The master lists everything. Each `main_<company>.tex` is **cut and reworded** for the specific
posting. Never send the master verbatim.

### 1. Skills — include only what the role needs (don't dump the full stack)
| Target role | Lead with | Trim / drop |
|-------------|-----------|-------------|
| **Data Analyst / BI** | SQL, BI & Viz (Tableau, Power BI, Alteryx, Excel), Python (pandas), A/B testing & stats | Drop **Developer Tools**; trim heavy ML/DL and niche cloud |
| **Data Engineer / analytics eng** | Data Engineering & Cloud (ETL/ELT, dbt, Spark/PySpark, AWS Glue/Athena/EMR/Kinesis/Firehose/Lambda/S3, warehouses), SQL, Python | Trim BI/Viz to one line; drop CV libs (OpenCV/CUDA) |
| **Data Scientist / ML** | ML & Statistics (scikit-learn, PyTorch, TensorFlow, XGBoost, statsmodels), Python, SQL, cloud | Drop **BI & Visualization** and web Dev Tools |
| **DBA / data platform** | SQL/T-SQL, databases, warehousing, some ETL/cloud | Be honest about the production-DBA-ops gap |

Reorder categories so the most relevant is first. Keep the **Certifications** line (IBM Data
Analyst) on Data-Analyst-targeted CVs; optional elsewhere.

### 2. Projects — choose by the job title/description, lead with the most relevant
Pick **2–3**. The master carries Orchid, Churn, Bertram; LPR is held out for CV/ML roles.
| Project | Signal | Lead it for |
|---------|--------|-------------|
| **Orchid** (collaborative data-notebook IDE — Python/SQL notebooks over Snowflake, BigQuery, PostgreSQL, MySQL; AI assistant that reads/writes SQL & Python; real-time collab) | "I understand the data-tooling ecosystem" | **Data Engineer / analytics-eng / data-platform**; also a differentiator on Data-Analyst CVs |
| **Customer Churn** (EDA, 7 ML models, A/B testing, recommendations) | "what I'll do on the job" — analysis | **Data Analyst / Data Scientist** |
| **Bertram** (full-stack, LLM, OAuth, FastAPI, PostgreSQL, Next.js) | modern full-stack + AI | **SWE / full-stack / AI-product** |
| **License Plate Recognition** (YOLOv5, OCR, CUDA, Power BI/Tableau) | computer vision + pipeline | **CV / ML-heavy** roles only |

### 3. Reword bullets for ATS
For every chosen experience/project, rewrite bullets to mirror the **posting's exact terms** where
truthfully applicable (posting says "ELT" → say "ELT"; "dashboards" → "dashboards"; "stakeholders"
→ "stakeholders"). Front-load tools/keywords, keep the numbers. **Never invent a skill the profile
doesn't support** — leave genuine gaps visible, never stuff.

## Compile-and-inspect loop (MANDATORY, every time)
1. `pdflatex main_<company>.tex` twice.
2. Confirm the log says **1 page**.
3. Read the PDF: no entry collisions, no orphaned titles, and the **bottom is well-filled** (no big gap).
4. **If >1 page:** cut the lowest-relevance content (see cutting rules). **If a big bottom gap:** add a relevant project / relevant coursework / the certifications line — truthful fillers only, never padding.

## ATS text-layer verification
```bash
pdftotext -layout main_<company>.pdf -   # poppler; optional but preferred
```
- Ligatures extract as real words (`efficiency`, `Snowflake`) — if a custom edit breaks this, restore the `glyphtounicode` lines.
- Email + phone appear as **literal text** (fontawesome icon glyphs are harmless noise).
- No `(cid:*)` or `�`. Reading order matches the visual (single-column, so safe).
- Posting keywords covered where truthful; genuine gaps stay visible.

## Relevance-weighted cutting (when trimming to 1 page)
Cut by **signal, not by section**. For each candidate line score: (1) relevance to THIS posting,
(2) uniqueness in the doc, (3) whether the cover letter leans on it. Cut the lowest-total first —
an older bullet that hits posting keywords beats a recent bullet that doesn't. Order of cuts:
redundant lines → low-relevance skill categories → low-relevance project → drop a whole project
before gutting Experience. Never cut the one concrete example the cover letter depends on.

## Page budget (1-page hard limit)
Roughly: Education 2 entries · Skills 5–7 category lines · Experience 2 roles (2–3 bullets, then 1) ·
Projects 2–3 (2 bullets each). If it overflows, cut; if it underflows, add a truthful item. Never
compress geometry or line-spacing to force a fit.

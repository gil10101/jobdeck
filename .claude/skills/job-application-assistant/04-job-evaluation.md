# Job Evaluation Framework

<!-- SETUP: Skill match areas and career goals are personalized by running /setup -->

## Scoring Dimensions

Evaluate each job posting against these five dimensions:

### 1. Technical Skills Match (0-100)
How well do the required/preferred skills align with the candidate's capabilities?

| Score | Meaning |
|-------|---------|
| 80-100 | Core requirements are primary skills |
| 60-79 | Most requirements match, 1-2 gaps that are learnable |
| 40-59 | Partial match, significant upskilling needed |
| 0-39 | Fundamental mismatch |

**Strong match areas:** Python (pandas/scikit-learn/PyTorch), SQL & T-SQL, ETL/ELT & dbt, AWS data stack (Glue, Athena, EMR, Kinesis, Firehose, Lambda, S3), PySpark, BigQuery, Tableau/Power BI, A/B testing & statistical modeling, data cleaning/validation
**Moderate match areas:** JavaScript/TypeScript (React/Next.js), FastAPI/Flask, Docker, GitHub Actions CI/CD, Alteryx, R, applied ML/data science, LLM app integration
**Weak match areas:** Production DBA operations (backups/replication/HA), Snowflake (limited), Kubernetes/Terraform (not on record), senior-level data-science research depth, security-clearance roles

### 2. Experience Match (0-100)
Does work history align with what they're looking for?

| Score | Meaning |
|-------|---------|
| 80-100 | Direct experience in the same domain and role type |
| 60-79 | Related experience, transferable skills clear |
| 40-59 | Adjacent experience, would need to make the case |
| 0-39 | Unrelated experience |

**Strong:** Data analytics (SQL + Tableau dashboards, data quality/validation, program reporting — NYC Aging); end-to-end data/ML projects (churn pipeline, computer vision, full-stack AI app)
**Moderate:** Data engineering (cloud/AWS + dbt + Spark from projects/coursework, less production tenure); full-stack software engineering (MetaBronx + Bertram)
**Entry-level / internship-scope:** Data scientist roles (applied ML project experience, targeting internships incl. Winter 2026); DBA/data-platform (strong SQL, limited production-admin experience)

### 3. Behavioral/Culture Fit (0-100)
Does the role and company culture match the behavioral profile?

| Score | Meaning |
|-------|---------|
| 80-100 | Culture strongly matches behavioral preferences |
| 60-79 | Mixed signals but mostly compatible |
| 40-59 | Some friction areas |
| 0-39 | Significant culture mismatch |

**Red flags to research:** Department disorganization, work dominated by maintenance over development, poor chemistry with leadership, culture mismatches. Check reviews, media coverage, LinkedIn connections, and network contacts for insider perspective.

### 4. Location & Logistics (Pass/Fail + Notes)
- Within commute range: PASS
- Remote with occasional office: PASS
- Requires relocation: FAIL (deal-breaker)
- Frequent international travel: FLAG (discuss with user)

### 5. Career Alignment & Motivation (0-100)
Does this role advance career goals and contain tasks that energize?

| Score | Meaning |
|-------|---------|
| 80-100 | Strongly aligned with career direction, clear growth path |
| 60-79 | Good role but only partially aligned with long-term goals |
| 40-59 | Decent job but doesn't build toward career goals |
| 0-39 | Dead end or backwards step |

**Career goals:**
- Land a data analyst / BI / analytics-engineering role that turns data into decisions (near-term, new-grad or FT)
- Grow into data engineering — owning pipelines and cloud data platforms (AWS + dbt + Spark)
- Deepen applied data science, primarily through internships (incl. Winter 2026) while finishing the M.S. (Aug 2026)

**Role-priority reminder (from setup):**
1. Data Analyst / BI / Analytics Engineer (strongest fit)
2. Data Engineer / Junior Data Engineer
3. Database Administrator (junior) / data-platform — honest gap on production-DBA ops
4. Data Scientist — internships only (incl. Winter 2026)

**Motivation filter:** Evaluate not just whether Gil *can* do the tasks, but whether they will *energize* him. Consider:
- Tasks that energize: building data pipelines/infra (ETL/ELT, warehousing, cloud data at scale); analytics → decisions (dashboards, metrics, stakeholder-facing analysis); applied ML/modeling
- Tasks that drain: heavy on-call/ops firefighting; pure manual/spreadsheet-only reporting with no engineering; sales/consulting-style client travel
- Non-task factors: mentorship and code review, autonomy/ownership, cross-functional collaboration, degree of learning support

**Life situation alignment:** Consider personal constraints:
- **Security**: Early-career, finishing M.S. (Aug 2026); values roles with growth and stability; U.S. citizen/PR (no sponsorship needed)
- **Flexibility**: Based in Brooklyn; NYC metro (hybrid/onsite) or fully-remote US; open to internships alongside studies
- **Professional development**: Prioritizes mentorship, code review, and a path from analytics toward data engineering

### 6. Salary Benchmark (Optional)

If the salary lookup tool is configured (`salary_data.json` exists), look up the company:
```
python salary_lookup.py "<Company Name>" --json
```

If a city is known from the posting, add `--city "<City>"` to narrow results.

Present findings as:
```
### Salary Benchmark
| Metric | Value |
|--------|-------|
| [Category] index | XX.X (+/-X.X% vs baseline) |
| Overall index | XX.X (+/-X.X% vs baseline) |
```

Interpret results relative to the baseline defined in the data file's metadata. For index-based data, higher typically means above-market compensation.

If the salary tool is not configured, skip this section.

## Output Format

Present the evaluation as:

```
## Job Fit Evaluation: [Role] at [Company]

| Dimension | Score | Notes |
|-----------|-------|-------|
| Technical Skills | XX/100 | [brief note] |
| Experience Match | XX/100 | [brief note] |
| Behavioral Fit | XX/100 | [brief note] |
| Location | PASS/FAIL | [brief note] |
| Career Alignment | XX/100 | [brief note] |

**Overall Score: XX/100** (weighted average of scored dimensions)

### Verdict: [Strong Fit / Good Fit / Moderate Fit / Weak Fit / Poor Fit]

### Key Strengths for This Role
- [bullet points]

### Gaps to Address
- [bullet points]

### Recommendation
[1-2 sentences: apply/skip/apply with caveats]

### Company Research Checklist
- [ ] Checked company website (mission, values, recent news)
- [ ] Checked review sites (Glassdoor, Jobindex, etc.)
- [ ] Checked LinkedIn for team size, recent hires, connections
- [ ] Checked media for restructuring, growth, or workplace issues
- [ ] Identified network contacts who may know the team/manager
```

## Weighting
- Technical Skills: 30%
- Experience Match: 25%
- Behavioral Fit: 15%
- Career Alignment: 30%

(Location is pass/fail, not weighted)

## Thresholds
- **Strong Fit** (75+): Definitely apply, tailor everything
- **Good Fit** (60-74): Apply, address gaps in cover letter
- **Moderate Fit** (45-59): Consider carefully, discuss with user
- **Weak Fit** (30-44): Probably skip unless strategic reasons
- **Poor Fit** (<30): Skip

## Pre-Application: Call the Employer (Best Practice)

Before writing the application, consider whether the candidate should call the contact person listed in the posting. **Only call if there are substantive questions** - never call just to "be remembered."

### When to Suggest Calling
- The posting has unclear or ambiguous requirements
- It's unclear which competencies are essential vs. nice-to-have
- The role description is vague about day-to-day tasks
- There's a named contact person who invites questions

### Good Questions to Ask
- "What are the primary challenges in this role?"
- "How is time typically divided across the listed responsibilities?"
- "Which competencies are most critical for success in this position?"
- "What does success look like in the first 6-12 months?"

### Rules for the Call
- Prepare a 30-second "elevator pitch" about your background in case they ask
- The call's purpose is **gathering information**, not delivering a pitch
- Take notes - use what you learn to tailor the application
- Reference the conversation naturally in the cover letter ("After speaking with [name], I was especially drawn to...")

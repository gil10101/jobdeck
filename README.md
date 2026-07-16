<p align="center">
  <img src="assets/mascot/cat_note_collar.gif" alt="Pip, the courier bird" width="200">
</p>

# AI Job Search

*The job search that runs on your machine.*

A local-first desktop app that turns [Claude Code](https://claude.com/claude-code) into a full job-application pipeline: it scouts job boards against your profile, tailors a one-page résumé and cover letter per posting, verifies the compiled PDFs the way an ATS parser reads them, tracks every application, and preps you for interviews — all driven by AI agents that run on your own machine under your own Claude login.

## What this is

An Electron + React desktop app around the [Claude Agent SDK](https://docs.anthropic.com/en/api/agent-sdk). Your career data lives in a **workspace folder you choose** — a plain directory of JSON and LaTeX files the app reads and writes. Nothing about you is baked into the app; everything comes from onboarding.

The workflow, end to end:

```
 Onboard            Scout                Intake / Build           Track & Apply
    |                  |                        |                       |
    v                  v                        v                       v
 Upload a CV;      One agent run          Paste a posting or      Tracker rows with
 an agent          searches the           drop a .txt in          status colors and
 extracts your     job boards,            applications/TODO/.     Glassdoor ratings.
 profile; you      filters HARD           A build agent tailors   Apply view embeds
 review gaps       against your           résumé + cover letter,  the posting site
 and edit it.      criteria, and          compiles both to        next to your
    |              writes honest          exactly one page,       pre-filled answers.
    v              fit-scored             ATS-checks the PDF      Interview runs
 profile.json      candidates            text layer, pre-fills    build stage-
 in your           for YOUR              application answers,     specific prep
 workspace         review.               and adds a tracker row.  packs.
```

Plus an **in-app AI assistant**: it answers questions about your runs, applications, settings, and profile through a locked-down tool set, and takes a small number of actions — starting a scout, adding a profile entry, repairing a job-board CLI — each behind an explicit Approve/Deny card.

## Features

- **Onboarding wizard** — point it at your existing résumé/LinkedIn export; an agent extracts a structured profile (identity, education, experience, projects, skills, search criteria) and surfaces what it couldn't determine as questions. You review and edit everything in a structured editor before it's saved to `profile.json`.
- **Scout runs** — an agent searches the enabled job boards (personalized jobright feed, LinkedIn public listings, freehire) plus the open web, applies your hard filters (role, salary band, location tiers, company size, recency, deal-breakers), and writes fit-scored candidates with honest gap notes. Candidates land in a review queue — accept one to build an application, or reject it.
- **Build runs** — for each accepted posting, an agent drafts a tailored one-page résumé and cover letter in LaTeX from your master documents, compiles them (tectonic / pdflatex / xelatex / lualatex, auto-detected with a Settings override), iterates until both are exactly one page, extracts the PDF text layer to verify what an ATS parser actually sees (literal contact details, sane reading order, keyword coverage without stuffing), pre-fills common application-form answers, and adds a tracker row. Fabricating skills or experience is prohibited at the prompt level; gaps stay visible.
- **Tracker** — every application as a row with status, salary, location, links to the generated documents, and a cached Glassdoor rating per company (fetched automatically for new companies).
- **Apply view** — the posting's site embedded next to your pre-filled answers, with an experimental type-into-forms helper. Submission stays a human step by design.
- **Interview runs** — stage-specific prep from the exact documents the interviewer read, mapped to your profile's stories.
- **Assistant panel** — streaming chat with conversation history, session resume across restarts, per-reply model picker, a context-usage donut, and long-term memory notes. Read tools are free; every state-changing action requires your approval in the UI.
- **Runs view** — a live timeline for every agent run: each tool call, streamed text, errors, and end-of-run context usage. The exact prompt each run received is saved to disk for audit.
- **Library** — browse and preview everything the app has generated in your workspace.

## Architecture

```
┌────────────────────────── Electron ──────────────────────────┐
│                                                              │
│  renderer (React + zustand + Tailwind)                       │
│    views: Tracker · Scout · Intake · Runs · Library ·        │
│           Settings · Apply · Onboarding · Assistant panel    │
│                        │ typed IPC (invoke + push)           │
│  preload: thin typed bridge, contextIsolation on             │
│                        │                                     │
│  main process                                                │
│    AgentRunner ── one-shot agent runs (scout/build/          │
│    │              interview/onboard) via Agent SDK query()   │
│    AssistantSession ── streaming chat session with approval  │
│    │                   bridge and SDK session resume         │
│    stores ── tracker.json · profile.json · settings ·        │
│    │         runs · conversations (all plain files)          │
│    boards ── job-board CLI health, install, credentials,     │
│              app-side jobright feed prefetch                 │
└──────────────┬───────────────────────────┬───────────────────┘
               │                           │
        workspace folder             Claude Agent SDK
        (your data: profile,         (runs under your local
        applications/, master/,      Claude Code login)
        runs/, scout/, library/)
```

Key design decisions:

- **Typed IPC contract.** Every main↔renderer channel is declared once in `app/src/shared/ipc.ts`; handlers and callers are type-checked against it, and push events follow the same contract.
- **Deterministic data plane, LLM judgment plane.** Anything that talks to a rate-limited third party is done by the app, not the agent. The personalized jobright feed is fetched app-side once per scout and handed to the agent as a file; the agent judges fit but physically cannot generate API traffic. The zero-auth board CLIs enforce cross-process request pacing and short-lived response caches, so even a misbehaving agent cannot produce burst traffic.
- **Credential hygiene.** Job-board passwords are encrypted with the OS keychain (Electron `safeStorage`) and stored in app data — never in the workspace, never in plaintext. They are decrypted only into single app-spawned CLI processes; agent processes get a revocable session token at most.
- **Approval-gated agent actions.** The assistant's tool server exposes reads freely; every mutation (profile writes, starting runs, installing CLIs or the bun runtime) round-trips through an Approve/Deny card in the UI. The assistant's Claude session is restricted to that tool server — no shell, no file access.
- **Auditable prompts.** Every agent prompt is a template in `app/resources/prompts/`, filled from your profile at run time, and the exact rendered prompt is saved with each run.
- **Self-contained board CLIs.** The search CLIs are small [bun](https://bun.sh) scripts bundled with the app and scaffolded into your workspace on setup — installable and repairable from Settings (or by the assistant, with approval) without any network download.

## Requirements

- **[Claude Code](https://claude.com/claude-code)** installed and logged in — agent runs execute under your Claude subscription via the Agent SDK; the app shows token/context usage, and nothing is billed per-run beyond your plan.
- **Node.js 20+ and npm** (to run the app in development).
- **[bun](https://bun.sh)** — runs the job-board search CLIs. Auto-detected (including version-manager installs); Settings offers a one-click install if missing.
- **A LaTeX engine** — [tectonic](https://tectonic-typesetting.github.io) (single binary, recommended) or any TeX distribution providing pdflatex/xelatex/lualatex. Auto-detected, with a manual path override in Settings.
- Optional: `pdftotext` from [poppler](https://poppler.freedesktop.org/) for the ATS text-layer check (the check degrades gracefully without it).

## Getting started

```bash
git clone https://github.com/gil10101/jobdeck
cd jobdeck/app
npm install
npm run dev
```

First launch opens the onboarding wizard:

1. **Choose a workspace folder** — any directory; the app scaffolds it (including the board CLIs).
2. **Add your source material** — upload your current résumé/CV (PDF), paste text, or both.
3. **Review the extracted profile** — answer the gaps the extractor flagged, adjust anything in the structured editor, save.

Then configure **Settings → Job boards** (jobright credentials if you use it; LinkedIn and freehire need none) and run your first scout from the Scout view.

A starter master-résumé template lives at `cv/main_example.tex` — a plain-`article`, single-column, ATS-safe one-pager. Drop your filled-in version into your workspace's `master/` folder and build runs will tailor from it; without one, the build agent constructs the layout from the same spec.

## Configuration

Everything lives in **Settings**:

- **Agent runs** — model override (aliases or pinned versions), max turns per run, concurrent runs, live text streaming.
- **Job boards** — per-board enable toggles, install status with one-click repair, jobright credentials (keychain-encrypted) and connection test, bun runtime detection/install, Glassdoor rating backfill.
- **Candidate profile** — the structured profile editor, and profile refinement runs.
- **Workflow** — folder renaming on submit, the experimental apply-form typing helper.
- **Appearance** — dark/light theme.

## Data & privacy

- **Local-first**: your profile, applications, generated documents, run transcripts, and assistant conversations are plain files in your chosen workspace folder. The app phones nothing home.
- **What leaves your machine**: agent runs send their prompts (which include relevant profile data) to Anthropic through your own Claude login, exactly like using Claude Code directly; scout runs and the rating lookup query the job boards / search from your IP.
- **Job-board access is personal-use**: the CLIs use your own accounts and public endpoints, deliberately rate-limited to human-scale traffic. Keep volume low; respect each site's terms.

## Repository layout

```
app/                  the Electron app
  src/main/           main process: agent runner, assistant, stores, boards, IPC
  src/preload/        typed IPC bridge
  src/renderer/       React UI
  src/shared/         IPC contract + types shared across processes
  resources/prompts/  agent prompt templates (filled from your profile)
  resources/skills/   bundled job-board CLIs (scaffolded into workspaces)
.agents/skills/       source of truth for the job-board CLIs
cv/                   starter master-résumé template (main_example.tex)
cover_letters/        LaTeX cover-letter class + fonts (manual-use heritage)
assets/mascot/        Pip
```

## Acknowledgements

- This project grew out of [Mads Lorentzen's ai-job-search](https://github.com/MadsLorentzen/ai-job-search) — a CLAUDE.md-driven job-application framework for Claude Code. The desktop app reimplements that workflow as a standalone application.
- [Mikkel Krogholm](https://github.com/mikkelkrogsholm) ([skills repo](https://github.com/mikkelkrogsholm/skills)) for the original job-search CLI skill pattern.


## License

MIT

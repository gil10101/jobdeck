<p align="center">
  <img src="assets/mascot/cat_note_collar.gif" alt="mascot" width="200">
</p>

# ohmo

*The job search that runs on your machine.*

A local-first desktop app built on [Claude Code](https://claude.com/claude-code): it scouts job boards against your profile, tailors a one-page résumé and cover letter per posting, verifies the compiled PDFs the way an ATS parser reads them, tracks every application, and preps you for interviews — all driven by AI agents that run on your own machine under your own Claude login.

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

Plus an **in-app AI assistant**: it answers questions about your runs, applications, settings, profile, and synced email through a locked-down tool set, and takes a small number of actions — starting a scout, rebuilding a dead run, editing your profile, repairing a job-board CLI — each behind an explicit Approve/Deny card.

## Features

- **Onboarding wizard** — point it at your existing résumé/LinkedIn export; an agent extracts a structured profile (identity, education, experience, projects, skills, search criteria) and surfaces what it couldn't determine as questions. You review and edit everything in a structured editor before it's saved to `profile.json`.
- **Scout runs** — an agent searches the enabled job boards (personalized jobright feed, LinkedIn public listings, freehire) plus the open web, applies your hard filters (role, salary band, location tiers, company size, recency, deal-breakers), and writes fit-scored candidates with honest gap notes. Candidates land in a review queue — accept one to build an application, or reject it. Internships are tagged in the queue.
- **Custom company boards** — add any company's Greenhouse, Lever, or Ashby board by URL; the app prefetches its openings itself (exact-host allowlist, sanitized rows) and hands them to scouts as data.
- **Scout history** — every past scout with what it kept and what it excluded (with the reason per posting), rerunnable with the original instructions, plus a composer that turns structured filter picks (sources, work model, salary range, and more) into the next scout's instructions.
- **Intake** — the build queue. Paste a posting, drop screenshots, drag in a `.txt`, or paste just a URL — the app extracts the posting from the page's structured data. Organize items into folders with icons, drag-and-drop between them, build one or build all, and open a details slide-over per item.
- **Build runs** — for each accepted posting, an agent drafts a tailored one-page résumé and cover letter in LaTeX from your master documents, compiles them (tectonic / pdflatex / xelatex / lualatex, auto-detected with a Settings override), iterates until both are exactly one page, extracts the PDF text layer to verify what an ATS parser actually sees (literal contact details, sane reading order, keyword coverage without stuffing), pre-fills common application-form answers, and adds a tracker row. Fabricating skills or experience is prohibited at the prompt level; gaps stay visible. Failed or cancelled builds are rebuildable in one click with their original input.
- **Tracker** — every application as a row with status, salary, location, quick-open posting links, links to the generated documents, and a cached Glassdoor rating per company (fetched automatically for new companies).
- **Per-application chat** — each application's detail view has a revision chat whose agent works directly inside that application's folder (and nowhere else): "tighten the summary", "recompile", "the form asks X — draft an answer". Document edits apply immediately and recompile to exactly one page; new Q&A answers are drafted in chat first and only appended after you approve.
- **Apply view** — the posting's site embedded next to your pre-filled answers, with an experimental type-into-forms helper. Submission stays a human step by design.
- **Interview runs** — stage-specific prep from the exact documents the interviewer read, mapped to your profile's stories.
- **Email** — connect Gmail read-only with your own OAuth client (paste the ID or upload the client JSON). The app polls for job-search mail, classifies it (assessment, interview, offer, rejection, confirmation, recruiter — including by ATS/assessment sender domains), and suggests tracker status updates you apply or dismiss (optional auto-apply for status flips). Job, Primary, and All inbox filters plus your own layer: star, hide (hidden means hidden everywhere, including from the assistant), and tags with inline creation. Links in bodies are clickable.
- **Browser** — an embedded browser with tabs, split view (two independent panes, each with its own toolbar and history sidebar), bookmarks, and browsing history. Logins are shared with the Apply view. The **Build button** turns the listing you are looking at into a queued build — the page you see is parsed for its posting, filed into Intake, and sent through the normal build pipeline without copy-paste.
- **Assistant panel** — streaming chat with conversation history, session resume across restarts, per-reply model picker, a context-usage donut, long-term memory notes, and a draggable expanded window. It can search your synced email (read-only), diagnose scout/board failures, start scouts, rebuild dead builds, and edit your profile through natural language — every state-changing action behind an Approve/Deny card.
- **Who I am** — one tab showing everything the agents know about you: the full profile, master-résumé context, and knowledge base, with an in-tab section editor. The knowledge base holds background-only material (transcripts, notes, files) agents may use for judgment and answers but never place on a résumé or cover letter.
- **Runs view** — a live timeline for every agent run: each tool call, streamed text, errors, and end-of-run context usage. The exact prompt each run received is saved to disk for audit.
- **Library** — browse and preview everything the app has generated in your workspace.

## Architecture

```
┌────────────────────────── Electron ──────────────────────────┐
│                                                              │
│  renderer (React + zustand + Tailwind)                       │
│    views: Tracker · Scout · History · Intake · Runs ·        │
│           Email · Browser · Library · Who I am · Settings ·  │
│           Apply · Onboarding · Assistant + detail chats      │
│                        │ typed IPC (invoke + push)           │
│  preload: thin typed bridge, contextIsolation on             │
│                        │                                     │
│  main process                                                │
│    AgentRunner ── one-shot agent runs (scout/build/          │
│    │              interview/onboard) via Agent SDK query()   │
│    AssistantSession ── streaming chat session with approval  │
│    │                   bridge and SDK session resume; reused │
│    │                   by per-application detail chats       │
│    stores ── tracker.json · profile.json · settings ·        │
│    │         runs · conversations (all plain files)          │
│    boards ── job-board CLI health, install, credentials,     │
│    │         app-side jobright feed + custom-board prefetch  │
│    email ── Gmail OAuth (PKCE loopback), poll sync,          │
│             classification, tracker suggestions              │
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

- **[Claude Code](https://claude.com/claude-code)** installed and logged in — agent runs execute under your Claude subscription via the Agent SDK; the app shows token/context usage, and nothing is billed per-run beyond your plan. The CLI is still required when the model provider is Gemini or Ollama — it runs the agent loop either way; only the model calls are redirected.
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

Then configure **Settings → Job boards** (jobright credentials if you use it; LinkedIn and freehire need none) and run your first scout from the Scout view. Optionally connect Gmail under **Settings → Email** with your own Google OAuth client to get inbox classification and tracker status suggestions.

A starter master-résumé template lives at `cv/main_example.tex` — a plain-`article`, single-column, ATS-safe one-pager. Drop your filled-in version into your workspace's `master/` folder and build runs will tailor from it; without one, the build agent constructs the layout from the same spec.

## Configuration

Everything lives in **Settings**:

- **Model provider** — which backend powers every agent: **Claude** (default, your Claude Code auth), **Gemini** (bring your own API key, keychain-encrypted), or **Ollama** (local server URL + model + context window). Gemini and Ollama run through a local loopback shim that speaks the Anthropic Messages API to the Agent SDK and translates streaming + tool calls to the backend's wire format — conversations keep their full context when you switch, because SDK session transcripts live on disk and replay through whichever backend is active. A Test button validates key/model/URL with one tiny request. Notes: tool-calling quality varies by model (Claude models are tuned for this harness), web search is unavailable off-Anthropic (Glassdoor rating lookups degrade to "not found"), and Ollama models must be tool-capable.
- **Agent runs** — model override (aliases or pinned versions; Claude provider only), max turns per run, concurrent runs, live text streaming.
- **Job boards** — per-board enable toggles, install status with one-click repair, jobright credentials (keychain-encrypted) and connection test, custom Greenhouse/Lever/Ashby company boards, bun runtime detection/install, Glassdoor rating backfill.
- **Email (Gmail)** — bring your own Google OAuth client (paste the client ID/secret or upload the downloaded JSON), sign in read-only, set the poll interval, and choose whether status suggestions auto-apply.
- **Candidate profile** — the structured profile editor, profile refinement runs, master-résumé context, and the knowledge base.
- **Workflow** — folder renaming on submit, the experimental apply-form typing helper.
- **Appearance** — dark/light theme, sidebar tab toggles, draggable panel dividers.

## Data & privacy

- **Local-first**: your profile, applications, generated documents, run transcripts, and assistant conversations are plain files in your chosen workspace folder. The app phones nothing home.
- **What leaves your machine**: agent runs send their prompts (which include relevant profile data) to Anthropic through your own Claude login, exactly like using Claude Code directly; scout runs and the rating lookup query the job boards / search from your IP; the email feature talks directly to Google's Gmail API with your own OAuth client.
- **Email stays yours**: Gmail access is read-only scope through an OAuth client you create; the refresh token and client secret are encrypted with the OS keychain, message headers are cached locally with owner-only file permissions, and signing out wipes the cache. Email content is treated as untrusted third-party data everywhere agents can see it.
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

## Roadmap

- **More model providers** (OpenAI-compatible APIs, Qwen endpoints): Gemini and Ollama shipped via the built-in translation shim (see Configuration → Model provider); the same shim can grow additional backends. Tool-calling fidelity varies by model, so each new backend needs validation against the approval-gated agent flows before it's wired in.

## Acknowledgements

- This project grew out of [Mads Lorentzen's ai-job-search](https://github.com/MadsLorentzen/ai-job-search) — a CLAUDE.md-driven job-application framework for Claude Code. The desktop app reimplements that workflow as a standalone application.
- [Mikkel Krogholm](https://github.com/mikkelkrogsholm) ([skills repo](https://github.com/mikkelkrogsholm/skills)) for the original job-search CLI skill pattern.


## License

MIT

<p align="center">
  <img src="assets/mascot/cat_note_collar.gif" alt="mascot" width="200">
</p>

# ohmo

*The job search that runs on your machine.*

A local-first desktop app built on the [Claude Agent SDK](https://docs.anthropic.com/en/api/agent-sdk): it scouts job boards against your profile, tailors a one-page résumé and cover letter per posting, verifies the compiled PDFs the way an ATS parser reads them, tracks every application, and preps you for interviews — all driven by AI agents that run on your own machine.

**You do not need an Anthropic account.** The agents can run on Claude (your own Claude Code login), on Gemini (your own API key), or entirely on a **local Ollama model** with nothing sent to any model provider at all. The provider is a first-class choice: you pick it during first-run setup and can change it any time in Settings. The honest caveat: tool-calling quality varies by model — Claude models are tuned for this harness — and an Ollama model must be tool-capable to work here at all. See [Requirements](#requirements).

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
- **Calendar** — a top-level view for the time-bound half of a search. Interview invites are lifted out of synced mail: `.ics` attachments are parsed (a `METHOD:CANCEL` reply dismisses the event; a re-send with the same UID replaces it), and invites written as plain text in the body are detected as well. Every extracted event arrives as a **proposal** you approve or dismiss — the sidebar badges how many are waiting — so nothing lands in your calendar unasked. Approved events show in a month grid plus upcoming/past lists with a countdown, the company, and a Join button for the meeting link; you can also add and edit entries by hand. Desktop reminders fire the day before and a configurable 5–240 minutes before the start, and clicking one raises the app on the Calendar tab.
- **Browser** — an embedded browser with tabs, split view (two independent panes, each with its own toolbar and history sidebar), bookmarks, and browsing history. Logins are shared with the Apply view. The **Build button** turns the listing you are looking at into a queued build — the page you see is parsed for its posting, filed into Intake, and sent through the normal build pipeline without copy-paste.
- **Assistant panel** — streaming chat with conversation history, session resume across restarts, per-reply model picker, a context-usage donut, long-term memory notes, and a draggable expanded window. It can search your synced email (read-only), diagnose scout/board failures, start scouts, rebuild dead builds, and edit your profile through natural language — every state-changing action behind an Approve/Deny card.
- **Who I am** — one tab showing everything the agents know about you: the full profile, master-résumé context, and knowledge base, with an in-tab section editor. The knowledge base holds background-only material (transcripts, notes, files) agents may use for judgment and answers but never place on a résumé or cover letter.
- **Profile module export/import** — every section header in the profile editor (Identity, Experience, Skills, Job search, Tailoring, Documents, …) carries its own download/upload pair, in Settings → Candidate profile and in Who I am's edit mode. Export writes that one saved section as a small versioned JSON envelope (`identity.module.json` and friends: schema id, module name, schema version, data). Import validates the file through the same schema path a whole profile takes — a payload that isn't recognizably that module is refused, not merged — then shows Current vs Incoming side by side; nothing touches `profile.json` until you hit Apply.
- **Workspace export/import** — **Settings → Workspace data → Export workspace…** packs the entire workspace (profile, tracker, applications, generated documents, runs, library) into a zip carrying a `manifest.json` that lists every file with its size and SHA-256. **Import an export…** on the setup screen re-hashes every entry against that manifest before writing and aborts the whole import on any mismatch, so a truncated or tampered archive can't half-restore. Two things to know: the export deliberately leaves credentials out (see [SECURITY.md](SECURITY.md) for exactly what the filter catches — your board passwords, Gmail tokens and API keys live in the OS keychain outside the workspace and never travel), and import requires an **empty destination folder**, into which it writes a `workspace/` directory. Importing over a workspace the app already has open takes effect on the next launch.
- **Runs view** — a live timeline for every agent run: each tool call, streamed text, errors, and end-of-run context usage. The exact prompt each run received is saved to disk for audit.
- **Library** — browse and preview everything the app has generated in your workspace.

## Architecture

```
┌────────────────────────── Electron ──────────────────────────┐
│                                                              │
│  renderer (React + zustand + Tailwind)                       │
│    views: Tracker · Scout · History · Intake · Runs ·        │
│           Email · Calendar · Browser · Library · Who I am ·  │
│           Settings · Apply · Onboarding · Assistant + chats  │
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
│    │        classification, tracker suggestions              │
│    calendar ── ICS/plain-text invite extraction, approval    │
│                state, desktop reminder loop                  │
└──────────────┬───────────────────────────┬───────────────────┘
               │                           │
        workspace folder             Claude Agent SDK
        (your data: profile,         (agent loop always local;
        applications/, master/,      model calls go to Claude,
        runs/, scout/, library/)     Gemini, or Ollama via shim)
```

Key design decisions:

- **Typed IPC contract.** Every main↔renderer channel is declared once in `app/src/shared/ipc.ts`; handlers and callers are type-checked against it, and push events follow the same contract.
- **Deterministic data plane, LLM judgment plane.** Anything that talks to a rate-limited third party is done by the app, not the agent. The personalized jobright feed is fetched app-side once per scout and handed to the agent as a file; the agent judges fit but physically cannot generate API traffic. The zero-auth board CLIs enforce cross-process request pacing and short-lived response caches, so even a misbehaving agent cannot produce burst traffic.
- **Credential hygiene.** Job-board passwords are encrypted with the OS keychain (Electron `safeStorage`) and stored in app data — never in the workspace, never in plaintext. They are decrypted only into single app-spawned CLI processes; agent processes get a revocable session token at most.
- **Approval-gated agent actions.** The assistant's tool server exposes reads freely; every mutation (profile writes, starting runs, installing CLIs or the bun runtime) round-trips through an Approve/Deny card in the UI. The assistant's agent session — whichever provider backs it — is restricted to that tool server — no shell, no file access.
- **Auditable prompts.** Every agent prompt is a template in `app/resources/prompts/`, filled from your profile at run time, and the exact rendered prompt is saved with each run.
- **Self-contained board CLIs.** The search CLIs are small [bun](https://bun.sh) scripts bundled with the app and scaffolded into your workspace on setup — installable and repairable from Settings (or by the assistant, with approval) without any network download.

## Requirements

### Always required, whichever provider you choose

- **The Claude Code agent runtime.** This is the binary the Agent SDK spawns to run the agent loop — tools, turns, transcripts. It is an npm dependency (`@anthropic-ai/claude-agent-sdk-<platform>-<arch>`), so `npm install` in `app/` fetches it; a `claude` on your PATH is *not* a substitute, and the setup preflight reports it missing when no build exists for your platform/arch. It is required under **every** provider, because the provider only changes where *model calls* go: Gemini and Ollama are reached by pointing the same runtime at a local shim. Removing an Anthropic account from the picture does not remove this runtime.
- **Node.js 22.18+ (or 24+) and npm.** There is no packaged installer yet — you run the app from source (`npm run dev`), so Node is required to use it, not only to develop it. The self-tests execute TypeScript directly, which Node runs without a flag from 22.18 and 23.6 onward; that is the floor.
- **[bun](https://bun.sh)** — runs the job-board search CLIs. Auto-detected (including version-manager installs); Settings offers a one-click install if missing.
- **A LaTeX engine** — [tectonic](https://tectonic-typesetting.github.io) (single binary, recommended) or any TeX distribution providing pdflatex/xelatex/lualatex. Auto-detected, with a manual path override in Settings.
- Optional: `pdftotext` from [poppler](https://poppler.freedesktop.org/) for the ATS text-layer check (the check degrades gracefully without it).

### Required by your model provider — one of these, not all

| Provider | What it needs | Notes |
| --- | --- | --- |
| **Claude** (default) | A [Claude Code](https://claude.com/claude-code) sign-in — run `claude` in a terminal and finish the login — **or** an `ANTHROPIC_API_KEY` in the environment. | Runs execute under your subscription; the app shows token/context usage and nothing is billed per-run beyond your plan. A sign-in and a key are alternatives: with a subscription login detected, the key is dropped from agent processes so a stray key cannot be billed instead. On macOS the login may live in the keychain, where the preflight cannot see it — it then reports "unconfirmed", not "signed out". |
| **Gemini** | A Google AI Studio **API key** (stored keychain-encrypted) and a model. | No Anthropic account of any kind. |
| **Ollama** | A reachable **Ollama server** (default `http://127.0.0.1:11434`) and a **tool-capable model** pulled on it. | No Anthropic account, no API key, no network egress to a model provider. The model picker marks tool support and each model's context ceiling; a model without tool support cannot drive this app. An optional ollama.com key unlocks cloud models. |

A **Claude sign-in is required only for the Claude provider.** Under Gemini or Ollama the app never needs Anthropic credentials — but it still needs the agent runtime above.

Two things worth knowing before going fully local:

- **Tool-calling quality varies by model.** Claude models are tuned for this harness; third-party models get extra prompt discipline and, under Ollama, the subagent-spawning tools are withheld outright because local models hallucinate their arguments. Expect to try a few models.
- **Web search needs Gemini.** Local models have no search. If a Gemini API key is saved, search sub-requests execute through Gemini's Google Search grounding *even under the Ollama provider* (Glassdoor rating lookups included). Without any key, agents get an explicit "search unavailable" result rather than silently failing — scout runs lean on the job-board CLIs, which need no key.

## Getting started

```bash
git clone https://github.com/gil10101/ohmo
cd ohmo/app
npm install
npm run dev
```

First launch opens the onboarding wizard:

1. **Choose a workspace folder** — any directory; the app scaffolds it (including the board CLIs).
2. **Choose your model provider** — Claude, Gemini, or Ollama, with the same key/URL/model fields and Test button Settings has. The setup screen lists what the provider you picked actually requires and what is missing, so an Ollama-only user is never blocked on a Claude sign-in they do not need. Provider settings live in the workspace, which is why this step comes after the folder — and why you can change your mind later in **Settings → Model provider** without redoing setup.
3. **Add your source material** — upload your current résumé/CV (PDF), paste text, or both.
4. **Review the extracted profile** — answer the gaps the extractor flagged, adjust anything in the structured editor, save.

Step 3 already runs an agent, so the provider must be usable by then — that is the point of step 2.

Then configure **Settings → Job boards** (jobright credentials if you use it; LinkedIn and freehire need none) and run your first scout from the Scout view. Optionally connect Gmail under **Settings → Email** with your own Google OAuth client to get inbox classification and tracker status suggestions.

A starter master-résumé template lives at `cv/main_example.tex` — a plain-`article`, single-column, ATS-safe one-pager. Drop your filled-in version into your workspace's `master/` folder and build runs will tailor from it. The build agent looks for exactly two filenames there, in order: `<FileBasename>_Resume.tex` (the sanitized output stem from your profile — `Jane_Doe_Resume.tex`) and `main_example.tex`. With neither present it constructs the layout from the same spec instead.

## Configuration

Everything lives in **Settings** (the model provider is also the second step of
first-run setup, since agent runs start before onboarding is finished):

- **Model provider** — the same choice first-run setup offered, changeable at any time: which backend powers every agent — **Claude** (default, your Claude Code sign-in or `ANTHROPIC_API_KEY`), **Gemini** (bring your own API key, keychain-encrypted), or **Ollama** (local server URL + model + context window; an optional ollama.com API key unlocks cloud models, marked "cloud" in the picker, and the model hint shows each model's context ceiling and tool support). Gemini and Ollama run through a local loopback shim that speaks the Anthropic Messages API to the Agent SDK and translates streaming + tool calls to the backend's wire format — conversations keep their full context when you switch, because SDK session transcripts live on disk and replay through whichever backend is active. A Test button validates key/model/URL with one tiny request. Web search keeps working off-Anthropic: search requests execute through Gemini's Google Search grounding whenever a Gemini key is saved — under the Ollama provider too, so a local model plus a Gemini key still searches the web (rating lookups included). Without a key, agents get an explicit "search unavailable" result instead of silent failure. Notes: tool-calling quality varies by model (Claude models are tuned for this harness), and Ollama models must be tool-capable.
- **Agent runs** — model override (aliases or pinned versions; Claude provider only), max turns per run, concurrent runs, live text streaming.
- **Job boards** — per-board enable toggles, install status with one-click repair, jobright credentials (keychain-encrypted) and connection test, custom Greenhouse/Lever/Ashby company boards, bun runtime detection/install, Glassdoor rating backfill.
- **Email (Gmail)** — bring your own Google OAuth client (paste the client ID/secret or upload the downloaded JSON), sign in read-only, set the poll interval, and choose whether status suggestions auto-apply. Desktop notifications (new interview/assessment/offer mail plus calendar reminders) and the reminder lead time in minutes live here too.
- **Candidate profile** — the structured profile editor, profile refinement runs, master-résumé context, and the knowledge base.
- **Workflow** — folder renaming on submit, the experimental apply-form typing helper.
- **Appearance** — dark/light theme, sidebar tab toggles, draggable panel dividers.

## Data & privacy

- **Local-first**: your profile, applications, generated documents, run transcripts, and assistant conversations are plain files in your chosen workspace folder. There is no telemetry, no analytics, and no update check — this project operates no server and receives nothing about you.
- **What leaves your machine**, in full:
  - agent runs send their prompts (which include relevant profile data) to whichever provider you chose: Anthropic through your own Claude login, exactly like using Claude Code directly; Google, under the Gemini provider; or **nowhere off your machine** under Ollama pointed at a local server — model calls then stay on localhost, and only web-search sub-requests (if you saved a Gemini key) and the job-board CLIs reach the network;
  - scout runs and the Glassdoor rating lookup query the job boards and search engines from your IP;
  - the email feature talks directly to Google's Gmail API with your own OAuth client;
  - the **Browser view fetches favicons from a third party**: every open tab, bookmark row and history row requests `https://icons.duckduckgo.com/ip3/<hostname>.ico`. That sends the *hostname* of each of those pages to DuckDuckGo (nothing else — no path, no query, no page content), and it is the only remote host the renderer's content-security policy allows to serve images. The Apply and Browser `<webview>`s themselves load real sites, so those sites see you as an ordinary visitor.
- **Agent transcripts are files too**: the Claude Agent SDK stores each run's conversation as plain `.jsonl` under `~/.claude/projects/`, outside your workspace — under **every** provider, since the same runtime drives the loop even when the model is local. Anything an agent read — posting text, and Gmail message bodies when you ask the assistant to open one or draft a reply — is in there. See [SECURITY.md](SECURITY.md).
- **Email stays yours**: Gmail access is read-only scope through an OAuth client you create; the refresh token and client secret are encrypted with the OS keychain, message headers and snippets (never bodies) are cached locally with owner-only file permissions, and signing out wipes the cache. Email content is treated as untrusted third-party data everywhere agents can see it. Calendar entries are derived facts (title, time, location, meeting link) held under the same owner-only permissions — message bodies are never copied into them, and no calendar service is contacted.
- **Job-board access is personal-use**: the CLIs use your own accounts and public endpoints, deliberately rate-limited to human-scale traffic. Keep volume low; respect each site's terms.

## Repository layout

```
app/                  the Electron app
  src/main/           main process: agent runner, assistant, stores, boards,
                      email, calendar, IPC
  src/preload/        typed IPC bridge
  src/renderer/       React UI
  src/shared/         IPC contract + types shared across processes
  resources/prompts/  agent prompt templates (filled from your profile)
  resources/skills/   bundled job-board CLIs (scaffolded into workspaces)
.agents/skills/       source of truth for the job-board CLIs
cv/                   starter master-résumé template (main_example.tex)
cover_letters/        standalone LaTeX reference: cover.cls (fontspec-based, so
                      xelatex/lualatex only), an example letter using it, and
                      the Lato/Raleway fonts it loads by relative path. No code
                      path reads any of it — build runs write a self-contained
                      `article` cover letter matching the résumé's font
assets/mascot/        mascot GIFs
```

`assets/mascot/cat_note_collar.gif` was added here as this app's mascot and is
the header image at the top of this file. `pip_flight_loop.gif` is Pip, the
courier bird, carried over from the upstream `ai-job-search` project (see
[Acknowledgements](#acknowledgements)); nothing in this repo references it.

## Roadmap

- **More model providers** (OpenAI-compatible APIs, Qwen endpoints): Gemini and Ollama shipped via the built-in translation shim (see Configuration → Model provider); the same shim can grow additional backends. Tool-calling fidelity varies by model, so each new backend needs validation against the approval-gated agent flows before it's wired in.

## Acknowledgements

- This project grew out of [Mads Lorentzen's ai-job-search](https://github.com/MadsLorentzen/ai-job-search) — a CLAUDE.md-driven job-application framework for Claude Code. The desktop app reimplements that workflow as a standalone application.
- [Mikkel Krogsholm](https://github.com/mikkelkrogsholm) ([skills repo](https://github.com/mikkelkrogsholm/skills)) for the original job-search CLI skill pattern.


## License

MIT — see [LICENSE](LICENSE).

Bundled third-party assets keep their own licenses: the Lato fonts under
`cover_letters/OpenFonts/fonts/` are distributed under the
[SIL Open Font License 1.1](https://openfontlicense.org/).

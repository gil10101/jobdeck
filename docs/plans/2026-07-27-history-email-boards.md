# Workstreams: Scout History · Gmail · Custom Boards · Browser & Panel UX

Design doc + running log. Subagent completion notes append to §7. Sequencing:
Team A (history) and Team B (browser/panel UX) run first in parallel; email
starts when Team A is near done; custom boards last.

## 1. Issues & probable causes

**I1 — Popups dead in every embedded browser surface.** `installWebviewHardening`
(`app/src/main/window.ts`) sets a webview `setWindowOpenHandler` that denies all
popups and `loadURL`s the popup URL in place. OAuth flows (Google sign-in on
jobright/LinkedIn/etc.) require a real child window whose JS can talk back to
its opener and self-close; in-place navigation both breaks the flow and
destroys the page being applied on. The `<webview>` tags also lack the
`allowpopups` attribute, so `window.open` may not even reach the handler.

**I2 — Scout instructions are write-only.** Instructions live only in the Scout
view textbox; past runs' instructions, fetched postings, and drop reasoning are
not browsable, and reruns require retyping. Data gaps: run inputs are persisted
(`runs/<id>.input.json`, since the rebuild feature) and kept candidates land in
`scout/<id>.candidates.json`, but **dropped postings and their reasons are not
captured** — the scout output schema has no `excluded` list.

**I3 — Email context lives outside the app.** Application confirmations,
interview/assessment invites arrive in Gmail; checking them means window
switching, and tracker statuses are updated by hand.

**I4 — Board set is fixed.** jobright/linkedin/freehire only; no way to add a
specific company's careers board.

**I5 — Right sidebars are fixed-width and unhideable** in the Apply view and
the Detail view; no divider drag (Scout view already has one to copy).

## 2. Decisions (user-confirmed 2026-07-27)

- Email updates by **polling** (3–5 min, configurable) + manual refresh. True
  webhooks rejected: Gmail push needs a public Pub/Sub endpoint (hosted server)
  — wrong shape for a local-first app.
- Gmail auth is **BYO OAuth client ID** (user creates a Google Cloud project,
  enables Gmail API, Desktop-type OAuth client; Settings documents the steps).
  Read-only scope `gmail.readonly`. PKCE loopback flow (no client secret).
  Tokens keychain-encrypted like board credentials (`safeStorage`).
- Email tab shows **job-search-related mail** (confirmations, interview/OA/
  meeting invites, recruiter messages) with an all-recent toggle; assistant +
  detail chat get **read-only** email tools; email classification proposes
  **tracker status updates as one-click suggestions** (auto-apply behind an
  off-by-default setting — status flips from heuristic/LLM classification are
  too consequential to silently apply).
- Custom boards: **ATS public APIs only** — Greenhouse
  (`boards-api.greenhouse.io/v1/boards/<slug>/jobs?content=true`), Lever
  (`api.lever.co/v0/postings/<slug>?mode=json`), Ashby
  (`api.ashbyhq.com/posting-api/job-board/<slug>`). Slug auto-detected from a
  pasted careers URL. Arbitrary HTML career sites are **declined in-UI with the
  reason** (no stable structure; per-site scrapers rot silently).

## 3. Suggested implementation

### Team A — Scout History tab
1. **Capture exclusions**: scout output schema gains
   `"excluded": [{"position","company","reason"}]` (compact, ≤40 entries;
   reasons one line, e.g. "posted max $120k > $90k ceiling"). Prompt instructs
   honest per-drop reasons at triage time. Parser (`parsers/report.ts` scout
   path / candidates-file validate) passes it through to
   `scout/<id>.candidates.json`.
2. **History IPC**: `scout:history` → per scout run: `{runId, startedAt,
   status, instructions (from input.json), summary, kept: [...candidates file],
   excluded: [...]}`. Old runs render with whatever they have.
3. **HistoryView** (new sidebar tab "History", lucide `History` icon): run list
   (left) → run detail (right): instructions block with **Rerun** button
   (`scout:start` with those instructions), kept postings (chips to Scout view
   candidates where still present), excluded list labeled **"Filtered out"**
   with reason + date.
4. **Instruction composer** (top of tab, judged sound): chip/select filters
   composing INTO the instructions string, sourced from the profile —
   employment type (`searchConfig.employmentTypes`), target titles
   (`searchConfig.targetRoles`), min/max pay (numeric), work model. Compose →
   editable text → Run. Saved automatically by run-input persistence.

### Team B — Browser & panel UX
1. **Popup fix**: add `allowpopups` to both webview surfaces; rework the
   webview `setWindowOpenHandler` to `{action:'allow'}` with
   `overrideBrowserWindowOptions` (contextIsolation on, nodeIntegration off,
   plain Chrome UA) so OAuth child windows work; keep `_blank`-to-same-page
   heuristics out. Harden child windows the same way (they are also
   web-contents-created events — ensure no recursion bugs).
2. **Browser tab**: new sidebar entry "Browser" (lucide `Globe`): standalone
   webview with the Apply view's nav bar (back/forward/reload/URL), persistent
   `partition` shared with Apply view so logins carry over, home = blank/last
   URL (store slice keeps last URL per session).
3. **Sidebar toggles**: borderless icon button (`PanelRight` lucide) — Apply
   view: right of the "↗ Browser" button; Detail view: next to "Apply →".
   Toggles the right panel; persisted in component state (not settings).
4. **Draggable dividers**: copy Scout view's divider pattern (pointer-drag,
   min/max clamps) for Apply and Detail right panels.

### Team C — Gmail (starts when A is near done)
1. `app/src/main/email/`: `gmailAuth.ts` (PKCE loopback OAuth, token store via
   `safeStorage`, refresh), `gmailClient.ts` (REST: profile, list/get messages
   with `q=`), `emailSync.ts` (poll loop w/ configurable interval, incremental
   via `historyId` when available else `after:` query; classification), 
   `emailStore.ts` (cache under app-data, headers + snippet + parsed class).
2. **Classification**: deterministic first (sender/subject regex: "application
   received", "interview", "assessment|OA|HackerRank|Codility", calendar
   invites), assistant-model optional later. Match to tracker rows by company
   name fuzzy + recency → produce `suggestion: {rowId, newStatus, emailId}`.
3. **UI**: sidebar tab "Email" (lucide `Mail`): list (job-filtered default,
   All toggle), reader pane, suggestion banners ("Mark Veeva as interview?"
   one-click), Settings section (client ID entry, sign-in/out, poll interval,
   auto-apply toggle, setup steps).
4. **Agent harness**: read-only tools `search_email`, `get_email` in the
   assistant + detail chat (approval-free reads, injection-hardened framing:
   email content is untrusted data); `where_is_setting` entry.
5. IPC: `email:status/auth/signOut/list/get/refresh/applySuggestion/dismissSuggestion`;
   pushes `push:emailChanged`, `push:emailSuggestion`.

### Team D — Custom boards (last)
1. `boards/customBoards.ts`: registry in profile `searchConfig.customBoards:
   [{id, label, ats: 'greenhouse'|'lever'|'ashby', slug, enabled}]`; slug
   detection from pasted URL patterns; fetch+normalize per ATS (title,
   location, url, postedAt, department).
2. Settings → Job boards: "Add company board" (paste careers URL → detect →
   test-fetch → save); per-board toggle rows like existing boards.
3. Scout integration: app-side prefetch (like jobright) writing
   `scout/<id>.custom-boards.json`; prompt section lists it; availability notes
   cover disabled/failed boards. Declines non-ATS URLs with the reason string.

## 4. Possible blockers
- **Popup fix vs hardening**: child windows must not gain node access —
  verify `overrideBrowserWindowOptions` webPreferences are applied to OAuth
  popups and that `web-contents-created` hardening doesn't re-deny them.
- **Gmail OAuth loopback port**: PKCE needs a localhost redirect port;
  Electron main can host a one-shot `http.Server` on an ephemeral port —
  ensure firewall prompts are acceptable on macOS.
- **historyId gaps**: Gmail incremental sync expires; fall back to
  `q=after:<ts>` full-page fetch.
- **Tracker matching false positives**: company-name fuzzy matches (agencies,
  similarly named cos) — suggestions-only default mitigates.
- **Ashby/Greenhouse/Lever schema drift**: pin to documented public endpoints,
  degrade per-board with availability notes (pattern exists).
- **Context budget**: teams run as subagents with this doc as source of truth;
  ledger lines in `.superpowers/sdd/progress.md`.

## 5. Architecture notes
- Reuse patterns: per-call path helpers (REPO_ROOT live binding), typed IPC
  contract first, push channels guarded by id, `safeStorage` cred store,
  app-side prefetch keeping agents off rate-limited APIs, availability notes in
  prompts, theme-safe classes only, lucide icons.
- Email polling lives in main (like TodoWatcher); UI is a thin reader over the
  cache; agents get tools over the same cache (no direct network from agent
  tools).
- Browser tab + Apply view share a webview `partition` ("persist:embedded") so
  one login serves both.

## 6. Explicitly out of scope / declined
- Arbitrary HTML career-site scraping (unreliable; per-site rot) — declined
  with in-UI reason when a non-ATS URL is added.
- Gmail push webhooks (needs hosted infra).
- Auto-applying tracker status changes by default (suggestions instead).

## 7. Subagent completion notes (append here)

### Team A — scout history (done 2026-07-27)

**Shipped** (commits `8e53ddd` schema+IPC, `8af9077` view):
- Scout output schema: `excluded` array (position/company/reason) with prompt
  instructions to record every triage drop honestly, cap 40, off-limits-list
  postings exempt (`app/resources/prompts/scout_jobs.md`).
- Shared tolerant candidates-file parser `parseCandidatesFile` in
  `parsers/report.ts` (fence-strip, array normalization, excluded coercion +
  cap) — used by `AgentRunner.finalizeScout` (which now also counts filtered
  drops in the run summary) and by the new IPC. The candidates file is never
  rewritten, so `excluded` persists in `scout/<id>.candidates.json` as written.
- IPC `scout:history` (`shared/ipc.ts`, `shared/types.ts` additive:
  `ScoutHistoryEntry`/`ScoutKeptItem`/`ScoutExcludedItem`; handler in
  `ipcRegistry.ts`): per scout run — instructions from `runStore.getInput`
  (fallback `''`), kept postings (condensed, no postingText), excluded list,
  counts, status/dates/summary; missing files and pre-excluded runs yield
  empty lists.
- `HistoryView.tsx`: composer (textarea + profile-sourced chips for employment
  types and target titles (max 6), static work-model chips, min-pay input;
  chips append phrases, text stays editable, `Run scout` → `scout:start` →
  toast + navigate to Runs), run list (status/date/instructions
  preview/kept·filtered counts, auto-refetch on scout run status changes),
  detail (mono instructions block + Rerun, kept list with fit pills,
  "Filtered out" muted list with reasons, View-run link).

**Deviations from spec:** none substantive. Additions: filtered count in the
scout run summary line; a View-run button in the detail header (mirrors
ScoutView's run links); Run/Rerun disabled while a scout is live (mirrors
ScoutView's guard).

**Known gaps / review risks:**
- Excluded entries are only as honest/complete as the agent's compliance; no
  ingest-time cross-check that drops were actually recorded.
- Kept lists come from the candidates FILE, i.e. what the run reported —
  not the store's post-dedupe view, so a posting can show as "kept" here yet
  have been deduped away as already-known at ingest.
- Chip phrases are plain English appended with `; ` — clicking contradictory
  chips (e.g. two "X only" phrases) composes contradictions the user must
  edit out; active-state detection is exact-substring.
- `scout:history` re-reads every candidates file per call (no cache); fine at
  personal-use scale.

**Files touched:** `app/resources/prompts/scout_jobs.md`,
`app/src/main/parsers/report.ts`, `app/src/main/agent/AgentRunner.ts`,
`app/src/shared/ipc.ts`, `app/src/shared/types.ts`,
`app/src/main/ipcRegistry.ts`, `app/src/renderer/src/views/HistoryView.tsx`.

### Team B — browser & panel UX (done 2026-07-27)

**Shipped** (commits `25c0cfc` popup fix, `a9192f6` browser tab + panels):
- Popup fix: webview `setWindowOpenHandler` now returns `{action: 'allow'}`
  with hardened `overrideBrowserWindowOptions` instead of denying and loading
  in place (which broke OAuth and destroyed the page being applied on). Both
  webview surfaces carry `allowpopups`. Chained popups (SSO account pickers)
  are adopted recursively via `did-create-window`: same handler, same plain
  Chrome UA.
- `BrowserView.tsx`: nav bar in ApplyView's style (back/forward/reload, URL
  bar with Enter-to-navigate, ↗ system-browser button), webview on the same
  `persist:apply` partition so logins are shared; last visited URL kept in
  `sessionStorage` (`browser.lastUrl`), centered type-a-URL hint when blank;
  no right sidebar.
- Panel toggles: borderless lucide `PanelRight` ghost button (assistant-panel
  style) right of "↗ Browser" in ApplyView and right of "Apply →" in
  DetailView; each toggles its right panel (local state, default visible).
- Draggable dividers (ScoutView pattern) for both right panels, clamps
  280–640px, widths persisted (`apply.panelWidth` / `detail.panelWidth`);
  divider replaces the old fixed border between panes.

**Popup-fix safety (verified):** child windows are created only through
`overrideBrowserWindowOptions.webPreferences = {contextIsolation: true,
nodeIntegration: false, sandbox: true}` plus `autoHideMenuBar: true`; no
`preload` is passed, and the app preload is only ever attached in
`createMainWindow`, so popups never see it. Electron merges override prefs
with inherited ones taking the stricter value, and the opener webview itself
has no node access. Only `https?:`/`about:blank` popup URLs are allowed. The
`web-contents-created` hardening early-returns for non-webview contents, so
popup windows (type `'window'`) are never re-denied and there is no handler
recursion. The app window's own window-open handler (renderer links →
`shell.openExternal`, deny) is untouched. Boot-smoke: the live `--watch` dev
session rebuilt `out/main/index.js` with the final handler (grep-verified)
and Electron restarted and stayed up.

**Deviations from spec:**
- `allowpopups` is passed as `{'true' as unknown as boolean}`: react-dom 18
  drops boolean-valued unknown attributes (`shouldRemoveAttributeWithWarning`),
  so the runtime value must be a string, while `@types/react`'s webview
  intrinsic types it as boolean. The repo's global JSX webview augmentation in
  `types.d.ts` is inert under `react-jsx` (types.d.ts is outside Team B's
  file set — cleanup suggested).
- Added a session-level UA override for webview sessions so a popup's first
  request predates the per-contents UA and never carries the Electron token.
- Added a full-window transparent overlay while a divider drag is live —
  webview/PDF-iframe guests swallow `mousemove`, which ScoutView (plain DOM)
  never had to handle.
- Browser tab's ↗ button keeps the "↗ Browser" label for parity with
  ApplyView.

**Known gaps / review risks:**
- OAuth not click-tested end to end (needs a human run against a real
  provider); Google can still refuse embedded logins on signals other than
  UA — the ↗ system-browser escape hatch remains.
- Popup windows are chrome-less (no nav/URL bar) — fine for self-closing
  OAuth, but a popup that never self-closes must be closed via its own UI or
  the OS window button.
- Divider drag and toggles verified by typecheck + pattern parity with
  ScoutView; not pointer-tested in this session (no CDP port on the running
  app).
- Hiding the Detail right panel unmounts the active tab component; chat
  history lives in the store and survives, but an unsent chat draft is lost.

**Files touched:** `app/src/main/window.ts`,
`app/src/renderer/src/views/ApplyView.tsx`,
`app/src/renderer/src/views/DetailView.tsx`,
`app/src/renderer/src/views/BrowserView.tsx`.

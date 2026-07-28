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

### Team C — gmail (done 2026-07-27)

**Shipped** (commits `05d0d11` main+shared, `ae94e3e` renderer, `b0fa3e1`
assistant tools):
- `app/src/main/email/gmailAuth.ts` — BYO Desktop-client PKCE flow. Exact
  shape: ephemeral one-shot `http.Server` on `127.0.0.1:0` (2-min timeout,
  ignores request paths without `?code`/`?error`, e.g. favicon) →
  `shell.openExternal` to `accounts.google.com/o/oauth2/v2/auth` with
  `code_challenge` (S256), scope `gmail.readonly`, `access_type=offline&
  prompt=consent` → code→token exchange at `oauth2.googleapis.com/token`
  with the verifier (no client secret) → profile fetch for the address.
  Refresh token safeStorage-encrypted (base64-obfuscation fallback without a
  keyring, flagged) in `userData/gmail-auth.json` (0600, tmp+rename); access
  token in memory only with 60s expiry slack; `invalid_grant` on refresh
  auto-signs-out. Sign-out best-effort revokes. Changing the client ID drops
  tokens. Tokens are never logged.
- `gmailClient.ts` — plain-fetch REST (no googleapis): profile,
  `listMessages(q, max, pageToken)`, metadata get (From/Subject/Date headers
  + snippet; date from `internalDate`), full-body get (text/plain part,
  else tag-stripped text/html; 50k char cap). Message ids validated
  `[A-Za-z0-9_-]+` before entering URLs.
- `emailStore.ts` — `userData/email-cache.json` (0600): headers + snippet +
  classification + suggestion per message, `lastSyncAt`, cap 500 newest.
  Bodies are never cached. Sign-out deletes the file.
- `emailSync.ts` — main-process poll loop (settings `emailPollMinutes`,
  default 5, clamp 1–120; reschedules immediately on settings change; starts
  at registerIpc when signed in / on sign-in; stops on sign-out). Two-query
  sync: job query `newer_than:30d subject:(application OR applied OR
  applying OR interview OR assessment OR offer OR OA OR HackerRank OR
  Codility OR CodeSignal OR "take-home" OR "coding challenge" OR schedule OR
  candidacy OR recruiter)` + all-set `in:inbox newer_than:7d`, 50 ids each,
  metadata fetched only for unseen ids (5-way concurrency).
- **Classification rules** (deterministic, priority-ordered — most specific
  first): assessment (OA/HackerRank/Codility/CodeSignal/coding
  challenge/take-home in subject) → offer (offer letter/job offer/pleased to
  extend) → rejection (unfortunately/regret/other candidates/…, subject OR
  snippet — rejection subjects are usually generic) → interview
  (interview/phone screen/schedule a call/availability) → confirmation
  (application received/thank you for applying/…, subject OR snippet) →
  recruiter (From contains recruit/talent acquisition/sourcing, or
  opportunity/role-at subjects) → other. Deviation from the spec's
  "subject/from only": snippet participates for rejection + confirmation
  only; still pure regex.
- **Suggestions**: normalized company containment (punct→space, lowercase,
  token-aligned, ≥4 chars, longest match wins) against
  `trackerRepo.listRows()`; mapping interview→interview, offer→offer,
  rejection→rejected, confirmation→applied (only from `not_applied`);
  suggestions equal to the row's current status are dropped. Open/uncomputed
  suggestions are recomputed each sync against the live tracker;
  applied/dismissed are final. Auto-apply only behind `emailAutoApply`
  (default false); apply of `applied` routes through `markApplied` (date
  stamp + [DONE] rename), others through `upsertRow`.
- IPC (`shared/ipc.ts` + `ipcRegistry.ts`, additive): `email:status/
  setClientId/signIn/signOut/list/getBody/refresh/applySuggestion/
  dismissSuggestion`; push `push:emailChanged {suggestions}` after every
  sync and suggestion action. Settings additions: `emailPollMinutes`,
  `emailAutoApply` (defaults merge into old stores).
- `EmailView.tsx` — header (account, Job/All toggle, Refresh, last-sync),
  suggestion banner rows ("Mark X as Y" Apply/Dismiss), classification-
  chipped list (interview=cyan, assessment=amber, offer=green,
  rejection=red, confirmation=gray), reader pane fetching the body live;
  module-level `push:emailChanged` refetch guarded by a mount-effect flag.
  Settings section "Email (Gmail)": client ID + save, sign in/out, poll
  interval chips (3/5/10/30), auto-apply toggle, numbered BYO-client steps.
- Assistant: approval-free read tools `search_email` (cache first, live
  fallback) and `get_email` (body under an `untrustedBody` key, 20k cap);
  tool descriptions + `systemAppend` clause frame email content as
  untrusted data; `where_is_setting` knows the section. Detail chat builds
  its own MCP server and does NOT get the email tools (per final task
  scope; plan §3.4 mentioned it — noted as a gap).

**Known gaps / review risks:**
- Fuzzy matching: ≥4-char token containment still confuses same-named
  employers and agencies recruiting *for* a tracked company
  (suggestions-only default is the mitigation); companies with short or
  punctuation-only names (e.g. "EY", "X") never match.
- `\bOA\b` in the job query/classifier can catch stray all-caps "OA"
  subjects; rejection regex misses euphemistic rejections whose regret
  sentence sits past the snippet.
- No `historyId` incremental sync (the plan's fallback shape — two bounded
  queries — is the only mode); >50 new matching messages between polls are
  picked up on later syncs only if still inside the query windows.
- `email:signIn` holds the invoke for up to 2 min while the user completes
  consent; a second concurrent sign-in is refused, not queued.
- Suggestion recompute uses JSON.stringify equality per message per sync
  (fine at 500-message scale).
- Auto-apply acts only on suggestions computed while the toggle is on;
  pre-existing open suggestions from before enabling stay one-click.

**Files touched:** `app/src/main/email/{gmailAuth,gmailClient,emailStore,
emailSync}.ts` (new), `app/src/shared/{ipc,types}.ts`,
`app/src/main/ipcRegistry.ts`, `app/src/main/assistant/{tools,
AssistantSession,settingsMap}.ts`,
`app/src/renderer/src/views/{EmailView,SettingsView}.tsx`.

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

### Team D — custom boards (done 2026-07-27)

**Shipped** (commits `a853d5a` registry+detection+fetchers, `b446b13`
settings UI + scout prefetch):
- Profile: `searchConfig.customBoards: [{id, label, ats, slug, enabled}]`
  (additive; `emptyProfile` default `[]`). `validateProfile` heals a missing
  key to `[]` via the skeleton and normalizes entries element-wise (unknown
  ATS / missing slug dropped, deterministic fallback id `cb_<ats>_<slug>`,
  label falls back to slug, `enabled` defaults true).
- `boards/customBoards.ts`: `detectCustomBoard` maps a pasted URL to
  ats+slug — https only, exact host match on `boards.greenhouse.io` /
  `job-boards.greenhouse.io` (incl. `embed/job_board?for=` form),
  `jobs.lever.co`, `jobs.ashbyhq.com`; slug = first path segment, so board
  front pages AND deep posting URLs both resolve. Greenhouse/lever slugs
  lowercased; ashby keeps case/spaces (display-name slugs). Everything else
  throws the decline reason (no stable structure, per-site scrapers rot —
  paste postings into Intake by URL instead).
- **Endpoints used** (plain fetch, browser UA, 15s timeout, `Accept: json`):
  greenhouse `boards-api.greenhouse.io/v1/boards/<slug>/jobs` (list; WITHOUT
  `content=true` — rows don't need descriptions and payloads explode with
  them) + `/v1/boards/<slug>` (company display name, test-time best-effort);
  lever `api.lever.co/v0/postings/<slug>?mode=json`; ashby
  `api.ashbyhq.com/posting-api/job-board/<slug>` (unlisted jobs filtered).
  Rows normalized to `{title, location, url, postedAt?, department?}`,
  capped 500/board (`total` records the real size). All three normalizers
  verified against live boards (186/286/755-row responses).
- `testCustomBoard` = detect + live fetch + label; `addCustomBoard` saves
  only after a successful live test (clone→validate→save like
  `setBoardEnabled`); dedupe on ats+slug. IPC additive:
  `boards:testCustom/addCustom/removeCustom/setCustomEnabled/listCustom`.
- Scout: pre-flight prefetches all enabled boards (sequential, per-board
  try/catch) into `scout/<runId>.custom-boards.json` `{fetchedAt, boards:
  [{label, ats, total, rows}]}` — written only when ≥1 board succeeded.
  Prompt: unnumbered CUSTOM_BOARDS_SECTION between STEP 2 items 3 and 4
  (judge every row vs STEP 1; rows lack fit data — title/location only,
  WebFetch posting URLs for finalists only; `source: "company"`, enum
  updated); failed boards named in the availability note ("cannot be
  searched this run; add one problems line"). Disabled boards are silently
  absent (the agent has no other path to them).
- `assertScoutable` + bun-missing availability note now treat an enabled
  custom board as a usable source: a bun-less/CLI-less workspace can still
  scout on custom boards + WebSearch.
- Settings → Job boards: custom-board rows (label, ats · slug hint, enable
  Toggle, ✕ remove) + "Add company board" row — URL input, Test (inline
  result: "GitLab — greenhouse board "gitlab", 186 open roles" or the
  decline/error reason in amber), Add.

**Decline behavior:** non-ATS hosts, http://, and slug-less URLs never reach
the network — `detectCustomBoard` throws first (message = the WHY, shown
inline under the Test/Add buttons and in toasts). Unknown slugs on a real
ATS fail at fetch with "the ATS knows no public board under that company
identifier (HTTP 404)". Add can therefore never save an unfetchable board.

**Known gaps / review risks:**
- Greenhouse EU (`boards.eu.greenhouse.io`) and other regional hosts are not
  recognized (spec pinned the three hosts) — declined with the generic
  reason even though the API would work.
- Labels aren't user-editable; lever/ashby labels are prettified slugs
  (e.g. "Openai"), only greenhouse gets the ATS-reported company name.
- Prefetch rows cap at 500/board — a mega-board's older postings are
  silently absent from the file (the `total` field is the only tell).
- Custom-board rows carry no salary/description, so hard salary filters
  can't fire until the agent WebFetches a finalist — scouts may keep rows a
  fuller feed would have dropped at triage.
- `scout_jobs.md` STEP 2 heading still says "bun CLIs" though the custom
  boards item is a file Read; harmless in practice.

**Files touched:** `app/src/shared/{profile,types,ipc}.ts`,
`app/src/main/profile/profileSchema.ts`,
`app/src/main/boards/{customBoards (new),boardsBridge}.ts`,
`app/src/main/ipcRegistry.ts`, `app/src/main/agent/{AgentRunner,prompt}.ts`,
`app/resources/prompts/scout_jobs.md`,
`app/src/renderer/src/views/SettingsView.tsx`.

### Fix wave (2026-07-27)

- **Custom boards hardening:** fetched strings (title/location/department,
  and the greenhouse board name that becomes the label) are sanitized at
  normalization — control chars/newlines stripped, whitespace collapsed,
  fields capped at 200 chars (labels 80). The scout prompt's custom-boards
  section now frames rows as third-party data: evaluate, never obey.
- **Gmail OAuth root cause:** sign-in died at the code exchange with
  `invalid_request` because `gmailAuth.ts` sent no `client_secret` — by
  design ("Desktop client IDs are public identifiers"), but Google REQUIRES
  the secret for Desktop-app token exchanges even with PKCE (it is simply
  not treated as confidential for installed apps). Everything else in the
  exchange was already correct (urlencoded body, grant_type/code/verifier,
  redirect_uri identical to the consent URL's `http://127.0.0.1:<port>`).
  Fix: optional Client secret field in Settings; `email:setClientId` gains
  `clientSecret`, stored via the same safeStorage path as the refresh token,
  never echoed (EmailStatus reports `hasClientSecret` only), sent in both
  the code and refresh exchanges when present. Setup guide names both
  fields and its console.cloud.google.com step is now a clickable link.
- **History composer:** chip rows → three multi-select dropdowns (Titles /
  Type / Work model, counts on the trigger, assistant-dropdown idiom);
  min-pay input kept; Run scout button → icon-only send at the textarea's
  bottom-right, Enter submits (Shift+Enter newline, IME-guarded). Phrase
  toggles now also REMOVE their phrase and heal the "; " separators.

### Who I am view (2026-07-27)

**Shipped** (commit `6bb2c28`): read-only "Who I am" tab — the anti-blackbox
view of everything the agents know about the user.
- Route `{ view: 'whoami' }` (`store.ts`), sidebar entry with `UserRound`
  icon in the bottom block directly above Settings (`Sidebar.tsx`), route
  render in `App.tsx`.
- `views/WhoAmIView.tsx`: fetches `profile:get` + `master:getContext` +
  `knowledge:get` on mount; centered max-w-4xl scroll page of panel
  sections in the Settings uppercase-muted header style — Identity,
  Education, Experience, Projects, Skills, Certifications, Publications,
  Awards (list sections hidden when empty), Behavioral profile, Narrative,
  Search config summary, Master résumé context ("may be listed on
  documents", pre block), Knowledge base ("background only — never on
  documents", notes pre + file list with sizes), Tailoring hard rules.
- Per-entry agent steering (inclusionRule / framingNotes / mustKeepPhrases,
  education notes) renders as muted uppercase-labelled guidance sub-lines,
  so the user sees exactly what instructions ride along with each entry.
- Header Edit button → Settings (the profile editor lives there); null
  profile → onboarding prompt panel instead of the page.
- In-section extras beyond the spec list, kept because the page promises
  "everything": narrative stories, behavioral assessment source, education
  thesis/coursework, user customRules under the hard-rules panel. Whole
  unlisted profile areas (evaluation config, role profiles, document prefs,
  board setup) stay off the page — they are configuration, already visible
  in Settings, and the section list scoped them out.
- Master context / knowledge base sections always render, with explicit
  "empty" lines when blank — absence of hidden context is itself the
  information this page exists to show.

### Fix/feature wave 2 (2026-07-27)

**Task 1 — OAuth client JSON upload + actionable 403 guidance** (commit
`10fa5a8`):
- `email:importClientJson` IPC: JSON-filtered open dialog (knowledge:addFiles
  pattern) → `parseClientJson` in gmailAuth accepts
  `{installed:{client_id, client_secret}}` (secret optional), rejects a
  `{web:{…}}` client with instructions to create a Desktop-app client, and
  rejects non-client JSON with the expected shape named → stored through the
  existing `setGmailClientId` safeStorage path → returns the refreshed
  EmailStatus. Judgment call: response is `{imported, status}` rather than
  bare EmailStatus so a cancelled dialog is distinguishable and never toasts
  success (mirrors knowledge:addFiles `{added: 0}`).
- `GMAIL_API_403_HINT` (enable-API guidance with the direct
  console.cloud.google.com/apis/library link + test-user reminder) thrown on
  HTTP 403 from every Gmail fetch: `gmailGet` (covers profile/list/
  getMessageMeta/getMessageBody) and the sign-in profile read — the two
  places a fresh client first hits the disabled-API wall.
- Email tab: a failed Refresh whose error mentions 403 renders the hint as a
  persistent amber banner under the toolbar with an "Open Gmail API library"
  button (toast still fires; banner clears on the next successful refresh).
  Body-pane errors inherit the hint text automatically via `gmailGet`.
- Settings: "Upload client JSON" button beside the manual fields (manual
  entry stays); the setup guide's enable-API step now links the Gmail API
  library page directly and names the 403 symptom; the final step offers the
  JSON download as the primary path.

**Task 2 — section-by-section edit mode inside Who I am** (commit `a0b617d`):
- ProfileEditor was monolithic → refactored into exported per-section form
  components (`IdentityForm` … `CustomRulesForm`, all
  `{value: ProfileFile, onChange}`) plus one `PROFILE_SECTIONS` array
  (key/title/summary/defaultOpen/Form). The default export renders the same
  collapsible rows from that array — Settings ProfilePanel and the
  onboarding wizard (also an importer) keep identical behavior.
- WhoAmIView Edit enters an in-view edit mode (no more Settings hop):
  left nav driven from PROFILE_SECTIONS (all 15 sections the editor
  supports, incl. Fit evaluation and Custom agent rules beyond the listed
  set — "whatever ProfileEditor supports"), right pane renders the selected
  section's form against a single `structuredClone` draft. Pinned bottom
  bar: Save posts the whole draft to profile:save (validation refusals
  toast and keep the draft in edit mode), Cancel discards → read view.
  Read view untouched.
- Skills in this mode use a dedicated SkillsChipEditor: items as chips with
  hover-revealed ✕ inside the chip, per-category + opens an inline input
  (Enter commits and stays open for the next, Escape/blur closes), inline
  category rename, add/remove whole categories. Judgment call: Settings
  keeps its CommaList skills form — the refactor contract was "no Settings
  behavior change", so the chip UX ships only where it was specified.

**Task 3 — assistant update_profile_section** (commit `2a442b7`):
- Approval-gated `update_profile_section` {section: 14-key enum, newValue:
  record|array, summary: string}: clone profile → wholesale replace →
  validateProfile (reject with problems) → approval preview
  `${section}: ${summary}` capped at 500 chars → save on approval. Tool
  description instructs: get_profile first, construct the FULL section
  (never partial), summary states exactly what changed.
- Added shape guard beyond the spec: validateProfile heals a mistyped
  section (object where an array belongs, or vice versa) back to its empty
  default, which would have silently wiped the section and then saved —
  such calls are refused with the expected shape named.
- systemAppend: new tool added to the approval-gated enumeration + one
  routing paragraph (document content rules → tailoring.hardRules or
  customRules via update_profile_section; "edit the skills section…" →
  update_profile_section on skills; single new entries → add_profile_entry;
  after any profile change tell the user the Who I am tab reflects it).
- Known limit: validation runs on a pre-approval snapshot, so a profile
  change landing while the approval card waits would be overwritten on
  approve — acceptable for a single-user desktop app.

### Polish wave (2026-07-28)

**Email fixes** (commit `909aa02`):
- Primary filter between Job and All: `category:primary newer_than:7d`
  synced as a third parallel sweep; `EmailMessage.primary` mirrors
  `jobRelated` (sticky flag, `'job' | 'primary' | 'all'` union end to end
  through ipc/emailStore/EmailView). Caches from before the flag existed
  self-heal on the re-list pass (`false !== undefined` counts as changed);
  CACHE_CAP behavior untouched.
- Job matching broadened in BOTH the Gmail query and the classifier: new
  subject terms (online assessment, next steps, technical screen,
  invitation, complete your) plus from-domain matching. Assessment
  platforms (hackerrank/codility/codesignal/karat/hirevue/testgorilla)
  classify 'assessment' outright; ATS senders (greenhouse/lever/ashby/
  myworkday/icims/smartrecruiters) run the subject rules first, then
  default to 'confirmation' when the subject mentions the application,
  else 'other' — placed before the recruiter heuristic so "Greenhouse
  Recruiting" senders don't misread as recruiters. Domain match is
  suffix-based on every `@host` in the From header (covers mail.*
  subdomains). Pure regex/string matching, no new deps.
- List rows: sender name first (truncates), classification chip to its
  right (shrink-0), timestamp still right-aligned.
- Reader pane linkifies bare http(s) URLs via split-with-capture — odd
  indices are always the URL matches (no re-test, so a non-captured
  `https://x` fragment can't drag its whole text part into a link);
  trailing punctuation stays outside the match. Links are cyan
  hover-underline buttons through `app:openExternal`; no other markup.

**History composer fixes** (commit `1d54e7a`):
- Send is a compact primary icon button (h-7 w-7 centered glyph, `btn
  btn-primary p-0` so the base padding can't stretch it) pinned bottom-2
  right-2 in the relative textarea wrapper; textarea pr-10. Disabled —
  and Enter no-ops — while instructions are empty, mirroring the
  assistant Composer's empty-draft rule; placeholder no longer advertises
  "empty = standard sweep" (Rerun on a past run still reaches it).
- FilterDropdown panels restyled to the AssistantPanel history idiom
  (mt-1 w-56 max-h-72 overflow-auto rounded-md border-edge bg-panel2
  shadow-xl z-50; rows px-3 py-1.5 text-xs hover:bg-panel). Triggers are
  compact `btn px-2 py-1`, flipping to `btn-primary` while any option is
  checked. Verified no ancestor of the panels clips (composer div and
  filter row set no overflow), so nothing needed unclipping.
- MIN PAY spinner → salary range: `$ [Min] – [Max] /yr` number inputs
  (w-24, native spinners killed via appearance-none + the two
  ::-webkit-*-spin-button variants; arrow keys still step 1000).
  Composes `salary $MIN–$MAX` / `salary ≥ $MIN` / `salary ≤ $MAX` live
  into the instructions on every keystroke, removing the previous phrase
  first (same appendPhrase/removePhrase healing as the dropdowns).
  Known limit: hand-editing the salary phrase in the textarea breaks the
  next swap's exact-match removal — same drift class the checkbox
  filters already accept.

### Polish wave 2 (2026-07-28)

**History/Scout fixes** (commit `9bd5384`):
- Composer textarea + salary Min/Max inputs override `.input`'s
  `focus:border-cyan-500` with per-control `focus:border-edge` (utilities
  layer beats the components-layer `@apply`, and `.input` already sets
  `outline-none` unconditionally — no ring exists to suppress). The
  global class is untouched; every other input keeps the cyan focus.
- Send button insets equalized: the textarea was inline-block, so the
  relative wrapper carried a ~4px descender gap below it and `bottom-2`
  measured from the wrong box (button sat ~4px from the field's bottom
  border vs 8px from the right). `block` on the textarea makes the
  wrapper hug the border box; bottom-2/right-2 are now identical insets
  (border is a uniform 1px so inside-border distances match too).
- Send icon is `CornerDownLeft` (enter/return glyph), same size 13.
- ScoutView instructions input + state deleted; `⌕ Scout now` calls
  `scout:start` with `instructions: undefined` (standard sweep) and its
  tooltip points at History, now the only instructions surface.

**Profile list-field fixes** (commit `7a66ffd`):
- StringList rows: `group/row relative` wrapper; ✕ is `invisible`,
  revealed by `group-hover/row` + `group-focus-within/row` (keyboard
  path: tab from the field lands on a visible button), absolutely
  positioned inside the field's right edge with `pr-8` on the field so
  text never underlaps. Visibility (not display) toggles = zero layout
  shift.
- StringList inputs → auto-growing textareas: `rows={1}`, `resize-none`,
  `[field-sizing:content] min-h-[2.25rem] whitespace-pre-wrap
  break-words`, `block` to kill the inline descender gap. Covers every
  StringList consumer in ProfileEditor: experience/project bullets,
  must-keep phrases, traits/strengths/growth/thrives-in, what-excites/
  sectors/deal-breakers, strong/moderate/weak match areas, calibration
  notes, hard rules, excluded companies, extra hard filters, custom
  tailoring rules (verified by grep — StringList is only used there).
- Coursework/Technologies/Skills are CommaList, not StringList — same
  growing-textarea treatment applied; `commit()` now splits on
  `/[,\n]/` so Enter behaves as a separator instead of embedding a
  newline inside an item (bonus: multi-line pastes parse).
- EntryList card `✕ remove` and SkillsChipEditor category-row ✕ use the
  same hover/focus-within reveal. Named groups throughout (`group/row`,
  `group/entry`, `group/cat`): StringList rows nest inside EntryList
  cards and SkillsChipEditor's skill chips already use plain `group`,
  so unnamed groups would cross-trigger reveals.
- Not touched: CategoryPicker role-chip ✕ (chip, not a row; file not in
  scope) and `.input` global focus style.

Typecheck 0 after each commit; theme grep clean on all four touched
files. `field-sizing: content` needs Chromium 123+ — fine for this
Electron; degrades to a fixed-height single-row textarea elsewhere.

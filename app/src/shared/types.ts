// Shared domain types — imported by main, preload, and renderer.
// Pure types only; no runtime imports.

import type { CustomBoardAts } from './profile'

export type StatusKey =
  | 'not_applied'
  | 'applied'
  | 'interview'
  | 'offer'
  | 'rejected'
  | 'withdrawn'

/** Company-scoped Glassdoor info, cached once per company and joined by name. */
export interface CompanyInfo {
  /** As first seen (display form). */
  name: string
  /** Glassdoor overall rating 1.0-5.0, or null when not found. */
  rating: number | null
  /** Glassdoor company/overview URL, or null. */
  url: string | null
  reviewCount: number | null
  /** ISO timestamp of the lookup. */
  fetchedAt: string
  source: 'lookup' | 'pasted' | 'manual'
}

export interface TrackerRow {
  id: string
  /** Canonical folder slug WITHOUT the "[DONE] " prefix; null when no folder is bound. */
  slug: string | null
  /** Repo-relative path (forward slashes) of the CURRENT on-disk folder name (may include "[DONE] "). */
  folderPath: string | null
  position: string
  company: string
  salary: string
  location: string
  /** 'YYYY-MM-DD' when parseable, else raw string preserved. */
  datePosted: string | null
  applyUrl: string
  dateApplied: string | null
  coverLetter: boolean
  coverLetterPath: string | null
  resumePath: string | null
  statusKey: StatusKey
  /** Original free text, preserved for export fidelity. */
  statusText: string
  notes: string
  source: 'xlsx-import' | 'agent' | 'manual' | 'scan' | 'scout'
  report: ReportJson | null
  runId: string | null
  createdAt: string
  updatedAt: string
}

export interface ReportJson {
  schema: string // 'app.report.v1'
  slug: string
  position: string
  company: string
  salary: string
  location: string
  datePosted: string | null
  applyUrl: string
  coverLetter: boolean
  resumePages: number
  coverLetterPages: number
  noEmDashes: string // 'confirmed'
  fitNote: string
  problems: string[]
  files: Record<string, string>
  /** Optional richer fields; may be absent on older/minimal reports. */
  keywordCoverage?: { keyword: string; status: string; where: string }[] | null
  atsCheck?: string | null
}

export interface IntakeItem {
  id: string
  kind: 'todo-file' | 'pasted'
  /** For todo-file items: the file name inside TODO/ (no path). */
  todoFileName: string | null
  title: string
  postingText: string
  /** Repo-relative paths of pasted posting screenshots (agent Reads them). */
  imagePaths: string[]
  applyUrl: string | null
  companyHint: string
  roleHint: string
  state: 'new' | 'building' | 'built' | 'failed' | 'dismissed'
  runId: string | null
  /** Custom intake folder the user filed this under; null = auto date grouping. */
  folderId?: string | null
  /** User notes handed to the build agent as authoritative extra context. */
  notes?: string | null
  createdAt: string
}

export interface IntakeFolder {
  id: string
  name: string
  /** Lucide icon name chosen at creation (renderer maps it to the component). */
  icon: string
  createdAt: string
}

export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export type RunKind = 'build' | 'scout' | 'interview' | 'onboard' | 'master'

export interface RunMeta {
  id: string
  kind: RunKind
  slug: string
  intakeId: string | null
  status: RunStatus
  errorText: string | null
  /** Short one-line outcome (e.g. "12 new candidates" for scout runs). */
  summary: string | null
  /** Scout notes: what was dropped/filtered and why, CLI hiccups, etc. */
  problems: string[] | null
  costUsd: number | null
  durationMs: number | null
  numTurns: number | null
  /** Context footprint of the run's last step vs the model window (per-step
   *  figures; absent on runs recorded before these were tracked). */
  contextTokens?: number | null
  contextWindow?: number | null
  /** Total tokens the whole run consumed (input + output + cache). */
  totalTokens?: number | null
  folderPath: string | null
  /** Kind-specific output artifact (onboard: the profile draft json path). */
  resultPath: string | null
  startedAt: string
  endedAt: string | null
}

/** A job surfaced by a scout run, awaiting the user's review. */
export interface CandidateJob {
  id: string
  position: string
  company: string
  salary: string
  location: string
  workModel: string
  datePosted: string | null
  applyUrl: string
  source: string
  /** Agent's 0-100 fit judgment against the candidate profile/criteria. */
  fitScore: number | null
  fitNote: string
  postingText: string
  /** Structured extraction from the JD (agent-provided; may be absent on old candidates). */
  skills?: string[] | null
  minimumQualifications?: string[] | null
  preferredQualifications?: string[] | null
  education?: string[] | null
  responsibilities?: string[] | null
  benefits?: string[] | null
  state: 'new' | 'accepted' | 'rejected'
  scoutRunId: string
  buildRunId: string | null
  /** User notes handed to the build agent as authoritative extra context. */
  notes?: string | null
  createdAt: string
}

/** A posting the scout dropped at triage, with its honest one-line reason. */
export interface ScoutExcludedItem {
  position: string
  company: string
  reason: string
}

/** Condensed kept-posting row for the history view (no posting text — light payload). */
export interface ScoutKeptItem {
  position: string
  company: string
  salary: string
  location: string
  fitScore: number | null
  fitNote: string
}

/** One scout run's input and outcome for the History tab. kept/excluded are
 *  empty when the run's candidates file is missing or predates the fields. */
export interface ScoutHistoryEntry {
  runId: string
  startedAt: string
  endedAt: string | null
  status: RunStatus
  summary: string | null
  /** Extra instructions the run started with; '' when none were recorded. */
  instructions: string
  keptCount: number
  excludedCount: number
  kept: ScoutKeptItem[]
  excluded: ScoutExcludedItem[]
}

export type RunEvent =
  | { seq: number; ts: number; kind: 'status'; status: RunStatus }
  | { seq: number; ts: number; kind: 'init'; model: string; sessionId?: string }
  | { seq: number; ts: number; kind: 'text'; text: string; complete: boolean }
  /** Model reasoning (Claude extended thinking, or thinking passed through the
   *  provider shim) — shown dimmed, never part of the answer. */
  | { seq: number; ts: number; kind: 'thinking'; text: string }
  | { seq: number; ts: number; kind: 'tool_start'; toolUseId: string; tool: string; summary: string }
  | { seq: number; ts: number; kind: 'tool_end'; toolUseId: string; ok: boolean; preview: string }
  | {
      seq: number
      ts: number
      kind: 'result'
      ok: boolean
      costUsd?: number
      durationMs?: number
      numTurns?: number
      /** Context footprint of the run's LAST step (per-step usage, not the
       *  cumulative result totals) — drives the "ctx N%" display. */
      contextTokens?: number
      contextWindow?: number
      errorText?: string
    }

export interface AssistantUsage {
  inputTokens: number
  outputTokens: number
  cacheTokens: number
  costUsd: number
  contextTokens: number // running context size for the donut
  contextWindow: number // model max, for the donut denominator
}

export interface AssistantMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  events: RunEvent[] // reuse existing RunEvent; [] for user msgs
  createdAt: string
}

export interface ConversationMeta { id: string; title: string; updatedAt: string }

export interface AssistantConversation extends ConversationMeta {
  createdAt: string
  messages: AssistantMessage[]
  usage: AssistantUsage
  // Claude Agent SDK session id — lets a later run resume with the model's
  // full prior context instead of starting from a blank context window.
  sdkSessionId?: string
}

export interface AssistantApproval {
  approvalId: string
  conversationId: string
  tool: string // e.g. 'add_profile_entry'
  preview: string // human-readable preview
}

export type AssistantStatus = 'idle' | 'thinking' | 'awaiting-approval'

// ---- job-board search CLIs ----

export type BoardId = 'jobright' | 'linkedin' | 'freehire'

export interface BoardStatus {
  id: BoardId
  /** Per-board on/off from the profile search config; scouts skip disabled boards. */
  enabled: boolean
  /** CLI entrypoint present in the workspace. */
  installed: boolean
  /** Where the CLI lives (workspace-relative), installed or not. */
  path: string
  /** Credentials state; null for boards that need none. */
  configured: boolean | null
  /** Saved account email, when the board uses credentials. */
  email: string | null
}

export interface BoardsStatus {
  /** The bun runtime that executes the CLIs was found. */
  bunOk: boolean
  bunPath: string
  boards: BoardStatus[]
}

/** Result of detecting + live-fetching a pasted careers URL (custom boards). */
export interface CustomBoardTest {
  ats: CustomBoardAts
  slug: string
  /** Company name (ATS-reported when available, else derived from the slug). */
  label: string
  /** Open roles the board returned in the test fetch. */
  sampleCount: number
}

export interface AnswersField {
  label: string
  value: string
}

export interface AnswersDoc {
  title: { raw: string; company: string | null; role: string | null }
  applyLine: string | null
  fields: AnswersField[]
  sections: { heading: string; body: string }[]
  statusLine: string | null
}

export interface PostingDoc {
  title: string
  meta: { label: string; value: string }[]
  sections: { heading: string; body: string }[]
  fitNote: string | null
  salary: string | null
  applyUrl: string | null
}

export interface AppFileInfo {
  name: string
  relPath: string
  exists: boolean
  kind: 'pdf' | 'tex' | 'md' | 'json' | 'other'
}

export interface ApplicationDetail {
  row: TrackerRow
  files: AppFileInfo[]
  answers: AnswersDoc | null
  posting: PostingDoc | null
  report: ReportJson | null
  messageToHiringTeam: string | null
  interviewPrep: string | null
  rawAnswersMd: string | null
  rawPostingMd: string | null
}

export interface ScanConflict {
  slug: string
  kind: 'done-on-disk-but-not-applied' | 'row-folder-missing'
  detail: string
}

export interface ScanResult {
  created: number
  updated: number
  conflicts: ScanConflict[]
}

export interface AppSettings {
  /** Parallel agent runs. Builds are independent (separate folders, separate
   *  LaTeX processes; store writes are serialized in the main process), so
   *  the real limits are API throughput and how many you want to watch. */
  maxConcurrentRuns: 1 | 2 | 3 | 4
  renameFolderOnSubmit: boolean
  model?: string
  maxTurns: number
  includePartialMessages: boolean
  insertTextEnabled: boolean
  theme: 'dark' | 'light'
  repoRootOverride?: string
  /** Gmail poll cadence in minutes; a manual Refresh syncs regardless. */
  emailPollMinutes: number
  /** Apply email-derived tracker status changes without asking. Off = the
   *  Email tab shows one-click suggestions instead (status flips from
   *  heuristic classification are too consequential to silently apply). */
  emailAutoApply: boolean
  /** OS notifications for new job mail and calendar event reminders. */
  emailNotifications: boolean
  /** Minutes before an approved event's start for the "starting soon" reminder. */
  reminderLeadMinutes: number
  /** Harvest Glassdoor via the in-app browser session before each scout run.
   *  Off by default: it drives the user's logged-in browser (real session, no
   *  stored creds), which is a gray zone on Glassdoor's ToS. */
  scoutGlassdoor: boolean
  /** User-pasted Glassdoor search URLs to harvest; empty = auto-derive from the
   *  profile's target roles. */
  glassdoorSearches: string[]
  /** Which model backend powers agents. claude = the Agent SDK's own auth;
   *  gemini/ollama route the SDK through a local Anthropic-API shim. */
  provider: 'claude' | 'gemini' | 'ollama'
  geminiModel: string
  ollamaUrl: string
  ollamaModel: string
  /** Ollama context window per request — model defaults are far too small
   *  for agent prompts; lower it if the machine runs out of memory. */
  ollamaNumCtx: number
  /** Reasoning on thinking-capable local models — much slower per turn. */
  ollamaThink: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  maxConcurrentRuns: 1,
  renameFolderOnSubmit: true,
  maxTurns: 120,
  includePartialMessages: true,
  insertTextEnabled: false,
  theme: 'dark',
  emailPollMinutes: 5,
  emailAutoApply: false,
  emailNotifications: true,
  reminderLeadMinutes: 30,
  scoutGlassdoor: false,
  glassdoorSearches: [],
  provider: 'claude',
  geminiModel: 'gemini-3.6-flash',
  ollamaUrl: 'http://127.0.0.1:11434',
  ollamaModel: '',
  ollamaNumCtx: 32768,
  ollamaThink: false
}

// ---- Gmail integration ----

export type EmailClassification =
  | 'confirmation'
  | 'interview'
  | 'assessment'
  | 'offer'
  | 'rejection'
  | 'recruiter'
  | 'other'

/** Proposed tracker status change derived from an email's classification. */
export interface EmailSuggestion {
  rowId: string
  /** Row's company at match time, for the "Mark X as Y" banner. */
  company: string
  suggestStatus: StatusKey
}

/** Structured view of a message's text/calendar part. */
export interface EmailInvite {
  title: string | null
  start: string | null
  end: string | null
  location: string | null
  meetLink: string | null
  organizer: string | null
  /** iCalendar METHOD: REQUEST = invite/update, CANCEL = cancellation. */
  method: string | null
}

/** Cached Gmail message: headers + snippet only — the body is fetched live on
 *  demand (email:getBody) and never stored. */
export interface EmailMessage {
  id: string
  threadId: string
  from: string
  subject: string
  /** ISO timestamp (Gmail internalDate). */
  date: string
  snippet: string
  classification: EmailClassification
  /** Matched the job-search query (vs. only the all-recent inbox sweep). */
  jobRelated: boolean
  /** Listed in Gmail's Primary category sweep at some sync. */
  primary: boolean
  suggestion: EmailSuggestion | null
  /** null = no suggestion was ever computed for this message. */
  suggestionState: 'open' | 'applied' | 'dismissed' | null
  /** Starred by the user; exempt from cache eviction. */
  favorite: boolean
  /** Hidden from every list except the Hidden filter; exempt from eviction. */
  hidden: boolean
  /** User-assigned tag names (from presets + custom tags). */
  tags: string[]
  /** Parsed text/calendar metadata (derived facts, never the body).
   *  undefined and null both mean no invite; consumers read `invite ?? null`. */
  invite?: EmailInvite | null
}

/** Email list filters: content sweeps plus the user's own starred/hidden sets. */
export type EmailFilter = 'job' | 'primary' | 'all' | 'starred' | 'hidden'

export interface EmailStatus {
  /** A client ID is saved AND an account is signed in. */
  configured: boolean
  /** Saved OAuth client ID (not a secret), for the Settings form. */
  clientId: string | null
  /** A client secret is stored; the value itself is never sent to the renderer. */
  hasClientSecret: boolean
  email: string | null
  polling: boolean
  lastSyncAt: string | null
}

// ---- calendar ----

/** One calendar entry, extracted from mail or added by hand. Proposed events
 *  wait for explicit approval; reminders fire only for approved ones. */
export interface CalendarEvent {
  id: string
  sourceMessageId: string | null
  /** iCalendar UID — an update with the same UID replaces the event. */
  icsUid: string | null
  title: string
  company: string | null
  rowId: string | null
  start: string
  end: string | null
  location: string | null
  meetLink: string | null
  notes: string | null
  source: 'ics' | 'detected' | 'manual'
  state: 'proposed' | 'approved' | 'dismissed'
  createdAt: string
  remindedDayBefore: boolean
  remindedSoon: boolean
}

export interface TrackerStoreFile {
  schema: 'tracker.v1'
  revision: number
  rows: TrackerRow[]
  intake: IntakeItem[]
  intakeFolders: IntakeFolder[]
  candidates: CandidateJob[]
  settings: AppSettings
}

export interface LibraryFile {
  name: string
  relPath: string
  kind: 'pdf' | 'image' | 'text' | 'other'
  sizeKb: number
}

export interface LibraryCategory {
  title: string
  files: LibraryFile[]
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string }

/** External LaTeX engines the builder knows how to drive. */
export type LatexKind = 'pdflatex' | 'xelatex' | 'lualatex' | 'tectonic'

/** Where an external command-line tool was found on this host. */
export type ToolName = 'pdflatex' | 'pdftotext'

/**
 * Resolution outcome for one external tool. `path` is what the app will
 * actually run; `override` is echoed back even when unusable so Settings can
 * show the offending value together with `overrideError`.
 */
export interface ToolStatus {
  tool: ToolName
  ok: boolean
  path: string | null
  source: 'override' | 'detected' | 'none'
  override: string | null
  overrideError: string | null
  /** LaTeX flavour of `path`; always null for pdftotext. */
  kind: LatexKind | null
}

/** One host prerequisite, as shown by the onboarding preflight. */
export interface PrereqTool {
  id: 'claude' | 'claudeAuth' | 'latex' | 'bun'
  label: string
  ok: boolean
  /** false = the app still runs; only the feature named in `remedy` is lost. */
  required: boolean
  /** What was (not) found on this host. */
  detail: string
  /** One line the user can act on. */
  remedy: string
  url: string
}

/** Detection of the two external tools Settings can override. */
export interface EnvCheck {
  pdflatex: ToolStatus
  pdftotext: ToolStatus
  platform: string
  appVersion: string
}

/** env:check's full response: the tool rows above plus every host prerequisite,
 *  worst-first, for the onboarding preflight. env:setToolPath returns the
 *  EnvCheck half alone — it re-detects the two tools, not the whole host. */
export interface EnvPreflight extends EnvCheck {
  tools: PrereqTool[]
}

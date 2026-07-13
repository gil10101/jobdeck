// Shared domain types — imported by main, preload, and renderer.
// Pure types only; no runtime imports.

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
  cityjobsMessage: boolean
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
  createdAt: string
}

export type RunEvent =
  | { seq: number; ts: number; kind: 'status'; status: RunStatus }
  | { seq: number; ts: number; kind: 'init'; model: string; sessionId?: string }
  | { seq: number; ts: number; kind: 'text'; text: string; complete: boolean }
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
      errorText?: string
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
  maxConcurrentRuns: 1 | 2
  renameFolderOnSubmit: boolean
  model?: string
  maxTurns: number
  includePartialMessages: boolean
  insertTextEnabled: boolean
  theme: 'dark' | 'light'
  repoRootOverride?: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  maxConcurrentRuns: 1,
  renameFolderOnSubmit: true,
  maxTurns: 120,
  includePartialMessages: true,
  insertTextEnabled: false,
  theme: 'dark'
}

export interface TrackerStoreFile {
  schema: 'tracker.v1'
  revision: number
  rows: TrackerRow[]
  intake: IntakeItem[]
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

import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

/**
 * V2: the app operates on a user-chosen WORKSPACE directory (not a git repo).
 * Paths are ESM live bindings initialized by initWorkspace() at boot (or after
 * the first-run picker). Anything touching them before init throws loudly.
 *
 * Workspace layout:
 *   workspace/
 *     profile.json  tracker.json
 *     applications/ (+TODO/)   master/   templates/   library/
 *     intake-images/  exports/  runs/  scout/  tmp/  onboarding/
 */

const NOT_READY = '__WORKSPACE_NOT_INITIALIZED__'

// Live bindings — consumers imported these names in v1; values now flip at init.
// REPO_ROOT is kept as the legacy alias of the workspace root (renamed in M2 sweeps).
export let REPO_ROOT = NOT_READY
export let APP_DATA_DIR = NOT_READY // legacy alias: internal data now lives inside the workspace
export let RUNS_DIR = NOT_READY
export let EXPORTS_DIR = NOT_READY
export let TMP_DIR = NOT_READY
export let INTAKE_IMAGES_DIR = NOT_READY
export let SCOUT_DIR = NOT_READY
export let APPLICATIONS_DIR = NOT_READY
export let TODO_DIR = NOT_READY
export let MASTER_DIR = NOT_READY
export let TEMPLATES_DIR = NOT_READY
export let ONBOARDING_DIR = NOT_READY
export let UPLOADS_DIR = NOT_READY
export let TRACKER_FILE = NOT_READY
export let PROFILE_FILE = NOT_READY
export let COMPANIES_FILE = NOT_READY

export const APP_DIR = app.getAppPath()

export function workspaceReady(): boolean {
  return REPO_ROOT !== NOT_READY
}

/** Point every path binding at the chosen workspace and create the layout. */
export function initWorkspace(root: string): void {
  const abs = path.resolve(root)
  REPO_ROOT = abs
  APP_DATA_DIR = abs
  APPLICATIONS_DIR = path.join(abs, 'applications')
  TODO_DIR = path.join(APPLICATIONS_DIR, 'TODO')
  MASTER_DIR = path.join(abs, 'master')
  TEMPLATES_DIR = path.join(abs, 'templates')
  ONBOARDING_DIR = path.join(abs, 'onboarding')
  UPLOADS_DIR = path.join(abs, 'uploads')
  RUNS_DIR = path.join(abs, 'runs')
  EXPORTS_DIR = path.join(abs, 'exports')
  TMP_DIR = path.join(abs, 'tmp')
  INTAKE_IMAGES_DIR = path.join(abs, 'intake-images')
  SCOUT_DIR = path.join(abs, 'scout')
  TRACKER_FILE = path.join(abs, 'tracker.json')
  PROFILE_FILE = path.join(abs, 'profile.json')
  COMPANIES_FILE = path.join(abs, 'companies.json')
  ensureAppDataDirs()
}

export function ensureAppDataDirs(): void {
  assertReady()
  for (const d of [
    APPLICATIONS_DIR,
    TODO_DIR,
    MASTER_DIR,
    TEMPLATES_DIR,
    ONBOARDING_DIR,
    UPLOADS_DIR,
    RUNS_DIR,
    EXPORTS_DIR,
    TMP_DIR,
    INTAKE_IMAGES_DIR,
    SCOUT_DIR
  ]) {
    fs.mkdirSync(d, { recursive: true })
  }
}

function assertReady(): void {
  if (!workspaceReady()) {
    throw new Error('workspace not initialized — complete first-run setup')
  }
}

/** pdflatex resolution: config override → PATH → TinyTeX → MiKTeX (M2 wires config). */
export const PDFLATEX = path.join(
  process.env.APPDATA ?? '',
  'TinyTeX',
  'bin',
  'windows',
  'pdflatex.exe'
)

/** Legacy v1 bun path — used only by the deprecated boardsBridge until M3 removes it. */
export const BUN_EXE = 'C:\\Users\\gillu\\.bun\\bin\\bun.exe'

/** Workspace-relative path with forward slashes. */
export function toRel(absPath: string): string {
  assertReady()
  return path.relative(REPO_ROOT, absPath).split(path.sep).join('/')
}

/** Absolute path from a workspace-relative one (either slash direction). */
export function toAbs(relPath: string): string {
  assertReady()
  return path.join(REPO_ROOT, ...relPath.split(/[\\/]/))
}

export const DONE_PREFIX_RE = /^\[DONE\]\s*/

export function stripDonePrefix(name: string): string {
  return name.replace(DONE_PREFIX_RE, '')
}

/** snake_case slug from free text (company/role). */
export function slugifyPart(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_')
}

export function buildSlug(companyHint: string, roleHint: string, dateMMDD: string): string {
  const company = slugifyPart(companyHint) || 'company'
  const role = slugifyPart(roleHint) || 'application'
  return `${company}_${role}_${dateMMDD}`.slice(0, 80)
}

/** Ensure the slug does not collide with an existing folder (with or without [DONE] prefix). */
export function uniqueSlug(base: string): string {
  const exists = (s: string): boolean =>
    fs.existsSync(path.join(APPLICATIONS_DIR, s)) ||
    fs.existsSync(path.join(APPLICATIONS_DIR, `[DONE] ${s}`))
  if (!exists(base)) return base
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}_${i}`
    if (!exists(candidate)) return candidate
  }
  return `${base}_${Date.now()}`
}

export function todayISO(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

export function todayMMDD(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${mm}_${dd}`
}

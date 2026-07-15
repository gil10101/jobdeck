import { app } from 'electron'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadConfig } from './appConfig'

/**
 * the app operates on a user-chosen WORKSPACE directory (not a git repo).
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

// Live bindings initialized by initWorkspace() at boot. REPO_ROOT
// is an alias of the workspace root.
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

export type LatexKind = 'pdflatex' | 'xelatex' | 'lualatex' | 'tectonic'
export interface LatexEngine {
  path: string
  kind: LatexKind
}

function inferLatexKind(p: string): LatexKind {
  const b = path.basename(p).toLowerCase()
  if (b.includes('tectonic')) return 'tectonic'
  if (b.includes('xelatex')) return 'xelatex'
  if (b.includes('lualatex')) return 'lualatex'
  return 'pdflatex'
}

// Common install locations, best-first: real pdflatex, then tectonic (a common
// single-binary engine on macOS/Homebrew), then xe/lua, then the Windows
// TinyTeX path. A config override (Settings) wins over all of these.
const LATEX_CANDIDATES: LatexEngine[] = [
  { path: '/Library/TeX/texbin/pdflatex', kind: 'pdflatex' },
  { path: '/usr/local/bin/pdflatex', kind: 'pdflatex' },
  { path: '/opt/homebrew/bin/pdflatex', kind: 'pdflatex' },
  { path: '/usr/bin/pdflatex', kind: 'pdflatex' },
  { path: '/opt/homebrew/bin/tectonic', kind: 'tectonic' },
  { path: '/usr/local/bin/tectonic', kind: 'tectonic' },
  { path: '/usr/bin/tectonic', kind: 'tectonic' },
  { path: '/Library/TeX/texbin/xelatex', kind: 'xelatex' },
  { path: '/Library/TeX/texbin/lualatex', kind: 'lualatex' },
  { path: path.join(process.env.APPDATA ?? '', 'TinyTeX', 'bin', 'windows', 'pdflatex.exe'), kind: 'pdflatex' }
]

/** Resolve an available LaTeX engine on this host: config override → known
 *  install locations. Returns null when none is installed. */
export function resolveLatex(): LatexEngine | null {
  const override = loadConfig().pdflatexPath
  if (override && fs.existsSync(override)) return { path: override, kind: inferLatexKind(override) }
  for (const c of LATEX_CANDIDATES) {
    if (c.path && fs.existsSync(c.path)) return c
  }
  return null
}

/** Resolve the `bun` runtime (runs the job-board search CLIs): the standard
 *  per-user install, common system locations, then a PATH lookup (catches
 *  version-manager installs like nvm/mise), else the bare command so execFile
 *  falls back to PATH. Never hardcodes a specific machine/user. */
export function resolveBun(): string {
  const home = os.homedir()
  const exe = process.platform === 'win32' ? 'bun.exe' : 'bun'
  const candidates = [
    path.join(home, '.bun', 'bin', exe),
    '/opt/homebrew/bin/bun',
    '/usr/local/bin/bun',
    '/usr/bin/bun'
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  try {
    const lookup = process.platform === 'win32' ? 'where' : 'which'
    const hit = execFileSync(lookup, ['bun'], { encoding: 'utf-8', timeout: 3000 })
      .trim()
      .split(/\r?\n/)[0]
    if (hit && fs.existsSync(hit)) return hit
  } catch {
    /* not on PATH either */
  }
  return 'bun'
}

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

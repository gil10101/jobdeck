import { app } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { LatexKind, ToolName, ToolStatus } from '@shared/types'
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

export type { LatexKind }
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

/** True only for a real file this process is allowed to execute. Windows has
 *  no execute bit, so there the file existing is the whole test. */
export function isExecutableFile(p: string): boolean {
  try {
    if (!fs.statSync(p).isFile()) return false
    if (process.platform === 'win32') return true
    fs.accessSync(p, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Filenames a bare command can have on disk: win32 expands PATHEXT (nothing
 *  is executable there without an extension), POSIX uses the name verbatim. */
function commandFileNames(command: string): string[] {
  if (process.platform !== 'win32' || path.extname(command)) return [command]
  const exts = (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((e) => e.trim())
    .filter(Boolean)
  return exts.map((e) => command + e.toLowerCase())
}

/** First executable named `command` on PATH, else null. A filesystem scan, not
 *  a spawn, so it costs nothing when the tool is absent and cannot hang. */
export function lookupOnPath(command: string): string | null {
  const dirs = (process.env.PATH ?? '').split(path.delimiter)
  const names = commandFileNames(command)
  for (const raw of dirs) {
    const dir = raw.trim().replace(/^"|"$/g, '')
    if (!dir) continue
    for (const name of names) {
      const full = path.join(dir, name)
      if (isExecutableFile(full)) return full
    }
  }
  return null
}

/** TeX Live installs under an unknown year and architecture
 *  (…/texlive/<year>/bin/<arch>), so the tree is enumerated, never guessed. */
function texliveBinDirs(): string[] {
  const roots =
    process.platform === 'win32' ? ['C:\\texlive'] : ['/usr/local/texlive', '/opt/texlive']
  const out: string[] = []
  for (const root of roots) {
    let years: string[] = []
    try {
      years = fs.readdirSync(root)
    } catch {
      continue
    }
    for (const year of years) {
      const bin = path.join(root, year, 'bin')
      try {
        for (const arch of fs.readdirSync(bin)) out.push(path.join(bin, arch))
      } catch {
        /* not a TeX Live year directory */
      }
    }
  }
  return out
}

/** Searched only after PATH misses: a GUI-launched app inherits a minimal PATH
 *  (macOS gives it /usr/bin:/bin:/usr/sbin:/sbin), which omits every TeX and
 *  poppler install. Order is best-first within each platform. */
function toolFallbackDirs(): string[] {
  const home = os.homedir()
  const dirs = [
    '/Library/TeX/texbin', // MacTeX / BasicTeX symlink farm
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/opt/local/bin', // MacPorts
    '/snap/bin',
    path.join(home, '.local', 'bin'),
    path.join(home, '.cargo', 'bin'), // tectonic installed with cargo
    path.join(home, 'bin')
  ]
  if (process.platform === 'win32') {
    const windowsRoots: [string, string[]][] = [
      ['APPDATA', ['TinyTeX', 'bin', 'windows']],
      ['LOCALAPPDATA', ['Programs', 'MiKTeX', 'miktex', 'bin', 'x64']],
      ['ProgramFiles', ['MiKTeX', 'miktex', 'bin', 'x64']],
      ['ProgramFiles', ['poppler', 'Library', 'bin']],
      ['ProgramFiles', ['poppler', 'bin']]
    ]
    for (const [envVar, tail] of windowsRoots) {
      const base = process.env[envVar]
      if (base) dirs.push(path.join(base, ...tail))
    }
  }
  return [...dirs, ...texliveBinDirs()]
}

/** Locate `command` in the well-known install dirs, honouring the win32
 *  executable suffix. */
function findInFallbackDirs(command: string): string | null {
  const exe = process.platform === 'win32' ? '.exe' : ''
  for (const dir of toolFallbackDirs()) {
    const full = path.join(dir, command + exe)
    if (isExecutableFile(full)) return full
  }
  return null
}

// Engine preference: real pdflatex, then tectonic (a common single-binary
// engine), then the Unicode engines. A Settings override beats all of them.
const LATEX_ENGINES: LatexKind[] = ['pdflatex', 'tectonic', 'xelatex', 'lualatex']

/** Resolve a LaTeX engine on this host: Settings override → PATH → well-known
 *  install locations. Returns null when nothing runnable exists. */
export function resolveLatex(): LatexEngine | null {
  const override = loadConfig().pdflatexPath
  if (override && isExecutableFile(override)) {
    return { path: override, kind: inferLatexKind(override) }
  }
  for (const kind of LATEX_ENGINES) {
    const hit = lookupOnPath(kind)
    if (hit) return { path: hit, kind }
  }
  for (const kind of LATEX_ENGINES) {
    const hit = findInFallbackDirs(kind)
    if (hit) return { path: hit, kind }
  }
  return null
}

/** Resolve poppler's `pdftotext` (the ATS text-layer check): Settings override
 *  → PATH → well-known install locations. Null when it is not installed. */
export function resolvePdftotext(): string | null {
  const override = loadConfig().pdftotextPath
  if (override && isExecutableFile(override)) return override
  return lookupOnPath('pdftotext') ?? findInFallbackDirs('pdftotext')
}

/** Why a configured override cannot be used, or null when it is fine. */
function overrideProblem(p: string | null): string | null {
  if (!p) return null
  if (!fs.existsSync(p)) return 'file not found'
  if (!isExecutableFile(p)) return 'not an executable file'
  return null
}

/** Detection report for the Settings rows and env:check. */
export function toolStatus(tool: ToolName): ToolStatus {
  const config = loadConfig()
  const override = tool === 'pdflatex' ? config.pdflatexPath : config.pdftotextPath
  const overrideError = overrideProblem(override)
  const engine = tool === 'pdflatex' ? resolveLatex() : null
  const resolved = tool === 'pdflatex' ? (engine?.path ?? null) : resolvePdftotext()
  return {
    tool,
    ok: !!resolved,
    path: resolved,
    source: !resolved ? 'none' : override && !overrideError ? 'override' : 'detected',
    override,
    overrideError,
    kind: engine?.kind ?? null
  }
}

/**
 * Turn user input from the Settings row into a storable override.
 * Blank clears the override; a bare command is looked up on PATH; anything the
 * app could not execute is rejected loudly rather than silently ignored later.
 */
export function normalizeToolOverride(input: string | null): string | null {
  const trimmed = (input ?? '').trim().replace(/^"|"$/g, '')
  if (!trimmed) return null
  if (!path.isAbsolute(trimmed)) {
    const hit = lookupOnPath(trimmed)
    if (!hit) throw new Error(`${trimmed}: not an absolute path and not found on PATH`)
    return hit
  }
  const problem = overrideProblem(trimmed)
  if (problem) throw new Error(`${trimmed}: ${problem}`)
  return trimmed
}

/** Resolve the `bun` runtime (runs the job-board search CLIs): the standard
 *  per-user install, common system locations, then a PATH lookup (catches
 *  version-manager installs like nvm/mise), else the bare command so execFile
 *  falls back to PATH. Never hardcodes a specific machine/user.
 *  Filesystem scans only — this runs on every env:check, and spawning a
 *  which/where here would block the main process exactly when bun is absent. */
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
  return lookupOnPath('bun') ?? 'bun'
}

/** Workspace-relative path with forward slashes. */
export function toRel(absPath: string): string {
  assertReady()
  return path.relative(REPO_ROOT, absPath).split(path.sep).join('/')
}

/**
 * Absolute path from a workspace-relative one (either slash direction).
 *
 * Jail: the result is always the workspace root or something under it. IPC
 * handlers reach this with renderer-supplied strings, so an absolute path, a
 * drive-qualified one, or any '..' that climbs out is rejected rather than
 * resolved — the same containment the local-file protocol handler enforces.
 * Every caller passes a path produced by toRel() or built from workspace
 * folder names, so nothing legitimate needs to escape.
 */
export function toAbs(relPath: string): string {
  assertReady()
  if (path.isAbsolute(relPath) || /^[a-zA-Z]:/.test(relPath)) {
    throw new Error(`path must be workspace-relative: ${relPath}`)
  }
  const abs = path.resolve(REPO_ROOT, ...relPath.split(/[\\/]/).filter(Boolean))
  if (abs !== REPO_ROOT && !abs.startsWith(REPO_ROOT + path.sep)) {
    throw new Error(`path escapes the workspace: ${relPath}`)
  }
  return abs
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

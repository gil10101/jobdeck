import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Repo root resolution: the app lives at <repo>/app, so the repo root is the
 * parent of app.getAppPath(). Overridable via MISSION_REPO_ROOT env for tests.
 * Validated by the presence of CLAUDE.md + documents/applications.
 */
function resolveRepoRoot(): string {
  const candidates = [
    process.env.MISSION_REPO_ROOT,
    path.resolve(app.getAppPath(), '..'),
    path.resolve(process.cwd(), '..'),
    process.cwd()
  ].filter(Boolean) as string[]

  for (const c of candidates) {
    try {
      if (
        fs.existsSync(path.join(c, 'CLAUDE.md')) &&
        fs.existsSync(path.join(c, 'documents', 'applications'))
      ) {
        return c
      }
    } catch {
      // keep looking
    }
  }
  // Last resort: parent of app path (may be wrong, but surfaces loudly in UI).
  return path.resolve(app.getAppPath(), '..')
}

export const REPO_ROOT = resolveRepoRoot()
export const APP_DIR = app.getAppPath()
export const APP_DATA_DIR = path.join(REPO_ROOT, 'app-data')
export const RUNS_DIR = path.join(APP_DATA_DIR, 'runs')
export const EXPORTS_DIR = path.join(APP_DATA_DIR, 'exports')
export const TMP_DIR = path.join(APP_DATA_DIR, 'tmp')
export const INTAKE_IMAGES_DIR = path.join(APP_DATA_DIR, 'intake-images')
export const SCOUT_DIR = path.join(APP_DATA_DIR, 'scout')
export const BUN_EXE = 'C:\\Users\\gillu\\.bun\\bin\\bun.exe'
export const APPLICATIONS_DIR = path.join(REPO_ROOT, 'documents', 'applications')
export const TODO_DIR = path.join(APPLICATIONS_DIR, 'TODO')
export const TRACKER_FILE = path.join(APP_DATA_DIR, 'tracker.json')
export const XLSX_FILE = path.join(REPO_ROOT, 'applications.xlsx')
export const PDFLATEX = path.join(
  process.env.APPDATA ?? '',
  'TinyTeX',
  'bin',
  'windows',
  'pdflatex.exe'
)

export function ensureAppDataDirs(): void {
  for (const d of [APP_DATA_DIR, RUNS_DIR, EXPORTS_DIR, TMP_DIR, INTAKE_IMAGES_DIR, SCOUT_DIR]) {
    fs.mkdirSync(d, { recursive: true })
  }
}

/** Repo-relative path with forward slashes. */
export function toRel(absPath: string): string {
  return path.relative(REPO_ROOT, absPath).split(path.sep).join('/')
}

/** Absolute path from a repo-relative one (either slash direction). */
export function toAbs(relPath: string): string {
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

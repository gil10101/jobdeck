import fs from 'node:fs'
import path from 'node:path'

/**
 * Import a v1 repo (Mission Control era) into a fresh v2 workspace — BY COPY,
 * never by reference: sharing live dirs with a running v1 app means atomic-write
 * races and double-processing, so the v2 workspace is always its own copy.
 *
 * FROZEN v1 INVARIANTS this importer relies on (do not break in v2):
 *   1. "[DONE] " folder/file prefix (with trailing space) marks submitted/processed.
 *   2. report.json schema "app.report.v1" stays accepted by parsers/report.ts.
 *   3. tracker.json schema "tracker.v1" stays readable by Store.load().
 */

export interface V1ImportSummary {
  applicationsCopied: number
  trackerImported: boolean
  trackerRows: number
  masterResumeCopied: boolean
  intakeImagesCopied: number
  onboardingSourcesStaged: string[]
  warnings: string[]
}

const V1_APPS_REL = ['documents', 'applications']
const PATH_REWRITES: [string, string][] = [
  ['documents/applications/', 'applications/'],
  ['app-data/intake-images/', 'intake-images/']
]

function rewritePaths(value: string): string {
  let out = value
  for (const [from, to] of PATH_REWRITES) {
    if (out.startsWith(from)) out = to + out.slice(from.length)
  }
  return out
}

export function looksLikeV1Repo(repoRoot: string): boolean {
  return (
    fs.existsSync(path.join(repoRoot, 'CLAUDE.md')) &&
    fs.existsSync(path.join(repoRoot, ...V1_APPS_REL))
  )
}

export function importFromV1Repo(repoRoot: string, workspaceRoot: string): V1ImportSummary {
  const summary: V1ImportSummary = {
    applicationsCopied: 0,
    trackerImported: false,
    trackerRows: 0,
    masterResumeCopied: false,
    intakeImagesCopied: 0,
    onboardingSourcesStaged: [],
    warnings: []
  }
  if (!looksLikeV1Repo(repoRoot)) {
    throw new Error(
      'that folder does not look like a v1 workspace (missing CLAUDE.md or documents/applications)'
    )
  }
  const ws = path.resolve(workspaceRoot)
  const inside = path.resolve(repoRoot) === ws || ws.startsWith(path.resolve(repoRoot) + path.sep)
  if (inside) {
    throw new Error('the v2 workspace must be OUTSIDE the v1 repo (import copies, never shares)')
  }

  // 1. Application folders (including "[DONE] …" ones and TODO/).
  const srcApps = path.join(repoRoot, ...V1_APPS_REL)
  const dstApps = path.join(ws, 'applications')
  fs.mkdirSync(dstApps, { recursive: true })
  for (const entry of fs.readdirSync(srcApps, { withFileTypes: true })) {
    const src = path.join(srcApps, entry.name)
    const dst = path.join(dstApps, entry.name)
    try {
      if (entry.isDirectory()) {
        fs.cpSync(src, dst, { recursive: true, errorOnExist: false, force: false })
        if (entry.name !== 'TODO') summary.applicationsCopied++
      } else {
        fs.copyFileSync(src, dst)
      }
    } catch (err) {
      summary.warnings.push(`could not copy ${entry.name}: ${String(err)}`)
    }
  }

  // 2. Tracker — copy + rewrite workspace-relative path prefixes.
  const srcTracker = path.join(repoRoot, 'app-data', 'tracker.json')
  if (fs.existsSync(srcTracker)) {
    try {
      const data = JSON.parse(fs.readFileSync(srcTracker, 'utf-8')) as {
        rows?: Record<string, unknown>[]
        intake?: Record<string, unknown>[]
      }
      for (const row of data.rows ?? []) {
        for (const key of ['folderPath', 'resumePath', 'coverLetterPath'] as const) {
          if (typeof row[key] === 'string') row[key] = rewritePaths(row[key] as string)
        }
      }
      for (const item of data.intake ?? []) {
        if (Array.isArray(item.imagePaths)) {
          item.imagePaths = (item.imagePaths as string[]).map(rewritePaths)
        }
      }
      fs.writeFileSync(path.join(ws, 'tracker.json'), JSON.stringify(data, null, 2), 'utf-8')
      summary.trackerImported = true
      summary.trackerRows = data.rows?.length ?? 0
    } catch (err) {
      summary.warnings.push(`tracker import failed: ${String(err)}`)
    }
  } else {
    summary.warnings.push('no v1 tracker.json found (app-data/tracker.json)')
  }

  // 3. Master résumé template (kept under its original name until a profile exists).
  const srcMaster = path.join(repoRoot, 'cv', 'main_example.tex')
  if (fs.existsSync(srcMaster)) {
    fs.mkdirSync(path.join(ws, 'master'), { recursive: true })
    fs.copyFileSync(srcMaster, path.join(ws, 'master', 'main_example.tex'))
    const srcMasterPdf = srcMaster.replace(/\.tex$/, '.pdf')
    if (fs.existsSync(srcMasterPdf)) {
      fs.copyFileSync(srcMasterPdf, path.join(ws, 'master', 'main_example.pdf'))
    }
    summary.masterResumeCopied = true
  }

  // 4. Intake images.
  const srcImages = path.join(repoRoot, 'app-data', 'intake-images')
  if (fs.existsSync(srcImages)) {
    const dstImages = path.join(ws, 'intake-images')
    fs.mkdirSync(dstImages, { recursive: true })
    for (const name of fs.readdirSync(srcImages)) {
      try {
        fs.copyFileSync(path.join(srcImages, name), path.join(dstImages, name))
        summary.intakeImagesCopied++
      } catch {
        /* skip */
      }
    }
  }

  // 5. Stage profile sources for the onboarding agent (M2 reads these).
  const stageDir = path.join(ws, 'onboarding', 'v1-import')
  fs.mkdirSync(stageDir, { recursive: true })
  const sources = [
    path.join(repoRoot, 'CLAUDE.md'),
    ...safeList(path.join(repoRoot, '.claude', 'skills', 'job-application-assistant')).map((f) =>
      path.join(repoRoot, '.claude', 'skills', 'job-application-assistant', f)
    )
  ]
  for (const src of sources) {
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue
    const dst = path.join(stageDir, path.basename(src))
    try {
      fs.copyFileSync(src, dst)
      summary.onboardingSourcesStaged.push(path.basename(src))
    } catch {
      /* skip */
    }
  }

  // Board credentials intentionally NOT copied (plaintext in v1) — v2 stores them
  // encrypted via safeStorage; the user re-enters them in Settings/wizard (M3).
  if (fs.existsSync(path.join(repoRoot, '.agents', 'skills', 'jobright-search', 'credentials.json'))) {
    summary.warnings.push(
      'jobright credentials were NOT imported (v1 stores them in plaintext) — re-enter them in Settings; consider deleting the old credentials.json'
    )
  }

  return summary
}

function safeList(dir: string): string[] {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

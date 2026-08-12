import ExcelJS from 'exceljs'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { TrackerRow } from '@shared/types'
import { CANONICAL_STATUS_TEXT, normalizeStatus } from '@shared/status'
import { TMP_DIR, stripDonePrefix } from '../paths'
import { cellToDateString, cellToLink, cellToPathText, cellToString } from './cellValue'
import type { TrackerRepo } from '../store/trackerRepo'
import type { Store } from '../store/Store'

export interface ImportSummary {
  imported: number
  skipped: number
  warnings: string[]
}

const HEADER_MAP: Record<string, keyof TrackerRow | 'coverLetterYN'> = {
  position: 'position',
  company: 'company',
  salary: 'salary',
  location: 'location',
  'date posted': 'datePosted',
  'job app link': 'applyUrl',
  'date applied': 'dateApplied',
  'cover letter (y/n)': 'coverLetterYN',
  'cover letter link': 'coverLetterPath',
  'resume link': 'resumePath',
  status: 'statusText'
}

function normPath(p: string): string {
  return p.split('\\').join('/').trim()
}

/** Application folder name inside a document path. The workspace layout is
 *  `applications/<slug>/<file>`; the optional leading segment also accepts the
 *  `documents/applications/...` paths older sheets carry. Anchored so an
 *  `applications` folder deeper in some unrelated path cannot match. */
const APPLICATION_PATH_RE = /(?:^|\/)(?:documents\/)?applications\/(?:\[DONE\]\s*)?([^/]+)\//

/** The slug binding an imported row to its on-disk folder. Without it the
 *  post-import rescan has nothing to match and creates a duplicate row. */
function deriveSlug(resumePath: string | null, coverPath: string | null): string | null {
  for (const p of [resumePath, coverPath]) {
    if (!p) continue
    const m = p.match(APPLICATION_PATH_RE)
    if (m) return stripDonePrefix(m[1])
  }
  return null
}

/**
 * Import rows from a user-picked applications xlsx. Reads a COPY of the file
 * so an open Excel instance can never block us.
 */
export async function importFromXlsx(
  store: Store,
  repo: TrackerRepo,
  mode: 'replace' | 'merge',
  filePath: string
): Promise<ImportSummary> {
  const warnings: string[] = []
  if (!fs.existsSync(filePath)) {
    throw new Error(`xlsx file not found: ${filePath}`)
  }

  // Copy-to-temp read (Excel holds a write lock, not a read lock — copy works).
  const tmpCopy = path.join(TMP_DIR, `import-${Date.now()}.xlsx`)
  fs.mkdirSync(TMP_DIR, { recursive: true })
  try {
    fs.copyFileSync(filePath, tmpCopy)
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code === 'EBUSY' || e.code === 'EPERM') {
      throw new Error('the xlsx is locked hard by another program. Close Excel and retry.')
    }
    throw err
  }

  try {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(tmpCopy)
    const ws = wb.worksheets[0]
    if (!ws) throw new Error('workbook has no worksheets')

    // Header map by name (row 1).
    const colFor: Partial<Record<keyof typeof HEADER_MAP extends string ? string : never, number>> &
      Record<string, number> = {}
    ws.getRow(1).eachCell((cell, colNumber) => {
      const key = cellToString(cell.value).toLowerCase()
      if (key in HEADER_MAP) colFor[key] = colNumber
    })
    if (colFor['position'] === undefined || colFor['company'] === undefined) {
      throw new Error('header row missing Position/Company columns — is this the right file?')
    }

    const parsed: Partial<TrackerRow>[] = []
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return
      const get = (header: string): unknown =>
        colFor[header] !== undefined ? row.getCell(colFor[header]).value : null

      const position = cellToString(get('position'))
      const company = cellToString(get('company'))
      if (!position && !company) return // blank row

      const coverPath = normPath(cellToPathText(get('cover letter link'))) || null
      const resumePath = normPath(cellToPathText(get('resume link'))) || null
      const statusText = cellToString(get('status')) || CANONICAL_STATUS_TEXT.not_applied

      parsed.push({
        position,
        company,
        salary: cellToString(get('salary')),
        location: cellToString(get('location')),
        datePosted: cellToDateString(get('date posted')),
        applyUrl: cellToLink(get('job app link')),
        dateApplied: cellToDateString(get('date applied')),
        coverLetter: cellToString(get('cover letter (y/n)')).toUpperCase().startsWith('Y'),
        coverLetterPath: coverPath,
        resumePath,
        slug: deriveSlug(resumePath, coverPath),
        folderPath: null, // bound by the post-import rescan
        statusText,
        statusKey: normalizeStatus(statusText),
        source: 'xlsx-import' as const
      })
    })

    let imported = 0
    let skipped = 0
    store.mutate(['rows'], (s) => {
      if (mode === 'replace') s.rows = []
      for (const p of parsed) {
        const dup = s.rows.find(
          (r) =>
            (p.slug && r.slug === p.slug) ||
            (r.company.toLowerCase() === (p.company ?? '').toLowerCase() &&
              r.position.toLowerCase() === (p.position ?? '').toLowerCase())
        )
        if (dup) {
          if (mode === 'merge') {
            // fill blanks only
            for (const k of Object.keys(p) as (keyof TrackerRow)[]) {
              const val = p[k]
              if ((dup[k] === '' || dup[k] === null || dup[k] === undefined) && val != null) {
                ;(dup as unknown as Record<string, unknown>)[k as string] = val
              }
            }
            dup.updatedAt = new Date().toISOString()
          }
          skipped++
          continue
        }
        const ts = new Date().toISOString()
        s.rows.push({
          id: randomUUID(),
          slug: p.slug ?? null,
          folderPath: null,
          position: p.position ?? '',
          company: p.company ?? '',
          salary: p.salary ?? '',
          location: p.location ?? '',
          datePosted: p.datePosted ?? null,
          applyUrl: p.applyUrl ?? '',
          dateApplied: p.dateApplied ?? null,
          coverLetter: p.coverLetter ?? false,
          coverLetterPath: p.coverLetterPath ?? null,
          resumePath: p.resumePath ?? null,
          statusKey: p.statusKey ?? 'not_applied',
          statusText: p.statusText ?? CANONICAL_STATUS_TEXT.not_applied,
          notes: '',
          source: 'xlsx-import',
          report: null,
          runId: null,
          createdAt: ts,
          updatedAt: ts
        })
        imported++
      }
    })

    void repo // repo reserved for future dedupe hooks
    return { imported, skipped, warnings }
  } finally {
    try {
      fs.unlinkSync(tmpCopy)
    } catch {
      /* ignore */
    }
  }
}

import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { ReportJson, ScanConflict, ScanResult, TrackerRow } from '@shared/types'
import { CANONICAL_STATUS_TEXT, normalizeStatus } from '@shared/status'
import { APPLICATIONS_DIR, DONE_PREFIX_RE, stripDonePrefix, toRel, todayISO } from '../paths'
import type { FolderFacts } from '../fsops/FolderScanner'
import type { Store } from './Store'

function nowISO(): string {
  return new Date().toISOString()
}

function blankRow(): TrackerRow {
  const ts = nowISO()
  return {
    id: randomUUID(),
    slug: null,
    folderPath: null,
    position: '',
    company: '',
    salary: '',
    location: '',
    datePosted: null,
    applyUrl: '',
    dateApplied: null,
    coverLetter: false,
    coverLetterPath: null,
    resumePath: null,
    statusKey: 'not_applied',
    statusText: CANONICAL_STATUS_TEXT.not_applied,
    notes: '',
    source: 'manual',
    report: null,
    runId: null,
    createdAt: ts,
    updatedAt: ts
  }
}

export class TrackerRepo {
  constructor(private store: Store) {}

  listRows(): TrackerRow[] {
    return this.store.state.rows
  }

  getRow(id: string): TrackerRow | undefined {
    return this.store.state.rows.find((r) => r.id === id)
  }

  findBySlug(slug: string): TrackerRow | undefined {
    return this.store.state.rows.find((r) => r.slug === slug)
  }

  upsertRow(patch: Partial<TrackerRow> & { id?: string }): TrackerRow {
    return this.store.mutate(['rows'], (s) => {
      let row = patch.id ? s.rows.find((r) => r.id === patch.id) : undefined
      if (!row) {
        row = { ...blankRow(), ...patch, id: patch.id ?? randomUUID() }
        s.rows.push(row)
      } else {
        const statusTextChanged =
          patch.statusText !== undefined && patch.statusText !== row.statusText
        const statusKeyChanged = patch.statusKey !== undefined && patch.statusKey !== row.statusKey
        Object.assign(row, patch)
        // Keep key/text coherent: explicit key wins, else re-derive from text.
        if (statusKeyChanged && !statusTextChanged) {
          row.statusText = CANONICAL_STATUS_TEXT[row.statusKey]
        } else if (statusTextChanged && !statusKeyChanged) {
          row.statusKey = normalizeStatus(row.statusText)
        }
      }
      row.updatedAt = nowISO()
      return row
    })
  }

  deleteRow(id: string): void {
    this.store.mutate(['rows'], (s) => {
      s.rows = s.rows.filter((r) => r.id !== id)
    })
  }

  /**
   * Stamp date + flip to applied. Optionally rename the folder to "[DONE] <name>"
   * (repo convention), atomically updating every stored path that references it.
   */
  markApplied(id: string, dateApplied?: string): TrackerRow {
    const row = this.getRow(id)
    if (!row) throw new Error(`row not found: ${id}`)

    let newFolderRel: string | null = null
    if (
      this.store.state.settings.renameFolderOnSubmit &&
      row.folderPath &&
      !DONE_PREFIX_RE.test(path.basename(row.folderPath))
    ) {
      const oldAbs = path.join(APPLICATIONS_DIR, path.basename(row.folderPath))
      const newName = `[DONE] ${path.basename(row.folderPath)}`
      const newAbs = path.join(APPLICATIONS_DIR, newName)
      try {
        if (fs.existsSync(oldAbs) && !fs.existsSync(newAbs)) {
          fs.renameSync(oldAbs, newAbs)
          newFolderRel = toRel(newAbs)
        }
      } catch (err) {
        console.error('[tracker] folder rename failed (continuing without):', err)
      }
    }

    return this.store.mutate(['rows'], (s) => {
      const r = s.rows.find((x) => x.id === id)!
      const oldFolderRel = r.folderPath
      r.statusKey = 'applied'
      r.statusText = 'applied'
      r.dateApplied = dateApplied ?? todayISO()
      if (newFolderRel && oldFolderRel) {
        const swap = (p: string | null): string | null =>
          p ? p.replace(oldFolderRel, newFolderRel!) : p
        r.folderPath = newFolderRel
        r.resumePath = swap(r.resumePath)
        r.coverLetterPath = swap(r.coverLetterPath)
      }
      r.updatedAt = nowISO()
      return r
    })
  }

  /** Create/refresh a row from a successful agent build. */
  upsertFromReport(report: ReportJson, runId: string, folderRel: string): TrackerRow {
    const existing = this.findBySlug(report.slug)
    const files = report.files ?? {}
    const resumeRel = files.resumePdf ? `${folderRel}/${files.resumePdf}` : null
    const coverRel = files.coverLetterPdf ? `${folderRel}/${files.coverLetterPdf}` : null
    return this.upsertRow({
      id: existing?.id,
      slug: report.slug,
      folderPath: folderRel,
      position: report.position || existing?.position || '',
      company: report.company || existing?.company || '',
      salary: report.salary || '',
      location: report.location || '',
      datePosted: report.datePosted ?? null,
      applyUrl: report.applyUrl || existing?.applyUrl || '',
      coverLetter: !!report.coverLetter,
      coverLetterPath: coverRel,
      resumePath: resumeRel,
      statusKey: 'not_applied',
      statusText: CANONICAL_STATUS_TEXT.not_applied,
      source: 'agent',
      report,
      runId
    })
  }

  /** Reconcile disk scan facts with the store. */
  applyScan(facts: FolderFacts[]): ScanResult {
    let created = 0
    let updated = 0
    const conflicts: ScanConflict[] = []
    const seenSlugs = new Set<string>()

    for (const f of facts) {
      seenSlugs.add(f.slug)
      const row = this.findBySlug(f.slug)
      if (!row) {
        this.upsertRow({
          slug: f.slug,
          folderPath: f.folderRel,
          position: f.positionGuess ?? '',
          company: f.companyGuess ?? stripDonePrefix(f.slug).replace(/_/g, ' '),
          salary: f.salaryGuess ?? '',
          applyUrl: f.applyUrlGuess ?? '',
          resumePath: f.files.resumePdf ? `${f.folderRel}/${f.files.resumePdf}` : null,
          coverLetterPath: f.files.coverPdf ? `${f.folderRel}/${f.files.coverPdf}` : null,
          coverLetter: !!f.files.coverPdf,
          statusKey: f.doneOnDisk ? 'applied' : 'not_applied',
          statusText: f.doneOnDisk ? 'applied' : CANONICAL_STATUS_TEXT.not_applied,
          source: 'scan'
        })
        created++
        continue
      }
      // Bind/refresh paths when the on-disk name changed (e.g. [DONE] prefix added by hand).
      let touched = false
      const patch: Partial<TrackerRow> & { id: string } = { id: row.id }
      if (row.folderPath !== f.folderRel) {
        patch.folderPath = f.folderRel
        if (row.resumePath && row.folderPath) {
          patch.resumePath = row.resumePath.replace(row.folderPath, f.folderRel)
        }
        if (row.coverLetterPath && row.folderPath) {
          patch.coverLetterPath = row.coverLetterPath.replace(row.folderPath, f.folderRel)
        }
        touched = true
      }
      if (!row.resumePath && f.files.resumePdf) {
        patch.resumePath = `${f.folderRel}/${f.files.resumePdf}`
        touched = true
      }
      if (!row.coverLetterPath && f.files.coverPdf) {
        patch.coverLetterPath = `${f.folderRel}/${f.files.coverPdf}`
        patch.coverLetter = true
        touched = true
      }
      if (touched) {
        this.upsertRow(patch)
        updated++
      }
      if (f.doneOnDisk && row.statusKey === 'not_applied') {
        conflicts.push({
          slug: f.slug,
          kind: 'done-on-disk-but-not-applied',
          detail: `Folder is [DONE] on disk but tracker row is "${row.statusText}"`
        })
      }
    }

    // Rows whose folder disappeared from disk.
    for (const row of this.store.state.rows) {
      if (row.slug && row.folderPath && !seenSlugs.has(row.slug)) {
        conflicts.push({
          slug: row.slug,
          kind: 'row-folder-missing',
          detail: `Tracker row "${row.position} @ ${row.company}" points at a folder that no longer exists`
        })
      }
    }

    return { created, updated, conflicts }
  }
}

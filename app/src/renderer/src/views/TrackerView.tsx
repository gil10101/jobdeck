import { useMemo, useState } from 'react'
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState
} from '@tanstack/react-table'
import type { StatusKey, TrackerRow } from '@shared/types'
import { STATUS_COLOR_STYLES, STATUS_LABELS, statusColor } from '@shared/status'
import ConfirmDialog from '../components/ConfirmDialog'
import { call } from '../api'
import { useApp } from '../store'
import { buildColumns } from './grid/columns'

const FILTER_KEYS: (StatusKey | 'all')[] = [
  'all',
  'not_applied',
  'applied',
  'interview',
  'offer',
  'rejected'
]

export default function TrackerView(): JSX.Element {
  const rows = useApp((s) => s.rows)
  const toast = useApp((s) => s.toast)
  const refreshRows = useApp((s) => s.refreshRows)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusKey | 'all'>('all')
  const [sorting, setSorting] = useState<SortingState>([])
  const [confirmImport, setConfirmImport] = useState(false)
  const [busy, setBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<TrackerRow | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const matched = rows.filter((r) => {
      if (statusFilter !== 'all') {
        if (statusFilter === 'rejected') {
          if (r.statusKey !== 'rejected' && r.statusKey !== 'withdrawn') return false
        } else if (r.statusKey !== statusFilter) return false
      }
      if (!q) return true
      return (
        r.position.toLowerCase().includes(q) ||
        r.company.toLowerCase().includes(q) ||
        r.location.toLowerCase().includes(q)
      )
    })
    // Default order: newest batch first (grouped by the day rows were added).
    return [...matched].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }, [rows, search, statusFilter])

  /** Row ids that start a new intake batch (calendar day) — get a 2px divider. */
  const batchStarts = useMemo(() => {
    const starts = new Set<string>()
    let prevDay: string | null = null
    for (const r of filtered) {
      const day = (r.createdAt ?? '').slice(0, 10)
      if (prevDay !== null && day !== prevDay) starts.add(r.id)
      prevDay = day
    }
    return starts
  }, [filtered])

  const columns = useMemo(() => buildColumns(), [])
  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    meta: { requestDelete: (row: TrackerRow) => setDeleteTarget(row) }
  })

  const doDelete = async (): Promise<void> => {
    if (!deleteTarget) return
    setBusy(true)
    try {
      await call('tracker:delete', { id: deleteTarget.id, deleteFolder: true })
      toast(`Deleted ${deleteTarget.position} @ ${deleteTarget.company} (folder removed)`, 'success')
      await refreshRows()
    } catch (err) {
      toast(String(err), 'error')
    } finally {
      setBusy(false)
      setDeleteTarget(null)
    }
  }

  const doImport = async (mode: 'replace' | 'merge'): Promise<void> => {
    setBusy(true)
    try {
      const { path } = await call('app:pickFile', {
        filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }]
      })
      if (!path) return
      const res = await call('tracker:importXlsx', { mode, filePath: path })
      toast(`Imported ${res.imported} rows (${res.skipped} duplicates skipped)`, 'success')
      await refreshRows()
    } catch (err) {
      toast(`Import failed: ${String(err)}`, 'error')
    } finally {
      setBusy(false)
      setConfirmImport(false)
    }
  }

  const doExport = async (): Promise<void> => {
    setBusy(true)
    try {
      const res = await call('tracker:exportXlsx', undefined)
      toast(`Exported to ${res.path}`, 'success')
    } catch (err) {
      toast(`Export failed: ${String(err)}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const doScan = async (): Promise<void> => {
    setBusy(true)
    try {
      const res = await call('scan:run', undefined)
      toast(
        `Scan: ${res.created} new, ${res.updated} updated${
          res.conflicts.length ? `, ${res.conflicts.length} conflicts` : ''
        }`,
        res.conflicts.length ? 'info' : 'success'
      )
      for (const c of res.conflicts.slice(0, 3)) toast(`⚠ ${c.slug}: ${c.detail}`)
      await refreshRows()
    } catch (err) {
      toast(`Scan failed: ${String(err)}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length }
    for (const r of rows) {
      const k = r.statusKey === 'withdrawn' ? 'rejected' : r.statusKey
      c[k] = (c[k] ?? 0) + 1
    }
    return c
  }, [rows])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-edge bg-panel px-4 py-2.5">
        <h1 className="mr-2 text-sm font-semibold text-gray-100">Tracker</h1>
        <input
          className="input w-56"
          placeholder="Search position / company…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex items-center gap-1">
          {FILTER_KEYS.map((key) => {
            const active = statusFilter === key
            const dot = key === 'all' ? '#8b93a3' : STATUS_COLOR_STYLES[statusColor(key)].dot
            return (
              <button
                key={key}
                onClick={() => setStatusFilter(key)}
                className={`chip transition-colors ${active ? 'border-cyan-700 bg-cyan-950/60 text-cyan-200' : 'hover:border-gray-500'}`}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} />
                {key === 'all' ? 'All' : STATUS_LABELS[key as StatusKey]}
                <span className="text-gray-500">{counts[key] ?? 0}</span>
              </button>
            )
          })}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button className="btn" disabled={busy} onClick={() => setConfirmImport(true)}>
            ⇪ Import xlsx
          </button>
          <button className="btn" disabled={busy} onClick={doExport}>
            ⇓ Export xlsx
          </button>
          <button className="btn" disabled={busy} onClick={doScan}>
            ⟳ Rescan folders
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-panel">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    onClick={header.column.getToggleSortingHandler()}
                    className="cursor-pointer select-none whitespace-nowrap border-b border-edge px-3 py-2 text-left font-semibold text-gray-400 hover:text-gray-200"
                    style={{ width: header.getSize() }}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {{ asc: ' ↑', desc: ' ↓' }[header.column.getIsSorted() as string] ?? ''}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className={`border-b border-edge/50 hover:bg-panel2 ${
                  sorting.length === 0 && batchStarts.has(row.original.id)
                    ? 'border-t-2 border-t-edge'
                    : ''
                }`}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-3 py-2 align-top">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-16 text-center text-gray-500">
                  {rows.length === 0
                    ? 'No applications yet. Click "Import xlsx" to migrate applications.xlsx, or "Rescan folders" to discover application folders on disk.'
                    : 'Nothing matches the current filter.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`Delete "${deleteTarget?.position ?? ''}" @ ${deleteTarget?.company ?? ''}?`}
        body="Removes the tracker row AND deletes the application folder (résumé, cover letter, answers) from disk. If it came from a scout candidate, that candidate is marked rejected so it is never suggested again. This cannot be undone."
        confirmLabel={busy ? 'Deleting…' : 'Delete application'}
        danger
        onConfirm={() => void doDelete()}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={confirmImport}
        title="Import from applications.xlsx"
        body="Merge keeps existing app rows and only adds/fills from the xlsx. Replace wipes the app tracker first and re-imports everything (folders are re-bound automatically). The xlsx file itself is never modified."
        confirmLabel="Merge import"
        onConfirm={() => void doImport('merge')}
        onCancel={() => setConfirmImport(false)}
      />
      {confirmImport && (
        <div className="fixed bottom-24 right-4 z-[95]">
          <button className="btn btn-danger" onClick={() => void doImport('replace')}>
            …or Replace-import (wipe app rows first)
          </button>
        </div>
      )}
    </div>
  )
}

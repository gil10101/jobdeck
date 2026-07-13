import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'
import type { TrackerRow } from '@shared/types'
import StatusBadge from '../../components/StatusBadge'
import RatingBadge from '../../components/RatingBadge'
import { FolderIcon } from '../../components/icons'
import { call } from '../../api'
import { useApp, companyKey } from '../../store'

const col = createColumnHelper<TrackerRow>()

function GlassdoorCell({ row }: { row: TrackerRow }): JSX.Element {
  const info = useApp((s) => s.companies[companyKey(row.company)])
  return <RatingBadge rating={info?.rating ?? null} url={info?.url} />
}

function ActionButton({
  label,
  title,
  onClick
}: {
  label: React.ReactNode
  title: string
  onClick: () => void
}): JSX.Element {
  return (
    <button
      title={title}
      className="inline-flex items-center rounded border border-edge bg-panel2 px-1.5 py-0.5 text-[10px] text-gray-300 hover:border-cyan-500 hover:text-cyan-200"
      onClick={onClick}
    >
      {label}
    </button>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildColumns(): ColumnDef<TrackerRow, any>[] {
  return [
    col.accessor('position', {
      header: 'Position',
      size: 260,
      cell: (info) => (
        <button
          className="text-left font-medium text-gray-100 hover:text-cyan-300 hover:underline"
          onClick={() => useApp.getState().navigate({ view: 'detail', rowId: info.row.original.id })}
        >
          {info.getValue() || '(untitled)'}
        </button>
      )
    }),
    col.accessor('company', {
      header: 'Company',
      size: 180,
      cell: (info) => <span className="text-gray-200">{info.getValue()}</span>
    }),
    col.display({
      id: 'glassdoor',
      header: 'Glassdoor',
      size: 70,
      cell: (info) => <GlassdoorCell row={info.row.original} />
    }),
    col.accessor('salary', {
      header: 'Salary',
      size: 140,
      cell: (info) => <span className="text-gray-400">{info.getValue()}</span>
    }),
    col.accessor('location', {
      header: 'Location',
      size: 160,
      cell: (info) => <span className="text-gray-400">{info.getValue()}</span>
    }),
    col.accessor('datePosted', {
      header: 'Posted',
      size: 90,
      cell: (info) => <span className="whitespace-nowrap text-gray-500">{info.getValue() ?? ''}</span>
    }),
    col.accessor('dateApplied', {
      header: 'Applied',
      size: 90,
      cell: (info) => (
        <span className="whitespace-nowrap text-gray-400">{info.getValue() ?? ''}</span>
      )
    }),
    col.accessor('coverLetter', {
      header: 'CL',
      size: 40,
      cell: (info) => (
        <span className={info.getValue() ? 'text-green-400' : 'text-gray-600'}>
          {info.getValue() ? 'Y' : 'N'}
        </span>
      )
    }),
    col.accessor('statusKey', {
      header: 'Status',
      size: 200,
      cell: (info) => {
        const row = info.row.original
        return (
          <StatusBadge
            statusKey={row.statusKey}
            statusText={row.statusText}
            editable
            onChange={(key) => {
              void call('tracker:upsert', { id: row.id, statusKey: key }).catch((err) =>
                useApp.getState().toast(String(err), 'error')
              )
            }}
          />
        )
      }
    }),
    col.display({
      id: 'actions',
      header: '',
      size: 150,
      cell: (info) => {
        const row = info.row.original
        const nav = useApp.getState().navigate
        const toast = useApp.getState().toast
        return (
          <div className="flex items-center gap-1">
            <ActionButton
              label="Detail"
              title="Open application detail"
              onClick={() => nav({ view: 'detail', rowId: row.id })}
            />
            <ActionButton
              label="Apply"
              title="Open embedded browser at the apply link"
              onClick={() => nav({ view: 'apply', rowId: row.id })}
            />
            <ActionButton
              label={<FolderIcon />}
              title="Open folder in Explorer"
              onClick={() => {
                if (!row.folderPath) {
                  toast('No folder bound to this row (run Rescan folders)', 'error')
                  return
                }
                void call('app:openFolder', { relPath: row.folderPath }).catch((err) =>
                  toast(String(err), 'error')
                )
              }}
            />
            <ActionButton
              label="✕"
              title="Delete this application (removes its folder too)"
              onClick={() => {
                const meta = info.table.options.meta as
                  | { requestDelete?: (row: TrackerRow) => void }
                  | undefined
                meta?.requestDelete?.(row)
              }}
            />
          </div>
        )
      }
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ] as ColumnDef<TrackerRow, any>[]
}

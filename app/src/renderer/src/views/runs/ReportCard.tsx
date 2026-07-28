import type { ReportJson, RunMeta } from '@shared/types'
import { ArrowRight, Check as CheckIcon, X as XIcon } from 'lucide-react'
import { FolderIcon } from '../../components/icons'
import { call } from '../../api'
import { useApp } from '../../store'

function Check({ ok, label }: { ok: boolean; label: string }): JSX.Element {
  return (
    <span className={`chip ${ok ? 'border-green-800 text-green-300' : 'border-red-900 text-red-300'}`}>
      {ok ? <CheckIcon size={11} /> : <XIcon size={11} />} {label}
    </span>
  )
}

export default function ReportCard({
  meta,
  report
}: {
  meta: RunMeta
  report: ReportJson | null
}): JSX.Element | null {
  const rows = useApp((s) => s.rows)
  const navigate = useApp((s) => s.navigate)
  const toast = useApp((s) => s.toast)
  if (meta.status !== 'succeeded' || !report) return null

  const row = rows.find((r) => r.slug === report.slug)

  return (
    <div className="border-t border-edge bg-panel px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-gray-100">
          {report.position} <span className="text-gray-500">@</span> {report.company}
        </span>
        <span className="text-[11px] text-gray-500">{report.salary}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Check ok={report.resumePages === 1} label={`resume ${report.resumePages}p`} />
        {report.coverLetter && (
          <Check ok={report.coverLetterPages === 1} label={`cover ${report.coverLetterPages}p`} />
        )}
        <Check ok={String(report.noEmDashes).toLowerCase() === 'confirmed'} label="no em-dashes" />
      </div>
      {report.fitNote && (
        <div className="fit-note mt-2 px-3 py-2 text-xs leading-relaxed">{report.fitNote}</div>
      )}
      {report.problems?.length > 0 && (
        <div className="mt-2 text-xs text-red-300">
          Problems: {report.problems.join('; ')}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        {row && (
          <>
            <button className="btn btn-primary" onClick={() => navigate({ view: 'detail', rowId: row.id })}>
              Open Detail
            </button>
            <button className="btn" onClick={() => navigate({ view: 'apply', rowId: row.id })}>
              Apply <ArrowRight size={13} />
            </button>
          </>
        )}
        {meta.folderPath && (
          <button
            className="btn"
            onClick={() =>
              void call('app:openFolder', { relPath: meta.folderPath! }).catch((err) =>
                toast(String(err), 'error')
              )
            }
          >
            <FolderIcon /> Open folder
          </button>
        )}
      </div>
    </div>
  )
}

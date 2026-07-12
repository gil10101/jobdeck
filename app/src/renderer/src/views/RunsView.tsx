import { useEffect, useState } from 'react'
import type { RunMeta } from '@shared/types'

function ScoutOutcomeBar({
  meta,
  onReview
}: {
  meta: RunMeta
  onReview: () => void
}): JSX.Element {
  const [notesOpen, setNotesOpen] = useState(false)
  return (
    <div className="border-t border-edge bg-panel">
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="text-xs font-medium text-gray-200">{meta.summary ?? 'Scout finished'}</span>
        <button className="btn btn-primary" onClick={onReview}>
          Review candidates →
        </button>
        {meta.problems && meta.problems.length > 0 && (
          <button className="btn ml-auto" onClick={() => setNotesOpen((v) => !v)}>
            {notesOpen ? '▾' : '▸'} Scout notes ({meta.problems.length})
          </button>
        )}
      </div>
      {notesOpen && meta.problems && (
        <ul className="max-h-44 overflow-auto border-t border-edge/50 px-5 py-2.5">
          {meta.problems.map((p, i) => (
            <li
              key={i}
              className="list-disc py-0.5 text-[11px] leading-relaxed text-gray-400 marker:text-gray-600"
            >
              {p}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
import { call } from '../api'
import { useApp } from '../store'
import { useRunEvents } from '../hooks/useRunEvents'
import Timeline from './runs/Timeline'
import ReportCard from './runs/ReportCard'

const STATUS_STYLE: Record<RunMeta['status'], string> = {
  queued: 'text-yellow-300',
  running: 'text-cyan-300',
  succeeded: 'text-green-400',
  failed: 'text-red-400',
  cancelled: 'text-gray-500'
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function RunsView({ runId }: { runId?: string }): JSX.Element {
  const runs = useApp((s) => s.runs)
  const navigate = useApp((s) => s.navigate)
  const rows = useApp((s) => s.rows)
  const [selected, setSelected] = useState<string | null>(runId ?? null)
  const { meta, events } = useRunEvents(selected)

  useEffect(() => {
    if (runId) setSelected(runId)
    else if (!selected && runs.length) setSelected(runs[0].id)
  }, [runId, runs.length])

  const totalCost = runs.reduce((sum, r) => sum + (r.costUsd ?? 0), 0)
  const report = meta?.slug ? (rows.find((r) => r.slug === meta.slug)?.report ?? null) : null

  return (
    <div className="flex h-full">
      <div className="flex w-72 shrink-0 flex-col border-r border-edge bg-panel">
        <div className="flex items-center justify-between border-b border-edge px-3 py-2.5">
          <h1 className="text-sm font-semibold text-gray-100">Runs</h1>
          <span
            className="text-[10px] text-gray-500"
            title="Estimated API-equivalent usage. Runs use your Claude subscription login — nothing is billed per run."
          >
            usage ≈${totalCost.toFixed(2)}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {runs.length === 0 && (
            <div className="p-4 text-xs text-gray-600">
              No runs yet. Build an application from the Intake view.
            </div>
          )}
          {runs.map((r) => (
            <button
              key={r.id}
              onClick={() => {
                setSelected(r.id)
                navigate({ view: 'runs', runId: r.id })
              }}
              className={`flex w-full flex-col gap-0.5 border-b border-edge/50 px-3 py-2 text-left hover:bg-panel2 ${
                selected === r.id ? 'bg-panel2' : ''
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-bold uppercase ${STATUS_STYLE[r.status]}`}>
                  {r.status === 'running' && (
                    <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
                  )}
                  {r.status}
                </span>
                {r.kind !== 'build' && (
                  <span className="rounded border border-cyan-800 px-1 text-[9px] uppercase text-cyan-300">
                    {r.kind}
                  </span>
                )}
                <span className="ml-auto text-[10px] text-gray-600">{relTime(r.startedAt)}</span>
              </div>
              <div className="truncate text-xs font-medium text-gray-200">{r.slug}</div>
              {r.summary && <div className="truncate text-[10px] text-green-300">{r.summary}</div>}
              {r.costUsd != null && (
                <div
                  className="text-[10px] text-gray-600"
                  title="Estimated API-equivalent usage — covered by your subscription, not billed"
                >
                  ≈${r.costUsd.toFixed(2)} · {Math.round((r.durationMs ?? 0) / 1000)}s
                </div>
              )}
              {r.errorText && (
                <div className="truncate text-[10px] text-red-400">{r.errorText}</div>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {meta ? (
          <>
            <div className="flex items-center gap-3 border-b border-edge bg-panel px-4 py-2.5">
              <span className={`text-xs font-bold uppercase ${STATUS_STYLE[meta.status]}`}>
                {meta.status}
              </span>
              {meta.kind !== 'build' && (
                <span className="rounded border border-cyan-800 px-1.5 py-0.5 text-[10px] uppercase text-cyan-300">
                  {meta.kind}
                </span>
              )}
              <span className="truncate text-sm font-semibold text-gray-100">{meta.slug}</span>
              {meta.summary && (
                <span className="max-w-[260px] truncate text-[11px] text-green-300" title={meta.summary}>
                  {meta.summary}
                </span>
              )}
              {meta.costUsd != null && (
                <span
                  className="text-[11px] text-gray-500"
                  title="Estimated API-equivalent usage — covered by your subscription, not billed"
                >
                  usage ≈${meta.costUsd.toFixed(2)} · {meta.numTurns ?? '?'} turns
                </span>
              )}
              {(meta.status === 'running' || meta.status === 'queued') && (
                <button
                  className="btn btn-danger ml-auto"
                  onClick={() => void call('runs:cancel', { runId: meta.id })}
                >
                  ■ Cancel
                </button>
              )}
            </div>
            <Timeline events={events} />
            {meta.kind === 'scout' && meta.status === 'succeeded' ? (
              <ScoutOutcomeBar meta={meta} onReview={() => navigate({ view: 'scout' })} />
            ) : (
              <ReportCard meta={meta} report={report} />
            )}
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-gray-600">
            Select a run
          </div>
        )}
      </div>
    </div>
  )
}

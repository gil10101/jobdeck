import { useEffect, useState } from 'react'
import { ArrowRight, ChevronDown, ChevronRight, RefreshCw, Square } from 'lucide-react'
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
          Review candidates <ArrowRight size={13} />
        </button>
        {meta.problems && meta.problems.length > 0 && (
          <button className="btn ml-auto" onClick={() => setNotesOpen((v) => !v)}>
            {notesOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Scout notes (
            {meta.problems.length})
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
import ThinkingDots from '../components/ThinkingDots'

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

function ctxPct(tokens: number, window: number): number {
  return Math.min(100, Math.round((tokens / window) * 100))
}

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

  const totalTokens = runs.reduce((sum, r) => sum + (r.totalTokens ?? 0), 0)
  const report = meta?.slug ? (rows.find((r) => r.slug === meta.slug)?.report ?? null) : null

  return (
    <div className="flex h-full">
      <div className="flex w-72 shrink-0 flex-col border-r border-edge bg-panel">
        <div className="flex items-center justify-between border-b border-edge px-3 py-2.5">
          <h1 className="text-sm font-semibold text-gray-100">Runs</h1>
          {totalTokens > 0 && (
            <span
              className="text-[10px] text-gray-500"
              title="Total tokens across all runs — usage, not a bill."
            >
              usage {fmtTokens(totalTokens)} tokens
            </span>
          )}
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
                  {r.status === 'running' && <ThinkingDots className="mr-1.5" />}
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
              {(r.contextTokens != null || r.durationMs != null) && (
                <div
                  className="text-[10px] text-gray-600"
                  title="Context window used at the end of the run — usage, not a bill"
                >
                  {r.contextTokens != null && r.contextWindow
                    ? `ctx ${ctxPct(r.contextTokens, r.contextWindow)}% · `
                    : ''}
                  {Math.round((r.durationMs ?? 0) / 1000)}s
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
              {meta.status === 'running' && <ThinkingDots />}
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
              {(meta.contextTokens != null || meta.totalTokens != null) && (
                <span
                  className="text-[11px] text-gray-500"
                  title="Context window used at the end of the run, and total tokens consumed — usage, not a bill"
                >
                  {meta.contextTokens != null && meta.contextWindow
                    ? `ctx ${ctxPct(meta.contextTokens, meta.contextWindow)}%${
                        meta.totalTokens ? ` · ${fmtTokens(meta.totalTokens)} tokens` : ''
                      }`
                    : `${fmtTokens(meta.totalTokens ?? 0)} tokens`}{' '}
                  · {meta.numTurns ?? '?'} turns
                </span>
              )}
              {(meta.status === 'running' || meta.status === 'queued') && (
                <button
                  className="btn btn-danger ml-auto"
                  onClick={() => void call('runs:cancel', { runId: meta.id })}
                >
                  <Square size={11} fill="currentColor" /> Cancel
                </button>
              )}
              {meta.kind === 'build' &&
                (meta.status === 'failed' || meta.status === 'cancelled') && (
                  <button
                    className="btn btn-primary ml-auto"
                    title="Restart this build with its original input"
                    onClick={() =>
                      void call('runs:rebuild', { runId: meta.id })
                        .then((m) => {
                          setSelected(m.id)
                          navigate({ view: 'runs', runId: m.id })
                        })
                        .catch((err) => useApp.getState().toast(String(err), 'error'))
                    }
                  >
                    <RefreshCw size={13} /> Rebuild
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

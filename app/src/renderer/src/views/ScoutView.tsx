import { useEffect, useState } from 'react'
import type { CandidateJob } from '@shared/types'
import { call } from '../api'
import { useApp } from '../store'
import { candidateSections } from '../lib/postingSections'

function scoreColor(score: number | null): string {
  if (score === null) return 'var(--muted)'
  if (score >= 80) return 'var(--st-green-dot)'
  if (score >= 60) return 'var(--st-yellow-dot)'
  return 'var(--st-red-dot)'
}

function FitPill({ score }: { score: number | null }): JSX.Element {
  const color = scoreColor(score)
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold"
      style={{ color, borderColor: color }}
      title="Agent fit score (0-100) against your CLAUDE.md profile"
    >
      {score ?? '–'}
      <span className="text-[8px] font-normal uppercase opacity-70">fit</span>
    </span>
  )
}

interface Actions {
  accept: (id: string) => Promise<void>
  reject: (id: string) => Promise<void>
  busyId: string | null
}

function ActionButtons({ c, actions }: { c: CandidateJob; actions: Actions }): JSX.Element {
  const navigate = useApp((s) => s.navigate)
  const busy = actions.busyId === c.id
  if (c.state === 'accepted') {
    return (
      <>
        <span className="chip border-green-800 text-green-300">✓ accepted</span>
        {c.buildRunId && (
          <button className="btn" onClick={() => navigate({ view: 'runs', runId: c.buildRunId! })}>
            View build run
          </button>
        )}
      </>
    )
  }
  if (c.state === 'rejected') {
    return <span className="chip text-muted">✗ rejected</span>
  }
  return (
    <>
      <button
        className="btn btn-green"
        disabled={busy}
        title="Add a tracker row and queue the résumé + cover-letter build"
        onClick={() => void actions.accept(c.id)}
      >
        ✓ Accept
      </button>
      <button
        className="btn"
        disabled={busy}
        title="Never suggest this posting again"
        onClick={() => void actions.reject(c.id)}
      >
        ✗ Reject
      </button>
    </>
  )
}

function CandidateChips({ c }: { c: CandidateJob }): JSX.Element {
  return (
    <div className="flex flex-wrap gap-1.5">
      {c.salary && <span className="chip">{c.salary}</span>}
      {c.location && <span className="chip">{c.location}</span>}
      {c.workModel !== 'unknown' && <span className="chip">{c.workModel}</span>}
      {c.datePosted && <span className="chip">posted {c.datePosted}</span>}
      <span className="chip text-muted">{c.source}</span>
    </div>
  )
}

function Section({
  title,
  items,
  chips
}: {
  title: string
  items: string[]
  chips?: boolean
}): JSX.Element | null {
  if (!items.length) return null
  return (
    <div className="mb-3">
      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-muted">{title}</div>
      {chips ? (
        <div className="flex flex-wrap gap-1.5">
          {items.map((s, i) => (
            <span key={i} className="chip">
              {s}
            </span>
          ))}
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((s, i) => (
            <li
              key={i}
              className="ml-4 list-disc text-[11px] leading-relaxed text-gray-300 marker:text-gray-600"
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Docked right panel with structured posting details. */
function PostingPanel({
  c,
  actions,
  width,
  onClose
}: {
  c: CandidateJob | null
  actions: Actions
  width: number
  onClose: () => void
}): JSX.Element {
  const toast = useApp((s) => s.toast)
  const [rawOpen, setRawOpen] = useState(false)

  useEffect(() => {
    setRawOpen(false)
  }, [c?.id])

  useEffect(() => {
    if (!c) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [c, onClose])

  const sections = c ? candidateSections(c) : null
  const hasStructure =
    sections && Object.values(sections).some((arr) => (arr as string[]).length > 0)

  return (
    <div
      className={`shrink-0 overflow-hidden bg-panel ${c ? '' : 'border-l-0'}`}
      style={{ width: c ? width : 0, transition: 'width 150ms' }}
    >
      {c && sections && (
        <div className="flex h-full flex-col" style={{ width }}>
          <div className="flex items-start gap-3 border-b border-edge px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <FitPill score={c.fitScore} />
                <span className="truncate text-sm font-semibold text-gray-100">
                  {c.position} <span className="text-gray-500">@</span> {c.company}
                </span>
              </div>
              <div className="mt-2">
                <CandidateChips c={c} />
              </div>
            </div>
            <button className="btn shrink-0 px-2" onClick={onClose} title="Close (Esc)">
              ✕
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-4">
            {c.fitNote && (
              <div className="fit-note mb-3 px-3 py-2">
                <div className="fit-note-label text-[10px] font-bold uppercase tracking-wide">
                  Fit note (honest)
                </div>
                <div className="mt-1 text-[11px] leading-relaxed">{c.fitNote}</div>
              </div>
            )}
            {c.applyUrl && (
              <div className="mb-3 flex items-center gap-2 rounded-md border border-cyan-900/60 bg-cyan-950/30 px-3 py-2">
                <span
                  className="min-w-0 flex-1 truncate text-[11px] text-cyan-300"
                  title={c.applyUrl}
                >
                  {c.applyUrl}
                </span>
                <button
                  className="btn px-2 py-0.5 text-[10px]"
                  onClick={() =>
                    void call('app:copy', { text: c.applyUrl }).catch((err) =>
                      toast(String(err), 'error')
                    )
                  }
                >
                  copy
                </button>
                <button
                  className="btn px-2 py-0.5 text-[10px]"
                  onClick={() =>
                    void call('app:openExternal', { url: c.applyUrl }).catch((err) =>
                      toast(String(err), 'error')
                    )
                  }
                >
                  open ↗
                </button>
              </div>
            )}

            <Section title="Skills" items={sections.skills} chips />
            <Section title="Minimum requirements" items={sections.minimum} />
            <Section title="Preferred requirements" items={sections.preferred} />
            <Section title="Education" items={sections.education} />
            <Section title="Responsibilities" items={sections.responsibilities} />
            <Section title="Benefits" items={sections.benefits} />

            {c.postingText && (
              <div className="mt-1">
                <button className="btn" onClick={() => setRawOpen((v) => !v)}>
                  {rawOpen ? '▾ Hide full posting' : '▸ Full posting text'}
                </button>
                {(rawOpen || !hasStructure) && (
                  <pre className="mt-2 whitespace-pre-wrap font-sans text-[11px] leading-relaxed text-gray-400">
                    {c.postingText}
                  </pre>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 border-t border-edge px-4 py-3">
            <ActionButtons c={c} actions={actions} />
          </div>
        </div>
      )}
    </div>
  )
}

function CandidateCard({
  c,
  actions,
  selected,
  onShowPosting
}: {
  c: CandidateJob
  actions: Actions
  selected: boolean
  onShowPosting: (c: CandidateJob) => void
}): JSX.Element {
  return (
    <div
      className={`panel cursor-pointer p-3 transition-colors ${
        selected ? 'border-cyan-700' : 'hover:border-gray-500'
      }`}
      onClick={() => onShowPosting(c)}
    >
      <div className="flex items-center gap-2">
        <FitPill score={c.fitScore} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-100">
          {c.position} <span className="text-gray-500">@</span> {c.company}
        </span>
        <span className="shrink-0 text-[10px] text-gray-600">{selected ? '◂ open' : 'details ▸'}</span>
      </div>
      <div className="mt-2">
        <CandidateChips c={c} />
      </div>
      {c.fitNote && (
        <div
          className="mt-2 line-clamp-2 text-[11px] leading-relaxed"
          style={{ color: 'var(--note-fg)' }}
        >
          {c.fitNote}
        </div>
      )}
      <div className="mt-2.5 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <ActionButtons c={c} actions={actions} />
      </div>
    </div>
  )
}

const PANEL_WIDTH_KEY = 'scout.panelWidth'

export default function ScoutView(): JSX.Element {
  const candidates = useApp((s) => s.candidates)
  const runs = useApp((s) => s.runs)
  const toast = useApp((s) => s.toast)
  const navigate = useApp((s) => s.navigate)
  const [instructions, setInstructions] = useState('')
  const [filter, setFilter] = useState<'new' | 'accepted' | 'rejected'>('new')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [minFit, setMinFit] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [postingFor, setPostingFor] = useState<string | null>(null)
  const [panelWidth, setPanelWidth] = useState(() => {
    const saved = Number(localStorage.getItem(PANEL_WIDTH_KEY))
    return saved >= 360 && saved <= 900 ? saved : 460
  })

  // Adjustable divider between the candidate list and the details panel.
  const startDrag = (e: React.MouseEvent): void => {
    e.preventDefault()
    const onMove = (ev: MouseEvent): void => {
      const w = Math.min(900, Math.max(360, window.innerWidth - ev.clientX))
      setPanelWidth(w)
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setPanelWidth((w) => {
        localStorage.setItem(PANEL_WIDTH_KEY, String(w))
        return w
      })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const liveScout = runs.find(
    (r) => r.kind === 'scout' && (r.status === 'running' || r.status === 'queued')
  )
  const lastScout = runs.find((r) => r.kind === 'scout' && r.status === 'succeeded')

  const actions: Actions = {
    busyId,
    accept: async (id) => {
      setBusyId(id)
      try {
        const { run } = await call('candidates:accept', { id })
        toast(`Accepted — row added, build queued (${run.slug})`, 'success')
        void useApp.getState().refreshRows()
        void useApp.getState().refreshRuns()
      } catch (err) {
        toast(String(err), 'error')
      } finally {
        setBusyId(null)
      }
    },
    reject: async (id) => {
      await call('candidates:reject', { id }).catch(() => undefined)
      setPostingFor((cur) => (cur === id ? null : cur))
    }
  }

  const startScout = async (): Promise<void> => {
    try {
      const meta = await call('scout:start', { instructions: instructions || undefined })
      toast('Scout agent launched — watch it work in Runs', 'success')
      void useApp.getState().refreshRuns()
      navigate({ view: 'runs', runId: meta.id })
    } catch (err) {
      toast(String(err), 'error')
    }
  }

  const sources = [...new Set(candidates.map((c) => c.source))].sort()
  const shown = candidates.filter(
    (c) =>
      c.state === filter &&
      (sourceFilter === 'all' || c.source === sourceFilter) &&
      (c.fitScore ?? 0) >= minFit
  )
  // Batches: group by the scout run that found them, newest batch first;
  // fit-score order within each batch.
  const batchOrder: string[] = []
  const batches = new Map<string, CandidateJob[]>()
  for (const c of [...shown].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))) {
    if (!batches.has(c.scoutRunId)) {
      batches.set(c.scoutRunId, [])
      batchOrder.push(c.scoutRunId)
    }
    batches.get(c.scoutRunId)!.push(c)
  }
  for (const list of batches.values()) {
    list.sort((a, b) => (b.fitScore ?? -1) - (a.fitScore ?? -1))
  }
  const batchLabel = (list: CandidateJob[]): string => {
    const d = new Date(list[0]?.createdAt ?? 0)
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  }
  const counts = {
    new: candidates.filter((c) => c.state === 'new').length,
    accepted: candidates.filter((c) => c.state === 'accepted').length,
    rejected: candidates.filter((c) => c.state === 'rejected').length
  }
  const drawerCandidate = candidates.find((c) => c.id === postingFor) ?? null

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-edge bg-panel px-4 py-2.5">
        <h1 className="text-sm font-semibold text-gray-100">Scout</h1>
        <input
          className="input w-96"
          placeholder='Optional instructions, e.g. "focus on healthcare analytics" or "city jobs only"…'
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !liveScout && void startScout()}
        />
        {liveScout ? (
          <button className="btn" onClick={() => navigate({ view: 'runs', runId: liveScout.id })}>
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
            Scouting… view run
          </button>
        ) : (
          <button className="btn btn-primary" onClick={startScout}>
            ⌕ Scout now
          </button>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <select
            className="input px-1.5 py-1 text-[11px]"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            title="Filter by source board"
          >
            <option value="all">all sources</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            className="input px-1.5 py-1 text-[11px]"
            value={minFit}
            onChange={(e) => setMinFit(Number(e.target.value))}
            title="Minimum fit score"
          >
            <option value={0}>any fit</option>
            <option value={60}>fit ≥ 60</option>
            <option value={70}>fit ≥ 70</option>
            <option value={80}>fit ≥ 80</option>
            <option value={90}>fit ≥ 90</option>
          </select>
          <span className="mx-0.5 h-4 w-px bg-edge" />
          {(['new', 'accepted', 'rejected'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`chip ${filter === f ? 'border-cyan-700 bg-cyan-950/60 text-cyan-200' : 'hover:border-gray-500'}`}
            >
              {f} <span className="text-gray-500">{counts[f]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {shown.length === 0 ? (
            <div className="mx-auto mt-16 max-w-md text-center text-xs leading-relaxed text-gray-500">
              {filter === 'new' ? (
                <>
                  <div className="text-sm font-semibold text-gray-300">No candidates to review</div>
                  <p className="mt-2">
                    Hit <span className="text-cyan-300">Scout now</span> and a Claude Code agent
                    will sweep jobright, LinkedIn, and freehire against your criteria, score each
                    match, and drop the keepers here for review.
                  </p>
                  <p className="mt-2">
                    <span className="text-green-300">Accept</span> adds the tracker row and
                    immediately queues the résumé + cover-letter build.{' '}
                    <span className="text-red-300">Reject</span> is remembered so it is never
                    suggested again.
                  </p>
                  {lastScout?.summary && (
                    <p className="mt-3 text-gray-600">Last scout: {lastScout.summary}</p>
                  )}
                </>
              ) : (
                `No ${filter} candidates yet.`
              )}
            </div>
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col">
              {batchOrder.map((runId, bi) => {
                const list = batches.get(runId)!
                return (
                  <div
                    key={runId}
                    className={bi > 0 ? 'mt-4 border-t-2 border-edge pt-3' : ''}
                  >
                    <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-muted">
                      <span>Scout batch · {batchLabel(list)}</span>
                      <span className="font-normal text-gray-600">{list.length} candidate{list.length === 1 ? '' : 's'}</span>
                    </div>
                    <div className="flex flex-col gap-2.5">
                      {list.map((c) => (
                        <CandidateCard
                          key={c.id}
                          c={c}
                          actions={actions}
                          selected={c.id === postingFor}
                          onShowPosting={(cand) =>
                            setPostingFor((cur) => (cur === cand.id ? null : cand.id))
                          }
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {drawerCandidate && (
          <div
            className="w-1 shrink-0 cursor-col-resize bg-edge transition-colors hover:bg-cyan-500"
            onMouseDown={startDrag}
            title="Drag to resize"
          />
        )}
        <PostingPanel
          c={drawerCandidate}
          actions={actions}
          width={panelWidth}
          onClose={() => setPostingFor(null)}
        />
      </div>
    </div>
  )
}

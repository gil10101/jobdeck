import { useEffect, useState } from 'react'
import { Check, ChevronDown, CornerDownLeft, History, RefreshCw, RotateCcw } from 'lucide-react'
import type { ScoutHistoryEntry } from '@shared/types'
import type { ProfileFile } from '@shared/profile'
import { call } from '../api'
import { useApp } from '../store'

const STATUS_STYLE: Record<ScoutHistoryEntry['status'], string> = {
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
      title="Agent fit score (0-100) against your profile"
    >
      {score ?? '–'}
      <span className="text-[8px] font-normal uppercase opacity-70">fit</span>
    </span>
  )
}

/** Append `phrase` to the composed instructions once, "; "-separated. */
function appendPhrase(text: string, phrase: string): string {
  if (text.includes(phrase)) return text
  return text.trim() ? `${text.trim()}; ${phrase}` : phrase
}

/** Remove an appended phrase and heal the "; " separators around the gap. */
function removePhrase(text: string, phrase: string): string {
  return text
    .replace(phrase, '')
    .replace(/\s*;\s*;\s*/g, '; ')
    .replace(/^\s*;\s*/, '')
    .replace(/\s*;\s*$/, '')
    .trim()
}

/** Multi-select filter: a compact button ("Titles (2)") opening a checkbox
 *  panel styled like the AssistantPanel history dropdown. Checked = the
 *  option's phrase is present in the composed text, so the dropdowns stay
 *  consistent with hand-edits to the textarea. */
function FilterDropdown({
  label,
  options,
  text,
  onToggle
}: {
  label: string
  options: { key: string; label: string; phrase: string }[]
  text: string
  onToggle: (phrase: string) => void
}): JSX.Element | null {
  const [open, setOpen] = useState(false)
  if (options.length === 0) return null
  const count = options.filter((o) => text.includes(o.phrase)).length
  return (
    <div className="relative">
      <button
        className={`btn px-2 py-1 ${count > 0 ? 'btn-primary' : ''}`}
        title={`Filter by ${label.toLowerCase()}`}
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      >
        {count > 0 ? `${label} (${count})` : label}
        <ChevronDown size={11} aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-72 w-56 overflow-auto rounded-md border border-edge bg-panel2 shadow-xl">
          {options.map((o) => {
            const checked = text.includes(o.phrase)
            return (
              <button
                key={o.key}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-200 hover:bg-panel"
                title={checked ? `Removes: ${o.phrase}` : `Appends: ${o.phrase}`}
                onMouseDown={(e) => {
                  // Keep focus on the trigger so the panel survives multi-toggles.
                  e.preventDefault()
                  onToggle(o.phrase)
                }}
              >
                <span
                  className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                    checked ? 'border-cyan-700 bg-cyan-950/60 text-cyan-300' : 'border-edge'
                  }`}
                >
                  {checked && <Check size={10} strokeWidth={3} aria-hidden="true" />}
                </span>
                <span className="truncate">{o.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

const WORK_MODELS = ['onsite', 'hybrid', 'remote'] as const

/** 'salary $MIN–$MAX'; one-sided ≥/≤ when only one bound is set; null when
 *  neither parses — the phrase then disappears from the instructions. */
function salaryPhrase(min: string, max: string): string | null {
  const fmt = (raw: string): string | null => {
    const n = Number(raw)
    return raw.trim() && Number.isFinite(n) && n > 0
      ? `$${Math.round(n).toLocaleString('en-US')}`
      : null
  }
  const lo = fmt(min)
  const hi = fmt(max)
  if (lo && hi) return `salary ${lo}–${hi}`
  if (lo) return `salary ≥ ${lo}`
  if (hi) return `salary ≤ ${hi}`
  return null
}

/** Instruction composer: dropdown filters append plain-English constraint
 *  phrases into an editable textarea; the composed text is what scout:start
 *  receives. Enter (chat-style) or the send button launches the run. */
function InstructionComposer({
  scouting,
  onRun
}: {
  scouting: boolean
  onRun: (instructions: string) => Promise<void>
}): JSX.Element {
  const [profile, setProfile] = useState<ProfileFile | null>(null)
  const [text, setText] = useState('')
  const [salaryMin, setSalaryMin] = useState('')
  const [salaryMax, setSalaryMax] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void call('profile:get', undefined)
      .then(setProfile)
      .catch(() => setProfile(null))
  }, [])

  const toggle = (phrase: string): void => {
    setText((t) => (t.includes(phrase) ? removePhrase(t, phrase) : appendPhrase(t, phrase)))
  }

  /** Swap the composed salary phrase live on every bound edit — the previous
   *  phrase is healed out exactly like an unchecked dropdown option. */
  const setSalary = (min: string, max: string): void => {
    const prev = salaryPhrase(salaryMin, salaryMax)
    const next = salaryPhrase(min, max)
    setSalaryMin(min)
    setSalaryMax(max)
    setText((t) => {
      const base = prev ? removePhrase(t, prev) : t
      return next ? appendPhrase(base, next) : base
    })
  }

  const run = async (): Promise<void> => {
    if (busy || scouting || !text.trim()) return
    setBusy(true)
    try {
      await onRun(text)
    } finally {
      setBusy(false)
    }
  }

  const employmentTypes = profile?.searchConfig.employmentTypes ?? []
  const titles = (profile?.searchConfig.targetRoles ?? []).map((r) => r.title)

  return (
    <div className="border-b border-edge bg-panel px-4 py-3">
      <div className="relative">
        <textarea
          className="input block min-h-[3.5rem] w-full resize-none pr-10 text-xs leading-relaxed focus:border-edge"
          rows={2}
          placeholder='Instructions for the next scout run — type freely or use the filters below (e.g. "focus on analytics roles; remote only")…'
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // IME users confirm a composition candidate with Enter; that
            // Enter must not launch a run.
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void run()
            }
          }}
        />
        <button
          className="btn btn-primary absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-md p-0"
          disabled={busy || scouting || !text.trim()}
          aria-label="Run scout"
          title={
            scouting
              ? 'A scout run is already live — wait for it to finish'
              : 'Launch a scout run with these instructions (Enter)'
          }
          onClick={() => void run()}
        >
          <CornerDownLeft size={13} aria-hidden="true" />
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <FilterDropdown
          label="Titles"
          options={titles.map((t, i) => ({ key: `${i}:${t}`, label: t, phrase: `focus on "${t}"` }))}
          text={text}
          onToggle={toggle}
        />
        <FilterDropdown
          label="Type"
          options={employmentTypes.map((t) => ({ key: t, label: t, phrase: `${t} roles only` }))}
          text={text}
          onToggle={toggle}
        />
        <FilterDropdown
          label="Work model"
          options={WORK_MODELS.map((m) => ({ key: m, label: m, phrase: `${m} only` }))}
          text={text}
          onToggle={toggle}
        />
        <span className="ml-1 shrink-0 text-[10px] font-bold uppercase tracking-wide text-muted">
          salary
        </span>
        <span className="shrink-0 text-[11px] text-gray-500">$</span>
        <input
          type="number"
          min={0}
          step={1000}
          className="input w-24 appearance-none px-1.5 py-0.5 text-[11px] focus:border-edge [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          placeholder="Min"
          title="Minimum posted pay per year"
          value={salaryMin}
          onChange={(e) => setSalary(e.target.value, salaryMax)}
        />
        <span className="shrink-0 text-[11px] text-gray-500">–</span>
        <input
          type="number"
          min={0}
          step={1000}
          className="input w-24 appearance-none px-1.5 py-0.5 text-[11px] focus:border-edge [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          placeholder="Max"
          title="Maximum posted pay per year"
          value={salaryMax}
          onChange={(e) => setSalary(salaryMin, e.target.value)}
        />
        <span className="shrink-0 text-[10px] text-gray-500">/yr</span>
      </div>
    </div>
  )
}

function RunListItem({
  e,
  selected,
  onSelect
}: {
  e: ScoutHistoryEntry
  selected: boolean
  onSelect: () => void
}): JSX.Element {
  return (
    <button
      onClick={onSelect}
      className={`flex w-full flex-col gap-0.5 border-b border-edge/50 px-3 py-2 text-left hover:bg-panel2 ${
        selected ? 'bg-panel2' : ''
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`text-[10px] font-bold uppercase ${STATUS_STYLE[e.status]}`}>
          {e.status === 'running' && (
            <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
          )}
          {e.status}
        </span>
        <span className="ml-auto text-[10px] text-gray-600">{relTime(e.startedAt)}</span>
      </div>
      <div className="truncate text-xs text-gray-200">
        {e.instructions || <span className="italic text-gray-500">standard sweep</span>}
      </div>
      <div className="text-[10px]">
        <span className="text-green-300">{e.keptCount} kept</span>
        <span className="text-gray-600"> · </span>
        <span className="text-gray-500">{e.excludedCount} filtered</span>
      </div>
    </button>
  )
}

function RunDetail({
  e,
  scouting,
  onRerun
}: {
  e: ScoutHistoryEntry
  scouting: boolean
  onRerun: () => Promise<void>
}): JSX.Element {
  const navigate = useApp((s) => s.navigate)
  const [busy, setBusy] = useState(false)
  const started = new Date(e.startedAt)
  const rerun = async (): Promise<void> => {
    setBusy(true)
    try {
      await onRerun()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center gap-2">
        <span className={`text-xs font-bold uppercase ${STATUS_STYLE[e.status]}`}>{e.status}</span>
        <span className="text-[11px] text-gray-500" title={started.toLocaleString()}>
          {started.toLocaleString([], {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
          })}{' '}
          · {relTime(e.startedAt)}
        </span>
        {e.summary && <span className="truncate text-[11px] text-green-300">{e.summary}</span>}
        <button
          className="btn ml-auto px-2 py-1 text-[11px]"
          title="Open this run's timeline"
          onClick={() => navigate({ view: 'runs', runId: e.runId })}
        >
          View run
        </button>
      </div>

      <div className="panel mt-3 p-3">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wide text-muted">
            Instructions
          </span>
          <button
            className="btn btn-primary ml-auto"
            disabled={busy || scouting}
            title={
              scouting
                ? 'A scout run is already live — wait for it to finish'
                : 'Start a new scout run with exactly these instructions'
            }
            onClick={() => void rerun()}
          >
            <RotateCcw size={12} />
            Rerun
          </button>
        </div>
        <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-gray-300">
          {e.instructions || '(none — standard sweep)'}
        </pre>
      </div>

      <div className="mt-4">
        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-muted">
          Kept postings ({e.keptCount})
        </div>
        {e.kept.length === 0 ? (
          <div className="text-[11px] text-gray-500">No kept postings recorded for this run.</div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {e.kept.map((k, i) => (
              <div key={i} className="panel flex items-center gap-2.5 px-3 py-2">
                <FitPill score={k.fitScore} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-gray-100">
                    {k.position} <span className="text-gray-500">@</span> {k.company}
                  </div>
                  {(k.salary || k.location || k.fitNote) && (
                    <div className="truncate text-[10px] text-gray-500" title={k.fitNote}>
                      {[k.salary, k.location].filter(Boolean).join(' · ')}
                      {k.fitNote ? ` — ${k.fitNote}` : ''}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mb-6 mt-4">
        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-muted">
          Filtered out ({e.excludedCount})
        </div>
        {e.excluded.length === 0 ? (
          <div className="text-[11px] text-gray-500">No drop reasons recorded for this run.</div>
        ) : (
          <ul className="flex flex-col gap-1">
            {e.excluded.map((x, i) => (
              <li key={i} className="text-[11px] leading-relaxed text-gray-500">
                <span className="text-gray-400">
                  {x.position} <span className="text-gray-600">@</span> {x.company}
                </span>
                {x.reason && <span className="text-gray-600"> — {x.reason}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export default function HistoryView(): JSX.Element {
  const toast = useApp((s) => s.toast)
  const navigate = useApp((s) => s.navigate)
  const runs = useApp((s) => s.runs)
  const [entries, setEntries] = useState<ScoutHistoryEntry[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const liveScout = runs.some(
    (r) => r.kind === 'scout' && (r.status === 'running' || r.status === 'queued')
  )

  const refresh = async (): Promise<void> => {
    try {
      const list = await call('scout:history', undefined)
      setEntries(list)
      setSelectedId((cur) =>
        cur && list.some((e) => e.runId === cur) ? cur : (list[0]?.runId ?? null)
      )
    } catch (err) {
      toast(`Failed to load scout history: ${String(err)}`, 'error')
    }
  }

  // Refetch whenever any scout run appears or changes status (pushes keep
  // `runs` live), so a finishing run's kept/filtered lists show up unprompted.
  const scoutFingerprint = runs
    .filter((r) => r.kind === 'scout')
    .map((r) => `${r.id}:${r.status}`)
    .join(',')
  useEffect(() => {
    void refresh()
  }, [scoutFingerprint])

  const startScout = async (instructions: string): Promise<void> => {
    try {
      const meta = await call('scout:start', { instructions: instructions.trim() || undefined })
      toast('Scout agent launched — watch it work in Runs', 'success')
      void useApp.getState().refreshRuns()
      navigate({ view: 'runs', runId: meta.id })
    } catch (err) {
      toast(String(err), 'error')
    }
  }

  const selected = entries?.find((e) => e.runId === selectedId) ?? null

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-edge bg-panel px-4 py-2.5">
        <h1 className="text-sm font-semibold text-gray-100">History</h1>
        <span className="text-[11px] text-gray-500">
          past scout runs, their instructions, and what got kept or filtered out
        </span>
      </div>

      <InstructionComposer scouting={liveScout} onRun={startScout} />

      <div className="flex min-h-0 flex-1">
        <div className="flex w-80 shrink-0 flex-col border-r border-edge bg-panel">
          <div className="flex items-center justify-between border-b border-edge px-3 py-2">
            <span className="text-xs font-semibold text-gray-100">Scout runs</span>
            <button
              className="btn px-2 py-1"
              title="Refresh history"
              onClick={() => void refresh()}
            >
              <RefreshCw size={12} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {entries === null ? (
              <div className="p-4 text-xs text-gray-600">Loading…</div>
            ) : entries.length === 0 ? (
              <div className="p-4 text-xs leading-relaxed text-gray-600">
                No scout runs yet — compose instructions above and hit send.
              </div>
            ) : (
              entries.map((e) => (
                <RunListItem
                  key={e.runId}
                  e={e}
                  selected={e.runId === selectedId}
                  onSelect={() => setSelectedId(e.runId)}
                />
              ))
            )}
          </div>
        </div>

        <div className="min-w-0 flex-1 overflow-auto p-4">
          {selected ? (
            <RunDetail
              e={selected}
              scouting={liveScout}
              onRerun={() => startScout(selected.instructions)}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-gray-600">
              <History size={20} strokeWidth={1.5} />
              {entries?.length ? 'Select a run' : 'Scout runs will appear here'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

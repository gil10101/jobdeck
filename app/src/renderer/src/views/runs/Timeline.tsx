import { useEffect, useRef, useState } from 'react'
import type { RunEvent } from '@shared/types'

const MAX_RENDERED = 500

function ToolRow({ event, end }: { event: RunEvent & { kind: 'tool_start' }; end?: RunEvent & { kind: 'tool_end' } }): JSX.Element {
  const [open, setOpen] = useState(false)
  const ok = end ? end.ok : null
  return (
    <div className="group">
      <button
        className="flex w-full items-start gap-2 rounded px-2 py-1 text-left hover:bg-panel2"
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
            ok === null ? 'animate-pulse bg-cyan-400' : ok ? 'bg-green-500' : 'bg-red-500'
          }`}
        />
        <span className="shrink-0 font-semibold text-gray-300">{event.tool}</span>
        <span className="min-w-0 flex-1 truncate text-gray-500">{event.summary}</span>
        {end && <span className="shrink-0 text-[10px] text-gray-600">{open ? '▾' : '▸'}</span>}
      </button>
      {open && end && (
        <pre className="ml-6 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-bg p-2 text-[10px] leading-relaxed text-gray-500">
          {end.preview || '(no output)'}
        </pre>
      )}
    </div>
  )
}

export default function Timeline({ events }: { events: RunEvent[] }): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef(true)
  const [showAll, setShowAll] = useState(false)

  // Pair tool_end events with their tool_start.
  const ends = new Map<string, RunEvent & { kind: 'tool_end' }>()
  for (const e of events) {
    if (e.kind === 'tool_end' && e.toolUseId) ends.set(e.toolUseId, e)
  }

  const visible = showAll ? events : events.slice(-MAX_RENDERED)

  useEffect(() => {
    if (pinnedRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [events.length])

  const onScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
  }

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[11px] leading-relaxed"
    >
      {!showAll && events.length > MAX_RENDERED && (
        <button className="btn mb-2 w-full" onClick={() => setShowAll(true)}>
          Show {events.length - MAX_RENDERED} earlier events
        </button>
      )}
      {visible.map((e) => {
        switch (e.kind) {
          case 'init':
            return (
              <div key={e.seq} className="px-2 py-1 text-cyan-500">
                ⚡ agent session started · model {e.model}
              </div>
            )
          case 'status':
            return (
              <div key={e.seq} className="px-2 py-1 uppercase tracking-wide text-gray-600">
                → {e.status}
              </div>
            )
          case 'tool_start':
            return <ToolRow key={e.seq} event={e} end={ends.get(e.toolUseId)} />
          case 'tool_end':
            return null // rendered inside its ToolRow
          case 'text':
            return (
              <div
                key={`${e.seq}-${e.complete}`}
                className={`my-1 whitespace-pre-wrap rounded-md border border-edge/60 bg-panel2/60 px-3 py-2 font-sans text-xs leading-relaxed text-gray-300 ${
                  e.complete ? '' : 'opacity-80'
                }`}
              >
                {e.text}
                {!e.complete && <span className="animate-pulse text-cyan-400"> ▍</span>}
              </div>
            )
          case 'result':
            return (
              <div
                key={e.seq}
                className={`mt-2 rounded-md border px-3 py-2 ${
                  e.ok
                    ? 'border-green-800 bg-green-950/40 text-green-300'
                    : 'border-red-900 bg-red-950/40 text-red-300'
                }`}
              >
                {e.ok ? '✓ agent finished' : `✗ ${e.errorText ?? 'agent errored'}`}
                {typeof e.costUsd === 'number' && (
                  <span
                    className="ml-2 text-[10px] opacity-70"
                    title="Estimated API-equivalent usage — covered by your subscription, not billed"
                  >
                    usage ≈${e.costUsd.toFixed(2)} · {Math.round((e.durationMs ?? 0) / 1000)}s ·{' '}
                    {e.numTurns ?? '?'} turns
                  </span>
                )}
              </div>
            )
          default:
            return null
        }
      })}
      {events.length === 0 && <div className="p-4 text-gray-600">Waiting for events…</div>}
    </div>
  )
}

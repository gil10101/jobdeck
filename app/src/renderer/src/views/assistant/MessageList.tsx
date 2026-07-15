import { useEffect, useRef, useState } from 'react'
import type { AssistantApproval, AssistantMessage, RunEvent } from '@shared/types'
import ApprovalCard from './ApprovalCard'

function ToolRow({
  event,
  end
}: {
  event: RunEvent & { kind: 'tool_start' }
  end?: RunEvent & { kind: 'tool_end' }
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const ok = end ? end.ok : null
  return (
    <div className="group">
      <button
        className="flex w-full items-start gap-2 rounded px-1.5 py-1 text-left hover:bg-panel2"
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${
            ok === null ? 'animate-pulse bg-cyan-400' : ok ? 'bg-green-500' : 'bg-red-500'
          }`}
        />
        <span className="shrink-0 font-semibold text-gray-300">{event.tool}</span>
        <span className="min-w-0 flex-1 truncate text-gray-500">{event.summary}</span>
        {end && <span className="shrink-0 text-[10px] text-gray-600">{open ? '▾' : '▸'}</span>}
      </button>
      {open && end && (
        <pre className="ml-5 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-bg p-2 text-[10px] leading-relaxed text-gray-500">
          {end.preview || '(no output)'}
        </pre>
      )}
    </div>
  )
}

// Tool rows first, then prose, then any failure. A message's settled `text`
// supersedes its streamed 'text' events, and successful 'result'/'init'/'status'
// events are run-page detail — only failed results render, since an errored turn
// may otherwise produce a message with no visible content at all.
function AssistantBlock({
  events,
  text,
  pulse
}: {
  events: RunEvent[]
  text: string
  pulse?: boolean
}): JSX.Element {
  const ends = new Map<string, RunEvent & { kind: 'tool_end' }>()
  for (const e of events) {
    if (e.kind === 'tool_end' && e.toolUseId) ends.set(e.toolUseId, e)
  }
  const starts = events.filter(
    (e): e is RunEvent & { kind: 'tool_start' } => e.kind === 'tool_start'
  )
  const failures = events.filter(
    (e): e is RunEvent & { kind: 'result' } => e.kind === 'result' && !e.ok
  )

  return (
    <div className="max-w-[92%] text-xs leading-relaxed text-gray-200">
      {starts.length > 0 && (
        <div className="mb-1 flex flex-col font-mono text-[11px]">
          {starts.map((e) => (
            <ToolRow key={e.seq} event={e} end={ends.get(e.toolUseId)} />
          ))}
        </div>
      )}
      {(text || pulse) && (
        <div className="whitespace-pre-wrap px-1 py-0.5">
          {text}
          {pulse && <span className="animate-pulse text-cyan-400"> ▍</span>}
        </div>
      )}
      {failures.map((e) => (
        <div
          key={e.seq}
          className="mt-1 whitespace-pre-wrap rounded-md border border-red-900 bg-red-950/40 px-2 py-1.5 text-red-300"
        >
          ✗ {e.errorText ?? 'assistant run failed'}
        </div>
      ))}
    </div>
  )
}

export default function MessageList({
  messages,
  streaming,
  pendingApproval,
  onDecide
}: {
  messages: AssistantMessage[]
  streaming: { text: string; events: RunEvent[] } | null
  pendingApproval: AssistantApproval | null
  onDecide: (d: 'allow' | 'deny') => void
}): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef(true)

  useEffect(() => {
    if (pinnedRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages.length, streaming?.text.length, streaming?.events.length, pendingApproval])

  const onScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
  }

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-3"
    >
      {messages.length === 0 && !streaming && (
        <div className="p-4 text-xs text-gray-600">
          Ask about your runs, applications, settings, or profile.
        </div>
      )}
      {messages.map((m) =>
        m.role === 'user' ? (
          <div
            key={m.id}
            className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-lg bg-cyan-950/50 px-3 py-2 text-xs text-gray-100"
          >
            {m.text}
          </div>
        ) : (
          <AssistantBlock key={m.id} events={m.events} text={m.text} />
        )
      )}
      {streaming && <AssistantBlock events={streaming.events} text={streaming.text} pulse />}
      {pendingApproval && <ApprovalCard approval={pendingApproval} onDecide={onDecide} />}
    </div>
  )
}

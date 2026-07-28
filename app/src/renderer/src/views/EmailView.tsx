import { useEffect, useRef, useState } from 'react'
import { Check, Mail, RefreshCw, Settings, X } from 'lucide-react'
import type { EmailClassification, EmailMessage, EmailStatus } from '@shared/types'
import { call, onPush } from '../api'
import { useApp } from '../store'

const CLASS_STYLE: Record<EmailClassification, string> = {
  interview: 'border-cyan-700 text-cyan-300',
  assessment: 'border-amber-900 text-amber-300',
  offer: 'border-green-800 text-green-300',
  rejection: 'border-red-900 text-red-400',
  confirmation: 'border-edge text-gray-400',
  recruiter: 'border-cyan-900 text-cyan-400',
  other: 'border-edge text-gray-500'
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

/** Display name from an RFC 5322 From header ('Jane Doe <a@b>' → 'Jane Doe'). */
function fromName(from: string): string {
  const m = from.match(/^\s*"?([^"<]+?)"?\s*</)
  return (m ? m[1] : from.replace(/[<>]/g, '')).trim() || from
}

// The sync loop pushes after every pass; refetch only while the view is
// mounted (the mount effect owns this module-level flag).
let refetchMounted: (() => void) | null = null
onPush('push:emailChanged', () => refetchMounted?.())

function ClassChip({ classification }: { classification: EmailClassification }): JSX.Element {
  return (
    <span
      className={`shrink-0 rounded border px-1 text-[9px] font-bold uppercase ${CLASS_STYLE[classification]}`}
    >
      {classification}
    </span>
  )
}

/** Bare http(s) URLs open externally; split-with-capture puts every URL at an
 *  odd index, everything else stays plain pre-wrap text — no other markup. */
function LinkifiedBody({ text }: { text: string }): JSX.Element {
  const parts = text.split(/(https?:\/\/[^\s<>"]+[^\s<>".,;:!?')\]])/g)
  return (
    <div className="max-w-3xl whitespace-pre-wrap text-[13px] leading-relaxed text-gray-200">
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <button
            key={i}
            className="break-all text-left text-cyan-400 hover:underline"
            title={part}
            onClick={() => void call('app:openExternal', { url: part }).catch(() => undefined)}
          >
            {part}
          </button>
        ) : (
          part
        )
      )}
    </div>
  )
}

const FILTERS = [
  { key: 'job', label: 'Job', hint: 'Job-search-related mail (last 30 days)' },
  { key: 'primary', label: 'Primary', hint: "Gmail's Primary category (last 7 days)" },
  { key: 'all', label: 'All', hint: 'Everything recent in the inbox (last 7 days)' }
] as const

export default function EmailView(): JSX.Element {
  const navigate = useApp((s) => s.navigate)
  const toast = useApp((s) => s.toast)
  const [status, setStatus] = useState<EmailStatus | null>(null)
  const [messages, setMessages] = useState<EmailMessage[]>([])
  const [filter, setFilter] = useState<'job' | 'primary' | 'all'>('job')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [body, setBody] = useState<string | null>(null)
  const [bodyErr, setBodyErr] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  // Inline banner for a failed refresh whose error carries 403 guidance —
  // toasts vanish, but this failure needs the console link to stay visible.
  const [syncHint, setSyncHint] = useState<string | null>(null)
  const filterRef = useRef(filter)
  filterRef.current = filter

  const load = async (): Promise<void> => {
    try {
      setStatus(await call('email:status', undefined))
      setMessages(await call('email:list', { filter: filterRef.current }))
    } catch {
      /* main not booted yet — the view renders its connect hint */
    }
  }

  useEffect(() => {
    refetchMounted = () => void load()
    void load()
    return () => {
      refetchMounted = null
    }
  }, [])

  useEffect(() => {
    void call('email:list', { filter })
      .then(setMessages)
      .catch(() => undefined)
  }, [filter])

  // Bodies load live from Gmail per selection and are never cached on disk.
  useEffect(() => {
    setBody(null)
    setBodyErr(null)
    if (!selectedId) return
    let alive = true
    void call('email:getBody', { id: selectedId })
      .then(({ text }) => {
        if (alive) setBody(text)
      })
      .catch((err) => {
        if (alive) setBodyErr(String(err))
      })
    return () => {
      alive = false
    }
  }, [selectedId])

  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    try {
      setStatus(await call('email:refresh', undefined))
      setMessages(await call('email:list', { filter: filterRef.current }))
      setSyncHint(null)
    } catch (err) {
      const text = String(err)
      setSyncHint(text.includes('403') ? text : null)
      toast(text, 'error')
    } finally {
      setRefreshing(false)
    }
  }

  const applySuggestion = async (m: EmailMessage): Promise<void> => {
    try {
      await call('email:applySuggestion', { emailId: m.id })
      toast(`Marked ${m.suggestion?.company} as ${m.suggestion?.suggestStatus}`, 'success')
      await load()
    } catch (err) {
      toast(String(err), 'error')
    }
  }

  const dismissSuggestion = async (m: EmailMessage): Promise<void> => {
    try {
      await call('email:dismissSuggestion', { emailId: m.id })
      await load()
    } catch (err) {
      toast(String(err), 'error')
    }
  }

  if (!status) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-600">Loading…</div>
    )
  }

  if (!status.configured) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <Mail size={28} className="text-gray-500" />
        <div className="text-sm text-gray-400">
          Connect Gmail to see job-search mail — confirmations, interview and
          <br />
          assessment invites — and one-click tracker updates.
        </div>
        <button className="btn btn-primary" onClick={() => navigate({ view: 'settings' })}>
          <Settings size={12} className="mr-1 inline" /> Set up in Settings
        </button>
      </div>
    )
  }

  const suggestions = messages.filter((m) => m.suggestion && m.suggestionState === 'open')
  const selected = messages.find((m) => m.id === selectedId) ?? null

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-edge bg-panel px-4 py-2.5">
        <Mail size={14} className="shrink-0 text-cyan-300" />
        <h1 className="text-sm font-semibold text-gray-100">Email</h1>
        {status?.email && <span className="truncate text-[11px] text-gray-500">{status.email}</span>}
        <div className="ml-2 flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={`chip ${filter === f.key ? 'border-cyan-700 bg-cyan-950/60 text-cyan-200' : ''}`}
              title={f.hint}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-[10px] text-gray-600">
          {status?.lastSyncAt ? `synced ${relTime(status.lastSyncAt)}` : 'not synced yet'}
        </span>
        <button className="btn" disabled={refreshing} onClick={() => void refresh()}>
          <RefreshCw size={12} className={`mr-1 inline ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Syncing…' : 'Refresh'}
        </button>
      </div>

      {syncHint && (
        <div className="flex items-start gap-3 border-b border-edge bg-amber-950/30 px-4 py-2">
          <span className="min-w-0 flex-1 text-[11px] leading-relaxed text-amber-300">{syncHint}</span>
          <button
            className="btn shrink-0 px-2 py-0.5 text-[10px]"
            onClick={() =>
              void call('app:openExternal', {
                url: 'https://console.cloud.google.com/apis/library/gmail.googleapis.com'
              }).catch(() => undefined)
            }
          >
            Open Gmail API library
          </button>
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="max-h-40 overflow-auto border-b border-edge">
          {suggestions.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-3 border-b border-edge/50 bg-cyan-950/40 px-4 py-2 last:border-b-0"
            >
              <ClassChip classification={m.classification} />
              <span className="text-xs text-gray-200">
                Mark <span className="font-semibold">{m.suggestion?.company}</span> as{' '}
                <span className="font-semibold">{m.suggestion?.suggestStatus}</span>
              </span>
              <button
                className="min-w-0 truncate text-left text-[11px] text-gray-500 hover:text-gray-300"
                title={m.subject}
                onClick={() => setSelectedId(m.id)}
              >
                {m.subject}
              </button>
              <div className="ml-auto flex shrink-0 gap-1.5">
                <button className="btn btn-primary px-2 py-0.5 text-[10px]" onClick={() => void applySuggestion(m)}>
                  <Check size={11} className="mr-0.5 inline" /> Apply
                </button>
                <button className="btn px-2 py-0.5 text-[10px]" onClick={() => void dismissSuggestion(m)}>
                  <X size={11} className="mr-0.5 inline" /> Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="w-96 shrink-0 overflow-auto border-r border-edge bg-panel">
          {messages.length === 0 && (
            <div className="p-4 text-xs text-gray-600">
              {filter === 'job'
                ? 'No job-search mail found yet. Refresh, or switch to All.'
                : filter === 'primary'
                  ? 'No Primary mail synced yet. Refresh, or switch to All.'
                  : 'Nothing synced yet — hit Refresh.'}
            </div>
          )}
          {messages.map((m) => (
            <button
              key={m.id}
              onClick={() => setSelectedId(m.id)}
              className={`flex w-full flex-col gap-0.5 border-b border-edge/50 px-3 py-2 text-left hover:bg-panel2 ${
                selectedId === m.id ? 'bg-panel2' : ''
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 truncate text-[11px] font-medium text-gray-300">
                  {fromName(m.from)}
                </span>
                <ClassChip classification={m.classification} />
                <span className="ml-auto shrink-0 text-[10px] text-gray-600">{relTime(m.date)}</span>
              </div>
              <div className="truncate text-xs text-gray-200">{m.subject || '(no subject)'}</div>
              <div className="truncate text-[10px] text-gray-500">{m.snippet}</div>
            </button>
          ))}
        </div>

        <div className="flex min-w-0 flex-1 flex-col overflow-auto">
          {selected ? (
            <>
              <div className="border-b border-edge bg-panel px-5 py-3">
                <div className="flex items-center gap-2">
                  <ClassChip classification={selected.classification} />
                  <h2 className="min-w-0 truncate text-sm font-semibold text-gray-100">
                    {selected.subject || '(no subject)'}
                  </h2>
                </div>
                <div className="mt-1 text-[11px] text-gray-500">
                  {selected.from} · {new Date(selected.date).toLocaleString()}
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
                {bodyErr ? (
                  <div className="text-xs text-red-400">{bodyErr}</div>
                ) : body === null ? (
                  <div className="text-xs text-gray-600">Loading message…</div>
                ) : (
                  <LinkifiedBody text={body} />
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-gray-600">
              Select a message
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

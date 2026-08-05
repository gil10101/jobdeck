import { useEffect, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  ListFilter,
  Mail,
  RefreshCw,
  Reply,
  Search,
  Settings,
  Sparkles,
  Star,
  Tag,
  X
} from 'lucide-react'
import type { EmailClassification, EmailFilter, EmailMessage, EmailStatus } from '@shared/types'
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
const ALL_CLASSES = Object.keys(CLASS_STYLE) as EmailClassification[]

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

/** Unwrap hard line breaks inside paragraphs so mailer text wrapped at ~70
 *  columns flows to the container width instead of rendering ragged. A single
 *  newline is joined only when the previous line is clearly mid-flow: long
 *  enough, not ending a sentence (or the next line starts lowercase), not a
 *  URL, and the next line is not a list item. Blank-line paragraph breaks are
 *  always kept. */
function reflowPlain(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  for (const line of lines) {
    const prev = out[out.length - 1]
    const next = line.trim()
    const joinable =
      prev !== undefined &&
      prev.trim() !== '' &&
      next !== '' &&
      prev.trim().length >= 40 &&
      !/https?:\/\/\S*$/.test(prev.trim()) &&
      // List items (bulleted or numbered) and indented/quoted lines keep
      // their own line — only clear mid-sentence wraps join.
      !/^[-*•>]/.test(next) &&
      !/^(\d+[.)]|[a-z][.)])\s/.test(next) &&
      !/^\s/.test(line) &&
      (!/[.!?:]$/.test(prev.trim()) || /^[a-z0-9]/.test(next))
    if (joinable) out[out.length - 1] = `${prev.trimEnd()} ${next}`
    else out.push(line)
  }
  return out.join('\n')
}

/** Bare http(s) URLs open externally; split-with-capture puts every URL at an
 *  odd index, everything else stays plain pre-wrap text — no other markup. */
function LinkifiedBody({ text }: { text: string }): JSX.Element {
  const parts = reflowPlain(text).split(/(https?:\/\/[^\s<>"]+[^\s<>".,;:!?')\]])/g)
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

const FILTERS: { key: EmailFilter; label: string; hint: string }[] = [
  { key: 'job', label: 'Job', hint: 'Job-search-related mail (last 30 days)' },
  { key: 'primary', label: 'Primary', hint: "Gmail's Primary category (last 7 days)" },
  { key: 'all', label: 'All', hint: 'Everything recent in the inbox (last 7 days)' },
  { key: 'starred', label: 'Starred', hint: 'Messages you starred' },
  { key: 'hidden', label: 'Hidden', hint: 'Messages you hid — they appear nowhere else' }
]

const EMPTY_HINT: Record<EmailFilter, string> = {
  job: 'No job-search mail found yet. Refresh, or switch to All.',
  primary: 'No Primary mail synced yet. Refresh, or switch to All.',
  all: 'Nothing synced yet — hit Refresh.',
  starred: 'Nothing starred yet — star a message to pin it here.',
  hidden: 'No hidden messages.'
}

/** Per-message tag picker: checkboxes for every known tag plus an inline
 *  "new tag" input (Enter creates the tag and assigns it). Toggles go through
 *  onMouseDown+preventDefault so focus (and the menu) survives multi-toggles;
 *  the owning row closes it when focus leaves the anchor. */
function TagMenu({
  message,
  allTags,
  onToggle,
  onCreate,
  onClose
}: {
  message: EmailMessage
  allTags: string[]
  onToggle: (tag: string) => void
  onCreate: (name: string) => void
  onClose: () => void
}): JSX.Element {
  const [draft, setDraft] = useState('')
  return (
    <div
      className="absolute right-0 top-full z-50 mt-1 w-56 cursor-default rounded-md border border-edge bg-panel2 shadow-xl"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="max-h-48 overflow-auto py-1">
        {allTags.map((t) => {
          const checked = message.tags.includes(t)
          return (
            <button
              key={t}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-200 hover:bg-panel"
              title={checked ? `Remove "${t}"` : `Tag as "${t}"`}
              onMouseDown={(e) => {
                // Keep focus where it is so the menu survives multi-toggles.
                e.preventDefault()
                onToggle(t)
              }}
            >
              <span
                className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                  checked ? 'border-cyan-500 bg-cyan-950/60 text-cyan-300' : 'border-edge'
                }`}
              >
                {checked && <Check size={10} strokeWidth={3} aria-hidden="true" />}
              </span>
              <span className="truncate">{t}</span>
            </button>
          )
        })}
      </div>
      <div className="border-t border-edge p-1.5">
        <input
          className="input w-full px-2 py-1 text-[11px]"
          placeholder="New tag — Enter to add"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) {
              onCreate(draft)
              setDraft('')
            } else if (e.key === 'Escape') {
              onClose()
            }
          }}
        />
      </div>
    </div>
  )
}

/** Multi-select classification filter. Edits a draft set; nothing takes effect
 *  until Apply. Selecting all (or none) means "no filter" — every class shows. */
function ClassFilterDropdown({
  selected,
  onApply
}: {
  selected: EmailClassification[]
  onApply: (next: EmailClassification[]) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Set<EmailClassification>>(new Set(selected))
  const active = selected.length > 0
  const openMenu = (): void => {
    setDraft(new Set(selected.length ? selected : ALL_CLASSES))
    setOpen(true)
  }
  const toggle = (c: EmailClassification): void => {
    const next = new Set(draft)
    if (next.has(c)) next.delete(c)
    else next.add(c)
    setDraft(next)
  }
  const apply = (): void => {
    onApply(draft.size === 0 || draft.size === ALL_CLASSES.length ? [] : [...draft])
    setOpen(false)
  }
  return (
    <div className="relative">
      <button
        className={`chip ${active ? 'border-cyan-700 bg-cyan-950/60 text-cyan-200' : ''}`}
        title="Filter by type"
        onClick={() => (open ? setOpen(false) : openMenu())}
      >
        <ListFilter size={9} aria-hidden="true" />
        {active ? `Types (${selected.length})` : 'Types'}
        <ChevronDown size={9} aria-hidden="true" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-50 mt-1 w-48 rounded-md border border-edge bg-panel2 shadow-xl">
            <div className="flex items-center justify-between border-b border-edge px-2 py-1.5 text-[10px] text-gray-400">
              <button className="hover:text-gray-200" onClick={() => setDraft(new Set(ALL_CLASSES))}>
                Select all
              </button>
              <button className="hover:text-gray-200" onClick={() => setDraft(new Set())}>
                Clear
              </button>
            </div>
            <div className="max-h-56 overflow-auto py-1">
              {ALL_CLASSES.map((c) => {
                const checked = draft.has(c)
                return (
                  <button
                    key={c}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-200 hover:bg-panel"
                    onClick={() => toggle(c)}
                  >
                    <span
                      className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                        checked ? 'border-cyan-500 bg-cyan-950/60 text-cyan-300' : 'border-edge'
                      }`}
                    >
                      {checked && <Check size={10} strokeWidth={3} aria-hidden="true" />}
                    </span>
                    <span className="capitalize">{c}</span>
                  </button>
                )
              })}
            </div>
            <div className="border-t border-edge p-1.5">
              <button className="btn btn-primary w-full py-1 text-[11px]" onClick={apply}>
                Apply
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default function EmailView(): JSX.Element {
  const navigate = useApp((s) => s.navigate)
  const toast = useApp((s) => s.toast)
  const [status, setStatus] = useState<EmailStatus | null>(null)
  const [messages, setMessages] = useState<EmailMessage[]>([])
  const [filter, setFilter] = useState<EmailFilter>('job')
  const [allTags, setAllTags] = useState<string[]>([])
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [classFilter, setClassFilter] = useState<EmailClassification[]>([])
  const [search, setSearch] = useState('')
  const [tagMenuId, setTagMenuId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [body, setBody] = useState<string | null>(null)
  const [bodyErr, setBodyErr] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  // AI reply composer for the selected message. Nothing is ever sent — the
  // draft is copied or opened in a Gmail compose window (read-only scope).
  const [replyOpen, setReplyOpen] = useState(false)
  const [replyDraft, setReplyDraft] = useState('')
  const [replyMeta, setReplyMeta] = useState<{ to: string; subject: string } | null>(null)
  const [replyInstructions, setReplyInstructions] = useState('')
  const [replyLoading, setReplyLoading] = useState(false)
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
    void call('email:tags', undefined)
      .then(({ tags }) => setAllTags(tags))
      .catch(() => undefined)
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
    // A new message clears any open reply composer from the previous one.
    setReplyOpen(false)
    setReplyDraft('')
    setReplyMeta(null)
    setReplyInstructions('')
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

  /** Star/hide/tag patch; the refetch drops rows the patch filtered away
   *  (a just-hidden message outside the Hidden view, an unstarred one in it). */
  const patchMessage = async (
    id: string,
    patch: { favorite?: boolean; hidden?: boolean; tags?: string[] }
  ): Promise<void> => {
    try {
      await call('email:update', { id, patch })
      await load()
    } catch (err) {
      toast(String(err), 'error')
    }
  }

  const toggleTag = (m: EmailMessage, tag: string): void => {
    const tags = m.tags.includes(tag) ? m.tags.filter((t) => t !== tag) : [...m.tags, tag]
    void patchMessage(m.id, { tags })
  }

  const createAndAssignTag = async (m: EmailMessage, name: string): Promise<void> => {
    try {
      const res = await call('email:createTag', { name })
      setAllTags(res.tags)
      // Assign under the normalized name main actually stored.
      await call('email:update', { id: m.id, patch: { tags: [...m.tags, res.created] } })
      await load()
    } catch (err) {
      toast(String(err), 'error')
    }
  }

  const generateReply = async (): Promise<void> => {
    if (!selectedId) return
    setReplyOpen(true)
    setReplyLoading(true)
    try {
      const res = await call('email:draftReply', {
        id: selectedId,
        instructions: replyInstructions.trim() || undefined
      })
      setReplyDraft(res.draft)
      setReplyMeta({ to: res.to, subject: res.subject })
    } catch (err) {
      toast(String(err), 'error')
    } finally {
      setReplyLoading(false)
    }
  }

  const copyReply = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(replyDraft)
      toast('Reply copied', 'success')
    } catch {
      toast('Could not copy — select and copy manually', 'error')
    }
  }

  const composeInGmail = (): void => {
    if (!replyMeta) return
    const url =
      'https://mail.google.com/mail/?view=cm&fs=1' +
      `&to=${encodeURIComponent(replyMeta.to)}` +
      `&su=${encodeURIComponent(replyMeta.subject)}` +
      `&body=${encodeURIComponent(replyDraft)}`
    void call('app:openExternal', { url }).catch((err) => toast(String(err), 'error'))
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
  // Tag chips come from tags actually assigned in the current view; an active
  // tag filter keeps its chip even when the view no longer contains it, so it
  // can always be toggled off.
  const assignedTags = [...new Set(messages.flatMap((m) => m.tags))].sort()
  const tagChips =
    tagFilter && !assignedTags.includes(tagFilter) ? [tagFilter, ...assignedTags] : assignedTags
  const q = search.trim().toLowerCase()
  const shown = messages.filter((m) => {
    if (tagFilter && !m.tags.includes(tagFilter)) return false
    if (classFilter.length && !classFilter.includes(m.classification)) return false
    if (q && !`${fromName(m.from)} ${m.subject} ${m.snippet}`.toLowerCase().includes(q)) return false
    return true
  })
  const narrowed = q !== '' || classFilter.length > 0 || tagFilter !== null

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-edge bg-panel px-4 py-2.5">
        <Mail size={14} className="shrink-0 text-cyan-300" />
        <h1 className="text-sm font-semibold text-gray-100">Email</h1>
        {status?.email && <span className="truncate text-[11px] text-gray-500">{status.email}</span>}
        <div className="ml-2 flex flex-wrap items-center gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={`chip ${filter === f.key ? 'border-cyan-700 bg-cyan-950/60 text-cyan-200' : ''}`}
              title={f.hint}
              onClick={() => setFilter(f.key)}
            >
              {f.key === 'starred' && <Star size={9} aria-hidden="true" />}
              {f.key === 'hidden' && <EyeOff size={9} aria-hidden="true" />}
              {f.label}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-edge" aria-hidden="true" />
          <ClassFilterDropdown selected={classFilter} onApply={setClassFilter} />
          {tagChips.length > 0 && <span className="mx-1 h-4 w-px bg-edge" aria-hidden="true" />}
          {tagChips.map((t) => (
            <button
              key={t}
              className={`chip ${tagFilter === t ? 'border-cyan-700 bg-cyan-950/60 text-cyan-200' : ''}`}
              title={`Only messages tagged "${t}"`}
              onClick={() => setTagFilter(tagFilter === t ? null : t)}
            >
              <Tag size={9} aria-hidden="true" />
              {t}
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
          <div className="sticky top-0 z-10 border-b border-edge bg-panel p-2">
            <div className="relative">
              <Search
                size={12}
                className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-gray-500"
                aria-hidden="true"
              />
              <input
                className="input w-full px-7 text-[11px]"
                placeholder="Search sender, subject, preview…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-gray-500 hover:text-gray-300"
                  title="Clear search"
                  onClick={() => setSearch('')}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
          {shown.length === 0 && (
            <div className="p-4 text-xs text-gray-600">
              {narrowed ? 'No messages match your search or filters.' : EMPTY_HINT[filter]}
            </div>
          )}
          {shown.map((m) => (
            <div
              key={m.id}
              onClick={() => setSelectedId(m.id)}
              className={`group flex w-full cursor-pointer flex-col gap-0.5 border-b border-l-2 border-edge/50 px-3 py-2 text-left hover:bg-panel2 ${
                m.classification === 'assessment'
                  ? 'border-l-amber-400'
                  : m.classification === 'interview'
                    ? 'border-l-cyan-500'
                    : 'border-l-transparent'
              } ${selectedId === m.id ? 'bg-panel2' : ''}`}
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 truncate text-[11px] font-medium text-gray-300">
                  {fromName(m.from)}
                </span>
                <ClassChip classification={m.classification} />
                <div
                  className="relative ml-auto flex shrink-0 items-center gap-1.5"
                  onBlur={(e) => {
                    // Close the tag menu when focus leaves the anchor; moving
                    // into the menu's input keeps it open.
                    if (
                      tagMenuId === m.id &&
                      !e.currentTarget.contains(e.relatedTarget as Node | null)
                    ) {
                      setTagMenuId(null)
                    }
                  }}
                >
                  <button
                    className={
                      tagMenuId === m.id
                        ? 'text-cyan-300'
                        : 'text-gray-500 opacity-0 hover:text-cyan-300 focus:opacity-100 group-hover:opacity-100'
                    }
                    title="Tags"
                    aria-label="Tags"
                    onClick={(e) => {
                      e.stopPropagation()
                      setTagMenuId(tagMenuId === m.id ? null : m.id)
                    }}
                  >
                    <Tag size={12} aria-hidden="true" />
                  </button>
                  <button
                    className="text-gray-500 opacity-0 hover:text-gray-300 focus:opacity-100 group-hover:opacity-100"
                    title={m.hidden ? 'Unhide' : 'Hide'}
                    aria-label={m.hidden ? 'Unhide' : 'Hide'}
                    onClick={(e) => {
                      e.stopPropagation()
                      void patchMessage(m.id, { hidden: !m.hidden })
                    }}
                  >
                    {m.hidden ? (
                      <Eye size={12} aria-hidden="true" />
                    ) : (
                      <EyeOff size={12} aria-hidden="true" />
                    )}
                  </button>
                  <button
                    className={
                      m.favorite
                        ? 'text-amber-300'
                        : 'text-gray-500 opacity-0 hover:text-amber-300 focus:opacity-100 group-hover:opacity-100'
                    }
                    title={m.favorite ? 'Unstar' : 'Star'}
                    aria-label={m.favorite ? 'Unstar' : 'Star'}
                    onClick={(e) => {
                      e.stopPropagation()
                      void patchMessage(m.id, { favorite: !m.favorite })
                    }}
                  >
                    <Star size={12} className={m.favorite ? 'fill-amber-300' : ''} aria-hidden="true" />
                  </button>
                  <span className="text-[10px] text-gray-600">{relTime(m.date)}</span>
                  {tagMenuId === m.id && (
                    <TagMenu
                      message={m}
                      allTags={allTags}
                      onToggle={(tag) => toggleTag(m, tag)}
                      onCreate={(name) => void createAndAssignTag(m, name)}
                      onClose={() => setTagMenuId(null)}
                    />
                  )}
                </div>
              </div>
              <div className="truncate text-xs text-gray-200">{m.subject || '(no subject)'}</div>
              <div className="truncate text-[10px] text-gray-500">{m.snippet}</div>
              {m.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {m.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-full border border-cyan-900 bg-cyan-950/40 px-1.5 text-[9px] text-cyan-300"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
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
                  <button
                    className="btn ml-auto shrink-0 px-2 py-0.5 text-[11px]"
                    title="Draft an AI reply as you (nothing is sent — you copy it or open Gmail)"
                    onClick={() => void generateReply()}
                  >
                    <Reply size={12} className="mr-1 inline" /> Draft reply
                  </button>
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

              {replyOpen && (
                <div className="shrink-0 border-t border-edge bg-panel">
                  <div className="flex items-center gap-2 px-5 py-2">
                    <Sparkles size={12} className="text-cyan-300" />
                    <span className="text-xs font-semibold text-gray-200">AI reply draft</span>
                    <span className="text-[10px] text-gray-500">
                      read-only — nothing is sent; copy it or open Gmail
                    </span>
                    <button
                      className="ml-auto p-1 text-gray-500 hover:text-gray-300"
                      title="Close"
                      onClick={() => setReplyOpen(false)}
                    >
                      <X size={13} />
                    </button>
                  </div>
                  <div className="px-5 pb-3">
                    {replyLoading && !replyDraft ? (
                      <div className="flex items-center gap-2 py-6 text-xs text-gray-500">
                        <RefreshCw size={12} className="animate-spin" /> Drafting a reply…
                      </div>
                    ) : (
                      <textarea
                        className="input h-40 w-full resize-y whitespace-pre-wrap font-sans text-[13px] leading-relaxed"
                        value={replyDraft}
                        onChange={(e) => setReplyDraft(e.target.value)}
                        placeholder="The draft will appear here."
                      />
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input
                        className="input min-w-0 flex-1 text-[11px]"
                        placeholder="Tweak it — e.g. 'shorter', 'offer Tue/Wed afternoons', 'ask about the team'"
                        value={replyInstructions}
                        onChange={(e) => setReplyInstructions(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && !replyLoading && void generateReply()}
                      />
                      <button
                        className="btn shrink-0 px-2 py-1 text-[11px]"
                        disabled={replyLoading}
                        onClick={() => void generateReply()}
                      >
                        <RefreshCw size={11} className={`mr-1 inline ${replyLoading ? 'animate-spin' : ''}`} />
                        {replyDraft ? 'Regenerate' : 'Generate'}
                      </button>
                      <button
                        className="btn shrink-0 px-2 py-1 text-[11px]"
                        disabled={!replyDraft}
                        onClick={() => void copyReply()}
                      >
                        <Copy size={11} className="mr-1 inline" /> Copy
                      </button>
                      <button
                        className="btn btn-primary shrink-0 px-2 py-1 text-[11px]"
                        disabled={!replyDraft || !replyMeta?.to}
                        title="Open a Gmail compose window with this draft"
                        onClick={composeInGmail}
                      >
                        <ExternalLink size={11} className="mr-1 inline" /> Open in Gmail
                      </button>
                    </div>
                  </div>
                </div>
              )}
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

import { useEffect, useState } from 'react'
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  X
} from 'lucide-react'
import type { CalendarEvent } from '@shared/types'
import { call, onPush } from '../api'
import { useApp } from '../store'

const SOURCE_LABEL: Record<CalendarEvent['source'], string> = {
  ics: 'from invite',
  detected: 'detected',
  manual: 'manual'
}

const SOURCE_STYLE: Record<CalendarEvent['source'], string> = {
  ics: 'border-cyan-700 text-cyan-300',
  detected: 'border-amber-900 text-amber-300',
  manual: 'border-edge text-gray-400'
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Local calendar-day key (yyyy-mm-dd) — grouping and day filtering are always
 *  done in the viewer's local zone, matching what the grid displays. */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** ISO → <input type="datetime-local"> value (local wall time, minute precision). */
function toLocalInput(iso: string): string {
  const d = new Date(iso)
  return `${dayKey(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** Start–end rendered in local time with a short weekday; the end collapses to
 *  time-only when it falls on the same local day as the start. */
function prettyWhen(startIso: string, endIso: string | null): string {
  const full: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }
  const start = new Date(startIso)
  const text = start.toLocaleString(undefined, full)
  if (!endIso) return text
  const end = new Date(endIso)
  const endText =
    dayKey(start) === dayKey(end)
      ? end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
      : end.toLocaleString(undefined, full)
  return `${text} – ${endText}`
}

function countdown(startIso: string): string {
  const diff = new Date(startIso).getTime() - Date.now()
  if (diff <= 0) return 'now'
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `in ${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `in ${hrs}h ${mins % 60}m`
  return `in ${Math.floor(hrs / 24)}d ${hrs % 24}h`
}

// Main pushes after every sync proposal and mutation; refetch only while the
// view is mounted (the mount effect owns this module-level flag).
let refetchMounted: (() => void) | null = null
onPush('push:calendarChanged', () => refetchMounted?.())

function SourceChip({ source }: { source: CalendarEvent['source'] }): JSX.Element {
  return (
    <span
      className={`shrink-0 rounded border px-1 text-[9px] font-bold uppercase ${SOURCE_STYLE[source]}`}
    >
      {SOURCE_LABEL[source]}
    </span>
  )
}

function JoinButton({ url }: { url: string }): JSX.Element {
  return (
    <button
      className="btn px-2 py-0.5 text-[10px]"
      title={url}
      onClick={() => void call('app:openExternal', { url }).catch(() => undefined)}
    >
      <ExternalLink size={10} className="mr-0.5 inline" /> Join
    </button>
  )
}

/** Inline editor for a proposed event: title + start only — the fields a
 *  mis-parsed invite most often gets wrong. */
function EditForm({
  event,
  onSave,
  onCancel
}: {
  event: CalendarEvent
  onSave: (patch: { title: string; start: string }) => void
  onCancel: () => void
}): JSX.Element {
  const [title, setTitle] = useState(event.title)
  const [start, setStart] = useState(toLocalInput(event.start))
  return (
    <div className="mt-2 rounded-md border border-cyan-700 bg-panel px-3 py-2">
      <input
        className="input w-full text-[11px]"
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <input
        type="datetime-local"
        className="input mt-1.5 w-full text-[11px]"
        value={start}
        onChange={(e) => setStart(e.target.value)}
      />
      <div className="mt-1.5 flex gap-1.5">
        <button
          className="btn btn-primary px-2 py-0.5 text-[10px]"
          disabled={!title.trim() || !start}
          onClick={() => onSave({ title: title.trim(), start: new Date(start).toISOString() })}
        >
          Save
        </button>
        <button className="btn px-2 py-0.5 text-[10px]" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

/** Small month grid: one dot per day that has a live (non-dismissed) event.
 *  Clicking a day toggles a filter over every list in the view. */
function MonthGrid({
  cursor,
  onCursor,
  eventDays,
  selectedDay,
  onSelectDay
}: {
  cursor: { y: number; m: number }
  onCursor: (c: { y: number; m: number }) => void
  eventDays: Set<string>
  selectedDay: string | null
  onSelectDay: (day: string | null) => void
}): JSX.Element {
  const first = new Date(cursor.y, cursor.m, 1)
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate()
  const todayKey = dayKey(new Date())
  const cells: (number | null)[] = [
    ...Array.from({ length: first.getDay() }, (): null => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1)
  ]
  const shift = (delta: number): void => {
    const d = new Date(cursor.y, cursor.m + delta, 1)
    onCursor({ y: d.getFullYear(), m: d.getMonth() })
  }
  return (
    <div>
      <div className="flex items-center justify-between">
        <button
          className="p-1 text-gray-500 hover:text-gray-200"
          title="Previous month"
          aria-label="Previous month"
          onClick={() => shift(-1)}
        >
          <ChevronLeft size={13} />
        </button>
        <span className="text-[11px] font-semibold text-gray-200">
          {first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </span>
        <button
          className="p-1 text-gray-500 hover:text-gray-200"
          title="Next month"
          aria-label="Next month"
          onClick={() => shift(1)}
        >
          <ChevronRight size={13} />
        </button>
      </div>
      <div className="mt-1 grid grid-cols-7 gap-0.5">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, i) => (
          <span key={i} className="text-center text-[9px] font-bold text-gray-600">
            {w}
          </span>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <span key={i} />
          const key = `${cursor.y}-${pad2(cursor.m + 1)}-${pad2(day)}`
          return (
            <button
              key={i}
              onClick={() => onSelectDay(selectedDay === key ? null : key)}
              title={eventDays.has(key) ? 'Show only this day' : undefined}
              className={`relative h-7 rounded text-[10px] transition-colors ${
                selectedDay === key
                  ? 'bg-cyan-950/60 font-semibold text-cyan-200'
                  : key === todayKey
                    ? 'font-semibold text-cyan-300 hover:bg-panel2'
                    : 'text-gray-300 hover:bg-panel2'
              }`}
            >
              {day}
              {eventDays.has(key) && (
                <span className="absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-cyan-400" />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function CalendarView(): JSX.Element {
  const toast = useApp((s) => s.toast)
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loaded, setLoaded] = useState(false)
  const [cursor, setCursor] = useState(() => {
    const d = new Date()
    return { y: d.getFullYear(), m: d.getMonth() }
  })
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [pastOpen, setPastOpen] = useState(false)
  const [addTitle, setAddTitle] = useState('')
  const [addStart, setAddStart] = useState('')
  const [addEnd, setAddEnd] = useState('')
  const [addLocation, setAddLocation] = useState('')
  // Countdown chips and the Upcoming/Past split depend on "now" — tick so a
  // view left open does not show stale labels or keep a started event under
  // Upcoming.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const load = async (): Promise<void> => {
    try {
      setEvents(await call('calendar:list', undefined))
    } catch {
      /* main not booted yet — the empty states cover it */
    } finally {
      setLoaded(true)
    }
  }

  useEffect(() => {
    refetchMounted = () => void load()
    void load()
    return () => {
      refetchMounted = null
    }
  }, [])

  // Every mutator returns the fresh full list — set it directly, no refetch.
  const mutate = async (promise: Promise<CalendarEvent[]>): Promise<void> => {
    try {
      setEvents(await promise)
    } catch (err) {
      toast(String(err), 'error')
    }
  }

  const saveEdit = async (id: string, patch: { title: string; start: string }): Promise<void> => {
    await mutate(call('calendar:update', { id, patch }))
    setEditId(null)
  }

  // datetime-local values (yyyy-mm-ddThh:mm) order lexicographically, so a
  // string compare is a correct end-after-start check.
  const addEndInvalid = Boolean(addStart && addEnd && addEnd <= addStart)

  const addEvent = async (): Promise<void> => {
    const title = addTitle.trim()
    if (!title || !addStart || addEndInvalid) return
    try {
      setEvents(
        await call('calendar:add', {
          title,
          start: new Date(addStart).toISOString(),
          end: addEnd ? new Date(addEnd).toISOString() : null,
          location: addLocation.trim() || null,
          notes: null
        })
      )
      setAddTitle('')
      setAddStart('')
      setAddEnd('')
      setAddLocation('')
    } catch (err) {
      toast(String(err), 'error')
    }
  }

  const inDay = (e: CalendarEvent): boolean =>
    !selectedDay || dayKey(new Date(e.start)) === selectedDay
  const proposed = events.filter((e) => e.state === 'proposed' && inDay(e))
  const upcoming = events.filter(
    (e) => e.state === 'approved' && new Date(e.start).getTime() >= nowMs && inDay(e)
  )
  // Most recent first — the opposite of the store's ascending order.
  const past = events
    .filter(
      (e) =>
        inDay(e) &&
        (e.state === 'dismissed' ||
          (e.state === 'approved' && new Date(e.start).getTime() < nowMs))
    )
    .reverse()
  const eventDays = new Set(
    events.filter((e) => e.state !== 'dismissed').map((e) => dayKey(new Date(e.start)))
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-edge bg-panel px-4 py-2.5">
        <CalendarDays size={14} className="shrink-0 text-cyan-300" />
        <h1 className="text-sm font-semibold text-gray-100">Calendar</h1>
        {selectedDay && (
          <button
            className="chip border-cyan-700 bg-cyan-950/60 text-cyan-200"
            title="Clear day filter"
            onClick={() => setSelectedDay(null)}
          >
            {new Date(`${selectedDay}T00:00`).toLocaleDateString(undefined, {
              weekday: 'short',
              month: 'short',
              day: 'numeric'
            })}
            <X size={9} aria-hidden="true" />
          </button>
        )}
        <span className="ml-auto text-[10px] text-gray-600">
          Invites and detected interview times wait for your approval — reminders fire only for
          approved events.
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="w-64 shrink-0 overflow-auto border-r border-edge bg-panel p-3">
          <MonthGrid
            cursor={cursor}
            onCursor={setCursor}
            eventDays={eventDays}
            selectedDay={selectedDay}
            onSelectDay={setSelectedDay}
          />

          <div className="mt-4 border-t border-edge pt-3">
            <div className="text-[10px] font-bold uppercase tracking-wide text-muted">
              Add event
            </div>
            <input
              className="input mt-2 w-full text-[11px]"
              placeholder="Title"
              value={addTitle}
              onChange={(e) => setAddTitle(e.target.value)}
            />
            <label className="mt-1.5 block text-[10px] text-gray-500">
              Starts
              <input
                type="datetime-local"
                className="input mt-0.5 w-full text-[11px]"
                value={addStart}
                onChange={(e) => setAddStart(e.target.value)}
              />
            </label>
            <label className="mt-1.5 block text-[10px] text-gray-500">
              Ends (optional)
              <input
                type="datetime-local"
                className="input mt-0.5 w-full text-[11px]"
                value={addEnd}
                onChange={(e) => setAddEnd(e.target.value)}
              />
            </label>
            {addEndInvalid && (
              <div className="mt-1 text-[10px] text-red-400">End must be after start.</div>
            )}
            <input
              className="input mt-1.5 w-full text-[11px]"
              placeholder="Location (optional)"
              value={addLocation}
              onChange={(e) => setAddLocation(e.target.value)}
            />
            <button
              className="btn btn-primary mt-2 w-full justify-center py-1 text-[10px]"
              disabled={!addTitle.trim() || !addStart || addEndInvalid}
              onClick={() => void addEvent()}
            >
              <Plus size={11} className="mr-0.5 inline" /> Add event
            </button>
          </div>
        </div>

        <div className="min-w-0 flex-1 overflow-auto px-5 py-4">
          <div className="text-[10px] font-bold uppercase tracking-wide text-muted">
            Needs review
          </div>
          {loaded && proposed.length === 0 && (
            <div className="mt-1 text-xs text-gray-600">
              {selectedDay
                ? 'Nothing to review on this day.'
                : 'Nothing to review — invites and detected interview times land here.'}
            </div>
          )}
          {proposed.map((e) =>
            editId === e.id ? (
              <EditForm
                // A sync update to the same proposal (icsUid re-parse) must
                // remount the editor — a stale draft would otherwise overwrite
                // the fresher invite data on Save.
                key={`${e.id}|${e.start}`}
                event={e}
                onSave={(patch) => void saveEdit(e.id, patch)}
                onCancel={() => setEditId(null)}
              />
            ) : (
              <div key={e.id} className="mt-2 rounded-md border border-amber-900 bg-panel px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 truncate text-xs font-medium text-gray-100">
                    {e.title}
                  </span>
                  <SourceChip source={e.source} />
                  {e.company && (
                    <span className="shrink-0 text-[10px] text-gray-500">{e.company}</span>
                  )}
                </div>
                <div className="mt-0.5 text-[11px] text-gray-400">{prettyWhen(e.start, e.end)}</div>
                {e.location && (
                  <div className="truncate text-[10px] text-gray-500" title={e.location}>
                    {e.location}
                  </div>
                )}
                <div className="mt-1.5 flex items-center gap-1.5">
                  {e.meetLink && <JoinButton url={e.meetLink} />}
                  <button
                    className="btn btn-primary px-2 py-0.5 text-[10px]"
                    onClick={() => void mutate(call('calendar:approve', { id: e.id }))}
                  >
                    <Check size={11} className="mr-0.5 inline" /> Approve
                  </button>
                  <button
                    className="btn px-2 py-0.5 text-[10px]"
                    onClick={() => setEditId(e.id)}
                  >
                    <Pencil size={10} className="mr-0.5 inline" /> Edit
                  </button>
                  <button
                    className="btn px-2 py-0.5 text-[10px]"
                    onClick={() => void mutate(call('calendar:dismiss', { id: e.id }))}
                  >
                    <X size={11} className="mr-0.5 inline" /> Dismiss
                  </button>
                </div>
              </div>
            )
          )}

          <div className="mt-6 text-[10px] font-bold uppercase tracking-wide text-muted">
            Upcoming
          </div>
          {loaded && upcoming.length === 0 && (
            <div className="mt-1 text-xs text-gray-600">
              {selectedDay
                ? 'No approved events on this day.'
                : 'No upcoming events — approve a proposal above or add one manually.'}
            </div>
          )}
          {upcoming.map((e) => (
            <div
              key={e.id}
              className="mt-2 flex items-center gap-3 rounded-md border border-edge bg-panel px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 truncate text-xs font-medium text-gray-100">
                    {e.title}
                  </span>
                  {e.company && (
                    <span className="shrink-0 text-[10px] text-gray-500">{e.company}</span>
                  )}
                </div>
                <div className="mt-0.5 text-[11px] text-gray-400">
                  {prettyWhen(e.start, e.end)}
                  {e.location && <span className="text-gray-500"> · {e.location}</span>}
                </div>
              </div>
              <span className="shrink-0 rounded-full border border-cyan-900 bg-cyan-950/40 px-1.5 py-0.5 text-[10px] text-cyan-300">
                {countdown(e.start)}
              </span>
              {e.meetLink && <JoinButton url={e.meetLink} />}
              <button
                className="shrink-0 text-gray-500 hover:text-red-400"
                title="Remove event"
                aria-label="Remove event"
                onClick={() => void mutate(call('calendar:remove', { id: e.id }))}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}

          <button
            className="mt-6 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-muted hover:text-gray-300"
            onClick={() => setPastOpen(!pastOpen)}
          >
            <ChevronRight
              size={11}
              className={`transition-transform ${pastOpen ? 'rotate-90' : ''}`}
              aria-hidden="true"
            />
            Past &amp; dismissed ({past.length})
          </button>
          {pastOpen && loaded && past.length === 0 && (
            <div className="mt-1 text-xs text-gray-600">Nothing here yet.</div>
          )}
          {pastOpen &&
            past.map((e) => (
              <div
                key={e.id}
                className="mt-2 flex items-center gap-3 rounded-md border border-edge/50 px-3 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 truncate text-[11px] text-gray-400">{e.title}</span>
                    {e.state === 'dismissed' && (
                      <span className="shrink-0 rounded border border-red-900 px-1 text-[9px] font-bold uppercase text-red-400">
                        dismissed
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-gray-600">{prettyWhen(e.start, e.end)}</div>
                </div>
                {/* Approved past events are already approved — calendar:approve
                    would be a no-op, so Restore only shows for dismissed ones. */}
                {e.state === 'dismissed' && (
                  <button
                    className="btn shrink-0 px-2 py-0.5 text-[10px]"
                    title="Restore to Upcoming"
                    onClick={() => void mutate(call('calendar:approve', { id: e.id }))}
                  >
                    <RotateCcw size={10} className="mr-0.5 inline" /> Restore
                  </button>
                )}
                <button
                  className="shrink-0 text-gray-500 hover:text-red-400"
                  title="Remove event"
                  aria-label="Remove event"
                  onClick={() => void mutate(call('calendar:remove', { id: e.id }))}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}

import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { CalendarEvent } from '@shared/types'

// Calendar events extracted from mail (plus manual entries), in the app-data
// dir (0600 — same posture as email-cache.json). Entries are derived facts;
// message bodies never land here.

interface CalendarFile {
  events: CalendarEvent[]
}

function storeFile(): string {
  return path.join(app.getPath('userData'), 'calendar.json')
}

let cache: CalendarFile | null = null

function load(): CalendarFile {
  if (cache) return cache
  try {
    const parsed = JSON.parse(fs.readFileSync(storeFile(), 'utf-8')) as CalendarFile
    cache = { events: Array.isArray(parsed.events) ? parsed.events : [] }
  } catch {
    cache = { events: [] }
  }
  return cache
}

function persist(): void {
  if (!cache) return
  const file = storeFile()
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), { encoding: 'utf-8', mode: 0o600 })
  fs.renameSync(tmp, file)
}

export function listEvents(): CalendarEvent[] {
  return [...load().events].sort((a, b) => (Date.parse(a.start) || 0) - (Date.parse(b.start) || 0))
}

export interface ProposeEventInput {
  sourceMessageId: string | null
  icsUid: string | null
  title: string
  company: string | null
  rowId: string | null
  start: string
  end: string | null
  location: string | null
  meetLink: string | null
  notes: string | null
  source: 'ics' | 'detected'
  /** iCalendar METHOD:CANCEL — the UID-matched event is dismissed, not updated. */
  cancelled?: boolean
}

/** Normalized-title + start-minute key catches the same event arriving twice
 *  without a UID (a re-send, or ics + detected variants of one mail). */
function normTitle(t: string): string {
  return t.trim().toLowerCase().replace(/\s+/g, ' ')
}

function startMinute(iso: string): number {
  return Math.floor((Date.parse(iso) || 0) / 60000)
}

/** Dedupe rules, in order: (1) icsUid match → update in place (a moved start
 *  re-arms both reminders; cancelled → dismissed; an approved event stays
 *  approved through updates). (2) same sourceMessageId → no-op. (3) same
 *  normalized title + start minute → no-op. Else insert as 'proposed'.
 *  A CANCEL that matches nothing proposes nothing. */
export function proposeEvent(input: ProposeEventInput): {
  event: CalendarEvent | null
  changed: boolean
} {
  const store = load()
  if (input.icsUid) {
    const existing = store.events.find((e) => e.icsUid === input.icsUid)
    if (existing) {
      let changed = false
      if (input.cancelled) {
        if (existing.state !== 'dismissed') {
          existing.state = 'dismissed'
          changed = true
        }
      } else {
        if (existing.start !== input.start) {
          existing.start = input.start
          existing.remindedDayBefore = false
          existing.remindedSoon = false
          changed = true
        }
        if (existing.title !== input.title) {
          existing.title = input.title
          changed = true
        }
        if (existing.end !== input.end) {
          existing.end = input.end
          changed = true
        }
        if (existing.location !== input.location) {
          existing.location = input.location
          changed = true
        }
        if (existing.meetLink !== input.meetLink) {
          existing.meetLink = input.meetLink
          changed = true
        }
        if (existing.notes !== input.notes) {
          existing.notes = input.notes
          changed = true
        }
      }
      if (changed) persist()
      return { event: existing, changed }
    }
  }
  if (input.cancelled) return { event: null, changed: false }
  if (input.sourceMessageId) {
    const same = store.events.find((e) => e.sourceMessageId === input.sourceMessageId)
    if (same) return { event: same, changed: false }
  }
  const key = normTitle(input.title)
  const minute = startMinute(input.start)
  const dupe = store.events.find(
    (e) => normTitle(e.title) === key && startMinute(e.start) === minute
  )
  if (dupe) return { event: dupe, changed: false }
  const event: CalendarEvent = {
    id: randomUUID(),
    sourceMessageId: input.sourceMessageId,
    icsUid: input.icsUid,
    title: input.title,
    company: input.company,
    rowId: input.rowId,
    start: input.start,
    end: input.end,
    location: input.location,
    meetLink: input.meetLink,
    notes: input.notes,
    source: input.source,
    state: 'proposed',
    createdAt: new Date().toISOString(),
    remindedDayBefore: false,
    remindedSoon: false
  }
  store.events.push(event)
  persist()
  return { event, changed: true }
}

function mustFind(id: string): CalendarEvent {
  const e = load().events.find((x) => x.id === id)
  if (!e) throw new Error(`calendar event not found: ${id}`)
  return e
}

export function approveEvent(id: string): CalendarEvent {
  const e = mustFind(id)
  e.state = 'approved'
  persist()
  return e
}

export function dismissEvent(id: string): CalendarEvent {
  const e = mustFind(id)
  e.state = 'dismissed'
  persist()
  return e
}

export function removeEvent(id: string): void {
  const store = load()
  store.events = store.events.filter((e) => e.id !== id)
  persist()
}

/** Hand-entered events skip review — the user typing them is the approval. */
export function addManual(input: {
  title: string
  start: string
  end: string | null
  location: string | null
  notes: string | null
}): CalendarEvent {
  const event: CalendarEvent = {
    id: randomUUID(),
    sourceMessageId: null,
    icsUid: null,
    title: input.title,
    company: null,
    rowId: null,
    start: input.start,
    end: input.end,
    location: input.location,
    meetLink: null,
    notes: input.notes,
    source: 'manual',
    state: 'approved',
    createdAt: new Date().toISOString(),
    remindedDayBefore: false,
    remindedSoon: false
  }
  load().events.push(event)
  persist()
  return event
}

export function updateEvent(
  id: string,
  patch: {
    title?: string
    start?: string
    end?: string | null
    location?: string | null
    notes?: string | null
  }
): CalendarEvent {
  const e = mustFind(id)
  if (patch.title !== undefined) e.title = patch.title
  if (patch.start !== undefined && patch.start !== e.start) {
    // A moved start re-arms both reminders.
    e.start = patch.start
    e.remindedDayBefore = false
    e.remindedSoon = false
  }
  if (patch.end !== undefined) e.end = patch.end
  if (patch.location !== undefined) e.location = patch.location
  if (patch.notes !== undefined) e.notes = patch.notes
  persist()
  return e
}

/** Stamped BEFORE the notification shows — a crash between the stamp and the
 *  toast must not re-notify forever. */
export function markReminded(id: string, which: 'dayBefore' | 'soon'): void {
  const e = load().events.find((x) => x.id === id)
  if (!e) return
  if (which === 'dayBefore') e.remindedDayBefore = true
  else e.remindedSoon = true
  persist()
}

export function proposedCount(): number {
  return load().events.filter((e) => e.state === 'proposed').length
}

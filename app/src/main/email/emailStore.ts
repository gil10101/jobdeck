import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { EmailClassification, EmailFilter, EmailInvite, EmailMessage, EmailSuggestion } from '@shared/types'

// Header/snippet cache for synced Gmail messages, in the app-data dir (0600 —
// mail is personal and must never land in the workspace agents can read; the
// assistant reaches it only through its tools). Bodies are never stored.

const CACHE_CAP = 500
/** Ready-made tags; user-created ones are stored beside them. */
const PRESET_TAGS = ['interview', 'assessment', 'offer', 'follow up', 'recruiter', 'apply later']
const TAG_MAX_LEN = 24
const TAG_MAX_COUNT = 50

interface EmailCacheFile {
  messages: EmailMessage[]
  lastSyncAt: string | null
  customTags?: string[]
  /** Stamp of the one-time calendar backfill sweep; null = not yet run. */
  calendarBackfillAt?: string | null
}

function cacheFile(): string {
  return path.join(app.getPath('userData'), 'email-cache.json')
}

let cache: EmailCacheFile | null = null

function load(): EmailCacheFile {
  if (cache) return cache
  try {
    const parsed = JSON.parse(fs.readFileSync(cacheFile(), 'utf-8')) as EmailCacheFile
    cache = {
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      lastSyncAt: parsed.lastSyncAt ?? null,
      customTags: Array.isArray(parsed.customTags) ? parsed.customTags : [],
      calendarBackfillAt: parsed.calendarBackfillAt ?? null
    }
    // Migrations for per-message user state added after first release.
    for (const m of cache.messages) {
      m.favorite ??= false
      m.hidden ??= false
      m.tags ??= []
      m.invite ??= null
    }
  } catch {
    cache = { messages: [], lastSyncAt: null, customTags: [] }
  }
  return cache
}

function persist(): void {
  if (!cache) return
  const file = cacheFile()
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), { encoding: 'utf-8', mode: 0o600 })
  fs.renameSync(tmp, file)
}

export function lastSyncAt(): string | null {
  return load().lastSyncAt
}

export function calendarBackfillAt(): string | null {
  return load().calendarBackfillAt ?? null
}

/** Stamped after a COMPLETED backfill sweep — an interrupted sweep must retry. */
export function markCalendarBackfill(): void {
  load().calendarBackfillAt = new Date().toISOString()
  persist()
}

/** Every cached message, newest first — sync reconciliation needs hidden mail
 *  (or it would refetch it forever). Every other consumer must filter hidden
 *  out: the user hides mail to correct misclassification, so hidden means
 *  hidden everywhere — UI, assistant search, suggestion counts. */
export function allCachedMessages(): EmailMessage[] {
  return [...load().messages].sort((a, b) => b.date.localeCompare(a.date))
}

/** Time-sensitive job actions float to the top of the primary/starred/all
 *  lists so a deadline is never buried under newer mail. Lower rank = higher.
 *  Only recent, still-actionable items are pinned — an assessment handled
 *  weeks ago drops back to date order. The Job list opts out: it reads
 *  strictly newest-first. */
const PRIORITY: Record<string, number> = { assessment: 0, interview: 1, offer: 2 }
const PIN_WINDOW_MS = 21 * 24 * 60 * 60 * 1000

function priorityRank(m: EmailMessage): number {
  const base = PRIORITY[m.classification]
  if (base === undefined) return 9
  if (m.suggestionState === 'applied' || m.suggestionState === 'dismissed') return 9
  if (Date.now() - new Date(m.date).getTime() > PIN_WINDOW_MS) return 9
  return base
}

/** Priority first (time-sensitive on top), then newest within each tier. */
function prioritize(list: EmailMessage[]): EmailMessage[] {
  return [...list].sort((a, b) => priorityRank(a) - priorityRank(b) || b.date.localeCompare(a.date))
}

/** 'job' = job-search-query matches (strict date order), 'primary' = Gmail's
 *  Primary sweep, 'starred'/'hidden' = the user's own sets. Hidden messages
 *  only ever appear under 'hidden'. Assessment/interview/offer mail is pinned
 *  to the top everywhere except the Job list. */
export function listCachedMessages(filter: EmailFilter): EmailMessage[] {
  const all = allCachedMessages()
  if (filter === 'hidden') return all.filter((m) => m.hidden)
  const visible = all.filter((m) => !m.hidden)
  // Job mail reads strictly newest-first: the tab is triaged chronologically,
  // and pinned weeks-old interview mail buries what just arrived.
  if (filter === 'job') return visible.filter((m) => m.jobRelated)
  if (filter === 'primary') return prioritize(visible.filter((m) => m.primary))
  if (filter === 'starred') return prioritize(visible.filter((m) => m.favorite))
  return prioritize(visible)
}

export function getCachedMessage(id: string): EmailMessage | null {
  return load().messages.find((m) => m.id === id) ?? null
}

/** Merge a sync batch by id and stamp lastSyncAt; keeps the newest CACHE_CAP.
 *  Starred, tagged, and hidden messages are exempt from eviction — user state
 *  must not silently vanish because newer mail arrived. */
export function upsertMessages(msgs: EmailMessage[]): void {
  const store = load()
  const byId = new Map(store.messages.map((m) => [m.id, m]))
  for (const m of msgs) {
    // Sync never owns user state: batches are built from a pre-sync snapshot,
    // so a star/hide/tag set while the fetch ran must win over the batch copy.
    const prev = byId.get(m.id)
    byId.set(m.id, prev ? { ...m, favorite: prev.favorite, hidden: prev.hidden, tags: prev.tags } : m)
  }
  const sorted = [...byId.values()].sort((a, b) => b.date.localeCompare(a.date))
  const exempt = (m: EmailMessage): boolean => m.favorite || m.hidden || m.tags.length > 0
  let plain = 0
  store.messages = sorted.filter((m) => exempt(m) || plain++ < CACHE_CAP)
  store.lastSyncAt = new Date().toISOString()
  persist()
}

/** Set per-message user state (star/hide/tags); throws for an unknown id. */
export function updateMessage(
  id: string,
  patch: { favorite?: boolean; hidden?: boolean; tags?: string[] }
): EmailMessage {
  const msg = load().messages.find((m) => m.id === id)
  if (!msg) throw new Error(`email not in cache: ${id}`)
  if (patch.favorite !== undefined) msg.favorite = patch.favorite
  if (patch.hidden !== undefined) msg.hidden = patch.hidden
  if (patch.tags !== undefined) {
    msg.tags = [...new Set(patch.tags.map(normalizeTag).filter(Boolean))]
  }
  persist()
  return msg
}

/** Overwrite the derived fields (classification/job-related/suggestion) of one
 *  cached message — used when a full-body reclassification supersedes the
 *  snippet-based one made at sync. No-op for an unknown id; returns whether
 *  anything actually changed. User state (star/hide/tags) is untouched.
 *  `invite` undefined = leave the stored invite alone (the caller had no ICS
 *  part to judge from); null/value = overwrite. */
export function applyReclassification(
  id: string,
  fields: {
    classification: EmailClassification
    jobRelated: boolean
    suggestion: EmailSuggestion | null
    suggestionState: EmailMessage['suggestionState']
    invite?: EmailInvite | null
  }
): boolean {
  const msg = load().messages.find((m) => m.id === id)
  if (!msg) return false
  const inviteChanged =
    fields.invite !== undefined && JSON.stringify(msg.invite ?? null) !== JSON.stringify(fields.invite)
  const changed =
    inviteChanged ||
    msg.classification !== fields.classification ||
    msg.jobRelated !== fields.jobRelated ||
    msg.suggestionState !== fields.suggestionState ||
    JSON.stringify(msg.suggestion) !== JSON.stringify(fields.suggestion)
  if (!changed) return false
  msg.classification = fields.classification
  msg.jobRelated = fields.jobRelated
  msg.suggestion = fields.suggestion
  msg.suggestionState = fields.suggestionState
  if (fields.invite !== undefined) msg.invite = fields.invite
  persist()
  return true
}

function normalizeTag(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, TAG_MAX_LEN)
}

/** Presets first, then custom tags, deduped case-insensitively. */
export function listTags(): string[] {
  const custom = (load().customTags ?? []).filter((t) => !PRESET_TAGS.includes(t))
  return [...PRESET_TAGS, ...custom]
}

/** Register a user tag so it shows in every tag menu; returns the full list
 *  plus the normalized name actually stored (for immediate assignment). */
export function createTag(name: string): { tags: string[]; created: string } {
  const clean = normalizeTag(name)
  if (!clean) throw new Error('tag name is empty')
  const store = load()
  store.customTags ??= []
  if (!PRESET_TAGS.includes(clean) && !store.customTags.includes(clean)) {
    if (store.customTags.length >= TAG_MAX_COUNT) {
      throw new Error(`tag limit reached (${TAG_MAX_COUNT})`)
    }
    store.customTags.push(clean)
    persist()
  }
  return { tags: listTags(), created: clean }
}

export function setSuggestionState(id: string, state: 'open' | 'applied' | 'dismissed'): EmailMessage {
  const msg = load().messages.find((m) => m.id === id)
  if (!msg) throw new Error(`email not in cache: ${id}`)
  msg.suggestionState = state
  persist()
  return msg
}

export function openSuggestionCount(): number {
  return load().messages.filter((m) => !m.hidden && m.suggestion && m.suggestionState === 'open')
    .length
}

/** Sign-out wipes the cache — cached mail (and its tags) must not outlive
 *  the account. */
export function clearEmailCache(): void {
  cache = { messages: [], lastSyncAt: null, customTags: [] }
  try {
    fs.rmSync(cacheFile(), { force: true })
  } catch (err) {
    console.error('[email] cache delete failed:', err)
  }
}

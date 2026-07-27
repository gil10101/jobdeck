import type { EmailClassification, EmailMessage, EmailSuggestion, StatusKey, TrackerRow } from '@shared/types'
import type { Store } from '../store/Store'
import type { TrackerRepo } from '../store/trackerRepo'
import { gmailConfigured } from './gmailAuth'
import { getMessageMeta, listMessages, type GmailMessageMeta } from './gmailClient'
import { listCachedMessages, openSuggestionCount, upsertMessages } from './emailStore'

// Main-process poll loop (TodoWatcher sibling): every N minutes pull
// job-search-shaped mail + a recent-inbox sweep, classify deterministically,
// and propose tracker status updates. Suggestions are one-click by default;
// they are auto-applied ONLY behind settings.emailAutoApply.

/** Subject terms that mark mail as job-search-related, ~30 days back. */
const JOB_QUERY =
  'newer_than:30d subject:(application OR applied OR applying OR interview OR assessment OR offer OR OA OR HackerRank OR Codility OR CodeSignal OR "take-home" OR "coding challenge" OR schedule OR candidacy OR recruiter)'
/** The "All" toggle set: everything recent, so a miss above is still visible. */
const ALL_QUERY = 'in:inbox newer_than:7d'
const PAGE_SIZE = 50
const FETCH_CONCURRENCY = 5
const MIN_POLL_MINUTES = 1
const MAX_POLL_MINUTES = 120

/** Deterministic classification from headers (+ snippet for the two classes
 *  whose subjects are usually generic, e.g. "Update on your application").
 *  Order matters: assessment invites mention interviews, rejections mention
 *  everything — most specific signals first. */
export function classifyEmail(from: string, subject: string, snippet: string): EmailClassification {
  const s = subject
  if (/assessment|hackerrank|codility|codesignal|coding (challenge|test|exercise)|take[- ]home|\boa\b/i.test(s)) {
    return 'assessment'
  }
  if (/offer letter|job offer|offer of employment|pleased to (extend|offer)|your offer/i.test(s)) {
    return 'offer'
  }
  const rejection =
    /unfortunately|we regret|not (be )?(moving|proceeding) forward|other candidates|not (been )?selected|no longer under consideration|pursue other (applicants|candidates)|position has been filled/i
  if (rejection.test(s) || rejection.test(snippet)) return 'rejection'
  if (/interview|phone screen|screening call|schedule (a|your) (call|chat|conversation|meeting)|your availability|meet the team/i.test(s)) {
    return 'interview'
  }
  const confirmation =
    /application (was |has been )?(received|submitted)|(thank you|thanks) for (applying|your application)|we('ve| have) received your application|application confirmation|successfully (applied|submitted)/i
  if (confirmation.test(s) || confirmation.test(snippet)) return 'confirmation'
  if (/recruit|talent acquisition|sourcing|hiring team/i.test(from) || /\b(opportunity|opening|role at|position at)\b/i.test(s)) {
    return 'recruiter'
  }
  return 'other'
}

/** Lowercase, punctuation → spaces, collapsed — the comparable form. */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const SUGGEST_STATUS: Partial<Record<EmailClassification, StatusKey>> = {
  confirmation: 'applied',
  interview: 'interview',
  offer: 'offer',
  rejection: 'rejected'
}

/** Tracker match: normalized company name (≥ 4 chars — "hp" would match half
 *  the inbox) contained token-aligned in From+Subject; longest match wins.
 *  Confirmations only ever suggest applied from not_applied, and a suggestion
 *  matching the row's current status is noise, not news. */
export function suggestForMessage(
  classification: EmailClassification,
  from: string,
  subject: string,
  rows: TrackerRow[]
): EmailSuggestion | null {
  const status = SUGGEST_STATUS[classification]
  if (!status) return null
  const haystack = ` ${normalizeText(`${from} ${subject}`)} `
  let best: TrackerRow | null = null
  let bestLen = 0
  for (const row of rows) {
    const needle = normalizeText(row.company)
    if (needle.length < 4 || needle.length <= bestLen) continue
    if (!haystack.includes(` ${needle} `)) continue
    best = row
    bestLen = needle.length
  }
  if (!best) return null
  if (classification === 'confirmation' && best.statusKey !== 'not_applied') return null
  if (best.statusKey === status) return null
  return { rowId: best.id, company: best.company, suggestStatus: status }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += limit) {
    out.push(...(await Promise.all(items.slice(i, i + limit).map(fn))))
  }
  return out
}

export interface EmailSyncDeps {
  store: Store
  tracker: TrackerRepo
  send: (channel: string, payload: unknown) => void
}

export class EmailSync {
  private timer: NodeJS.Timeout | null = null
  private scheduledMinutes = 0
  private syncing = false

  constructor(private deps: EmailSyncDeps) {
    // Interval changes land immediately, not after the old interval elapses.
    deps.store.on('changed', (domains: string[]) => {
      if (this.timer && domains.includes('settings') && this.pollMinutes() !== this.scheduledMinutes) {
        this.schedule()
      }
    })
  }

  polling(): boolean {
    return this.timer !== null
  }

  private pollMinutes(): number {
    const raw = this.deps.store.state.settings.emailPollMinutes
    return Math.min(MAX_POLL_MINUTES, Math.max(MIN_POLL_MINUTES, Math.round(raw) || 5))
  }

  /** Sync now, then poll on the configured interval. Idempotent. */
  start(): void {
    if (!gmailConfigured()) return
    const firstStart = !this.timer
    this.schedule()
    if (firstStart) {
      void this.syncNow().catch((err) => console.error('[email] initial sync failed:', err))
    }
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.scheduledMinutes = this.pollMinutes()
    this.timer = setTimeout(() => {
      void this.syncNow()
        .catch((err) => console.error('[email] poll sync failed:', err))
        .finally(() => {
          // Chain the next tick only while polling is still on.
          if (this.timer) this.schedule()
        })
    }, this.scheduledMinutes * 60_000)
  }

  /** One full sync pass; safe to call concurrently (second call no-ops). */
  async syncNow(): Promise<{ fetched: number }> {
    if (this.syncing) return { fetched: 0 }
    if (!gmailConfigured()) throw new Error('Gmail is not connected')
    this.syncing = true
    try {
      const [job, all] = await Promise.all([
        listMessages(JOB_QUERY, PAGE_SIZE),
        listMessages(ALL_QUERY, PAGE_SIZE)
      ])
      const jobIds = new Set(job.ids.map((m) => m.id))
      const wantedIds = [...new Set([...job.ids, ...all.ids].map((m) => m.id))]

      // Headers are immutable — only fetch ids the cache has never seen.
      const cached = new Map(listCachedMessages('all').map((m) => [m.id, m]))
      const newIds = wantedIds.filter((id) => !cached.has(id))
      const metas = await mapLimit(newIds, FETCH_CONCURRENCY, (id) => getMessageMeta(id))

      const rows = this.deps.tracker.listRows()
      const autoApply = this.deps.store.state.settings.emailAutoApply
      const batch: EmailMessage[] = []

      for (const meta of metas) {
        batch.push(this.buildMessage(meta, jobIds.has(meta.id), rows))
      }
      // Re-listed known messages: refresh the job flag (a message can enter the
      // job set later) and re-derive still-open/uncomputed suggestions against
      // the current tracker; applied/dismissed decisions are final.
      for (const id of wantedIds) {
        const known = cached.get(id)
        if (!known) continue
        const jobRelated = known.jobRelated || jobIds.has(id)
        let { suggestion, suggestionState } = known
        if (suggestionState === 'open' || suggestionState === null) {
          suggestion = suggestForMessage(known.classification, known.from, known.subject, rows)
          suggestionState = suggestion ? 'open' : null
        }
        const changed =
          jobRelated !== known.jobRelated ||
          suggestionState !== known.suggestionState ||
          JSON.stringify(suggestion) !== JSON.stringify(known.suggestion)
        if (changed) batch.push({ ...known, jobRelated, suggestion, suggestionState })
      }

      if (autoApply) {
        for (const msg of batch) {
          if (msg.suggestion && msg.suggestionState === 'open') {
            this.applyToTracker(msg.suggestion)
            msg.suggestionState = 'applied'
          }
        }
      }

      // Always upsert — an empty batch still stamps lastSyncAt.
      upsertMessages(batch)
      this.deps.send('push:emailChanged', { suggestions: openSuggestionCount() })
      return { fetched: metas.length }
    } finally {
      this.syncing = false
    }
  }

  private buildMessage(meta: GmailMessageMeta, jobRelated: boolean, rows: TrackerRow[]): EmailMessage {
    const classification = classifyEmail(meta.from, meta.subject, meta.snippet)
    const suggestion = suggestForMessage(classification, meta.from, meta.subject, rows)
    return {
      ...meta,
      classification,
      jobRelated,
      suggestion,
      suggestionState: suggestion ? 'open' : null
    }
  }

  private applyToTracker(suggestion: EmailSuggestion): void {
    // markApplied stamps dateApplied + [DONE]-renames per settings; plain
    // status flips go through upsertRow (keeps statusText coherent).
    if (suggestion.suggestStatus === 'applied') this.deps.tracker.markApplied(suggestion.rowId)
    else this.deps.tracker.upsertRow({ id: suggestion.rowId, statusKey: suggestion.suggestStatus })
  }
}

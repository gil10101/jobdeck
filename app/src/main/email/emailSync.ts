import { BrowserWindow, Notification } from 'electron'
import type { EmailClassification, EmailInvite, EmailMessage, EmailSuggestion, StatusKey, TrackerRow } from '@shared/types'
import type { Store } from '../store/Store'
import type { TrackerRepo } from '../store/trackerRepo'
import { listEvents, proposeEvent, proposedCount, updateEvent } from '../calendar/calendarStore'
import { gmailConfigured } from './gmailAuth'
import { getMessageFull, getMessageMeta, listMessages, type GmailMessageMeta } from './gmailClient'
import { parseIcs } from './icsParse'
import { extractEvent } from './eventExtract'
import {
  ASSESSMENT_DOMAINS,
  ATS_DOMAINS,
  classifyEmail,
  deriveJobRelated,
  fromDomainMatch
} from './emailClassify'
import {
  allCachedMessages,
  applyReclassification,
  calendarBackfillAt,
  calendarBackfillVersion,
  getCachedMessage,
  markCalendarBackfill,
  openSuggestionCount,
  upsertMessages
} from './emailStore'

// Main-process poll loop (TodoWatcher sibling): every N minutes pull
// job-search-shaped mail + Primary-category and recent-inbox sweeps, classify
// deterministically, and propose tracker status updates. Suggestions are
// one-click by default; they are auto-applied ONLY behind settings.emailAutoApply.

/** Job-search mail, ~30 days back: subject terms OR a known assessment/ATS
 *  sender — assessment invites often carry no keyword in the subject at all.
 *  Bare "offer" is deliberately absent (it pulled in retail "50% off" promos);
 *  only "job offer"/"offer letter" qualify. */
const JOB_QUERY =
  'newer_than:30d (subject:(application OR applied OR applying OR interview OR assessment OR "job offer" OR "offer letter" OR OA OR HackerRank OR Codility OR CodeSignal OR "take-home" OR "coding challenge" OR "online assessment" OR "personality assessment" OR "next steps" OR "technical screen" OR "phone screen" OR "phone conversation" OR invitation OR availability OR "complete your" OR schedule OR candidacy OR recruiter)' +
  ` OR from:(${[...ASSESSMENT_DOMAINS, ...ATS_DOMAINS].join(' OR ')}))`
/** The "Primary" toggle set: Gmail's Primary category, recent. */
const PRIMARY_QUERY = 'category:primary newer_than:7d'
/** The "All" toggle set: everything recent, so a miss above is still visible. */
const ALL_QUERY = 'in:inbox newer_than:7d'
const PAGE_SIZE = 50
const FETCH_CONCURRENCY = 5
const MIN_POLL_MINUTES = 1
const MAX_POLL_MINUTES = 120

/** OS-toast-worthy classes; everything else stays ambient in the tab. */
const NOTIFY_CLASSES: EmailClassification[] = ['interview', 'assessment', 'offer']
const NOTIFY_TITLES: Partial<Record<EmailClassification, string>> = {
  interview: 'Interview email',
  assessment: 'Assessment email',
  offer: 'Offer email'
}
/** Backfills (first sync, cache wipe) pull weeks of old mail — only messages
 *  this recent are news worth a toast. */
const NOTIFY_WINDOW_MS = 48 * 60 * 60 * 1000
/** Individual toasts per sync pass; the overflow collapses into one summary. */
const NOTIFY_MAX_PER_SYNC = 3
/** Backfill sweep bounds: recent job mail only, hard-capped so the one-time
 *  pass stays a bounded number of Gmail fetches. */
const BACKFILL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
const BACKFILL_MAX = 60
/** Bump when an extraction fix must re-sweep already-stamped caches — the
 *  stamp alone would leave mail cached under the buggy code unhealed forever.
 *  v2: message-date clock, direct-recruiter body classification, ICS refetch. */
const BACKFILL_VERSION = 2

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
 *  the inbox) contained token-aligned in From+Subject+snippet; longest match
 *  wins. The snippet is searched because ATS mail (Lever/Greenhouse) hides the
 *  company in the body, not the from-address or subject, so a rejection like
 *  "...role at Acme" only matches once the body text is in scope. */
export function matchTrackerRow(
  from: string,
  subject: string,
  snippet: string,
  rows: TrackerRow[]
): TrackerRow | null {
  const haystack = ` ${normalizeText(`${from} ${subject} ${snippet}`)} `
  let best: TrackerRow | null = null
  let bestLen = 0
  for (const row of rows) {
    const needle = normalizeText(row.company)
    if (needle.length < 4 || needle.length <= bestLen) continue
    if (!haystack.includes(` ${needle} `)) continue
    best = row
    bestLen = needle.length
  }
  return best
}

/** Status suggestion for one message (matchTrackerRow picks the row).
 *  Confirmations only ever suggest applied from not_applied, and a suggestion
 *  matching the row's current status is noise, not news. */
export function suggestForMessage(
  classification: EmailClassification,
  from: string,
  subject: string,
  snippet: string,
  rows: TrackerRow[]
): EmailSuggestion | null {
  const status = SUGGEST_STATUS[classification]
  if (!status) return null
  const best = matchTrackerRow(from, subject, snippet, rows)
  if (!best) return null
  if (classification === 'confirmation' && best.statusKey !== 'not_applied') return null
  if (best.statusKey === status) return null
  return { rowId: best.id, company: best.company, suggestStatus: status }
}

/** Subject minus leading Re:/Fwd: runs — the event-title fallback when an
 *  invite carries no SUMMARY. */
function cleanSubject(subject: string): string {
  return subject.replace(/^\s*(?:(?:re|fwd?|fw)\s*:\s*)+/i, '').trim() || 'Interview'
}

/** parseIcs with failures surfaced: a throwing or VEVENT-less ICS part must be
 *  visible in logs, not silently degrade to text detection. */
function parseIcsLogged(raw: string, messageId: string): ReturnType<typeof parseIcs> {
  try {
    const parsed = parseIcs(raw)
    if (!parsed) console.error(`[email] ICS part had no VEVENT (message ${messageId})`)
    return parsed
  } catch (err) {
    console.error(`[email] ICS parse failed (message ${messageId}):`, err)
    return null
  }
}

/** Bring the app forward from an OS notification click. */
function focusMainWindow(): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
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
  // Bumped on stop(): a sync already in flight must not write its results
  // after sign-out, or it would resurrect the cache clearEmailCache wiped.
  private generation = 0

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
      void this.syncNow().catch((err) => {
        console.error('[email] initial sync failed:', err)
        // invalid_grant signs Gmail out mid-sync — stop instead of polling a
        // dead connection forever.
        if (!gmailConfigured()) this.stop()
      })
    }
  }

  stop(): void {
    this.generation++
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.scheduledMinutes = this.pollMinutes()
    this.timer = setTimeout(() => {
      void this.syncNow()
        .catch((err) => {
          console.error('[email] poll sync failed:', err)
          // See start(): a revoked token signs out mid-sync — stop the loop.
          if (!gmailConfigured()) this.stop()
        })
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
    const gen = this.generation
    try {
      const [job, primary, all] = await Promise.all([
        listMessages(JOB_QUERY, PAGE_SIZE),
        listMessages(PRIMARY_QUERY, PAGE_SIZE),
        listMessages(ALL_QUERY, PAGE_SIZE)
      ])
      const jobIds = new Set(job.ids.map((m) => m.id))
      const primaryIds = new Set(primary.ids.map((m) => m.id))
      const wantedIds = [...new Set([...job.ids, ...primary.ids, ...all.ids].map((m) => m.id))]

      // Headers are immutable — only fetch ids the cache has never seen
      // (hidden mail included, or it would be refetched forever).
      const cached = new Map(allCachedMessages().map((m) => [m.id, m]))
      const newIds = wantedIds.filter((id) => !cached.has(id))
      const metas = await mapLimit(newIds, FETCH_CONCURRENCY, (id) => getMessageMeta(id))
      // Signed out while the fetches ran: drop everything — no tracker writes,
      // no cache write (the rest of this pass is synchronous, so one check
      // after the last await covers it all).
      if (gen !== this.generation) return { fetched: 0 }

      const rows = this.deps.tracker.listRows()
      const autoApply = this.deps.store.state.settings.emailAutoApply
      const batch: EmailMessage[] = []

      // Classify job mail from the FULL body, not just the snippet: the
      // decisive line often sits past Gmail's ~200-char preview ("we have
      // decided not to move forward..."). Only job-sweep or ATS/assessment
      // senders get a body fetch, so the extra calls stay bounded; the body is
      // used for classification then discarded (never cached — mail bodies
      // must not touch disk).
      const bodyWorthy = (m: GmailMessageMeta): boolean => {
        if (jobIds.has(m.id) || fromDomainMatch(m.from, [...ATS_DOMAINS, ...ASSESSMENT_DOMAINS])) {
          return true
        }
        // Direct recruiter mail outside the job sweep: a snippet that already
        // reads as interview/assessment gets the full body too — the decisive
        // date/time usually sits past the ~200-char snippet boundary.
        const cls = classifyEmail(m.from, m.subject, m.snippet)
        return cls === 'interview' || cls === 'assessment'
      }
      const bodies = new Map<string, { text: string; ics: string | null }>()
      await mapLimit(
        metas.filter(bodyWorthy),
        FETCH_CONCURRENCY,
        async (m) => {
          try {
            bodies.set(m.id, await getMessageFull(m.id))
          } catch {
            /* fall back to the snippet for classification */
          }
        }
      )
      if (gen !== this.generation) return { fetched: 0 }

      // `fresh` = genuinely new messages only — notifications and calendar
      // proposals must never fire from the re-list heal loop below. Oldest
      // first: when an invite and its update/cancel land in one pass (first
      // sync backfill, reschedule within a poll interval), the chronologically
      // latest REQUEST/CANCEL for a UID must be the one applied last.
      const fresh: EmailMessage[] = []
      let calendarChanged = false
      for (const meta of [...metas].sort((a, b) => Date.parse(a.date) - Date.parse(b.date))) {
        const full = bodies.get(meta.id)
        const msg = this.buildMessage(
          meta,
          jobIds.has(meta.id),
          primaryIds.has(meta.id),
          rows,
          full?.text
        )
        const parsed = full?.ics ? parseIcsLogged(full.ics, meta.id) : null
        msg.invite = parsed?.invite ?? null
        if (this.proposeFromMessage(msg, parsed, full?.text ?? meta.snippet, rows)) {
          calendarChanged = true
        }
        fresh.push(msg)
        batch.push(msg)
      }
      // Re-listed known messages: refresh the job/primary flags (a message can
      // enter either set later; caches from before the primary flag existed
      // heal here too) and re-derive still-open/uncomputed suggestions against
      // the current tracker; applied/dismissed decisions are final.
      for (const id of wantedIds) {
        const known = cached.get(id)
        if (!known) continue
        const inPrimary = known.primary === true || primaryIds.has(id)
        // Classification was set at ingest from the full body; the body is not
        // cached, so re-deriving here (snippet only) would DOWNGRADE a
        // body-detected rejection back to "other". Keep the stored class; a
        // stale one heals when the message is opened (reclassifyFromBody).
        const classification = known.classification
        const jobRelated = deriveJobRelated(
          known.from,
          known.subject,
          known.snippet,
          jobIds.has(id),
          classification
        )
        let { suggestion, suggestionState } = known
        if (suggestionState === 'open' || suggestionState === null) {
          // Hidden = the user says the classifier got this one wrong, so never
          // hold a suggestion on it. Unhiding re-derives on the next sync.
          if (known.hidden) {
            suggestion = null
          } else {
            // Re-match against the current tracker (rows change over time). But
            // don't drop an existing open suggestion just because the company
            // lives in the body we no longer have — keep the ingest match.
            const rematch = suggestForMessage(classification, known.from, known.subject, known.snippet, rows)
            suggestion = rematch ?? (suggestionState === 'open' ? suggestion : null)
          }
          suggestionState = suggestion ? 'open' : null
        }
        const changed =
          jobRelated !== known.jobRelated ||
          inPrimary !== known.primary ||
          suggestionState !== known.suggestionState ||
          JSON.stringify(suggestion) !== JSON.stringify(known.suggestion)
        if (changed) {
          batch.push({ ...known, jobRelated, primary: inPrimary, suggestion, suggestionState })
        }
      }

      if (autoApply) {
        // Oldest first, so when several messages map to one row the newest
        // email's status wins. Each apply re-reads its row and fails alone —
        // a row deleted mid-loop must not abort the rest (or the cache write).
        const applicable = batch
          .filter((m) => !m.hidden && m.suggestion && m.suggestionState === 'open')
          .sort((a, b) => a.date.localeCompare(b.date))
        for (const msg of applicable) {
          const suggestion = msg.suggestion!
          // markApplied stamps dateApplied and may rename the folder on disk —
          // too much blast radius for a fuzzy company-name match. Auto-apply
          // covers plain status flips only; 'applied' stays a manual Apply.
          if (suggestion.suggestStatus === 'applied') continue
          try {
            const row = this.deps.tracker.getRow(suggestion.rowId)
            if (!row || row.statusKey === suggestion.suggestStatus) continue
            this.applyToTracker(suggestion)
            msg.suggestionState = 'applied'
          } catch (err) {
            console.error('[email] auto-apply failed:', err)
          }
        }
      }

      // Always upsert — an empty batch still stamps lastSyncAt.
      upsertMessages(batch)
      this.deps.send('push:emailChanged', { suggestions: openSuggestionCount() })
      if (calendarChanged) this.deps.send('push:calendarChanged', { proposed: proposedCount() })
      this.notifyNewMail(fresh)
      this.repairDetectedYears()
      await this.backfillCalendar(gen)
      return { fetched: metas.length }
    } finally {
      this.syncing = false
    }
  }

  /** One-time repair for 'detected' events minted before the extraction clock
   *  fix: missing years were resolved against the processing clock instead of
   *  the message's own date, bumping already-past interview times a year
   *  forward. A detected start whose year-earlier twin still sits at/after its
   *  source message's own day can only be that spurious bump. Scoped to events
   *  created no later than the backfill stamp; idempotent — a repaired start
   *  fails the guard. */
  private repairDetectedYears(): void {
    const stamp = calendarBackfillAt()
    if (!stamp) return
    const byId = new Map(allCachedMessages().map((m) => [m.id, m]))
    let changed = false
    for (const e of listEvents()) {
      if (e.source !== 'detected' || !e.sourceMessageId || e.createdAt > stamp) continue
      const msg = byId.get(e.sourceMessageId)
      if (!msg) continue
      const start = new Date(e.start)
      if (Number.isNaN(start.getTime())) continue
      const shifted = new Date(start)
      shifted.setUTCFullYear(shifted.getUTCFullYear() - 1)
      const msgDay = new Date(msg.date)
      msgDay.setUTCHours(0, 0, 0, 0)
      if (shifted.getTime() < msgDay.getTime()) continue
      let end = e.end
      if (end) {
        const endDate = new Date(end)
        endDate.setUTCFullYear(endDate.getUTCFullYear() - 1)
        end = endDate.toISOString()
      }
      // updateEvent re-arms both reminders — the moved start needs them.
      updateEvent(e.id, { start: shifted.toISOString(), end })
      changed = true
    }
    if (changed) this.deps.send('push:calendarChanged', { proposed: proposedCount() })
  }

  /** Versioned sweep: mail cached before calendar extraction existed (or under
   *  a since-fixed extraction, per BACKFILL_VERSION) never proposed events.
   *  Refetch full bodies for recent job mail, re-run classification + invite
   *  parsing through reclassifyFromBody (which also proposes), then stamp the
   *  cache with the current version so the sweep never repeats until the next
   *  bump. A per-message failure skips that message AND withholds the stamp,
   *  so an interrupted or rate-limited sweep retries on the next sync. */
  private async backfillCalendar(gen: number): Promise<void> {
    if (calendarBackfillVersion() >= BACKFILL_VERSION) return
    const cutoff = Date.now() - BACKFILL_WINDOW_MS
    const candidates = allCachedMessages()
      .filter(
        (m) =>
          !m.hidden &&
          (m.jobRelated || m.classification === 'interview' || m.classification === 'assessment') &&
          Date.parse(m.date) >= cutoff
      )
      .slice(0, BACKFILL_MAX)
    let failures = 0
    await mapLimit(candidates, FETCH_CONCURRENCY, async (m) => {
      if (gen !== this.generation) return
      try {
        const { text, ics } = await getMessageFull(m.id)
        const parsed = ics ? parseIcsLogged(ics, m.id) : null
        if (gen !== this.generation) return
        this.reclassifyFromBody(m.id, text, parsed ?? undefined)
      } catch {
        // Unreadable message: keep its sync-time classification, and count the
        // miss so the stamp is withheld and the next sync retries.
        failures++
      }
    })
    if (gen !== this.generation) return
    if (failures === 0) markCalendarBackfill(BACKFILL_VERSION)
  }

  private buildMessage(
    meta: GmailMessageMeta,
    jobHit: boolean,
    primary: boolean,
    rows: TrackerRow[],
    body?: string
  ): EmailMessage {
    // Classify against the body when we fetched it (job mail), else the snippet.
    // meta.snippet is still stored for the list preview.
    const scan = body ?? meta.snippet
    const classification = classifyEmail(meta.from, meta.subject, scan)
    const jobRelated = deriveJobRelated(meta.from, meta.subject, scan, jobHit, classification)
    const suggestion = suggestForMessage(classification, meta.from, meta.subject, scan, rows)
    return {
      ...meta,
      classification,
      jobRelated,
      primary,
      suggestion,
      suggestionState: suggestion ? 'open' : null,
      favorite: false,
      hidden: false,
      tags: [],
      invite: null
    }
  }

  /** Calendar proposal for one NEW message. An ICS part wins over text
   *  detection; a parsed invite proposes when the mail classified as interview
   *  OR the ICS carries any METHOD (a real invite/cancel envelope), and it
   *  must have a start to be schedulable. A CANCEL is terminal: it dismisses
   *  the UID-matched event even when its own DTSTART failed to parse, and it
   *  never falls through to text detection — the mail describes a removed
   *  event, not a new one. Text detection only runs for interview-class mail
   *  with no usable ICS event. Returns whether the calendar store changed. */
  private proposeFromMessage(
    msg: EmailMessage,
    parsed: { invite: EmailInvite; uid: string | null } | null,
    bodyText: string,
    rows: TrackerRow[]
  ): boolean {
    const match = matchTrackerRow(msg.from, msg.subject, bodyText, rows)
    const invite = parsed?.invite ?? null
    if (invite?.method === 'CANCEL') {
      if (!parsed?.uid) return false
      return proposeEvent({
        sourceMessageId: msg.id,
        icsUid: parsed.uid,
        title: invite.title ?? cleanSubject(msg.subject),
        company: match?.company ?? null,
        rowId: match?.id ?? null,
        // The dismiss path never reads start; '' keeps the input total when
        // the CANCEL's DTSTART is absent or unparseable.
        start: invite.start ?? '',
        end: invite.end,
        location: invite.location,
        meetLink: invite.meetLink,
        notes: null,
        source: 'ics',
        cancelled: true
      }).changed
    }
    if (invite?.start && (msg.classification === 'interview' || invite.method !== null)) {
      return proposeEvent({
        sourceMessageId: msg.id,
        icsUid: parsed?.uid ?? null,
        title: invite.title ?? cleanSubject(msg.subject),
        company: match?.company ?? null,
        rowId: match?.id ?? null,
        start: invite.start,
        end: invite.end,
        location: invite.location,
        meetLink: invite.meetLink,
        notes: null,
        source: 'ics'
      }).changed
    }
    if (msg.classification !== 'interview') return false
    // The message's own date is the clock: a backfill processing days-old mail
    // must not bump an already-past interview time into next year.
    const detected = extractEvent(msg.subject, bodyText, new Date(msg.date))
    if (!detected) return false
    return proposeEvent({
      sourceMessageId: msg.id,
      icsUid: null,
      title: detected.title,
      company: match?.company ?? null,
      rowId: match?.id ?? null,
      start: detected.start,
      end: detected.end,
      location: null,
      meetLink: null,
      notes: null,
      source: 'detected'
    }).changed
  }

  /** OS toasts for new high-stakes mail: recent messages only (a backfill of
   *  old mail is not news), capped per pass, overflow collapsed into one
   *  summary. A notification failure must never fail the sync. */
  private notifyNewMail(fresh: EmailMessage[]): void {
    if (!this.deps.store.state.settings.emailNotifications) return
    const now = Date.now()
    const notable = fresh.filter(
      (m) =>
        NOTIFY_CLASSES.includes(m.classification) &&
        Math.abs(now - Date.parse(m.date)) <= NOTIFY_WINDOW_MS
    )
    if (notable.length === 0) return
    try {
      if (!Notification.isSupported()) return
      for (const m of notable.slice(0, NOTIFY_MAX_PER_SYNC)) {
        this.showNotification(NOTIFY_TITLES[m.classification] ?? 'Job email', m.subject || m.snippet)
      }
      const rest = notable.length - NOTIFY_MAX_PER_SYNC
      if (rest > 0) this.showNotification('Job email', `+${rest} more new messages`)
    } catch (err) {
      console.error('[email] notification failed:', err)
    }
  }

  private showNotification(title: string, body: string): void {
    const n = new Notification({ title, body })
    n.on('click', () => {
      // Mirror the reminder pattern: focus the window, then route to the view
      // the notification is about.
      focusMainWindow()
      this.deps.send('push:emailFocus', {})
    })
    n.show()
  }

  /** Reclassify one cached message from its full body (fetched for display or
   *  by the backfill sweep). Heals a snippet-based mis-classification,
   *  refreshes its tracker suggestion, persists a freshly parsed invite, and
   *  proposes a calendar event the message qualifies for — a message cached
   *  before calendar extraction existed gets its event here. `parsed`
   *  undefined = the caller saw no usable ICS part (a stored invite is kept
   *  and still proposable). Applied/dismissed suggestions and hidden mail are
   *  left alone. Pushes so lists + badges update live. */
  reclassifyFromBody(
    id: string,
    body: string,
    parsed?: { invite: EmailInvite; uid: string | null } | null
  ): void {
    const msg = getCachedMessage(id)
    if (!msg || msg.hidden) return
    const rows = this.deps.tracker.listRows()
    const classification = classifyEmail(msg.from, msg.subject, body)
    const jobRelated = deriveJobRelated(msg.from, msg.subject, body, msg.jobRelated, classification)
    let suggestion = msg.suggestion
    let suggestionState = msg.suggestionState
    if (suggestionState === 'open' || suggestionState === null) {
      suggestion = suggestForMessage(classification, msg.from, msg.subject, body, rows)
      suggestionState = suggestion ? 'open' : null
    }
    const invite = parsed ? parsed.invite : undefined
    if (applyReclassification(id, { classification, jobRelated, suggestion, suggestionState, invite })) {
      this.deps.send('push:emailChanged', { suggestions: openSuggestionCount() })
    }
    const healed = getCachedMessage(id)
    if (healed) {
      // A stored invite without a fresh ICS part still proposes; uid null
      // means dedupe falls back to sourceMessageId, which is stable per mail.
      const proposable = parsed ?? (healed.invite ? { invite: healed.invite, uid: null } : null)
      if (this.proposeFromMessage(healed, proposable, body, rows)) {
        this.deps.send('push:calendarChanged', { proposed: proposedCount() })
      }
    }
  }

  private applyToTracker(suggestion: EmailSuggestion): void {
    // markApplied stamps dateApplied + [DONE]-renames per settings; plain
    // status flips go through upsertRow (keeps statusText coherent).
    if (suggestion.suggestStatus === 'applied') this.deps.tracker.markApplied(suggestion.rowId)
    else this.deps.tracker.upsertRow({ id: suggestion.rowId, statusKey: suggestion.suggestStatus })
  }
}

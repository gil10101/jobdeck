import type { EmailClassification, EmailMessage, EmailSuggestion, StatusKey, TrackerRow } from '@shared/types'
import type { Store } from '../store/Store'
import type { TrackerRepo } from '../store/trackerRepo'
import { gmailConfigured } from './gmailAuth'
import { getMessageMeta, listMessages, type GmailMessageMeta } from './gmailClient'
import { allCachedMessages, openSuggestionCount, upsertMessages } from './emailStore'

// Main-process poll loop (TodoWatcher sibling): every N minutes pull
// job-search-shaped mail + Primary-category and recent-inbox sweeps, classify
// deterministically, and propose tracker status updates. Suggestions are
// one-click by default; they are auto-applied ONLY behind settings.emailAutoApply.

/** Coding-assessment platforms — mail from these IS the assessment. */
const ASSESSMENT_DOMAINS = [
  'hackerrank.com',
  'codility.com',
  'codesignal.com',
  'karat.com',
  'hirevue.com',
  'testgorilla.com'
]
/** ATS notification senders — always job mail, but the subject picks the class.
 *  Workable routes candidate mail (incl. calendar invites) through
 *  inbound.workablemail.com, which is why interview invites slipped past. */
const ATS_DOMAINS = [
  'greenhouse.io',
  'lever.co',
  'ashbyhq.com',
  'myworkday.com',
  'icims.com',
  'smartrecruiters.com',
  'workable.com',
  'workablemail.com',
  'jobvite.com'
]

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

/** True when any address in the From header sits on (a subdomain of) one of
 *  `domains` — assessment invites often come from a mail.* subdomain. */
function fromDomainMatch(from: string, domains: string[]): boolean {
  const hosts = [...from.toLowerCase().matchAll(/@([a-z0-9-][a-z0-9.-]*)/g)].map((m) => m[1])
  return hosts.some((h) => domains.some((d) => h === d || h.endsWith(`.${d}`)))
}

/** Deterministic classification from the subject AND snippet. Order matters:
 *  assessment invites mention interviews, rejections mention everything — most
 *  specific signals first. Assessment-platform senders are 'assessment'
 *  outright; ATS senders that hit no rule default by whether the text mentions
 *  the application. The snippet is included throughout because the decisive
 *  word often lives in the body ("...take the Rembrandt Personality
 *  Assessment", a calendar invite's "When:/Attendees:" block), not the subject. */
export function classifyEmail(from: string, subject: string, snippet: string): EmailClassification {
  const s = subject
  const text = `${subject}\n${snippet}`
  // Retail/marketing blasts keyword-collide with job terms ("your OFFER ends
  // soon", "schedule your visit") — unless they come from a real ATS or
  // assessment sender, they are never job mail. Guard first so those terms
  // never reach the class rules below.
  if (
    !fromDomainMatch(from, [...ASSESSMENT_DOMAINS, ...ATS_DOMAINS]) &&
    looksPromotional(from, subject, snippet)
  ) {
    return 'other'
  }
  if (
    fromDomainMatch(from, ASSESSMENT_DOMAINS) ||
    /\bassessment\b|hackerrank|codility|codesignal|coding (challenge|test|exercise)|take[- ]home|\bonline assessment\b|personality (test|assessment)|\boa\b/i.test(
      text
    )
  ) {
    return 'assessment'
  }
  if (/offer letter|job offer|offer of employment|employment offer|pleased to (extend|offer)|extend(ing)? (you )?an offer|excited to offer you|we('d| would) (be happy to |like to )?offer you/i.test(text)) {
    return 'offer'
  }
  const rejection =
    /unfortunately|we regret|regret to inform|not (be )?(moving|proceeding) forward|will not be moving forward|decided (not )?to (move|proceed)|other candidates|not (been )?selected|no longer under consideration|pursue other (applicants|candidates)|position has been filled/i
  if (rejection.test(text)) return 'rejection'
  // Interview / call scheduling / calendar invites. Calendar markers
  // ("When:", "Attendees:", "reschedule", "needs-action") and phrasings like
  // "invite you for a call" carry no "interview" keyword, so match them too.
  const interview =
    /interview|technical screen|phone screen|screening call|next steps|invit(e|ation) (you )?(to|for)|schedule (a|your|some) (call|chat|conversation|meeting|time)|set up (a )?(call|time|chat)|book (a )?time|your availability|meet (the|with) (team|us)|phone (call|conversation)|hop on a call|speak with you|calendar (invite|invitation)|\bwhen:\s|\battendees:\b|\breschedule\b|needs-action|will call you|call (for|with|regarding).{0,40}\b(job|role|position|opportunity)\b/i
  if (interview.test(text)) return 'interview'
  const confirmation =
    /application (was |has been )?(received|submitted)|(thank you|thanks) for (applying|your application)|we('ve| have) received your application|application confirmation|successfully (applied|submitted)/i
  if (confirmation.test(text)) return 'confirmation'
  if (fromDomainMatch(from, ATS_DOMAINS)) {
    return /application/i.test(text) ? 'confirmation' : 'other'
  }
  if (/recruit|talent acquisition|sourcing|hiring team/i.test(from) || /\b(opportunity|opening|role at|position at)\b/i.test(s)) {
    return 'recruiter'
  }
  return 'other'
}

/** Marketing/promotional mail that keyword-matched the job sweep by accident
 *  ("your half price OFFER ends soon"). Only an unambiguous marketing sender
 *  subdomain, or a clearly promo-shaped subject/snippet, counts — generic
 *  labels (mail., email., news.) are excluded because real companies send
 *  legitimate hiring mail from them. */
function looksPromotional(from: string, subject: string, snippet: string): boolean {
  const host = from.toLowerCase().match(/@([a-z0-9.-]+)/)?.[1] ?? ''
  if (/(^|\.)(offers?|usoffers|deals?|promo|promotions?|marketing|newsletters?|eblast)\./.test(host)) {
    return true
  }
  const text = `${subject} ${snippet}`.toLowerCase()
  return /\b\d+%\s*(off|discount)\b|half price|\bcoupon\b|promo code|limited[- ]time|(offer|deal|sale|discount) ends|flash sale|shop now|free (month|trial|shipping)/.test(
    text
  )
}

/** True if a message belongs in the Job tab. ATS/assessment senders are always
 *  job mail. Otherwise it must have hit the job sweep — and mail the classifier
 *  could only call 'other' is dropped when it looks promotional, so a retail
 *  "offer"/"schedule" blast that snuck into the sweep does not pollute the tab.
 *  A message the classifier recognized as a real job class (interview, offer,
 *  rejection, …) is never demoted. */
export function deriveJobRelated(
  from: string,
  subject: string,
  snippet: string,
  jobHit: boolean,
  classification: EmailClassification
): boolean {
  if (fromDomainMatch(from, [...ATS_DOMAINS, ...ASSESSMENT_DOMAINS])) return true
  if (classification === 'other' && looksPromotional(from, subject, snippet)) return false
  return jobHit
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
 *  the inbox) contained token-aligned in From+Subject+snippet; longest match
 *  wins. The snippet is searched because ATS mail (Lever/Greenhouse) hides the
 *  company in the body, not the from-address or subject, so a rejection like
 *  "...role at Veeva" only matches once the body text is in scope.
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

      for (const meta of metas) {
        batch.push(this.buildMessage(meta, jobIds.has(meta.id), primaryIds.has(meta.id), rows))
      }
      // Re-listed known messages: refresh the job/primary flags (a message can
      // enter either set later; caches from before the primary flag existed
      // heal here too) and re-derive still-open/uncomputed suggestions against
      // the current tracker; applied/dismissed decisions are final.
      for (const id of wantedIds) {
        const known = cached.get(id)
        if (!known) continue
        const inPrimary = known.primary === true || primaryIds.has(id)
        // The classifier improved too — recompute the class for still-open mail
        // so a re-listed message reflects the current rules.
        const classification =
          known.suggestionState === 'applied' || known.suggestionState === 'dismissed'
            ? known.classification
            : classifyEmail(known.from, known.subject, known.snippet)
        // Re-derive (not sticky-OR) so the promo demotion and better sender
        // rules heal messages the old logic mis-flagged.
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
          suggestion = known.hidden
            ? null
            : suggestForMessage(classification, known.from, known.subject, known.snippet, rows)
          suggestionState = suggestion ? 'open' : null
        }
        const changed =
          jobRelated !== known.jobRelated ||
          inPrimary !== known.primary ||
          classification !== known.classification ||
          suggestionState !== known.suggestionState ||
          JSON.stringify(suggestion) !== JSON.stringify(known.suggestion)
        if (changed) {
          batch.push({ ...known, classification, jobRelated, primary: inPrimary, suggestion, suggestionState })
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
      return { fetched: metas.length }
    } finally {
      this.syncing = false
    }
  }

  private buildMessage(
    meta: GmailMessageMeta,
    jobHit: boolean,
    primary: boolean,
    rows: TrackerRow[]
  ): EmailMessage {
    const classification = classifyEmail(meta.from, meta.subject, meta.snippet)
    const jobRelated = deriveJobRelated(meta.from, meta.subject, meta.snippet, jobHit, classification)
    const suggestion = suggestForMessage(classification, meta.from, meta.subject, meta.snippet, rows)
    return {
      ...meta,
      classification,
      jobRelated,
      primary,
      suggestion,
      suggestionState: suggestion ? 'open' : null,
      favorite: false,
      hidden: false,
      tags: []
    }
  }

  private applyToTracker(suggestion: EmailSuggestion): void {
    // markApplied stamps dateApplied + [DONE]-renames per settings; plain
    // status flips go through upsertRow (keeps statusText coherent).
    if (suggestion.suggestStatus === 'applied') this.deps.tracker.markApplied(suggestion.rowId)
    else this.deps.tracker.upsertRow({ id: suggestion.rowId, statusKey: suggestion.suggestStatus })
  }
}

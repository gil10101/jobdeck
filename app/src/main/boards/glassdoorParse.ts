// Normalize Glassdoor's proprietary job JSON (from the in-app browser session)
// into the same row shape the scout agent already reads for custom boards.
// Glassdoor emits no JSON-LD on its job pages (they are marked non-indexable),
// so this parses the app-state / API objects the logged-in page loads instead.
// The exact object shape shifts over time, so every field is pulled defensively
// from several known paths and missing ones degrade to '' rather than throwing.

export interface GlassdoorRow {
  listingId: string
  title: string
  company: string
  location: string
  /** Formatted pay range, '' when the posting lists none. */
  salary: string
  /** Absolute glassdoor.com job URL. */
  url: string
  /** ISO date derived from the posting age, when known. */
  postedAt?: string
  /** Company overall rating, when the object carried it. */
  rating?: number
  /** Full description text (present on single job views, usually absent in a
   *  search result row); HTML flattened to text. */
  description?: string
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Ids arrive as numbers or strings in Glassdoor's JSON — coerce to a string. */
function idStr(v: unknown): string {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return str(v)
}

/** First non-empty string among several candidate paths. */
function pick(obj: Record<string, unknown>, paths: string[]): string {
  for (const p of paths) {
    const val = p.split('.').reduce<unknown>((acc, k) => (acc as Record<string, unknown>)?.[k], obj)
    const s = str(val)
    if (s) return s
  }
  return ''
}

/** Flatten Glassdoor's HTML description to readable text (no deps). */
function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const PERIOD_SUFFIX: Record<string, string> = {
  HOURLY: '/hr',
  DAILY: '/day',
  WEEKLY: '/wk',
  MONTHLY: '/mo',
  ANNUAL: '/yr',
  YEARLY: '/yr'
}

/** Format `payPeriodAdjustedPay` (p10/p50/p90) into a human range. */
function formatSalary(job: Record<string, unknown>): string {
  const pay = (job.payPeriodAdjustedPay ?? {}) as Record<string, unknown>
  const lo = num(pay.p10)
  const mid = num(pay.p50)
  const hi = num(pay.p90)
  const low = lo ?? mid
  const high = hi ?? mid
  if (low === null && high === null) return ''
  const currency = str(job.payCurrency) === 'USD' ? '$' : `${str(job.payCurrency)} `
  const period = str(job.payPeriod).toUpperCase()
  const suffix = PERIOD_SUFFIX[period] ?? ''
  const fmt = (n: number): string => `${currency}${Math.round(n).toLocaleString('en-US')}`
  const range = low !== null && high !== null && low !== high ? `${fmt(low)}-${fmt(high)}` : fmt((high ?? low) as number)
  return `${range}${suffix}`
}

/** ISO date `ageInDays` before `nowMs`, or undefined when age is unknown. */
function postedAtFrom(job: Record<string, unknown>, nowMs: number): string | undefined {
  const details = (job.jobListingDetails ?? {}) as Record<string, unknown>
  const age = num(job.ageInDays) ?? num(details.ageInDays)
  if (age === null) return undefined
  return new Date(nowMs - age * 86_400_000).toISOString().slice(0, 10)
}

function absoluteUrl(link: string): string {
  if (!link) return ''
  if (/^https?:\/\//i.test(link)) return link
  return `https://www.glassdoor.com${link.startsWith('/') ? '' : '/'}${link}`
}

/** A raw object is a job listing if it carries an id AND a title under any of
 *  the shapes Glassdoor uses (job view, search row, Apollo cache entry). */
export function isGlassdoorJob(node: unknown): node is Record<string, unknown> {
  if (!node || typeof node !== 'object') return false
  const o = node as Record<string, unknown>
  const details = (o.jobListingDetails ?? {}) as Record<string, unknown>
  const hasId = !!(o.listingId ?? o.jobListingId ?? details.jobListingId ?? o.jobId)
  const hasTitle = !!(o.jobTitle ?? o.jobTitleText ?? details.jobTitleText ?? o.normalizedJobTitle)
  return hasId && hasTitle
}

/** Normalize one raw Glassdoor job object into a row (nowMs must be supplied —
 *  the caller stamps a real clock; this stays deterministic for testing). */
export function normalizeGlassdoorJob(raw: Record<string, unknown>, nowMs: number): GlassdoorRow | null {
  const details = (raw.jobListingDetails ?? {}) as Record<string, unknown>
  const overview = (raw.jobOverview ?? {}) as Record<string, unknown>
  const listingId =
    idStr(raw.listingId) ||
    idStr(raw.jobListingId) ||
    idStr(details.jobListingId) ||
    idStr(overview.listingId) ||
    idStr(raw.jobId)
  const title = pick(raw, ['jobTitle', 'jobTitleText', 'jobListingDetails.jobTitleText', 'jobOverview.jobTitleText'])
  if (!listingId || !title) return null
  const company = pick(raw, [
    'employerName',
    'jobListingDetails.employer.name',
    'jobListingDetails.employerNameFromSearch',
    'employerOverview.name',
    'employer.name'
  ])
  const location = pick(raw, ['locationName', 'location.name', 'jobListingDetails.locationName'])
  const descHtml = pick(raw, ['jobDescription', 'jobOverview.description'])
  const rating = num(raw.employerRating) ?? num((raw.employerOverview as Record<string, unknown>)?.overallRating)
  const row: GlassdoorRow = {
    listingId,
    title,
    company,
    location,
    salary: formatSalary(raw),
    url: absoluteUrl(str(raw.seoJobLink) || str(details.seoJobLink) || str(raw.jobLink))
  }
  const postedAt = postedAtFrom(raw, nowMs)
  if (postedAt) row.postedAt = postedAt
  if (rating !== null) row.rating = rating
  if (descHtml) row.description = htmlToText(descHtml)
  return row
}

/** Pull job rows out of a page's raw HTML by parsing its embedded
 *  `<script type="application/json">` / `__NEXT_DATA__` blobs (where Glassdoor
 *  ships its app state). Used by the single-job Build path, which only has the
 *  outer HTML. Empty when no parseable job data is embedded. */
export function extractGlassdoorRowsFromHtml(html: string, nowMs: number): GlassdoorRow[] {
  const byId = new Map<string, GlassdoorRow>()
  const scriptRe = /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi
  for (const m of html.matchAll(scriptRe)) {
    const t = m[1].trim()
    if (!/jobListing|jobTitleText|listingId/.test(t)) continue
    try {
      for (const row of extractGlassdoorRows(JSON.parse(t), nowMs)) byId.set(row.listingId, row)
    } catch {
      /* not valid JSON — skip this blob */
    }
  }
  return [...byId.values()]
}

/** Walk an arbitrary payload (single job, results array, Apollo cache, nested
 *  page state) and return every job row found, deduped by listingId. Bounded
 *  recursion so a huge app-state blob can't runaway. */
export function extractGlassdoorRows(payload: unknown, nowMs: number, cap = 500): GlassdoorRow[] {
  const rows = new Map<string, GlassdoorRow>()
  const seen = new Set<unknown>()
  const walk = (node: unknown, depth: number): void => {
    if (rows.size >= cap || depth > 8 || !node || typeof node !== 'object') return
    if (seen.has(node)) return
    seen.add(node)
    if (isGlassdoorJob(node)) {
      const row = normalizeGlassdoorJob(node as Record<string, unknown>, nowMs)
      if (row && !rows.has(row.listingId)) rows.set(row.listingId, row)
      // Do not return — a job object may nest another (jobListingDetails), but
      // the dedupe by id keeps that harmless.
    }
    if (Array.isArray(node)) {
      for (const el of node) walk(el, depth + 1)
    } else {
      for (const val of Object.values(node as Record<string, unknown>)) walk(val, depth + 1)
    }
  }
  walk(payload, 0)
  return [...rows.values()]
}

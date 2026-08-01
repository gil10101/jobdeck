// Normalize Glassdoor's job JSON (captured from the in-app browser session)
// into the row shape the scout agent already reads for custom boards.
//
// Two data shapes occur and both are handled:
//  1. Denormalized API responses (what the Network tab shows) — every field
//     inline: jobTitle, employerName, payPeriodAdjustedPay, seoJobLink, …
//  2. Apollo's NORMALIZED cache (window.__APOLLO_STATE__) — a flat map of
//     "Type:id" → object, where a job's employer/location/pay live in SEPARATE
//     entries reached through `{ __ref: "Employer:123" }` pointers, and the
//     job's own fields sit under `header`/`job` sub-objects. Reading (2) without
//     following the refs is why rows came back with blank company/location/pay.
//
// So a `__ref` resolver is built from the whole payload and threaded through
// field extraction, with a key-name deep-search fallback for shape drift.

export interface GlassdoorRow {
  listingId: string
  title: string
  company: string
  location: string
  salary: string
  url: string
  postedAt?: string
  rating?: number
  description?: string
}

type Obj = Record<string, unknown>
type Resolve = (v: unknown) => unknown
const IDENTITY: Resolve = (v) => v

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
function idStr(v: unknown): string {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return str(v)
}
function isObj(v: unknown): v is Obj {
  return !!v && typeof v === 'object'
}

/** Build a "Type:id" → object map from every Apollo-cache-shaped object in the
 *  payload (keys containing ':' whose values are objects), so `{__ref}` pointers
 *  can be dereferenced wherever the cache actually sits. */
function buildRefMap(payload: unknown): Map<string, Obj> {
  const map = new Map<string, Obj>()
  const seen = new Set<unknown>()
  const walk = (node: unknown, depth: number): void => {
    if (!isObj(node) || depth > 8 || seen.has(node)) return
    seen.add(node)
    for (const [k, v] of Object.entries(node)) {
      if (k.includes(':') && isObj(v) && !Array.isArray(v)) map.set(k, v)
      walk(v, depth + 1)
    }
  }
  walk(payload, 0)
  return map
}

function makeResolve(map: Map<string, Obj>): Resolve {
  return (v: unknown): unknown => {
    if (isObj(v) && typeof (v as Obj).__ref === 'string') {
      return map.get((v as Obj).__ref as string) ?? v
    }
    return v
  }
}

/** Traverse `paths` on `obj`, dereferencing an Apollo `{__ref}` at each hop, and
 *  return the first non-empty string found. */
function pick(obj: Obj, paths: string[], resolve: Resolve): string {
  for (const p of paths) {
    let cur: unknown = obj
    for (const key of p.split('.')) {
      cur = resolve(cur)
      if (!isObj(cur)) {
        cur = undefined
        break
      }
      cur = (cur as Obj)[key]
    }
    const s = str(resolve(cur))
    if (s) return s
  }
  return ''
}

/** Like pick, but for id fields — coerces a numeric value to a string (Glassdoor
 *  listing ids are numbers, which str() would drop). */
function pickId(obj: Obj, paths: string[], resolve: Resolve): string {
  for (const p of paths) {
    let cur: unknown = obj
    for (const key of p.split('.')) {
      cur = resolve(cur)
      if (!isObj(cur)) {
        cur = undefined
        break
      }
      cur = (cur as Obj)[key]
    }
    const s = idStr(resolve(cur))
    if (s) return s
  }
  return ''
}

/** First string anywhere under `root` (refs resolved, depth-bounded) whose key
 *  matches `keyRe`. The last-resort fallback when known paths miss. */
function deepFindString(root: Obj, keyRe: RegExp, resolve: Resolve, maxDepth = 5): string {
  const seen = new Set<unknown>()
  const walk = (node: unknown, depth: number): string => {
    const r = resolve(node)
    if (!isObj(r) || depth > maxDepth || seen.has(r)) return ''
    seen.add(r)
    for (const [k, v] of Object.entries(r)) {
      if (keyRe.test(k)) {
        const s = str(resolve(v))
        if (s) return s
      }
    }
    for (const v of Object.values(r)) {
      const found = walk(v, depth + 1)
      if (found) return found
    }
    return ''
  }
  return walk(root, 0)
}

/** First object anywhere under `root` (refs resolved) that satisfies `pred`. */
function deepFindObj(root: Obj, pred: (o: Obj) => boolean, resolve: Resolve, maxDepth = 5): Obj | null {
  const seen = new Set<unknown>()
  const walk = (node: unknown, depth: number): Obj | null => {
    const r = resolve(node)
    if (!isObj(r) || depth > maxDepth || seen.has(r)) return null
    seen.add(r)
    if (pred(r)) return r
    for (const v of Object.values(r)) {
      const found = walk(v, depth + 1)
      if (found) return found
    }
    return null
  }
  return walk(root, 0)
}

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

/** Find the pay object (inline or under header/job) and format a range. */
function formatSalary(job: Obj, resolve: Resolve): string {
  const holder =
    deepFindObj(
      job,
      (o) => isObj(o.payPeriodAdjustedPay) || (!!str(o.payPeriod) && (num(o.payMin) !== null || isObj(o.payPeriodAdjustedPay))),
      resolve,
      4
    ) ?? job
  const pay = (resolve(holder.payPeriodAdjustedPay) ?? {}) as Obj
  const lo = num(pay.p10)
  const mid = num(pay.p50)
  const hi = num(pay.p90)
  const low = lo ?? mid ?? num(holder.payMin)
  const high = hi ?? mid ?? num(holder.payMax)
  if (low === null && high === null) return ''
  const currency = str(holder.payCurrency) === 'USD' || !str(holder.payCurrency) ? '$' : `${str(holder.payCurrency)} `
  const suffix = PERIOD_SUFFIX[str(holder.payPeriod).toUpperCase()] ?? ''
  const fmt = (n: number): string => `${currency}${Math.round(n).toLocaleString('en-US')}`
  const range =
    low !== null && high !== null && low !== high ? `${fmt(low)}-${fmt(high)}` : fmt((high ?? low) as number)
  return `${range}${suffix}`
}

function postedAtFrom(job: Obj, resolve: Resolve, nowMs: number): string | undefined {
  const holder = deepFindObj(job, (o) => num(o.ageInDays) !== null, resolve, 4) ?? job
  const age = num(holder.ageInDays)
  if (age === null) return undefined
  return new Date(nowMs - age * 86_400_000).toISOString().slice(0, 10)
}

function ratingFrom(job: Obj, resolve: Resolve): number | null {
  const holder = deepFindObj(job, (o) => num(o.overallRating) !== null || num(o.employerRating) !== null, resolve, 4)
  if (!holder) return null
  return num(holder.overallRating) ?? num(holder.employerRating)
}

function descriptionFrom(job: Obj, resolve: Resolve): string {
  const html = pick(job, ['jobDescription', 'job.description', 'jobOverview.description', 'description'], resolve)
  if (html) return htmlToText(html)
  // Normalized cache sometimes ships the body split into fragments.
  const frag = deepFindObj(job, (o) => Array.isArray(o.descriptionFragments), resolve, 4)
  if (frag && Array.isArray(frag.descriptionFragments)) {
    const text = (frag.descriptionFragments as unknown[]).map((f) => str(f)).filter(Boolean).join('\n')
    if (text) return htmlToText(text)
  }
  return ''
}

function absoluteUrl(link: string): string {
  if (!link) return ''
  if (/^https?:\/\//i.test(link)) return link
  return `https://www.glassdoor.com${link.startsWith('/') ? '' : '/'}${link}`
}

/** A job listing carries an id AND a title under one of the shapes Glassdoor
 *  uses (denormalized response, normalized JobListing/JobView/SearchResult). */
export function isGlassdoorJob(node: unknown): node is Obj {
  if (!isObj(node)) return false
  const o = node
  const header = isObj(o.header) ? o.header : {}
  const details = isObj(o.jobListingDetails) ? o.jobListingDetails : {}
  const jobSub = isObj(o.job) ? o.job : {}
  const hasId = !!(o.listingId ?? o.jobListingId ?? details.jobListingId ?? jobSub.listingId ?? o.jobId)
  const hasTitle = !!(
    o.jobTitle ??
    o.jobTitleText ??
    header.jobTitleText ??
    details.jobTitleText ??
    jobSub.jobTitleText ??
    o.normalizedJobTitle
  )
  return hasId && hasTitle
}

/** Normalize one raw job object into a row. `resolve` dereferences Apollo refs;
 *  pass IDENTITY for already-denormalized objects. */
export function normalizeGlassdoorJob(raw: Obj, nowMs: number, resolve: Resolve = IDENTITY): GlassdoorRow | null {
  const listingId = pickId(
    raw,
    [
      'listingId',
      'jobListingId',
      'job.listingId',
      'jobListingDetails.jobListingId',
      'jobOverview.listingId',
      'header.jobListingId',
      'jobId'
    ],
    resolve
  )
  const title =
    pick(
      raw,
      [
        'jobTitle',
        'jobTitleText',
        'header.jobTitleText',
        'job.jobTitleText',
        'jobListingDetails.jobTitleText',
        'jobOverview.jobTitleText'
      ],
      resolve
    ) || deepFindString(raw, /^(jobTitleText|jobTitle|normalizedJobTitle)$/, resolve)
  if (!listingId || !title) return null

  const company =
    pick(
      raw,
      [
        'employerName',
        'header.employerNameFromSearch',
        'header.employer.name',
        'header.employer.shortName',
        'jobListingDetails.employer.name',
        'jobListingDetails.employerNameFromSearch',
        'employerOverview.name',
        'employer.name',
        'employer.shortName'
      ],
      resolve
    ) || deepFindString(raw, /^(employerName|employerNameFromSearch|shortName)$/, resolve)

  const location =
    pick(raw, ['locationName', 'header.locationName', 'location.name', 'jobListingDetails.locationName'], resolve) ||
    deepFindString(raw, /^(locationName|cityName)$/, resolve)

  const url = absoluteUrl(
    pick(raw, ['seoJobLink', 'header.seoJobLink', 'jobListingDetails.seoJobLink', 'jobLink', 'header.jobLink'], resolve) ||
      deepFindString(raw, /^(seoJobLink|jobLink)$/, resolve)
  )

  const row: GlassdoorRow = {
    listingId,
    title,
    company,
    location,
    salary: formatSalary(raw, resolve),
    url
  }
  const postedAt = postedAtFrom(raw, resolve, nowMs)
  if (postedAt) row.postedAt = postedAt
  const rating = ratingFrom(raw, resolve)
  if (rating !== null) row.rating = rating
  const desc = descriptionFrom(raw, resolve)
  if (desc) row.description = desc
  return row
}

/** Pull job rows out of a page's raw HTML by parsing its embedded
 *  `<script type="application/json">` / `__NEXT_DATA__` blobs. */
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
 *  page state) and return every job row found, deduped by listingId, with
 *  Apollo `__ref` pointers resolved against the whole payload. */
export function extractGlassdoorRows(payload: unknown, nowMs: number, cap = 500): GlassdoorRow[] {
  const resolve = makeResolve(buildRefMap(payload))
  const rows = new Map<string, GlassdoorRow>()
  const seen = new Set<unknown>()
  const walk = (node: unknown, depth: number): void => {
    if (rows.size >= cap || depth > 8 || !isObj(node) || seen.has(node)) return
    seen.add(node)
    if (isGlassdoorJob(node)) {
      const row = normalizeGlassdoorJob(node, nowMs, resolve)
      if (row && !rows.has(row.listingId)) rows.set(row.listingId, row)
    }
    if (Array.isArray(node)) {
      for (const el of node) walk(el, depth + 1)
    } else {
      for (const val of Object.values(node)) walk(val, depth + 1)
    }
  }
  walk(payload, 0)
  return [...rows.values()]
}

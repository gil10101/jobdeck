import fs from 'node:fs'
import path from 'node:path'
import type { ProfileFile } from '@shared/profile'
import { SCOUT_DIR } from '../paths'
import { extractGlassdoorRows, type GlassdoorRow } from './glassdoorParse'

// The Glassdoor feed is harvested by the in-app browser (the user's real logged
// in session) BEFORE a scout run and written to a STABLE path the scout agent
// reads — the jobright-feed pattern, but the fetch happens in the visible
// browser because only a real session clears Glassdoor's bot protection. The
// renderer captures raw page JSON; normalization lives here (one tested parser).

const MAX_ROWS = 400
const STALE_MS = 24 * 60 * 60 * 1000

export interface GlassdoorFeed {
  fetchedAt: string
  searches: string[]
  rows: GlassdoorRow[]
}

function feedFile(): string {
  return path.join(SCOUT_DIR, 'glassdoor.feed.json')
}

/** Absolute path of the stable Glassdoor feed file (for toRel in the prompt). */
export function glassdoorFeedPath(): string {
  return feedFile()
}

/** Normalize the raw job objects the browser captured across all searches and
 *  write the feed (deduped by listingId, newest-capture wins, capped). */
export function writeGlassdoorFeed(searches: string[], rawPayloads: unknown[], nowMs: number): GlassdoorFeed {
  const byId = new Map<string, GlassdoorRow>()
  for (const payload of rawPayloads) {
    for (const row of extractGlassdoorRows(payload, nowMs)) {
      byId.set(row.listingId, row)
    }
  }
  const feed: GlassdoorFeed = {
    fetchedAt: new Date(nowMs).toISOString(),
    searches,
    rows: [...byId.values()].slice(0, MAX_ROWS)
  }
  fs.mkdirSync(SCOUT_DIR, { recursive: true })
  fs.writeFileSync(feedFile(), JSON.stringify(feed, null, 2))
  return feed
}

export function readGlassdoorFeed(): GlassdoorFeed | null {
  try {
    const feed = JSON.parse(fs.readFileSync(feedFile(), 'utf-8')) as GlassdoorFeed
    if (!Array.isArray(feed.rows)) return null
    return feed
  } catch {
    return null
  }
}

/** Feed summary for the Settings card. `stale` when older than STALE_MS. */
export function glassdoorFeedStatus(nowMs: number): { count: number; fetchedAt: string; stale: boolean } | null {
  const feed = readGlassdoorFeed()
  if (!feed) return null
  return {
    count: feed.rows.length,
    fetchedAt: feed.fetchedAt,
    stale: nowMs - Date.parse(feed.fetchedAt) > STALE_MS
  }
}

export function clearGlassdoorFeed(): void {
  fs.rmSync(feedFile(), { force: true })
}

/** Default Glassdoor search URLs derived from the profile's search terms and
 *  primary location. Glassdoor's precise location filter needs an internal
 *  locId, so the location is folded into the keyword (biases results toward it)
 *  — good enough for a default; the user pastes locId-tuned URLs for precision. */
export function defaultGlassdoorSearches(profile: ProfileFile | null): string[] {
  const cfg = profile?.searchConfig
  const terms = cfg?.boards.linkedin.queries.length
    ? cfg.boards.linkedin.queries
    : (cfg?.targetRoles ?? []).map((r) => r.title)
  const location = cfg?.boards.linkedin.location?.trim() ?? ''
  return terms
    .slice(0, 4)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((term) => {
      const keyword = location ? `${term} ${location}` : term
      return `https://www.glassdoor.com/Job/jobs.htm?sc.keyword=${encodeURIComponent(keyword)}`
    })
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

// A Glassdoor LOCATION base URL: /Job/<loc>-jobs-SRCH_IL.<a>,<b>_IC<locId>.htm
// (no keyword). Glassdoor's SRCH URLs encode character offsets into the slug —
// IL.a,b marks the location text, IC is the internal location id, KO marks the
// keyword. From a base we can synthesize a precise per-role search at that exact
// location by splicing the keyword slug in and recomputing the KO offsets.
// The trailing (\?\S*)? captures any filter query the user appended to the base
// (e.g. ?seniorityType=internship&fromAge=3) so it rides onto every generated
// per-role search — that is how internship/recency filtering reaches the harvest.
const BASE_LOCATION_RE = /glassdoor\.[^/]*\/Job\/(.+?)-jobs-SRCH_IL\.(\d+),(\d+)_IC(\d+)\.htm(\?\S*)?/i

/** Expand a location base URL into one precise search per term (preserving any
 *  filter query); null if `url` is not a bare location base (a full keyworded
 *  search is used as-is). */
function expandLocationBase(url: string, terms: string[]): string[] | null {
  const m = url.match(BASE_LOCATION_RE)
  if (!m) return null
  const [, locSlug, ilStart, ilEnd, locId, query = ''] = m
  const koStart = Number(ilEnd) + 1 // the hyphen after the location slug
  return terms.map((term) => {
    const kw = slugify(term)
    const slug = `${locSlug}-${kw}-jobs`
    return `https://www.glassdoor.com/Job/${slug}-SRCH_IL.${ilStart},${ilEnd}_IC${locId}_KO${koStart},${koStart + kw.length}.htm${query}`
  })
}

function searchTerms(profile: ProfileFile | null): string[] {
  const cfg = profile?.searchConfig
  const terms = cfg?.boards.linkedin.queries.length
    ? cfg.boards.linkedin.queries
    : (cfg?.targetRoles ?? []).map((r) => r.title)
  return terms
    .slice(0, 5)
    .map((t) => t.trim())
    .filter(Boolean)
}

/** The searches to harvest. A pasted Glassdoor LOCATION base URL is expanded
 *  into a precise search per target role at that location; a pasted full search
 *  URL is used verbatim; with nothing pasted, fall back to the keyword-embedded
 *  default. */
export function resolveGlassdoorSearches(pasted: string[], profile: ProfileFile | null): string[] {
  const terms = searchTerms(profile)
  const out: string[] = []
  for (const raw of pasted.map((u) => u.trim()).filter(Boolean)) {
    if (!/^https?:\/\/[^\s]*glassdoor\./i.test(raw)) continue
    const expanded = expandLocationBase(raw, terms)
    if (expanded) out.push(...expanded)
    else out.push(raw)
  }
  return out.length ? out : defaultGlassdoorSearches(profile)
}

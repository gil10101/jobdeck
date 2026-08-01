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

/** The searches to harvest: the user's pasted URLs if any, else auto-derived. */
export function resolveGlassdoorSearches(pasted: string[], profile: ProfileFile | null): string[] {
  const clean = pasted.map((u) => u.trim()).filter((u) => /^https?:\/\/[^\s]*glassdoor\./i.test(u))
  return clean.length ? clean : defaultGlassdoorSearches(profile)
}

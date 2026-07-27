import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { CustomBoard, CustomBoardAts } from '@shared/profile'
import type { CustomBoardTest } from '@shared/types'
import { validateProfile } from '../profile/profileSchema'
import { loadProfile, saveProfile } from '../profile/profileStore'

// Custom company boards: user-followed careers pages hosted on one of three
// ATS platforms, each with a stable DOCUMENTED public JSON API. Everything is
// fetched app-side (plain fetch, no credentials) before a scout run — the
// agent only ever Reads the resulting file. Arbitrary HTML career sites are
// declined outright: they have no stable structure, and per-site scrapers rot
// silently, so the honest answer is "no" with the reason.

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const FETCH_TIMEOUT_MS = 15_000

/** Bound the prefetch file: a mega-board must not blow up the agent's context. */
const MAX_ROWS_PER_BOARD = 500

const DECLINE_MESSAGE =
  'That is not a supported ATS board URL. Supported: Greenhouse (boards.greenhouse.io/<company>), ' +
  'Lever (jobs.lever.co/<company>), Ashby (jobs.ashbyhq.com/<company>) — their public APIs are stable. ' +
  'Other career sites have no stable structure to fetch (per-site scrapers rot silently), so they are ' +
  'declined; paste individual postings into Intake by URL instead.'

export interface CustomBoardRow {
  title: string
  location: string
  url: string
  postedAt?: string
  department?: string
}

/** Per-board summary of an app-side prefetch (rows land in the output file). */
export interface CustomBoardsPrefetch {
  boards: { label: string; ats: CustomBoardAts; count: number }[]
  /** One line per ENABLED board whose fetch failed: "<label> (<ats>): <reason>". */
  unavailable: string[]
}

/** Map a pasted careers URL to its ATS + company slug, or throw the decline
 *  reason. Board front pages AND individual posting URLs both resolve (the
 *  slug is the first path segment on all three platforms). */
export function detectCustomBoard(rawUrl: string): { ats: CustomBoardAts; slug: string } {
  let url: URL
  try {
    url = new URL(rawUrl.trim())
  } catch {
    throw new Error('that is not a valid URL — paste the full careers-page address (https://…)')
  }
  if (url.protocol !== 'https:') {
    throw new Error('only https:// careers URLs are accepted')
  }
  const host = url.hostname.toLowerCase()
  const segs = url.pathname
    .split('/')
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s)
      } catch {
        return s
      }
    })
  if (host === 'boards.greenhouse.io' || host === 'job-boards.greenhouse.io') {
    // Embed form carries the slug in a query param instead of the path.
    const slug = segs[0] === 'embed' ? (url.searchParams.get('for') ?? '') : (segs[0] ?? '')
    return { ats: 'greenhouse', slug: checkSlug(slug.toLowerCase(), 'greenhouse') }
  }
  if (host === 'jobs.lever.co') {
    return { ats: 'lever', slug: checkSlug((segs[0] ?? '').toLowerCase(), 'lever') }
  }
  if (host === 'jobs.ashbyhq.com') {
    // Ashby board names can be display names ("Acme Corp") — keep case/spaces.
    return { ats: 'ashby', slug: checkSlug(segs[0] ?? '', 'ashby') }
  }
  throw new Error(DECLINE_MESSAGE)
}

function checkSlug(slug: string, ats: CustomBoardAts): string {
  // Greenhouse/Lever slugs are URL-safe tokens; Ashby allows display names.
  const ok =
    ats === 'ashby' ? /^[A-Za-z0-9 ._&()'-]{1,100}$/.test(slug) : /^[a-z0-9_-]{1,100}$/.test(slug)
  if (!ok) {
    throw new Error(
      `could not read a company identifier from that URL — paste the board's front page, e.g. https://${SAMPLE_HOST[ats]}/<company>`
    )
  }
  return slug
}

const SAMPLE_HOST: Record<CustomBoardAts, string> = {
  greenhouse: 'boards.greenhouse.io',
  lever: 'jobs.lever.co',
  ashby: 'jobs.ashbyhq.com'
}

/** The documented public endpoint per ATS — the ONLY URLs this module fetches. */
function apiUrl(ats: CustomBoardAts, slug: string): string {
  const s = encodeURIComponent(slug)
  if (ats === 'greenhouse') return `https://boards-api.greenhouse.io/v1/boards/${s}/jobs`
  if (ats === 'lever') return `https://api.lever.co/v0/postings/${s}?mode=json`
  return `https://api.ashbyhq.com/posting-api/job-board/${s}`
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  })
  if (res.status === 404) {
    throw new Error('the ATS knows no public board under that company identifier (HTTP 404)')
  }
  if (!res.ok) throw new Error(`board fetch failed: HTTP ${res.status}`)
  return res.json()
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/** ISO date (YYYY-MM-DD) from an ISO string or ms epoch; undefined when absent. */
function isoDate(v: unknown): string | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10)
  }
  if (typeof v === 'string' && v) {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10)
  }
  return undefined
}

function normalizeGreenhouse(data: unknown): CustomBoardRow[] {
  const jobs = (data as { jobs?: unknown[] } | null)?.jobs
  if (!Array.isArray(jobs)) throw new Error('unexpected Greenhouse response shape (no jobs array)')
  return jobs
    .map((j): CustomBoardRow => {
      const job = (j ?? {}) as {
        title?: unknown
        absolute_url?: unknown
        location?: { name?: unknown }
        first_published?: unknown
        updated_at?: unknown
        departments?: { name?: unknown }[]
      }
      return {
        title: str(job.title),
        location: str(job.location?.name),
        url: str(job.absolute_url),
        postedAt: isoDate(job.first_published) ?? isoDate(job.updated_at),
        department: Array.isArray(job.departments) ? str(job.departments[0]?.name) || undefined : undefined
      }
    })
    .filter((r) => r.title && r.url)
}

function normalizeLever(data: unknown): CustomBoardRow[] {
  if (!Array.isArray(data)) throw new Error('unexpected Lever response shape (not an array)')
  return data
    .map((j): CustomBoardRow => {
      const job = (j ?? {}) as {
        text?: unknown
        hostedUrl?: unknown
        createdAt?: unknown
        categories?: { location?: unknown; team?: unknown; department?: unknown }
      }
      return {
        title: str(job.text),
        location: str(job.categories?.location),
        url: str(job.hostedUrl),
        postedAt: isoDate(job.createdAt),
        department: str(job.categories?.team) || str(job.categories?.department) || undefined
      }
    })
    .filter((r) => r.title && r.url)
}

function normalizeAshby(data: unknown): CustomBoardRow[] {
  const jobs = (data as { jobs?: unknown[] } | null)?.jobs
  if (!Array.isArray(jobs)) throw new Error('unexpected Ashby response shape (no jobs array)')
  return jobs
    .map((j): CustomBoardRow & { listed: boolean } => {
      const job = (j ?? {}) as {
        title?: unknown
        location?: unknown
        department?: unknown
        team?: unknown
        jobUrl?: unknown
        publishedAt?: unknown
        isListed?: unknown
      }
      return {
        title: str(job.title),
        location: str(job.location),
        url: str(job.jobUrl),
        postedAt: isoDate(job.publishedAt),
        department: str(job.department) || str(job.team) || undefined,
        listed: job.isListed !== false
      }
    })
    .filter((r) => r.listed && r.title && r.url)
    .map(({ listed: _listed, ...row }) => row)
}

export async function fetchCustomBoardRows(ats: CustomBoardAts, slug: string): Promise<CustomBoardRow[]> {
  const data = await fetchJson(apiUrl(ats, slug))
  if (ats === 'greenhouse') return normalizeGreenhouse(data)
  if (ats === 'lever') return normalizeLever(data)
  return normalizeAshby(data)
}

function prettyLabel(slug: string): string {
  const spaced = slug.replace(/[-_]+/g, ' ').trim()
  return spaced.replace(/\b[a-z]/g, (c) => c.toUpperCase()) || slug
}

/** Company display name for Greenhouse boards (documented meta endpoint);
 *  best-effort — the jobs list, not the name, decides whether a board works. */
async function greenhouseBoardName(slug: string): Promise<string | null> {
  try {
    const data = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}`)
    const name = (data as { name?: unknown } | null)?.name
    return typeof name === 'string' && name.trim() ? name.trim() : null
  } catch {
    return null
  }
}

/** Detect the ATS + slug and prove the board is fetchable with a live call.
 *  Throws the decline reason for anything that cannot work. */
export async function testCustomBoard(rawUrl: string): Promise<CustomBoardTest> {
  const { ats, slug } = detectCustomBoard(rawUrl)
  const rows = await fetchCustomBoardRows(ats, slug)
  const label = (ats === 'greenhouse' ? await greenhouseBoardName(slug) : null) ?? prettyLabel(slug)
  return { ats, slug, label, sampleCount: rows.length }
}

export function listCustomBoards(): CustomBoard[] {
  return loadProfile()?.searchConfig.customBoards ?? []
}

/** Clone → mutate → validate → save, so a validation failure can never leave
 *  the live profile object half-updated (same contract as setBoardEnabled). */
function saveCustomBoards(mutate: (list: CustomBoard[]) => CustomBoard[]): CustomBoard[] {
  const profile = loadProfile()
  if (!profile) throw new Error('no candidate profile yet — run onboarding first')
  const next = structuredClone(profile)
  next.searchConfig.customBoards = mutate(next.searchConfig.customBoards)
  const result = validateProfile(next)
  if (!result.ok) {
    throw new Error(`profile invalid after updating custom boards: ${result.problems.join('; ')}`)
  }
  saveProfile(result.profile)
  return result.profile.searchConfig.customBoards
}

/** Add a board only after a successful live test fetch — a URL that cannot be
 *  fetched (or is not an ATS board at all) is never saved. */
export async function addCustomBoard(rawUrl: string): Promise<CustomBoard[]> {
  const test = await testCustomBoard(rawUrl)
  return saveCustomBoards((list) => {
    if (list.some((b) => b.ats === test.ats && b.slug.toLowerCase() === test.slug.toLowerCase())) {
      throw new Error(`${test.label} (${test.ats}) is already in the list`)
    }
    return [
      ...list,
      {
        id: `cb_${randomUUID().slice(0, 8)}`,
        label: test.label,
        ats: test.ats,
        slug: test.slug,
        enabled: true
      }
    ]
  })
}

export function removeCustomBoard(id: string): CustomBoard[] {
  return saveCustomBoards((list) => list.filter((b) => b.id !== id))
}

export function setCustomBoardEnabled(id: string, enabled: boolean): CustomBoard[] {
  return saveCustomBoards((list) => {
    const board = list.find((b) => b.id === id)
    if (!board) throw new Error('custom board not found — refresh the list')
    board.enabled = enabled
    return list
  })
}

/** Fetch every ENABLED custom board app-side and write the rows to `outFile`
 *  for the scout agent to Read (it gets no way to hit the ATS APIs itself).
 *  Sequential on purpose: one slow board must not stampede third-party APIs.
 *  Per-board failures degrade to availability notes, never abort the run.
 *  The file is only written when at least one board succeeded. */
export async function prefetchCustomBoards(outFile: string): Promise<CustomBoardsPrefetch> {
  const enabled = listCustomBoards().filter((b) => b.enabled)
  const fetched: { label: string; ats: CustomBoardAts; total: number; rows: CustomBoardRow[] }[] = []
  const unavailable: string[] = []
  for (const board of enabled) {
    try {
      const rows = await fetchCustomBoardRows(board.ats, board.slug)
      fetched.push({
        label: board.label,
        ats: board.ats,
        total: rows.length,
        rows: rows.slice(0, MAX_ROWS_PER_BOARD)
      })
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      unavailable.push(`${board.label} (${board.ats}): ${reason.slice(0, 200)}`)
    }
  }
  if (fetched.length) {
    fs.mkdirSync(path.dirname(outFile), { recursive: true })
    fs.writeFileSync(
      outFile,
      JSON.stringify({ fetchedAt: new Date().toISOString(), boards: fetched }, null, 2),
      'utf-8'
    )
  }
  return {
    boards: fetched.map((b) => ({ label: b.label, ats: b.ats, count: b.rows.length })),
    unavailable
  }
}

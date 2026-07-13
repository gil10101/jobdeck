import type { CompanyInfo } from '@shared/types'
import { allCompanies, getCompany, normalizeKey, upsertCompany } from './companiesStore'
import { fetchGlassdoorRating } from './glassdoor'

let send: ((payload: Record<string, CompanyInfo>) => void) | null = null
let getModel: () => string | undefined = () => undefined
const inFlight = new Map<string, Promise<CompanyInfo>>()

/** Wire the push channel + settings model getter — called once at workspace boot. */
export function initRatingService(
  sendFn: (payload: Record<string, CompanyInfo>) => void,
  modelFn: () => string | undefined
): void {
  send = sendFn
  getModel = modelFn
}

/** Cached-or-fetch: resolves instantly for a known company, dedupes concurrent lookups. */
export async function ensureRating(company: string): Promise<CompanyInfo | null> {
  if (!company.trim()) return null
  const key = normalizeKey(company)
  const existing = getCompany(key)
  if (existing) return existing
  const pending = inFlight.get(key)
  if (pending) return pending

  const promise = fetchGlassdoorRating(company, getModel?.())
    .then((result) => {
      const info: CompanyInfo = {
        name: company,
        rating: result.rating,
        url: result.url,
        reviewCount: result.reviewCount,
        fetchedAt: new Date().toISOString(),
        source: 'lookup'
      }
      upsertCompany(info)
      send?.(allCompanies())
      return info
    })
    .finally(() => {
      inFlight.delete(key)
    })
  inFlight.set(key, promise)
  return promise
}

/** Fire-and-forget lookup for call sites that can't await (candidate/build finalization). */
export function ensureRatingBg(company: string): void {
  void ensureRating(company).catch(() => undefined)
}

const GLASSDOOR_MENTION_RE = /glassdoor[^0-9]{0,40}([0-5](?:\.\d)?)/i

/** Cheap heuristic: a pasted posting sometimes quotes its own Glassdoor rating. */
export function seedFromText(company: string, text: string): void {
  if (!company.trim()) return
  const key = normalizeKey(company)
  if (getCompany(key)) return
  const m = text.match(GLASSDOOR_MENTION_RE)
  if (!m) return
  upsertCompany({
    name: company,
    rating: Number(m[1]),
    url: null,
    reviewCount: null,
    fetchedAt: new Date().toISOString(),
    source: 'pasted'
  })
  send?.(allCompanies())
}

/** Bulk-fill unknown companies with a small concurrency pool. */
export async function backfillCompanies(names: string[]): Promise<{ fetched: number }> {
  const seen = new Set<string>()
  const todo: string[] = []
  for (const raw of names) {
    const name = raw.trim()
    if (!name) continue
    const key = normalizeKey(name)
    if (seen.has(key)) continue
    seen.add(key)
    if (getCompany(key)) continue
    todo.push(name)
  }

  let cursor = 0
  async function worker(): Promise<void> {
    while (cursor < todo.length) {
      const name = todo[cursor++]
      await ensureRating(name)
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, todo.length) }, () => worker()))
  return { fetched: todo.length }
}

import type { CustomBoard, ProfileFile } from '@shared/profile'
import { PROFILE_SCHEMA_ID, emptyProfile, sanitizeBasename } from '@shared/profile'

/**
 * Tolerant validation for profile drafts (agent-written or hand-edited).
 * Style follows parsers/report.ts: collect problems, never throw mid-walk.
 * Missing optional structure is healed from emptyProfile(); only genuinely
 * unusable input is rejected.
 */
export function validateProfile(
  raw: unknown
): { ok: true; profile: ProfileFile; healed: string[] } | { ok: false; problems: string[] } {
  const problems: string[] = []
  const healed: string[] = []
  if (!raw || typeof raw !== 'object') {
    return { ok: false, problems: ['profile is not a JSON object'] }
  }
  const input = raw as Record<string, unknown>
  const base = emptyProfile()

  // Deep-merge input over the empty skeleton, keeping only known keys and
  // coercing obviously-wrong shapes back to their defaults.
  const merged = mergeShape(base, input, '', healed) as unknown as ProfileFile
  merged.schema = PROFILE_SCHEMA_ID

  // mergeShape passes array elements through verbatim, so an extractor that
  // wrote target roles as bare strings (["Data Analyst", ...]) rather than
  // { title, priority } objects would reach the UI/scout unhealed. Normalize
  // the element shape and renumber priority from order (1-based).
  merged.searchConfig.targetRoles = (merged.searchConfig.targetRoles as unknown[])
    .map((r, i): { title: string; priority: number } => {
      if (typeof r === 'string') return { title: r, priority: i + 1 }
      const o = (r ?? {}) as { title?: unknown; priority?: unknown }
      return {
        title: typeof o.title === 'string' ? o.title : '',
        priority: typeof o.priority === 'number' ? o.priority : i + 1
      }
    })
    .filter((r) => r.title.trim())

  // customBoards passes through mergeShape element-verbatim (a missing key
  // heals to []); every entry must be a complete {id,label,ats,slug,enabled}
  // with a known ATS or the board fetchers break downstream — coerce what can
  // be coerced and drop the rest.
  merged.searchConfig.customBoards = (merged.searchConfig.customBoards as unknown[])
    .map((b): CustomBoard | null => {
      const o = (b ?? {}) as Partial<Record<keyof CustomBoard, unknown>>
      if (typeof o.slug !== 'string' || !o.slug.trim()) return null
      if (o.ats !== 'greenhouse' && o.ats !== 'lever' && o.ats !== 'ashby') return null
      const slug = o.slug.trim()
      return {
        // Deterministic fallback id: dedupe is by ats+slug, so collisions are moot.
        id: typeof o.id === 'string' && o.id.trim() ? o.id : `cb_${o.ats}_${slug}`,
        label: typeof o.label === 'string' && o.label.trim() ? o.label.trim() : slug,
        ats: o.ats,
        slug,
        enabled: typeof o.enabled === 'boolean' ? o.enabled : true
      }
    })
    .filter((b): b is CustomBoard => b !== null)

  // Same gap for arrays NESTED inside entry objects (skeleton arrays are empty,
  // so mergeShape can't heal per-element): an extractor that omits e.g. an
  // experience entry's `technologies` or an education entry's `coursework`
  // leaves them undefined, and every consumer (renderProfileMd, the editor)
  // reads `.length` on them. Default them all to [].
  const arr = <T>(v: T[] | undefined | null): T[] => (Array.isArray(v) ? v : [])
  merged.identity.languages = arr(merged.identity.languages)
  merged.education = arr(merged.education).map((e) => ({ ...e, coursework: arr(e.coursework) }))
  merged.experience = arr(merged.experience).map((e) => ({
    ...e,
    bullets: arr(e.bullets),
    technologies: arr(e.technologies)
  }))
  merged.projects = arr(merged.projects).map((pr) => ({
    ...pr,
    bullets: arr(pr.bullets),
    technologies: arr(pr.technologies),
    mustKeepPhrases: arr(pr.mustKeepPhrases)
  }))
  merged.skills = arr(merged.skills).map((s) => ({ ...s, items: arr(s.items) }))
  merged.certifications = arr(merged.certifications)
  merged.publications = arr(merged.publications)
  merged.awards = arr(merged.awards)

  // Hard requirements — the few fields nothing works without.
  const id = merged.identity
  if (!id.fullName.trim()) problems.push('identity.fullName is required')
  if (!id.email.trim()) problems.push('identity.email is required')
  if (merged.experience.length === 0 && merged.projects.length === 0) {
    problems.push('at least one experience entry or project is required')
  }

  if (problems.length) return { ok: false, problems }

  if (!merged.documents.fileBasename || merged.documents.fileBasename === 'Candidate') {
    merged.documents.fileBasename = sanitizeBasename(id.fullName)
    healed.push('documents.fileBasename derived from fullName')
  } else {
    merged.documents.fileBasename = sanitizeBasename(merged.documents.fileBasename)
  }
  merged.updatedAt = new Date().toISOString()
  return { ok: true, profile: merged, healed }
}

/** Recursively keep the skeleton's shape, taking input values where types agree. */
function mergeShape(
  skeleton: unknown,
  input: unknown,
  path: string,
  healed: string[]
): unknown {
  if (Array.isArray(skeleton)) {
    if (!Array.isArray(input)) {
      if (input !== undefined && input !== null) healed.push(`${path}: expected array, reset`)
      return skeleton
    }
    return input
  }
  if (skeleton !== null && typeof skeleton === 'object') {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      if (input !== undefined && input !== null) healed.push(`${path}: expected object, reset`)
      return skeleton
    }
    const out: Record<string, unknown> = {}
    const skel = skeleton as Record<string, unknown>
    const inp = input as Record<string, unknown>
    for (const key of Object.keys(skel)) {
      out[key] = mergeShape(skel[key], inp[key], path ? `${path}.${key}` : key, healed)
    }
    return out
  }
  // Primitive (string/number/boolean/null in the skeleton)
  if (input === undefined) return skeleton
  if (skeleton === null) return input // nullable field: accept whatever came in
  if (typeof input === typeof skeleton) return input
  if (input === null) return skeleton
  healed.push(`${path}: expected ${typeof skeleton}, reset`)
  return skeleton
}

import type { ProfileFile } from '@shared/profile'
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

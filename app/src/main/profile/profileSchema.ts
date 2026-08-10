// Relative .ts imports (not @shared): scripts/portable-selftest.ts executes
// this file under plain node type stripping, which resolves neither tsconfig
// path aliases nor extensionless specifiers.
import type { CustomBoard, ProfileFile, ProfileModuleName } from '../../shared/profile.ts'
import { PROFILE_SCHEMA_ID, emptyProfile, sanitizeBasename } from '../../shared/profile.ts'

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
  // Entry arrays hold objects only: spreading a primitive (a bare string entry)
  // would explode it into {"0":"n","1":"o",…} and render as garbage downstream.
  const objs = <T>(v: T[] | undefined | null): T[] =>
    arr(v).filter((e): e is T => e !== null && typeof e === 'object' && !Array.isArray(e))
  merged.identity.languages = objs(merged.identity.languages)
  merged.education = objs(merged.education).map((e) => ({ ...e, coursework: arr(e.coursework) }))
  merged.experience = objs(merged.experience).map((e) => ({
    ...e,
    bullets: arr(e.bullets),
    technologies: arr(e.technologies)
  }))
  merged.projects = objs(merged.projects).map((pr) => ({
    ...pr,
    bullets: arr(pr.bullets),
    technologies: arr(pr.technologies),
    mustKeepPhrases: arr(pr.mustKeepPhrases)
  }))
  merged.skills = objs(merged.skills).map((s) => ({ ...s, items: arr(s.items) }))
  merged.certifications = objs(merged.certifications)
  merged.publications = objs(merged.publications)
  merged.awards = objs(merged.awards)

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

/**
 * Per-element identity and skeleton of every array-valued module. mergeShape
 * passes array elements through verbatim, so without this an `experience`
 * payload would import cleanly as `skills` (and any junk as `customRules`),
 * and an entry missing required fields would reach profile.json — every
 * consumer (render.ts, the editor) then reads `undefined`. `blank` is the
 * element skeleton each entry is merged over: missing keys get their default,
 * unknown keys are dropped.
 */
const ARRAY_MODULE_ELEMENT: Record<
  string,
  { label: string; ok: (e: unknown) => boolean; blank?: () => Record<string, unknown> }
> = {
  customRules: { label: 'a string', ok: (e) => typeof e === 'string' },
  skills: {
    label: 'a skill category',
    ok: (e) => hasKeys(e, ['category', 'items']),
    blank: () => ({ category: '', items: [] })
  },
  education: {
    label: 'an education entry',
    ok: (e) => hasKeys(e, ['degree', 'institution']),
    blank: () => ({
      degree: '',
      institution: '',
      location: '',
      startDate: '',
      endDate: '',
      gpa: null,
      thesis: null,
      coursework: [],
      notes: null
    })
  },
  experience: {
    label: 'an experience entry',
    ok: (e) => hasKeys(e, ['title', 'company']),
    blank: () => ({
      title: '',
      company: '',
      location: '',
      startDate: '',
      endDate: '',
      bullets: [],
      technologies: [],
      inclusionRule: null,
      framingNotes: null
    })
  },
  projects: {
    label: 'a project entry',
    ok: (e) => hasKeys(e, ['name']),
    blank: () => ({
      name: '',
      oneLiner: '',
      bullets: [],
      technologies: [],
      url: null,
      mustKeepPhrases: [],
      framingNotes: null,
      inclusionRule: null
    })
  },
  certifications: {
    label: 'a certification',
    ok: (e) => hasKeys(e, ['title', 'issuer']),
    blank: () => ({ title: '', issuer: '', date: null, inclusionRule: null })
  },
  publications: {
    label: 'a publication',
    ok: (e) => hasKeys(e, ['citation']),
    blank: () => ({ citation: '', url: null })
  },
  awards: {
    label: 'an award',
    ok: (e) => hasKeys(e, ['title']),
    blank: () => ({ title: '', issuer: '', date: null, note: null })
  }
}

/** Merge every entry over the module's element skeleton; drop entries that
 *  cannot be an element at all. Healing only — never rejects. */
function normalizeEntries(
  module: ProfileModuleName,
  element: { blank?: () => Record<string, unknown> },
  entries: unknown[],
  healed: string[]
): unknown[] {
  const out: unknown[] = []
  entries.forEach((entry, i) => {
    const path = `${module}[${i}]`
    if (!element.blank) {
      // String-element module (customRules).
      if (typeof entry === 'string') out.push(entry)
      else healed.push(`${path}: not a string, dropped`)
      return
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      healed.push(`${path}: not an object, dropped`)
      return
    }
    out.push(mergeShape(element.blank(), entry, path, healed))
  })
  return out
}

function hasKeys(entry: unknown, keys: string[]): boolean {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
  const o = entry as Record<string, unknown>
  return keys.every((k) => o[k] !== undefined)
}

/**
 * Validate one module's data through the SAME path as whole-profile drafts:
 * splice it into a donor profile and run validateProfile, so per-section
 * healing (nested arrays, target-role/custom-board coercion) is never
 * duplicated. Donor stubs satisfy the whole-profile hard requirements that a
 * lone section cannot carry itself.
 *
 * `source` is the direction of travel. 'file' is ingest (import), where an
 * entry that is not recognizably an element of this module is rejected so a
 * mislabelled file cannot land. 'local' is data the profile is already allowed
 * to hold (export of the current section): heal it, never reject it, or the
 * app could refuse to export what it itself saved.
 */
export function validateModule(
  module: ProfileModuleName,
  data: unknown,
  source: 'file' | 'local' = 'file'
): { ok: true; data: unknown; healed: string[] } | { ok: false; problems: string[] } {
  // mergeShape silently resets a wrong-typed top level to the empty skeleton,
  // which would let garbage "import" as an empty section — reject it here.
  const skeleton: unknown = emptyProfile()[module]
  if (Array.isArray(skeleton) && !Array.isArray(data)) {
    return { ok: false, problems: [`${module}: expected an array`] }
  }
  if (!Array.isArray(skeleton) && (!data || typeof data !== 'object' || Array.isArray(data))) {
    return { ok: false, problems: [`${module}: expected an object`] }
  }
  const element = ARRAY_MODULE_ELEMENT[module]
  const entryHealed: string[] = []
  let value = data
  if (element && Array.isArray(data)) {
    if (source === 'file') {
      const bad = data.findIndex((e) => !element.ok(e))
      if (bad >= 0) {
        return { ok: false, problems: [`${module}: entry ${bad} is not ${element.label}`] }
      }
    }
    value = normalizeEntries(module, element, data, entryHealed)
  }
  const donor = emptyProfile()
  if (module !== 'identity') {
    donor.identity.fullName = 'Candidate'
    donor.identity.email = 'candidate@example.com'
  }
  // "at least one experience entry or project" must not veto an empty module
  // of either kind — stub whichever side the module does not occupy.
  if (module === 'projects') {
    donor.experience.push({
      title: 'stub',
      company: 'Acme',
      location: '',
      startDate: '',
      endDate: '',
      bullets: [],
      technologies: [],
      inclusionRule: null,
      framingNotes: null
    })
  } else {
    donor.projects.push({
      name: 'stub',
      oneLiner: '',
      bullets: [],
      technologies: [],
      url: null,
      mustKeepPhrases: [],
      framingNotes: null,
      inclusionRule: null
    })
  }
  ;(donor as unknown as Record<string, unknown>)[module] = value
  const result = validateProfile(donor)
  if (!result.ok) return result
  return {
    ok: true,
    data: (result.profile as unknown as Record<string, unknown>)[module],
    // Donor-stub noise (e.g. fileBasename derivation) is not about this module.
    healed: [...entryHealed, ...result.healed.filter((h) => h.startsWith(module))]
  }
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

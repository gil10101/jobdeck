// Relative .ts imports (not @shared): scripts/portable-selftest.ts executes
// this file under plain node type stripping, which resolves neither tsconfig
// path aliases nor extensionless specifiers.
import type { CustomBoard, ProfileFile, ProfileModuleName } from '../../shared/profile.ts'
import {
  PROFILE_MODULES,
  PROFILE_SCHEMA_ID,
  emptyProfile,
  sanitizeBasename
} from '../../shared/profile.ts'

/**
 * Tolerant validation for profile drafts (agent-written or hand-edited).
 * Style follows parsers/report.ts: collect problems, never throw mid-walk.
 * Missing optional structure is healed from emptyProfile(); only genuinely
 * unusable input is rejected.
 */
export function validateProfile(
  raw: unknown
):
  | { ok: true; profile: ProfileFile; healed: string[] }
  | {
      ok: false
      problems: string[]
      /** The input healed to a complete shape despite failing the hard
       *  requirements: safe for renderers to read, not fit to save as-is. */
      partial?: ProfileFile
    } {
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

  // Entry arrays hold objects only: spreading a primitive (a bare string entry)
  // would explode it into {"0":"n","1":"o",…} and render as garbage downstream.
  const objs = <T>(v: T[] | undefined | null): T[] =>
    Array.isArray(v)
      ? v.filter((e): e is T => e !== null && typeof e === 'object' && !Array.isArray(e))
      : []
  merged.identity.languages = objs(merged.identity.languages)
  merged.education = objs(merged.education)
  merged.experience = objs(merged.experience)
  merged.projects = objs(merged.projects)
  merged.skills = objs(merged.skills)
  merged.certifications = objs(merged.certifications)
  merged.publications = objs(merged.publications)
  merged.awards = objs(merged.awards)

  // Arrays NESTED inside entry objects are the remaining gap (skeleton arrays
  // are empty, so mergeShape passes them through element-verbatim): an entry
  // missing `technologies`, or a role profile missing `match`, reaches the
  // render path as `undefined` and throws there. Heal every one of them.
  const bag = merged as unknown as Record<string, unknown>
  for (const module of PROFILE_MODULES) {
    bag[module] = healNested(module, bag[module], module, healed)
  }

  // Hard requirements — the few fields nothing works without.
  const id = merged.identity
  if (!id.fullName.trim()) problems.push('identity.fullName is required')
  if (!id.email.trim()) problems.push('identity.email is required')
  if (merged.experience.length === 0 && merged.projects.length === 0) {
    problems.push('at least one experience entry or project is required')
  }

  if (problems.length) return { ok: false, problems, partial: merged }

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

type NestedSpec =
  | { kind: 'strings' }
  | {
      kind: 'objects'
      label: string
      /** Keys whose absence makes the entry unusable downstream. */
      required: string[]
      blank: () => Record<string, unknown>
    }

const STRINGS: NestedSpec = { kind: 'strings' }

/**
 * Every array nested INSIDE an entry object, keyed by its index-free path from
 * the profile root ('experience.bullets' means experience[i].bullets).
 * mergeShape and ARRAY_MODULE_ELEMENT only reach the top level of each module,
 * so without this table a nested entry keeps whatever the writer produced: a
 * role profile without `match` reaches renderTailoringRulesMd, which calls
 * `.join()` on it and throws on every build run and detail chat. Entries here
 * are healed on save and rejected on import.
 */
const NESTED_ARRAY: Record<string, NestedSpec> = {
  'identity.languages': {
    kind: 'objects',
    label: 'a language',
    required: ['name', 'proficiency'],
    blank: () => ({ name: '', proficiency: '' })
  },
  'education.coursework': STRINGS,
  'experience.bullets': STRINGS,
  'experience.technologies': STRINGS,
  'projects.bullets': STRINGS,
  'projects.technologies': STRINGS,
  'projects.mustKeepPhrases': STRINGS,
  'skills.items': STRINGS,
  'behavioral.traits': STRINGS,
  'behavioral.strengths': STRINGS,
  'behavioral.growthAreas': STRINGS,
  'behavioral.thrivesIn': STRINGS,
  'behavioral.jobPostingLanguageMapping': {
    kind: 'objects',
    label: 'a posting-language mapping',
    required: ['postingPhrase', 'candidateTrait'],
    blank: () => ({ postingPhrase: '', candidateTrait: '' })
  },
  'narrative.whatExcites': STRINGS,
  'narrative.targetSectors': STRINGS,
  'narrative.dealBreakers': STRINGS,
  'narrative.stories': {
    kind: 'objects',
    label: 'a story',
    required: ['title', 'text', 'use'],
    blank: () => ({ id: '', title: '', text: '', use: [] })
  },
  'narrative.stories.use': STRINGS,
  'evaluation.dimensions': {
    kind: 'objects',
    label: 'an evaluation dimension',
    required: ['name', 'weight', 'guidance'],
    blank: () => ({ name: '', weight: 0, guidance: '' })
  },
  'evaluation.strongMatchAreas': STRINGS,
  'evaluation.moderateMatchAreas': STRINGS,
  'evaluation.weakMatchAreas': STRINGS,
  'evaluation.calibrationNotes': STRINGS,
  'tailoring.roleProfiles': {
    kind: 'objects',
    label: 'a role profile',
    required: ['label', 'match'],
    blank: () => ({
      match: [],
      label: '',
      skillCategoryOrder: [],
      projectPriority: [],
      profileStatement: null,
      notes: null
    })
  },
  'tailoring.roleProfiles.match': STRINGS,
  'tailoring.roleProfiles.skillCategoryOrder': STRINGS,
  'tailoring.roleProfiles.projectPriority': STRINGS,
  'tailoring.hardRules': STRINGS,
  'searchConfig.locationTiers': {
    kind: 'objects',
    label: 'a location tier',
    required: ['tier', 'description'],
    blank: () => ({ tier: 'acceptable', description: '' })
  },
  'searchConfig.workModels': STRINGS,
  'searchConfig.employmentTypes': STRINGS,
  'searchConfig.excludeCompanies': STRINGS,
  'searchConfig.extraHardFilters': STRINGS,
  'searchConfig.boards.linkedin.queries': STRINGS,
  'searchConfig.boards.freehire.queries': STRINGS,
  'customRules': STRINGS
}

/** Array-valued keys each object path is expected to carry, so a missing one
 *  can be restored rather than reaching a consumer as `undefined`. */
const NESTED_CHILDREN = ((): Map<string, string[]> => {
  const out = new Map<string, string[]>()
  for (const full of Object.keys(NESTED_ARRAY)) {
    const cut = full.lastIndexOf('.')
    if (cut < 0) continue
    const parent = full.slice(0, cut)
    const list = out.get(parent) ?? []
    list.push(full.slice(cut + 1))
    out.set(parent, list)
  }
  return out
})()

/** Heal one array: enforce the element kind its spec declares, and recurse.
 *  Arrays with no spec keep their elements but are still walked for nested
 *  spec'd arrays deeper down. */
function healArray(path: string, value: unknown[], display: string, healed: string[]): unknown[] {
  const spec = NESTED_ARRAY[path]
  const out: unknown[] = []
  value.forEach((entry, i) => {
    const at = `${display}[${i}]`
    if (spec?.kind === 'strings') {
      if (typeof entry === 'string') out.push(entry)
      else healed.push(`${at}: not a string, dropped`)
      return
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      if (spec) healed.push(`${at}: not ${spec.label}, dropped`)
      else out.push(entry)
      return
    }
    const base =
      spec?.kind === 'objects'
        ? { ...spec.blank(), ...(entry as Record<string, unknown>) }
        : { ...(entry as Record<string, unknown>) }
    out.push(healObject(path, base, at, healed))
  })
  return out
}

function healObject(
  path: string,
  obj: Record<string, unknown>,
  display: string,
  healed: string[]
): Record<string, unknown> {
  for (const key of Object.keys(obj)) {
    const childPath = `${path}.${key}`
    const child = obj[key]
    if (Array.isArray(child)) {
      obj[key] = healArray(childPath, child, `${display}.${key}`, healed)
    } else if (NESTED_ARRAY[childPath]) {
      obj[key] = []
      healed.push(`${display}.${key}: expected array, reset`)
    } else if (child !== null && typeof child === 'object') {
      obj[key] = healObject(childPath, child as Record<string, unknown>, `${display}.${key}`, healed)
    }
  }
  for (const key of NESTED_CHILDREN.get(path) ?? []) {
    if (!Array.isArray(obj[key])) {
      obj[key] = []
      healed.push(`${display}.${key}: missing array, defaulted to []`)
    }
  }
  return obj
}

/** Entry point for the heal pass over one module's value. */
function healNested(path: string, value: unknown, display: string, healed: string[]): unknown {
  if (Array.isArray(value)) return healArray(path, value, display, healed)
  if (value !== null && typeof value === 'object') {
    return healObject(path, value as Record<string, unknown>, display, healed)
  }
  return value
}

/** Ingest counterpart of the heal pass: report every nested entry that cannot
 *  be an element of its array, naming the offending entry and what it lacks. */
function rejectNested(path: string, value: unknown, display: string, problems: string[]): void {
  if (Array.isArray(value)) {
    const spec = NESTED_ARRAY[path]
    value.forEach((entry, i) => {
      const at = `${display}[${i}]`
      if (spec?.kind === 'strings') {
        if (typeof entry !== 'string') problems.push(`${at} is not a string`)
        return
      }
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        if (spec) problems.push(`${at} is not ${spec.label}`)
        return
      }
      if (spec?.kind === 'objects') {
        const missing = spec.required.filter(
          (k) => (entry as Record<string, unknown>)[k] === undefined
        )
        if (missing.length) {
          problems.push(`${at} is not ${spec.label}: missing ${missing.join(', ')}`)
          return
        }
      }
      rejectNested(path, entry, at, problems)
    })
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    rejectNested(`${path}.${key}`, child, `${display}.${key}`, problems)
  }
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
  // Ingest also has to reach INSIDE each entry: the heal pass would silently
  // default a nested entry's missing fields, which for an import means
  // accepting a file that says something the profile then no longer says.
  if (source === 'file') {
    const nested: string[] = []
    rejectNested(module, value, module, nested)
    if (nested.length) return { ok: false, problems: nested }
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

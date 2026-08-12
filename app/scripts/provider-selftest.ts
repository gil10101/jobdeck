// Selftest for the pure provider-prerequisite mapping. Runs under plain node
// type stripping (node >= 23): `node scripts/provider-selftest.ts` from app/.
import type { PrereqTool, ProviderId } from '../src/shared/types.ts'
import {
  prereqIdsFor,
  prereqSpecsFor,
  scopeNoteFor,
  sortPrereqs
} from '../src/main/provider/prereqSpec.ts'

let pass = 0
let fail = 0

function check(name: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    pass++
  } else {
    fail++
    console.error(`FAIL ${name}`)
    console.error(`  expected: ${JSON.stringify(expected)}`)
    console.error(`  actual:   ${JSON.stringify(actual)}`)
  }
}

const PROVIDERS: ProviderId[] = ['claude', 'gemini', 'ollama']

// ---- which prerequisites each provider owns ----

check('claude requires a Claude sign-in', prereqIdsFor('claude').includes('claudeAuth'), true)
check('ollama does NOT require a Claude sign-in', prereqIdsFor('ollama').includes('claudeAuth'), false)
check('gemini does NOT require a Claude sign-in', prereqIdsFor('gemini').includes('claudeAuth'), false)
check('ollama requires a reachable server + model', prereqIdsFor('ollama').includes('ollamaServer'), true)
check('gemini requires an API key', prereqIdsFor('gemini').includes('geminiKey'), true)
check('claude asks for no Gemini key', prereqIdsFor('claude').includes('geminiKey'), false)
check('claude asks for no Ollama server', prereqIdsFor('claude').includes('ollamaServer'), false)
check('ollama asks for no Gemini key', prereqIdsFor('ollama').includes('geminiKey'), false)

check('claude prerequisites, in order', prereqIdsFor('claude'), ['claude', 'claudeAuth', 'latex', 'bun'])
check('gemini prerequisites, in order', prereqIdsFor('gemini'), ['claude', 'geminiKey', 'latex', 'bun'])
check('ollama prerequisites, in order', prereqIdsFor('ollama'), ['claude', 'ollamaServer', 'latex', 'bun'])

// Exactly one provider-specific row per provider: no provider drags in
// another's credential.
const PROVIDER_SPECIFIC = ['claudeAuth', 'geminiKey', 'ollamaServer']
for (const provider of PROVIDERS) {
  check(
    `${provider} carries exactly one provider-specific prerequisite`,
    prereqIdsFor(provider).filter((id) => PROVIDER_SPECIFIC.includes(id)).length,
    1
  )
}

// ---- rows shared by every provider ----

for (const provider of PROVIDERS) {
  const specs = prereqSpecsFor(provider)
  const runtime = specs.find((s) => s.id === 'claude')
  check(`${provider}: the Claude Code agent runtime is present`, !!runtime, true)
  check(`${provider}: the agent runtime stays required`, runtime?.required, true)
  check(
    `${provider}: the runtime remedy explains the agent loop is local`,
    /agent loop/.test(runtime?.remedy ?? ''),
    true
  )
  check(`${provider}: LaTeX is required`, specs.find((s) => s.id === 'latex')?.required, true)
  check(`${provider}: bun stays optional`, specs.find((s) => s.id === 'bun')?.required, false)
  check(
    `${provider}: every provider-specific requirement is required`,
    specs.filter((s) => PROVIDER_SPECIFIC.includes(s.id)).every((s) => s.required),
    true
  )
  check(
    `${provider}: every row has a label, remedy and url`,
    specs.every((s) => !!s.label && !!s.remedy && !!s.url),
    true
  )
  check(
    `${provider}: no duplicate ids`,
    new Set(specs.map((s) => s.id)).size,
    specs.length
  )
  check(`${provider}: specs match ids`, specs.map((s) => s.id), prereqIdsFor(provider))
}

// A non-Claude user must not be told to switch providers to escape a
// requirement they never had.
check(
  'the sign-in remedy names the provider-switch escape hatch',
  /Gemini or Ollama/.test(prereqSpecsFor('claude').find((s) => s.id === 'claudeAuth')?.remedy ?? ''),
  true
)

// ---- no workspace yet: the provider is unknown, not assumed ----

check('without a workspace only shared prerequisites apply', prereqIdsFor(null), [
  'claude',
  'latex',
  'bun'
])
check(
  'without a workspace no provider credential is demanded',
  prereqIdsFor(null).some((id) => PROVIDER_SPECIFIC.includes(id)),
  false
)
check(
  'the pre-workspace note says the rest waits for a workspace',
  /workspace/.test(scopeNoteFor(null)),
  true
)
for (const provider of PROVIDERS) {
  check(`${provider}: the scope note names the provider`, scopeNoteFor(provider).length > 0, true)
}
check(
  'the ollama note states no Claude sign-in is needed',
  /no Claude sign-in/.test(scopeNoteFor('ollama')),
  true
)
check(
  'the gemini note states no Claude sign-in is needed',
  /no Claude sign-in/.test(scopeNoteFor('gemini')),
  true
)

// ---- worst-first ordering ----

const row = (id: PrereqTool['id'], ok: boolean, required: boolean): PrereqTool => ({
  id,
  label: id,
  ok,
  required,
  detail: '',
  remedy: '',
  url: ''
})

check(
  'unmet requirements come first, then unmet extras, then satisfied rows',
  sortPrereqs([
    row('claude', true, true),
    row('bun', false, false),
    row('latex', false, true),
    row('ollamaServer', true, true)
  ]).map((t) => t.id),
  ['latex', 'bun', 'claude', 'ollamaServer']
)
check(
  'display order survives within a band',
  sortPrereqs([row('claude', false, true), row('ollamaServer', false, true)]).map((t) => t.id),
  ['claude', 'ollamaServer']
)

console.log(`PASS ${pass}/${pass + fail}`)
if (fail > 0) process.exit(1)

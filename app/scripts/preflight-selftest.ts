// Selftest for the renderer preflight slice's ordering guard. Runs under plain
// node type stripping (node >= 23): `node scripts/preflight-selftest.ts` from app/.
//
// The store is a renderer module, so the preload bridge it binds at import time
// is stubbed here before the dynamic import below. env:check is the only channel
// exercised; its latency is controlled per call so out-of-order resolution can
// be forced deterministically.

import { registerHooks } from 'node:module'
import fs from 'node:fs'

// Renderer sources use bundler resolution (extensionless relative imports);
// node needs the extension. Only relative specifiers are touched, so package
// resolution is untouched.
registerHooks({
  resolve(specifier, context, nextResolve): ReturnType<typeof nextResolve> {
    if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier) && context.parentURL) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL)
      if (fs.existsSync(candidate)) return nextResolve(`${specifier}.ts`, context)
    }
    return nextResolve(specifier, context)
  }
})

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

interface Deferred {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
  promise: Promise<unknown>
}

/** env:check calls awaiting a verdict, oldest first — the test decides the
 *  order they settle in, standing in for provider-shaped probe latency. */
const pending: Deferred[] = []

function defer(): Deferred {
  let resolve!: (value: unknown) => void
  let reject!: (err: Error) => void
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { resolve, reject, promise }
}

const api = {
  invoke: (channel: string): Promise<unknown> => {
    if (channel !== 'env:check') return Promise.resolve({ ok: true, data: null })
    const d = defer()
    pending.push(d)
    return d.promise
  },
  on: (): (() => void) => (): void => {}
}
;(globalThis as { window?: unknown }).window = { api }

function envCheckResult(provider: string, toolIds: string[]): unknown {
  return {
    ok: true,
    data: {
      provider,
      scopeNote: `Requirements for the ${provider} provider`,
      tools: toolIds.map((id) => ({
        id,
        label: id,
        ok: true,
        required: true,
        detail: '',
        remedy: '',
        url: ''
      })),
      pdflatex: null,
      pdftotext: null,
      platform: 'darwin',
      appVersion: '0.0.0'
    }
  }
}

/** Let queued microtasks (the store's own awaits) run to completion. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

const { useApp } = await import('../src/renderer/src/store.ts')

// ---- a slow check that started earlier must not overwrite a newer one ----

// Ollama first (a network round-trip), then Gemini (a local file read).
const ollama = useApp.getState().refreshPreflight()
const gemini = useApp.getState().refreshPreflight()
check('both checks are in flight', pending.length, 2)

// Gemini answers first, Ollama afterwards — the out-of-order case.
pending[1].resolve(envCheckResult('gemini', ['claude', 'geminiKey', 'latex', 'bun']))
await settle()
pending[0].resolve(envCheckResult('ollama', ['claude', 'ollamaServer', 'latex', 'bun']))
await Promise.all([ollama, gemini])
await settle()

check('the newest check wins', useApp.getState().preflight.provider, 'gemini')
check(
  'the rows belong to the winning provider',
  useApp.getState().preflight.tools?.map((t) => t.id),
  ['claude', 'geminiKey', 'latex', 'bun']
)
check('the panel is no longer marked checking', useApp.getState().preflight.checking, false)

// ---- a stale FAILURE must not clear a newer success either ----

pending.length = 0
const stale = useApp.getState().refreshPreflight()
const fresh = useApp.getState().refreshPreflight()
pending[1].resolve(envCheckResult('ollama', ['claude', 'ollamaServer', 'latex', 'bun']))
await settle()
pending[0].reject(new Error('probe timed out'))
await Promise.all([stale, fresh])
await settle()

check('a stale failure does not erase the newer verdict', useApp.getState().preflight.provider, 'ollama')
check('a stale failure raises no error banner', useApp.getState().preflight.error, null)
check('a stale failure does not blank the rows', !!useApp.getState().preflight.tools, true)

// ---- the ordinary single-check path still writes through ----

pending.length = 0
const only = useApp.getState().refreshPreflight()
check('the check is marked in progress', useApp.getState().preflight.checking, true)
pending[0].resolve(envCheckResult('claude', ['claude', 'claudeAuth', 'latex', 'bun']))
await only
check('a lone check writes its verdict', useApp.getState().preflight.provider, 'claude')
check('a lone check clears the in-progress flag', useApp.getState().preflight.checking, false)

// ---- a lone failure is still reported ----

pending.length = 0
const failing = useApp.getState().refreshPreflight()
pending[0].reject(new Error('probe timed out'))
await failing
check('a lone failure surfaces', useApp.getState().preflight.error, 'probe timed out')
check('a failed check reports no tools', useApp.getState().preflight.tools, null)

console.log(`PASS ${pass}/${pass + fail}`)
if (fail > 0) process.exit(1)

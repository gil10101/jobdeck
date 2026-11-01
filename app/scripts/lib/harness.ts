// Shared selftest plumbing. Importing this module installs a resolve hook so
// main-process and renderer sources load under plain node type stripping:
//   - extensionless relative imports get `.ts` (bundler resolution),
//   - `@shared/*` maps to src/shared/*.ts (the vite alias),
//   - `electron` maps to the recording stub beside this file.
// Sources under test must therefore be imported dynamically (`await import`)
// AFTER this module, never with a static import that is hoisted above it.
import { registerHooks } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const APP_ROOT = path.resolve(import.meta.dirname, '..', '..')
const SHARED_DIR = path.join(APP_ROOT, 'src', 'shared')
const ELECTRON_STUB = pathToFileURL(path.join(import.meta.dirname, 'electron-stub.ts')).href

registerHooks({
  resolve(specifier, context, nextResolve): ReturnType<typeof nextResolve> {
    if (specifier === 'electron') return { url: ELECTRON_STUB, shortCircuit: true }
    if (specifier.startsWith('@shared/')) {
      const rel = specifier.slice('@shared/'.length)
      const file = path.join(SHARED_DIR, /\.[a-z]+$/.test(rel) ? rel : `${rel}.ts`)
      return { url: pathToFileURL(file).href, shortCircuit: true }
    }
    if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier) && context.parentURL) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL)
      if (fs.existsSync(candidate)) return nextResolve(`${specifier}.ts`, context)
    }
    return nextResolve(specifier, context)
  }
})

let pass = 0
let fail = 0

export function check(name: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    pass++
  } else {
    fail++
    console.error(`FAIL ${name}`)
    console.error(`  expected: ${JSON.stringify(expected)}`)
    console.error(`  actual:   ${JSON.stringify(actual)}`)
  }
}

export function checkThrows(name: string, fn: () => unknown, messageIncludes: string): void {
  try {
    fn()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    check(`${name} (message)`, message.includes(messageIncludes) ? messageIncludes : message, messageIncludes)
    return
  }
  check(`${name} (threw)`, 'no throw', `throw containing "${messageIncludes}"`)
}

export async function checkRejects(
  name: string,
  fn: () => Promise<unknown>,
  messageIncludes: string
): Promise<void> {
  try {
    await fn()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    check(`${name} (message)`, message.includes(messageIncludes) ? messageIncludes : message, messageIncludes)
    return
  }
  check(`${name} (rejected)`, 'resolved', `rejection containing "${messageIncludes}"`)
}

/** Fresh empty directory under the OS temp dir. */
export function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), `${prefix}-`))
}

/** Print the tally and exit non-zero on any failure. Call last. */
export function finish(): void {
  console.log(`PASS ${pass}/${pass + fail}`)
  if (fail > 0) process.exit(1)
}

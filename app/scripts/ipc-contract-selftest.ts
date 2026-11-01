// Selftest that the IPC surface agrees with itself: every channel declared in
// the invoke contract is on the preload allowlist and has a main-process
// handler, and nothing is handled that the renderer could never reach. A
// channel added to one place and forgotten in another otherwise fails only at
// runtime ("unknown IPC channel" / "No handler registered").
// Runs under plain node type stripping: `node scripts/ipc-contract-selftest.ts`
// from app/.
import fs from 'node:fs'
import path from 'node:path'
import { check, finish } from './lib/harness.ts'

const { INVOKE_CHANNELS } = await import('../src/shared/ipc.ts')

const SRC = path.join(import.meta.dirname, '..', 'src')
const ipcSource = fs.readFileSync(path.join(SRC, 'shared', 'ipc.ts'), 'utf-8')

const start = ipcSource.indexOf('export interface IpcInvokeContract')
const end = ipcSource.indexOf('\n}\n', start)
const contractBody = ipcSource.slice(start, end)
// Top-level members only: two-space indent then a quoted channel name.
const declared = [...contractBody.matchAll(/^ {2}'([a-zA-Z]+:[a-zA-Z]+)':/gm)].map((m) => m[1])

function handledIn(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...handledIn(full))
    else if (entry.name.endsWith('.ts')) {
      const text = fs.readFileSync(full, 'utf-8')
      for (const m of text.matchAll(/\bhandle\(\s*'([a-zA-Z]+:[a-zA-Z]+)'/g)) out.push(m[1])
    }
  }
  return out
}
const handled = new Set(handledIn(path.join(SRC, 'main')))
const allowed = new Set<string>(INVOKE_CHANNELS)

check('contract parsed', declared.length > 50, true)
check('declared but not on the preload allowlist', declared.filter((c) => !allowed.has(c)), [])
check('allowlisted but not declared', [...allowed].filter((c) => !declared.includes(c)), [])
check('declared but no main handler', declared.filter((c) => !handled.has(c)), [])
check('handled but not declared', [...handled].filter((c) => !declared.includes(c)), [])
check('no duplicate allowlist entries', INVOKE_CHANNELS.length, allowed.size)

finish()

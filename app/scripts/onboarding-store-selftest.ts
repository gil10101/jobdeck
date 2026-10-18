// Selftest for the renderer store's first-run routing state: a failed
// config:get must surface as an error (App shows a retry screen) instead of a
// null config that falls through to the main UI, and hydrate must load every
// slice once a workspace exists — including build readiness.
// Runs under plain node type stripping: `node scripts/onboarding-store-selftest.ts`
// from app/.
import { check, finish } from './lib/harness.ts'

type Reply = { ok: true; data: unknown } | { ok: false; error: string }
let replies: Record<string, () => Reply> = {}
const calls: string[] = []

const api = {
  invoke: (channel: string): Promise<Reply> => {
    calls.push(channel)
    const reply = replies[channel]
    return Promise.resolve(reply ? reply() : { ok: true, data: [] })
  },
  on: (): (() => void) => (): void => {}
}
;(globalThis as { window?: unknown }).window = { api }
;(globalThis as { document?: unknown }).document = { documentElement: { dataset: {} } }

const { useApp } = await import('../src/renderer/src/store.ts')

const config = (workspacePath: string | null, onboardedAt: string | null): Reply => ({
  ok: true,
  data: { workspacePath, onboardedAt, bootError: null, configError: null }
})

// ---- config:get failure before any answer ----

replies = { 'config:get': () => ({ ok: false, error: 'main not ready' }) }
await useApp.getState().hydrate()
check('config stays unknown', useApp.getState().config, null)
check('failure is surfaced for the retry screen', useApp.getState().configLoadError, 'main not ready')
check('no workspace calls before config is known', calls.filter((c) => c !== 'config:get'), [])

// ---- retry succeeds: first run ----

calls.length = 0
replies = { 'config:get': () => config(null, null) }
await useApp.getState().hydrate()
check('error cleared on success', useApp.getState().configLoadError, null)
check('first run: only config is fetched', calls, ['config:get'])

// ---- a later failure keeps the config already in hand ----

replies = { 'config:get': () => ({ ok: false, error: 'transient' }) }
await useApp.getState().refreshConfig()
check('known config is kept', useApp.getState().config?.workspacePath, null)
check('no error screen once config is known', useApp.getState().configLoadError, null)

// ---- workspace exists: hydrate loads every slice ----

calls.length = 0
replies = {
  'config:get': () => config('/w/ws', null),
  'settings:get': () => ({ ok: true, data: { theme: 'dark', provider: 'claude' } }),
  'build:readiness': () => ({ ok: true, data: { mode: 'minimal', message: 'm' } }),
  'companies:get': () => ({ ok: true, data: {} }),
  'calendar:list': () => ({ ok: true, data: [] })
}
await useApp.getState().hydrate()
for (const channel of ['tracker:getAll', 'runs:list', 'candidates:list', 'settings:get', 'build:readiness']) {
  check(`hydrate fetches ${channel}`, calls.includes(channel), true)
}
check('readiness stored', useApp.getState().buildReadiness?.mode, 'minimal')

finish()

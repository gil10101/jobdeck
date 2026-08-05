import type { AppSettings } from '@shared/types'
import { testGemini } from './geminiBackend'
import { geminiKey, geminiKeySet } from './geminiKeyStore'
import { ollamaModels } from './ollamaBackend'
import { startShim, type ShimHandle } from './shim'
import type { ProviderConfig } from './translate'

// Provider switchboard. When the provider is claude, agent subprocesses run
// exactly as before; for gemini/ollama they get ANTHROPIC_BASE_URL pointed at
// the local shim, which translates on the fly. Conversation context is
// untouched either way — SDK session transcripts live on disk and replay
// through whichever backend is active, so switching providers mid-thread
// keeps the whole history.

const GEMINI_URL = 'https://generativelanguage.googleapis.com'
/** Local models mostly load slowly on first token; the CLI default timeout is too eager. */
const API_TIMEOUT_MS = 600_000

let getSettings: (() => AppSettings) | null = null
let shim: ShimHandle | null = null
let shimStarting: Promise<ShimHandle> | null = null
// Fences a startup that outlives a stopShim(): the late resolution must not
// resurrect a server nothing will ever close.
let shimGen = 0

export function initProviderRuntime(settingsGetter: () => AppSettings): void {
  getSettings = settingsGetter
}

function settings(): AppSettings {
  if (!getSettings) throw new Error('provider runtime not initialized')
  return getSettings()
}

export function currentProviderConfig(): ProviderConfig {
  const s = settings()
  const provider = s.provider ?? 'claude'
  return {
    provider,
    model: provider === 'gemini' ? s.geminiModel : provider === 'ollama' ? s.ollamaModel : '',
    geminiKey: provider === 'gemini' ? geminiKey() : null,
    geminiUrl: GEMINI_URL,
    ollamaUrl: s.ollamaUrl,
    ollamaNumCtx: s.ollamaNumCtx
  }
}

async function ensureShim(): Promise<ShimHandle> {
  if (shim) return shim
  if (!shimStarting) {
    const gen = shimGen
    shimStarting = startShim(currentProviderConfig).then((h) => {
      if (gen !== shimGen) {
        h.close()
        throw new Error('shim stopped during startup')
      }
      shim = h
      return h
    })
    shimStarting.catch(() => (shimStarting = null))
  }
  return shimStarting
}

export function stopShim(): void {
  shimGen++
  shim?.close()
  shim = null
  shimStarting = null
}

/**
 * Env for spawning an agent subprocess under the active provider. Claude:
 * plain inherited env. Gemini/Ollama: the CLI is pointed at the shim with its
 * per-launch secret — the real Gemini key never reaches the subprocess.
 */
export async function providerEnv(): Promise<Record<string, string>> {
  const base = { ...process.env } as Record<string, string>
  const config = currentProviderConfig()
  if (config.provider === 'claude') return base
  const handle = await ensureShim()
  return {
    ...base,
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${handle.port}`,
    ANTHROPIC_AUTH_TOKEN: handle.secret,
    ANTHROPIC_API_KEY: handle.secret,
    ANTHROPIC_MODEL: config.model,
    ANTHROPIC_SMALL_FAST_MODEL: config.model,
    API_TIMEOUT_MS: String(API_TIMEOUT_MS),
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1'
  }
}

/** Model to pass to query(): the backend model under gemini/ollama (a Claude
 *  model id would be meaningless there), else the caller's request/setting. */
export function resolveAgentModel(requested?: string | null): string | undefined {
  const config = currentProviderConfig()
  if (config.provider !== 'claude') return config.model || undefined
  return requested || undefined
}

/** Extra prompt discipline for third-party models: Claude models are tuned
 *  for this harness; others need the contract spelled out. Empty for claude. */
export function providerPromptAddendum(): string {
  if (currentProviderConfig().provider === 'claude') return ''
  return [
    '',
    'MODEL DISCIPLINE (you are running via a compatibility layer):',
    '- Call tools with strict JSON arguments that match the schema exactly; never invent tool or field names.',
    '- Prefer one tool call at a time; read results before the next call.',
    '- When asked to write a file, use the Write tool with the COMPLETE file content.',
    '- Finish with exactly the output format the task specifies — no extra commentary after it.'
  ].join('\n')
}

export interface ProviderStatus {
  provider: 'claude' | 'gemini' | 'ollama'
  geminiKeySet: boolean
  ollama: { reachable: boolean; models: string[]; message: string }
}

export async function providerStatus(): Promise<ProviderStatus> {
  const s = settings()
  let ollama: ProviderStatus['ollama'] = { reachable: false, models: [], message: '' }
  try {
    const models = await ollamaModels(s.ollamaUrl)
    ollama = { reachable: true, models, message: `${models.length} model${models.length === 1 ? '' : 's'} installed` }
  } catch (err) {
    ollama = { reachable: false, models: [], message: `not reachable: ${err instanceof Error ? err.message : String(err)}` }
  }
  return { provider: s.provider ?? 'claude', geminiKeySet: geminiKeySet(), ollama }
}

/** One live round-trip against the ACTIVE provider's backend (not the SDK —
 *  this validates the key/model/URL, which is where setup actually fails). */
export async function testProvider(): Promise<{ ok: boolean; message: string }> {
  const config = currentProviderConfig()
  try {
    if (config.provider === 'gemini') {
      return { ok: true, message: await testGemini(config) }
    }
    if (config.provider === 'ollama') {
      const models = await ollamaModels(config.ollamaUrl)
      if (!config.model) return { ok: false, message: `reachable; pick a model (installed: ${models.join(', ') || 'none'})` }
      const found = models.some((m) => m === config.model || m.startsWith(`${config.model}:`))
      return found
        ? { ok: true, message: `${config.model} is installed and ready` }
        : { ok: false, message: `model "${config.model}" not installed (installed: ${models.join(', ') || 'none'})` }
    }
    return { ok: true, message: 'Claude SDK — uses your existing Claude Code auth' }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

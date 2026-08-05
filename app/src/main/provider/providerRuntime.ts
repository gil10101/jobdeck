import type { AppSettings } from '@shared/types'
import { listGeminiModels, testGemini } from './geminiBackend'
import { geminiKey, geminiKeySet, ollamaKey, ollamaKeySet } from './providerKeyStore'
import { ollamaModelInfo, ollamaModels, prewarmOllama, type OllamaModelInfo } from './ollamaBackend'
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
    // Not gated on provider: web-search sub-requests run through Gemini
    // grounding even when the main model is Ollama.
    geminiKey: geminiKey(),
    geminiModel: s.geminiModel,
    geminiUrl: GEMINI_URL,
    ollamaUrl: s.ollamaUrl,
    ollamaKey: ollamaKey(),
    ollamaNumCtx: s.ollamaNumCtx,
    ollamaThink: s.ollamaThink
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
  if (config.provider === 'ollama') prewarmOllama(config)
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
  const provider = currentProviderConfig().provider
  if (provider === 'claude') return ''
  return [
    '',
    'MODEL DISCIPLINE (you are running via a compatibility layer):',
    '- Call tools with strict JSON arguments that match the schema exactly; never invent tool or field names. Argument values must use their real JSON types — objects as objects, never as JSON-in-a-string.',
    '- Prefer one tool call at a time; read results before the next call. NEVER repeat a call that already succeeded.',
    '- To create a NEW file, use Write once with the COMPLETE content. To change an EXISTING file, Read it first, then Edit or Write — a Write that fails with "has not been read yet" means Read it, then retry once.',
    '- Do the work directly with Read/Write/Bash-style tools — never launch subagents or name agent types.',
    '- Finish with exactly the output format the task specifies — no extra commentary after it.'
  ].join('\n')
}

/** Tools withheld from agent runs per provider. Local models reliably
 *  hallucinate Task/agent-type and Skill arguments; withholding the tools
 *  beats hoping the prompt is obeyed. */
export function providerDisallowedTools(): string[] {
  return currentProviderConfig().provider === 'ollama' ? ['Task', 'Skill'] : []
}

export interface ProviderStatus {
  provider: 'claude' | 'gemini' | 'ollama'
  geminiKeySet: boolean
  /** Chat models this key can use, from the live catalog ([] without a key). */
  geminiModels: string[]
  ollamaKeySet: boolean
  ollama: { reachable: boolean; models: string[]; message: string }
}

export async function providerStatus(): Promise<ProviderStatus> {
  const s = settings()
  const [ollama, geminiModels] = await Promise.all([
    ollamaModels(s.ollamaUrl, ollamaKey())
      .then((models) => ({
        reachable: true,
        models,
        message: `${models.length} model${models.length === 1 ? '' : 's'} available`
      }))
      .catch((err: unknown) => ({
        reachable: false,
        models: [] as string[],
        message: `not reachable: ${err instanceof Error ? err.message : String(err)}`
      })),
    listGeminiModels(currentProviderConfig()).catch(() => [] as string[])
  ])
  return {
    provider: s.provider ?? 'claude',
    geminiKeySet: geminiKeySet(),
    geminiModels,
    ollamaKeySet: ollamaKeySet(),
    ollama
  }
}

/** Metadata for one Ollama model (context ceiling, tool support) — Settings
 *  hint material; null fields when the server does not report them. */
export async function ollamaModelDetails(model: string): Promise<OllamaModelInfo> {
  const s = settings()
  return ollamaModelInfo(s.ollamaUrl, ollamaKey(), model)
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
      const models = await ollamaModels(config.ollamaUrl, config.ollamaKey)
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

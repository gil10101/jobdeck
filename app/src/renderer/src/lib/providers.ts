// How the model backends are named and described in the UI. The requirement
// list itself is never built here — main's prereq spec owns that, and every
// screen reads it through the store's preflight slice.
import type { ProviderId } from '@shared/types'

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  claude: 'Claude',
  gemini: 'Gemini',
  ollama: 'Ollama'
}

/**
 * How a run reaches the model under each backend. The Claude Code runtime runs
 * the agent loop under EVERY provider — only the model calls are redirected —
 * so this must never read as "Claude only" to someone who picked Gemini or
 * Ollama to stay off an Anthropic account.
 */
export const PROVIDER_RUN_NOTE: Record<ProviderId, string> = {
  claude: 'Agent runs use the Claude Code runtime and sign in with your Claude Code login.',
  gemini:
    'Agent runs still use the Claude Code runtime for the agent loop; only the model calls go to Gemini, so no Claude sign-in is needed.',
  ollama:
    'Agent runs still use the Claude Code runtime for the agent loop; only the model calls go to your Ollama server, so no Claude sign-in or Anthropic account is needed.'
}

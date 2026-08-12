import type { PrereqId, PrereqTool, ProviderId } from '@shared/types'

// Which prerequisites the active provider actually needs — the ONE place that
// decides it, so onboarding's preflight and Settings can never disagree.
// Pure module: type-only imports, zero runtime imports — the provider selftest
// executes it under plain node type stripping.
//
// The requirement set is derived, never hardcoded per caller: coreIpc asks for
// the specs of the current provider, probes only those, and returns them. A new
// provider is added here and both screens follow.

/** The static half of a prerequisite row: everything knowable without touching
 *  the host. The probe adds `ok` and `detail`. */
export interface PrereqSpec {
  id: PrereqId
  label: string
  /** false = the app still runs; only the feature named in `remedy` is lost. */
  required: boolean
  remedy: string
  url: string
}

const CLAUDE_DOCS = 'https://docs.claude.com/en/docs/claude-code/overview'

const SPECS: Record<PrereqId, PrereqSpec> = {
  claude: {
    id: 'claude',
    label: 'Claude Code agent runtime',
    required: true,
    // Required under every provider, and the reason has to be stated: a user
    // who picked Ollama to avoid Anthropic entirely will otherwise read this
    // row as the app ignoring their choice.
    remedy:
      'Run npm install in the app folder to fetch the Claude Code runtime for this platform. Every provider needs it: it runs the agent loop on this machine, and Gemini/Ollama only redirect the model calls — it does not require an Anthropic account.',
    url: CLAUDE_DOCS
  },
  claudeAuth: {
    id: 'claudeAuth',
    label: 'Claude sign-in',
    required: true,
    remedy:
      'Run claude in a terminal and finish the login, or export ANTHROPIC_API_KEY. Only the Claude provider needs this — choosing Gemini or Ollama as the model provider drops the requirement.',
    url: 'https://docs.claude.com/en/docs/claude-code/setup'
  },
  geminiKey: {
    id: 'geminiKey',
    label: 'Gemini API key',
    required: true,
    remedy: 'Paste a Gemini API key into the model-provider settings; it is stored encrypted on this machine.',
    url: 'https://aistudio.google.com/apikey'
  },
  ollamaServer: {
    id: 'ollamaServer',
    label: 'Ollama server and model',
    required: true,
    remedy:
      'Start Ollama (ollama serve), pull a tool-capable model (e.g. ollama pull qwen3:8b), then pick that model in the model-provider settings.',
    url: 'https://ollama.com/download'
  },
  latex: {
    id: 'latex',
    label: 'LaTeX engine',
    required: true,
    // Remedies must be actionable from wherever they are read. Settings is
    // unreachable during first-run setup, so a pointer there can only be a
    // secondary note, never the instruction itself.
    remedy:
      'Install tectonic (a single binary) or a TeX distribution. Once setup is done, Settings can also point at an engine installed somewhere unusual.',
    url: 'https://tectonic-typesetting.github.io'
  },
  bun: {
    id: 'bun',
    label: 'bun runtime',
    required: false,
    remedy:
      'Install bun — only job-board scout runs need it, so setup can continue without it. Settings offers a one-click install once setup is done.',
    url: 'https://bun.sh'
  }
}

/** The credential/backend prerequisite each provider owns. Absent from this
 *  map means the provider needs nothing beyond the shared rows. */
const PROVIDER_PREREQ: Record<ProviderId, PrereqId> = {
  claude: 'claudeAuth',
  gemini: 'geminiKey',
  ollama: 'ollamaServer'
}

/**
 * Prerequisite ids that apply to `provider`, in display order.
 * null = no workspace yet: settings (and therefore the provider) live inside
 * the workspace, so only the provider-independent rows can be judged.
 */
export function prereqIdsFor(provider: ProviderId | null): PrereqId[] {
  const providerSpecific = provider ? [PROVIDER_PREREQ[provider]] : []
  return ['claude', ...providerSpecific, 'latex', 'bun']
}

/** The specs behind prereqIdsFor(), same order. */
export function prereqSpecsFor(provider: ProviderId | null): PrereqSpec[] {
  return prereqIdsFor(provider).map((id) => SPECS[id])
}

/** One line telling the user what the list covers — including the honest
 *  answer before a workspace exists, where the provider cannot be known. */
export function scopeNoteFor(provider: ProviderId | null): string {
  if (!provider) {
    return 'The model provider is a workspace setting, so only the requirements shared by every provider are checked here. The provider-specific one is checked once a workspace folder exists.'
  }
  if (provider === 'claude') {
    return 'Requirements for the Claude provider — model calls use your Claude sign-in.'
  }
  if (provider === 'gemini') {
    return 'Requirements for the Gemini provider — model calls use your Gemini API key, so no Claude sign-in is needed.'
  }
  return 'Requirements for the Ollama provider — model calls stay on this machine, so no Claude sign-in or Anthropic account is needed.'
}

/** Worst-first: unmet requirements, then unmet optional extras, then whatever
 *  is already satisfied. Stable within each band, so display order survives. */
export function sortPrereqs(tools: PrereqTool[]): PrereqTool[] {
  const rank = (t: PrereqTool): number => (t.ok ? 2 : t.required ? 0 : 1)
  return [...tools].sort((a, b) => rank(a) - rank(b))
}

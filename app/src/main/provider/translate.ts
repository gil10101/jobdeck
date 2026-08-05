// Shared translation core for the local Anthropic-API shim: normalizes an
// incoming Anthropic Messages request (as the Claude Code CLI sends it —
// cache_control markers, block arrays, tool schemas) into plain structures the
// Gemini and Ollama backends can each map onto their own wire format.

export interface AnthropicTool {
  name: string
  description?: string
  input_schema?: Record<string, unknown>
  /** Server tools carry a versioned type ('web_search_20250305') and no schema. */
  type?: string
  allowed_domains?: string[]
  blocked_domains?: string[]
}

/** The web_search server tool, when the request carries one. The CLI's
 *  WebSearch client tool issues a sub-request whose ONLY tool is this — that
 *  request is a search order the shim must execute itself. */
export function webSearchTool(req: AnthropicRequest): AnthropicTool | null {
  return (req.tools ?? []).find((t) => t.type?.startsWith('web_search')) ?? null
}

export interface AnthropicRequest {
  model?: string
  system?: string | { type?: string; text?: string }[]
  messages?: AnthropicWireMessage[]
  tools?: AnthropicTool[]
  tool_choice?: { type?: string; name?: string }
  max_tokens?: number
  temperature?: number
  stop_sequences?: string[]
  stream?: boolean
}

export interface AnthropicWireMessage {
  role: 'user' | 'assistant'
  content: string | WireBlock[]
}

interface WireBlock {
  type?: string
  text?: string
  source?: { type?: string; media_type?: string; data?: string }
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  content?: string | WireBlock[]
  is_error?: boolean
}

/** Normalized content blocks — the only shapes backends must handle. */
export type NormBlock =
  | { kind: 'text'; text: string }
  | { kind: 'image'; mimeType: string; base64: string }
  | { kind: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { kind: 'tool_result'; toolUseId: string; toolName: string; text: string; images: { mimeType: string; base64: string }[] }

export interface NormMessage {
  role: 'user' | 'assistant'
  blocks: NormBlock[]
}

export function systemText(req: AnthropicRequest): string {
  if (typeof req.system === 'string') return req.system
  if (Array.isArray(req.system)) {
    return req.system
      .map((b) => b?.text ?? '')
      .filter(Boolean)
      .join('\n\n')
  }
  return ''
}

/** Flatten a tool_result's content (string or block list) to text + images. */
function toolResultParts(content: string | WireBlock[] | undefined): {
  text: string
  images: { mimeType: string; base64: string }[]
} {
  if (typeof content === 'string') return { text: content, images: [] }
  const texts: string[] = []
  const images: { mimeType: string; base64: string }[] = []
  for (const b of content ?? []) {
    if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text)
    if (b.type === 'image' && b.source?.type === 'base64' && b.source.data) {
      images.push({ mimeType: b.source.media_type ?? 'image/png', base64: b.source.data })
    }
  }
  return { text: texts.join('\n'), images }
}

/**
 * Normalize the transcript. Thinking blocks are dropped (backend models have
 * no equivalent), cache_control markers disappear with the fields we copy,
 * and every tool_result learns its tool NAME by looking up the tool_use id
 * earlier in the same transcript — Gemini requires name-keyed responses.
 */
export function normalizeMessages(req: AnthropicRequest): NormMessage[] {
  const nameById = new Map<string, string>()
  const out: NormMessage[] = []
  for (const msg of req.messages ?? []) {
    const blocks: NormBlock[] = []
    if (typeof msg.content === 'string') {
      if (msg.content) blocks.push({ kind: 'text', text: msg.content })
    } else {
      for (const b of msg.content ?? []) {
        if (b.type === 'text' && typeof b.text === 'string' && b.text) {
          blocks.push({ kind: 'text', text: b.text })
        } else if (b.type === 'image' && b.source?.type === 'base64' && b.source.data) {
          blocks.push({ kind: 'image', mimeType: b.source.media_type ?? 'image/png', base64: b.source.data })
        } else if (b.type === 'tool_use' && b.name) {
          const id = b.id ?? `toolu_${nameById.size}`
          nameById.set(id, b.name)
          blocks.push({
            kind: 'tool_use',
            id,
            name: b.name,
            input: (b.input && typeof b.input === 'object' ? b.input : {}) as Record<string, unknown>
          })
        } else if (b.type === 'tool_result' && b.tool_use_id) {
          const { text, images } = toolResultParts(b.content)
          blocks.push({
            kind: 'tool_result',
            toolUseId: b.tool_use_id,
            toolName: nameById.get(b.tool_use_id) ?? 'tool',
            text: b.is_error ? `[tool error] ${text}` : text,
            images
          })
        }
        // thinking / redacted_thinking / document: intentionally dropped
      }
    }
    if (blocks.length) out.push({ role: msg.role, blocks })
  }
  return out
}

/** Rough context-size estimate for count_tokens (chars/4 — same order as BPE). */
export function estimateTokens(req: AnthropicRequest): number {
  let chars = systemText(req).length
  for (const m of normalizeMessages(req)) {
    for (const b of m.blocks) {
      if (b.kind === 'text') chars += b.text.length
      else if (b.kind === 'tool_use') chars += JSON.stringify(b.input).length + b.name.length
      else if (b.kind === 'tool_result') chars += b.text.length
      else chars += 1000 // image: flat charge
    }
  }
  for (const t of req.tools ?? []) chars += JSON.stringify(t.input_schema ?? {}).length + (t.description?.length ?? 0)
  return Math.max(1, Math.ceil(chars / 4))
}

// ---- Gemini schema sanitizer ----

const GEMINI_SCHEMA_KEYS = new Set(['description', 'enum', 'nullable', 'minItems', 'maxItems'])

/**
 * Gemini's function-declaration schema is a strict OpenAPI subset: unknown
 * keys (additionalProperties, $schema, default, format variants…) fail the
 * whole request with a 400, so everything is rebuilt onto a whitelist.
 */
export function geminiSchema(schema: unknown): Record<string, unknown> | null {
  if (!schema || typeof schema !== 'object') return null
  const s = schema as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of GEMINI_SCHEMA_KEYS) {
    if (s[k] !== undefined) out[k] = s[k]
  }
  let type = s.type
  // JSON-Schema nullable unions ('type': ['string','null']) → nullable flag.
  if (Array.isArray(type)) {
    if (type.includes('null')) out.nullable = true
    type = type.find((t) => t !== 'null')
  }
  if (typeof type === 'string') out.type = type
  if (s.const !== undefined) out.enum = [s.const]
  if (s.properties && typeof s.properties === 'object') {
    const props: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(s.properties as Record<string, unknown>)) {
      const cleaned = geminiSchema(v)
      if (cleaned) props[k] = cleaned
    }
    if (Object.keys(props).length) {
      out.properties = props
      out.type = 'object'
      if (Array.isArray(s.required)) {
        const req = s.required.filter((r) => typeof r === 'string' && r in props)
        if (req.length) out.required = req
      }
    }
  }
  if (s.items) {
    const cleaned = geminiSchema(s.items)
    if (cleaned) {
      out.items = cleaned
      out.type = 'array'
    }
  }
  if (Array.isArray(s.anyOf)) {
    const variants = s.anyOf.map(geminiSchema).filter((v): v is Record<string, unknown> => v !== null)
    if (variants.length) out.anyOf = variants
  }
  // Gemini rejects typeless nodes; a bare/unrecognized schema degrades to string.
  if (!out.type && !out.anyOf && !out.enum) out.type = 'string'
  return Object.keys(out).length ? out : null
}

/**
 * Repair sloppy tool arguments against the tool's declared schema — smaller
 * models routinely send `"metadata": "{}"` where an object is required, or
 * numbers/booleans as strings. Only unambiguous repairs are made.
 */
export function coerceToolArgs(
  input: Record<string, unknown>,
  tool: AnthropicTool | undefined
): Record<string, unknown> {
  const props = tool?.input_schema?.properties as Record<string, { type?: string }> | undefined
  if (!props) return input
  const out: Record<string, unknown> = { ...input }
  for (const [key, value] of Object.entries(out)) {
    const expected = props[key]?.type
    if (typeof value !== 'string' || !expected) continue
    if (expected === 'object' || expected === 'array') {
      try {
        const parsed = JSON.parse(value) as unknown
        if (parsed !== null && typeof parsed === 'object') out[key] = parsed
      } catch {
        /* leave as-is; the tool's own validation will report it */
      }
    } else if (expected === 'number' || expected === 'integer') {
      const n = Number(value)
      if (value.trim() !== '' && Number.isFinite(n)) out[key] = n
    } else if (expected === 'boolean' && (value === 'true' || value === 'false')) {
      out[key] = value === 'true'
    }
  }
  return out
}

// ---- Backend event contract ----

/** What a backend yields; the shim renders these as Anthropic SSE or JSON. */
export type BackendEvent =
  | { kind: 'text'; delta: string }
  /** Model reasoning — rendered as an Anthropic thinking block, never as answer text. */
  | { kind: 'thinking'; delta: string }
  | {
      kind: 'tool'
      name: string
      input: Record<string, unknown>
      /** Gemini 3 thought signature — must ride back with this call in history. */
      signature?: string
    }
  | {
      // One executed (or failed) web search → a server_tool_use +
      // web_search_tool_result block pair in the Anthropic response.
      kind: 'web_search'
      query: string
      results: { title: string; url: string }[] | { errorCode: string }
    }
  | {
      kind: 'done'
      stopReason: 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence'
      inputTokens: number | null
      outputTokens: number | null
    }

export interface ProviderConfig {
  provider: 'claude' | 'gemini' | 'ollama'
  /** Backend model name for the active provider (gemini-2.5-flash, qwen3:14b, …). */
  model: string
  /** Key is carried regardless of provider: web searches run through Gemini
   *  grounding even when the main model is Ollama. */
  geminiKey: string | null
  /** Model for Gemini requests — the search path uses this under any provider. */
  geminiModel: string
  /** Override for tests; production uses the public endpoint. */
  geminiUrl: string
  ollamaUrl: string
  /** ollama.com key for cloud models; local daemons need none. */
  ollamaKey: string | null
  /** Ollama defaults to a tiny context; agent prompts need far more. */
  ollamaNumCtx: number
  /** Reasoning on thinking-capable models (qwen3…): minutes of thinking
   *  tokens per turn on laptop hardware, so off by default. */
  ollamaThink: boolean
}

export type Backend = (
  req: AnthropicRequest,
  config: ProviderConfig,
  signal: AbortSignal
) => AsyncGenerator<BackendEvent>

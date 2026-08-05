import {
  estimateTokens,
  normalizeMessages,
  systemText,
  type AnthropicRequest,
  type BackendEvent,
  type ProviderConfig
} from './translate'

// Anthropic Messages → Ollama native /api/chat (NDJSON streaming). The native
// endpoint is used instead of Ollama's OpenAI compat layer because it accepts
// tool-call arguments as real objects and per-request options like num_ctx —
// which matters: Ollama's default context is far too small for agent prompts.

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  images?: string[]
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[]
  /** Newer Ollama matches tool replies to calls by name. */
  tool_name?: string
}

function toMessages(req: AnthropicRequest): OllamaMessage[] {
  const out: OllamaMessage[] = []
  const sys = systemText(req)
  if (sys) out.push({ role: 'system', content: sys })
  for (const msg of normalizeMessages(req)) {
    if (msg.role === 'assistant') {
      const text = msg.blocks
        .filter((b) => b.kind === 'text')
        .map((b) => (b.kind === 'text' ? b.text : ''))
        .join('\n')
      const calls = msg.blocks
        .filter((b) => b.kind === 'tool_use')
        .map((b) => (b.kind === 'tool_use' ? { function: { name: b.name, arguments: b.input } } : null))
        .filter((c): c is NonNullable<typeof c> => c !== null)
      out.push({ role: 'assistant', content: text, ...(calls.length ? { tool_calls: calls } : {}) })
      continue
    }
    // User turns: tool results become role:'tool' messages (in order), plain
    // text+images become one user message.
    let text = ''
    const images: string[] = []
    for (const b of msg.blocks) {
      if (b.kind === 'tool_result') {
        out.push({
          role: 'tool',
          content: b.text || '(no output)',
          tool_name: b.toolName,
          ...(b.images.length ? { images: b.images.map((i) => i.base64) } : {})
        })
      } else if (b.kind === 'text') {
        text += (text ? '\n' : '') + b.text
      } else if (b.kind === 'image') {
        images.push(b.base64)
      }
    }
    if (text || images.length) {
      out.push({ role: 'user', content: text, ...(images.length ? { images } : {}) })
    }
  }
  return out
}

interface OllamaChunk {
  message?: {
    content?: string
    tool_calls?: { function?: { name?: string; arguments?: unknown } }[]
  }
  done?: boolean
  done_reason?: string
  prompt_eval_count?: number
  eval_count?: number
  error?: string
}

export async function* ollamaBackend(
  req: AnthropicRequest,
  config: ProviderConfig,
  signal: AbortSignal
): AsyncGenerator<BackendEvent> {
  if (!config.model) throw new Error('no Ollama model set (Settings → Model provider)')
  const body: Record<string, unknown> = {
    model: config.model,
    messages: toMessages(req),
    stream: true,
    options: {
      num_ctx: config.ollamaNumCtx,
      ...(req.max_tokens ? { num_predict: req.max_tokens } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.stop_sequences?.length ? { stop: req.stop_sequences } : {})
    }
  }
  // Server-side tools (no input_schema) exist only on Anthropic's API — see
  // geminiBackend for the rationale.
  const tools = (req.tools ?? []).filter((t) => t.input_schema).map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description ?? '', parameters: t.input_schema ?? { type: 'object' } }
  }))
  if (tools.length) body.tools = tools

  const res = await fetch(`${config.ollamaUrl.replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal
  })
  if (!res.ok || !res.body) {
    let detail = ''
    try {
      detail = (JSON.parse(await res.text()) as OllamaChunk).error ?? ''
    } catch {
      /* non-JSON error body */
    }
    throw new Error(`Ollama error (HTTP ${res.status})${detail ? `: ${detail}` : ''}`)
  }

  let sawTool = false
  let doneReason: string | undefined
  let inputTokens: number | null = null
  let outputTokens: number | null = null
  let buffer = ''
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const handleLine = function* (line: string): Generator<BackendEvent> {
    const trimmed = line.trim()
    if (!trimmed) return
    let chunk: OllamaChunk
    try {
      chunk = JSON.parse(trimmed) as OllamaChunk
    } catch {
      return
    }
    if (chunk.error) throw new Error(`Ollama stream error: ${chunk.error}`)
    if (chunk.message?.content) yield { kind: 'text', delta: chunk.message.content }
    for (const call of chunk.message?.tool_calls ?? []) {
      if (!call.function?.name) continue
      sawTool = true
      const args = call.function.arguments
      yield {
        kind: 'tool',
        name: call.function.name,
        input: (args && typeof args === 'object' ? args : {}) as Record<string, unknown>
      }
    }
    if (chunk.done) {
      doneReason = chunk.done_reason
      inputTokens = chunk.prompt_eval_count ?? inputTokens
      outputTokens = chunk.eval_count ?? outputTokens
    }
  }
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) yield* handleLine(line)
    }
    if (buffer) yield* handleLine(buffer)
  } finally {
    // Runs on parse errors AND consumer abandonment (generator .return());
    // without it the connection lingers until the socket times out.
    void reader.cancel().catch(() => undefined)
  }
  yield {
    kind: 'done',
    stopReason: sawTool ? 'tool_use' : doneReason === 'length' ? 'max_tokens' : 'end_turn',
    inputTokens: inputTokens ?? estimateTokens(req),
    outputTokens
  }
}

/** Reachability + installed-models probe for the Settings card. */
export async function ollamaModels(url: string): Promise<string[]> {
  const res = await fetch(`${url.replace(/\/$/, '')}/api/tags`, { signal: AbortSignal.timeout(3000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const parsed = (await res.json()) as { models?: { name?: string }[] }
  return (parsed.models ?? []).map((m) => m.name ?? '').filter(Boolean)
}

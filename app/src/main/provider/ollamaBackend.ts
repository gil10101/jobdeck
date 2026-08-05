import {
  estimateTokens,
  normalizeMessages,
  systemText,
  type AnthropicRequest,
  type BackendEvent,
  type ProviderConfig
} from './translate'
import { llmFetch } from './llmFetch'

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
    /** Thinking-capable models (qwen3…) stream reasoning separately here. */
    thinking?: string
    tool_calls?: { function?: { name?: string; arguments?: unknown } }[]
  }
  done?: boolean
  done_reason?: string
  prompt_eval_count?: number
  eval_count?: number
  error?: string
}

/** End index of the balanced JSON object starting at `start` (string-aware),
 *  or -1 while incomplete. */
function balancedEnd(s: string, start: number): number {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (escaped) {
      escaped = false
    } else if (ch === '\\') {
      escaped = inString
    } else if (ch === '"') {
      inString = !inString
    } else if (!inString) {
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) return i
      }
    }
  }
  return -1
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
    // Explicit false disables reasoning on thinking models; models without
    // thinking ignore the field.
    think: config.ollamaThink,
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

  const res = await llmFetch(`${config.ollamaUrl.replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader(config.ollamaKey) },
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
    const err = new Error(`Ollama error (HTTP ${res.status})${detail ? `: ${detail}` : ''}`) as Error & { status?: number }
    err.status = res.status
    throw err
  }

  let sawTool = false
  let doneReason: string | undefined
  let inputTokens: number | null = null
  let outputTokens: number | null = null
  // Small models happily emit the SAME call over and over in one response
  // (five identical Writes in a row) — collapse exact repeats.
  const seenCalls = new Set<string>()
  const emitCall = function* (name: string, input: Record<string, unknown>): Generator<BackendEvent> {
    const key = `${name} ${JSON.stringify(input)}`
    if (seenCalls.has(key)) return
    seenCalls.add(key)
    sawTool = true
    yield { kind: 'tool', name, input }
  }
  // Llama-family models often print tool calls as TEXT in trained-in JSON
  // shapes ({"name": ..., "parameters": {...}}) that Ollama's template cannot
  // parse. Text is buffered across brace boundaries; a complete JSON object
  // naming a KNOWN tool becomes a real call, anything else flows through as
  // text untouched.
  const knownTools = new Set((req.tools ?? []).filter((t) => t.input_schema).map((t) => t.name))
  let textBuf = ''
  const drainText = function* (final: boolean): Generator<BackendEvent> {
    for (;;) {
      const start = textBuf.indexOf('{')
      if (start === -1) {
        if (textBuf) {
          yield { kind: 'text', delta: textBuf }
          textBuf = ''
        }
        return
      }
      const end = balancedEnd(textBuf, start)
      if (end === -1) {
        // Object still streaming in: flush the text before it, hold the rest.
        if (start > 0) {
          yield { kind: 'text', delta: textBuf.slice(0, start) }
          textBuf = textBuf.slice(start)
        }
        if (final && textBuf) {
          yield { kind: 'text', delta: textBuf }
          textBuf = ''
        }
        return
      }
      interface TextCall {
        name?: unknown
        parameters?: unknown
        arguments?: unknown
        input?: unknown
      }
      let call: TextCall | null = null
      try {
        call = JSON.parse(textBuf.slice(start, end + 1)) as TextCall
      } catch {
        call = null
      }
      const input = call?.parameters ?? call?.arguments ?? call?.input
      if (
        typeof call?.name === 'string' &&
        knownTools.has(call.name) &&
        input !== null &&
        typeof input === 'object'
      ) {
        if (start > 0) yield { kind: 'text', delta: textBuf.slice(0, start) }
        yield* emitCall(call.name, input as Record<string, unknown>)
        textBuf = textBuf.slice(end + 1)
        continue
      }
      // Not a tool call: pass the opening brace through and keep scanning.
      yield { kind: 'text', delta: textBuf.slice(0, start + 1) }
      textBuf = textBuf.slice(start + 1)
    }
  }
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
    if (chunk.message?.thinking) yield { kind: 'thinking', delta: chunk.message.thinking }
    if (chunk.message?.content) {
      textBuf += chunk.message.content
      yield* drainText(false)
    }
    for (const call of chunk.message?.tool_calls ?? []) {
      if (!call.function?.name) continue
      const args = call.function.arguments
      yield* emitCall(
        call.function.name,
        (args && typeof args === 'object' ? args : {}) as Record<string, unknown>
      )
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
    yield* drainText(true)
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

/** Bearer auth for ollama.com cloud models; local daemons ignore it. */
function authHeader(key: string | null): Record<string, string> {
  return key ? { authorization: `Bearer ${key}` } : {}
}

/** Reachability + installed-models probe for the Settings card. */
export async function ollamaModels(url: string, key: string | null = null): Promise<string[]> {
  const res = await llmFetch(`${url.replace(/\/$/, '')}/api/tags`, {
    headers: authHeader(key),
    signal: AbortSignal.timeout(5000)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const parsed = (await res.json()) as { models?: { name?: string }[] }
  return (parsed.models ?? []).map((m) => m.name ?? '').filter(Boolean)
}

export interface OllamaModelInfo {
  /** Trained context length from model metadata; null when not reported. */
  contextLength: number | null
  /** Whether the model advertises tool/function calling; null when unknown. */
  tools: boolean | null
}

/** Model metadata for the Settings hints (context ceiling, tool support). */
export async function ollamaModelInfo(
  url: string,
  key: string | null,
  model: string
): Promise<OllamaModelInfo> {
  const res = await llmFetch(`${url.replace(/\/$/, '')}/api/show`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader(key) },
    body: JSON.stringify({ model }),
    signal: AbortSignal.timeout(5000)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const parsed = (await res.json()) as {
    model_info?: Record<string, unknown>
    capabilities?: string[]
  }
  let contextLength: number | null = null
  for (const [k, v] of Object.entries(parsed.model_info ?? {})) {
    if (k.endsWith('.context_length') && typeof v === 'number') {
      contextLength = v
      break
    }
  }
  const tools = Array.isArray(parsed.capabilities) ? parsed.capabilities.includes('tools') : null
  return { contextLength, tools }
}

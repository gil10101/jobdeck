import {
  estimateTokens,
  geminiSchema,
  normalizeMessages,
  systemText,
  webSearchTool,
  type AnthropicRequest,
  type BackendEvent,
  type ProviderConfig
} from './translate'

// Anthropic Messages → Gemini generateContent. Tool round-trips map onto
// functionCall/functionResponse parts; the API key travels in a header (never
// a URL, so it can't leak into logs or proxies).

const MAX_OUTPUT_TOKENS = 65536
const MAX_STOP_SEQUENCES = 5

interface GeminiPart {
  text?: string
  inlineData?: { mimeType: string; data: string }
  functionCall?: { name: string; args: Record<string, unknown> }
  functionResponse?: { name: string; response: Record<string, unknown> }
}

interface GeminiContent {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

function toContents(req: AnthropicRequest): GeminiContent[] {
  const contents: GeminiContent[] = []
  const push = (role: 'user' | 'model', parts: GeminiPart[]): void => {
    if (!parts.length) return
    const last = contents[contents.length - 1]
    // Gemini prefers alternating roles; merge adjacent same-role turns.
    if (last && last.role === role) last.parts.push(...parts)
    else contents.push({ role, parts })
  }
  for (const msg of normalizeMessages(req)) {
    const role = msg.role === 'assistant' ? 'model' : 'user'
    const parts: GeminiPart[] = []
    for (const b of msg.blocks) {
      if (b.kind === 'text') parts.push({ text: b.text })
      else if (b.kind === 'image') parts.push({ inlineData: { mimeType: b.mimeType, data: b.base64 } })
      else if (b.kind === 'tool_use') parts.push({ functionCall: { name: b.name, args: b.input } })
      else {
        parts.push({
          functionResponse: { name: b.toolName, response: { result: b.text || '(no output)' } }
        })
        for (const img of b.images) parts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } })
      }
    }
    push(role, parts)
  }
  return contents
}

function toolConfig(req: AnthropicRequest): Record<string, unknown> | undefined {
  const t = req.tool_choice?.type
  if (!t || t === 'auto') return undefined
  if (t === 'none') return { functionCallingConfig: { mode: 'NONE' } }
  if (t === 'tool' && req.tool_choice?.name) {
    return { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [req.tool_choice.name] } }
  }
  return { functionCallingConfig: { mode: 'ANY' } }
}

function buildBody(req: AnthropicRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    contents: toContents(req),
    generationConfig: {
      maxOutputTokens: Math.min(req.max_tokens ?? 8192, MAX_OUTPUT_TOKENS),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.stop_sequences?.length
        ? { stopSequences: req.stop_sequences.slice(0, MAX_STOP_SEQUENCES) }
        : {})
    }
  }
  const sys = systemText(req)
  if (sys) body.systemInstruction = { parts: [{ text: sys }] }
  // Server-side tools (web_search etc.) have no input_schema and only exist on
  // Anthropic's API — offering them here would let the model call tools the
  // CLI cannot execute.
  const decls = (req.tools ?? []).filter((t) => t.input_schema).map((t) => {
    const parameters = geminiSchema(t.input_schema)
    return {
      name: t.name,
      description: t.description ?? '',
      // Parameterless tools must omit the field entirely.
      ...(parameters && parameters.properties ? { parameters } : {})
    }
  })
  if (decls.length) {
    body.tools = [{ functionDeclarations: decls }]
    const tc = toolConfig(req)
    if (tc) body.toolConfig = tc
  } else if (webSearchTool(req)) {
    // The CLI's WebSearch sub-request: its only tool is the server-side
    // web_search — executed here via Gemini's Google Search grounding. Only
    // when there are no function declarations: Gemini rejects mixing search
    // grounding with function calling in one request.
    body.tools = [{ googleSearch: {} }]
  }
  return body
}

interface GeminiChunk {
  candidates?: {
    content?: { parts?: GeminiPart[] }
    finishReason?: string
    groundingMetadata?: {
      webSearchQueries?: string[]
      groundingChunks?: { web?: { uri?: string; title?: string } }[]
    }
  }[]
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
  error?: { message?: string }
}

function mapStop(finish: string | undefined, sawTool: boolean): 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence' {
  if (sawTool) return 'tool_use'
  if (finish === 'MAX_TOKENS') return 'max_tokens'
  return 'end_turn'
}

export async function* geminiBackend(
  req: AnthropicRequest,
  config: ProviderConfig,
  signal: AbortSignal
): AsyncGenerator<BackendEvent> {
  if (!config.geminiKey) throw new Error('no Gemini API key set (Settings → Model provider)')
  // geminiModel, not model: under the Ollama provider this backend still runs
  // web-search sub-requests, where config.model is an Ollama name.
  const url = `${config.geminiUrl.replace(/\/$/, '')}/v1beta/models/${encodeURIComponent(config.geminiModel)}:streamGenerateContent?alt=sse`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': config.geminiKey },
    body: JSON.stringify(buildBody(req)),
    signal
  })
  if (!res.ok || !res.body) {
    let detail = ''
    try {
      const parsed = JSON.parse(await res.text()) as GeminiChunk
      detail = parsed.error?.message ?? ''
    } catch {
      /* non-JSON error body */
    }
    throw new Error(`Gemini API error (HTTP ${res.status})${detail ? `: ${detail}` : ''}`)
  }

  let sawTool = false
  let finishReason: string | undefined
  let inputTokens: number | null = null
  let outputTokens: number | null = null
  const searchQueries = new Set<string>()
  const searchResults = new Map<string, { title: string; url: string }>()
  let buffer = ''
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const handleLine = function* (line: string): Generator<BackendEvent> {
    if (!line.startsWith('data:')) return
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') return
    let chunk: GeminiChunk
    try {
      chunk = JSON.parse(payload) as GeminiChunk
    } catch {
      return
    }
    if (chunk.error?.message) throw new Error(`Gemini stream error: ${chunk.error.message}`)
    const cand = chunk.candidates?.[0]
    for (const part of cand?.content?.parts ?? []) {
      if (typeof part.text === 'string' && part.text) yield { kind: 'text', delta: part.text }
      if (part.functionCall?.name) {
        sawTool = true
        yield { kind: 'tool', name: part.functionCall.name, input: part.functionCall.args ?? {} }
      }
    }
    const gm = cand?.groundingMetadata
    if (gm) {
      for (const q of gm.webSearchQueries ?? []) searchQueries.add(q)
      for (const c of gm.groundingChunks ?? []) {
        if (c.web?.uri) {
          searchResults.set(c.web.uri, { title: c.web.title ?? c.web.uri, url: c.web.uri })
        }
      }
    }
    if (cand?.finishReason) finishReason = cand.finishReason
    if (chunk.usageMetadata) {
      inputTokens = chunk.usageMetadata.promptTokenCount ?? inputTokens
      outputTokens = chunk.usageMetadata.candidatesTokenCount ?? outputTokens
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
  // Grounding data → one search-result pair. Attribution of individual hits
  // to individual queries isn't in the metadata, so all hits ride together;
  // the CLI only aggregates titles + urls anyway.
  if (webSearchTool(req) && (searchQueries.size || searchResults.size)) {
    yield {
      kind: 'web_search',
      query: [...searchQueries].join(' | ') || 'web search',
      results: [...searchResults.values()]
    }
  }
  yield {
    kind: 'done',
    stopReason: mapStop(finishReason, sawTool),
    inputTokens: inputTokens ?? estimateTokens(req),
    outputTokens
  }
}

/** One tiny non-streaming request to validate key + model; throws with detail. */
export async function testGemini(config: ProviderConfig): Promise<string> {
  if (!config.geminiKey) throw new Error('no Gemini API key set')
  const url = `${config.geminiUrl.replace(/\/$/, '')}/v1beta/models/${encodeURIComponent(config.geminiModel)}:generateContent`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': config.geminiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: 'Reply with the single word: ok' }] }],
      generationConfig: { maxOutputTokens: 10 }
    })
  })
  if (!res.ok) {
    let detail = ''
    try {
      detail = ((JSON.parse(await res.text()) as GeminiChunk).error?.message ?? '').slice(0, 200)
    } catch {
      /* non-JSON error body */
    }
    throw new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ''}`)
  }
  return `${config.geminiModel} responded`
}

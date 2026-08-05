import { randomUUID } from 'node:crypto'
import http from 'node:http'
import { geminiBackend, rememberToolSignature } from './geminiBackend'
import { ollamaBackend } from './ollamaBackend'
import {
  estimateTokens,
  webSearchTool,
  type AnthropicRequest,
  type Backend,
  type BackendEvent,
  type ProviderConfig
} from './translate'

// Loopback HTTP server speaking the Anthropic Messages API (the subset the
// Claude Code CLI uses: POST /v1/messages streaming + non-streaming, and
// count_tokens), backed by Gemini or Ollama. The agent subprocesses are
// pointed here via ANTHROPIC_BASE_URL; a per-launch bearer secret keeps any
// other local process from proxying through the user's Gemini key.

const BODY_LIMIT = 64 * 1024 * 1024

export interface ShimHandle {
  port: number
  secret: string
  close: () => void
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > BODY_LIMIT) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

function sendError(
  res: http.ServerResponse,
  status: number,
  message: string,
  headers: Record<string, string> = {}
): void {
  if (res.headersSent) {
    // Mid-stream failure: surface it as an SSE error event, then end.
    res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: 'api_error', message } })}\n\n`)
    res.end()
    return
  }
  const type = status === 429 ? 'rate_limit_error' : status === 529 ? 'overloaded_error' : 'api_error'
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(JSON.stringify({ type: 'error', error: { type, message } }))
}

function blockId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 24)}`
}

/** The server_tool_use + web_search_tool_result block pair for one search,
 *  in Anthropic wire shape (shared by the SSE and JSON renderers). */
function searchBlocks(ev: Extract<BackendEvent, { kind: 'web_search' }>): {
  use: Record<string, unknown>
  result: Record<string, unknown>
} {
  const id = blockId('srvtoolu')
  const content = Array.isArray(ev.results)
    ? ev.results.map((r) => ({ type: 'web_search_result', title: r.title, url: r.url }))
    : { type: 'web_search_tool_result_error', error_code: ev.results.errorCode }
  return {
    use: { type: 'server_tool_use', id, name: 'web_search', input: { query: ev.query } },
    result: { type: 'web_search_tool_result', tool_use_id: id, content }
  }
}

/** Backend for search sub-requests when no Gemini key exists to execute them:
 *  an explicit error result, so the model learns search is unavailable
 *  instead of hallucinating results. */
async function* searchUnavailable(req: AnthropicRequest): AsyncGenerator<BackendEvent> {
  yield { kind: 'text', delta: 'Web search is unavailable: no Gemini API key is set (Settings → Model provider). Answer from existing knowledge and say the web could not be searched.' }
  yield { kind: 'web_search', query: 'web search', results: { errorCode: 'unavailable' } }
  yield { kind: 'done', stopReason: 'end_turn', inputTokens: estimateTokens(req), outputTokens: 0 }
}

interface CollectedBlocks {
  text: string
  tools: { id: string; name: string; input: Record<string, unknown> }[]
  searches: Extract<BackendEvent, { kind: 'web_search' }>[]
}

/** Render backend events as the Anthropic streaming SSE sequence. */
async function streamResponse(
  res: http.ServerResponse,
  backend: Backend,
  req: AnthropicRequest,
  config: ProviderConfig,
  signal: AbortSignal
): Promise<void> {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive'
  })
  const emit = (event: string, data: Record<string, unknown>): void => {
    res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`)
  }
  const msgId = `msg_${randomUUID().replace(/-/g, '').slice(0, 24)}`
  // Real input size arrives only with the backend's final chunk; message_start
  // wants it upfront, so an estimate goes there and message_delta corrects it.
  emit('message_start', {
    message: {
      id: msgId,
      type: 'message',
      role: 'assistant',
      model: config.model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: estimateTokens(req), output_tokens: 0 }
    }
  })
  let index = -1
  let textOpen = false
  let stopReason = 'end_turn'
  let usage: Record<string, number> = { output_tokens: 0 }
  for await (const ev of backend(req, config, signal)) {
    if (ev.kind === 'text') {
      if (!textOpen) {
        index++
        textOpen = true
        emit('content_block_start', { index, content_block: { type: 'text', text: '' } })
      }
      emit('content_block_delta', { index, delta: { type: 'text_delta', text: ev.delta } })
    } else if (ev.kind === 'tool') {
      if (textOpen) {
        emit('content_block_stop', { index })
        textOpen = false
      }
      index++
      const toolId = blockId('toolu')
      // The CLI echoes this id back in history; the signature rejoins the
      // functionCall there (Gemini 3 rejects unsigned calls).
      if (ev.signature) rememberToolSignature(toolId, ev.signature)
      emit('content_block_start', {
        index,
        content_block: { type: 'tool_use', id: toolId, name: ev.name, input: {} }
      })
      emit('content_block_delta', {
        index,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(ev.input) }
      })
      emit('content_block_stop', { index })
    } else if (ev.kind === 'web_search') {
      if (textOpen) {
        emit('content_block_stop', { index })
        textOpen = false
      }
      const blocks = searchBlocks(ev)
      // The pair mirrors the real API: input streams as input_json_delta (the
      // CLI reads the query from there for progress), the result block
      // arrives complete.
      index++
      emit('content_block_start', {
        index,
        content_block: { ...blocks.use, input: {} }
      })
      emit('content_block_delta', {
        index,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify({ query: ev.query }) }
      })
      emit('content_block_stop', { index })
      index++
      emit('content_block_start', { index, content_block: blocks.result })
      emit('content_block_stop', { index })
    } else {
      stopReason = ev.stopReason
      usage = {
        output_tokens: ev.outputTokens ?? 0,
        ...(ev.inputTokens !== null ? { input_tokens: ev.inputTokens } : {})
      }
    }
  }
  if (textOpen) emit('content_block_stop', { index })
  emit('message_delta', { delta: { stop_reason: stopReason, stop_sequence: null }, usage })
  emit('message_stop', {})
  res.end()
}

/** Buffer the whole backend run into one Anthropic message JSON. */
async function jsonResponse(
  res: http.ServerResponse,
  backend: Backend,
  req: AnthropicRequest,
  config: ProviderConfig,
  signal: AbortSignal
): Promise<void> {
  const collected: CollectedBlocks = { text: '', tools: [], searches: [] }
  let stopReason = 'end_turn'
  let inputTokens: number | null = null
  let outputTokens: number | null = null
  for await (const ev of backend(req, config, signal)) {
    if (ev.kind === 'text') collected.text += ev.delta
    else if (ev.kind === 'tool') {
      const id = blockId('toolu')
      if (ev.signature) rememberToolSignature(id, ev.signature)
      collected.tools.push({ id, name: ev.name, input: ev.input })
    } else if (ev.kind === 'web_search') {
      collected.searches.push(ev)
    } else {
      stopReason = ev.stopReason
      inputTokens = ev.inputTokens
      outputTokens = ev.outputTokens
    }
  }
  const content: Record<string, unknown>[] = []
  if (collected.text) content.push({ type: 'text', text: collected.text })
  for (const s of collected.searches) {
    const blocks = searchBlocks(s)
    content.push(blocks.use, blocks.result)
  }
  for (const t of collected.tools) content.push({ type: 'tool_use', ...t })
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(
    JSON.stringify({
      id: blockId('msg'),
      type: 'message',
      role: 'assistant',
      model: config.model,
      content,
      stop_reason: stopReason,
      stop_sequence: null,
      usage: { input_tokens: inputTokens ?? estimateTokens(req), output_tokens: outputTokens ?? 0 }
    })
  )
}

/**
 * Start the shim on an ephemeral loopback port. `getConfig` is read per
 * request, so provider/model/key changes in Settings apply to the next
 * request without a restart.
 */
export function startShim(getConfig: () => ProviderConfig): Promise<ShimHandle> {
  const secret = randomUUID()
  const server = http.createServer((req, res) => {
    void (async () => {
      const auth = req.headers.authorization ?? ''
      const apiKey = (req.headers['x-api-key'] as string | undefined) ?? ''
      if (auth !== `Bearer ${secret}` && apiKey !== secret) {
        sendError(res, 401, 'unauthorized')
        return
      }
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (req.method !== 'POST') {
        sendError(res, 404, `not found: ${req.method} ${url.pathname}`)
        return
      }
      let body: AnthropicRequest
      try {
        body = JSON.parse(await readBody(req)) as AnthropicRequest
      } catch (err) {
        sendError(res, 400, `invalid request body: ${String(err)}`)
        return
      }
      if (url.pathname === '/v1/messages/count_tokens') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ input_tokens: estimateTokens(body) }))
        return
      }
      if (url.pathname !== '/v1/messages') {
        sendError(res, 404, `not found: ${url.pathname}`)
        return
      }
      const config = getConfig()
      let backend: Backend | null =
        config.provider === 'gemini' ? geminiBackend : config.provider === 'ollama' ? ollamaBackend : null
      if (!backend) {
        sendError(res, 400, 'shim reached while provider is claude')
        return
      }
      // Pure search sub-requests (the server web_search tool and nothing
      // else) always execute through Gemini grounding when a key exists —
      // including under the Ollama provider (local models have no search).
      // Without a key they get an explicit unavailable result.
      if (webSearchTool(body) && !(body.tools ?? []).some((t) => t.input_schema)) {
        backend = config.geminiKey
          ? geminiBackend
          : (r, _config, _signal): AsyncGenerator<BackendEvent> => searchUnavailable(r)
      }
      // Kill the backend fetch when the CLI drops the connection (abort/stop).
      const controller = new AbortController()
      req.on('close', () => controller.abort())
      try {
        if (body.stream) await streamResponse(res, backend, body, config, controller.signal)
        else await jsonResponse(res, backend, body, config, controller.signal)
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error('[provider] shim request failed:', err)
          const message = String(err instanceof Error ? err.message : err)
          // The backend's real status matters to the CLI: 429/5xx are
          // retried with backoff, 400s are surfaced immediately. Unknown
          // failures stay 500 so the retry logic gets a chance.
          const status = (err as { status?: number }).status ?? 500
          const retryIn = /retry in ([0-9.]+)s/i.exec(message)?.[1]
          sendError(res, status, message, retryIn ? { 'retry-after': String(Math.ceil(Number(retryIn))) } : {})
        } else {
          res.destroy()
        }
      }
    })()
  })
  return new Promise((resolve, reject) => {
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('shim listen failed'))
        return
      }
      resolve({ port: addr.port, secret, close: () => server.close() })
    })
  })
}

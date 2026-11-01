import { Agent, fetch as undiciFetch } from 'undici'

// fetch() for LLM backends. Undici's defaults assume web-service latencies —
// 300s to first header — but a local model can legitimately sit longer than
// that evaluating a large prompt (or queued behind another request) before
// its first byte. Timeouts are disabled here; cancellation still works
// through each request's AbortSignal, and connect failures still surface
// quickly via the connect timeout. undici's own fetch is used because a
// dispatcher must belong to the same undici instance as the fetch it rides.
const llmAgent = new Agent({
  headersTimeout: 0,
  bodyTimeout: 0,
  connectTimeout: 10_000
})

export function llmFetch(url: string, init: RequestInit): Promise<Response> {
  return undiciFetch(url, { ...init, dispatcher: llmAgent } as never) as unknown as Promise<Response>
}

import { REPO_ROOT } from '../paths'
import { mapMessage } from '../agent/eventMap'

type GlassdoorResult = { rating: number | null; url: string | null; reviewCount: number | null }

const TIMEOUT_MS = 60_000
const EMPTY: GlassdoorResult = { rating: null, url: null, reviewCount: null }

function buildPrompt(company: string): string {
  return [
    `Use web search to find the Glassdoor OVERALL company rating for "${company}" — the`,
    'single aggregate rating shown on the company\'s Glassdoor overview page (a number',
    'from 1.0 to 5.0), NOT the rating for any single role/job title. Also find the URL of',
    'that company\'s Glassdoor company overview page, and the number of reviews the',
    'rating is based on, if shown.',
    '',
    'Only report a field if you are confident you found the real value. If you cannot',
    'confidently find something, use null for it. Do not guess or estimate.',
    '',
    'Reply with ONLY a JSON object as the final line of your response (no other text',
    'after it), in exactly this shape:',
    '{"rating": <number 1-5 or null>, "url": <string or null>, "reviewCount": <integer or null>}'
  ].join('\n')
}

/** Find the last top-level balanced {...} block in `text` and parse it as JSON. */
function extractLastJsonObject(text: string): Record<string, unknown> | null {
  let lastMatch: string | null = null
  let depth = 0
  let start = -1
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '{') {
      if (depth === 0) start = i
      depth++
    } else if (ch === '}') {
      if (depth > 0) {
        depth--
        if (depth === 0 && start >= 0) lastMatch = text.slice(start, i + 1)
      }
    }
  }
  if (!lastMatch) return null
  try {
    const parsed = JSON.parse(lastMatch)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function coerceRating(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(5, Math.max(0, v)) : null
}

function coerceUrl(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function coerceReviewCount(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  const n = Math.trunc(v)
  return n >= 0 ? n : null
}

/** Run the SDK query and return the concatenated complete assistant text. */
async function runLookup(company: string, model?: string): Promise<string> {
  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  const q = query({
    prompt: buildPrompt(company),
    options: {
      cwd: REPO_ROOT,
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      settingSources: [],
      permissionMode: 'bypassPermissions',
      maxTurns: 6,
      env: { ...process.env } as Record<string, string>,
      ...(model ? { model } : {})
    }
  })

  let text = ''
  for await (const msg of q) {
    const mapped = mapMessage(msg)
    for (const e of mapped.events) {
      if (e.kind === 'text' && e.complete) text += e.text
    }
  }
  return text
}

/**
 * Look up a company's Glassdoor overall rating via the Claude Agent SDK.
 * Best-effort and NEVER throws — any error, timeout, or parse failure
 * resolves to all-null fields so callers can treat this as "not found yet".
 */
export async function fetchGlassdoorRating(company: string, model?: string): Promise<GlassdoorResult> {
  try {
    const text = await Promise.race([
      runLookup(company, model),
      new Promise<string>((_resolve, reject) =>
        setTimeout(() => reject(new Error('glassdoor lookup timed out')), TIMEOUT_MS)
      )
    ])
    const obj = extractLastJsonObject(text)
    if (!obj) return EMPTY
    return {
      rating: coerceRating(obj.rating),
      url: coerceUrl(obj.url),
      reviewCount: coerceReviewCount(obj.reviewCount)
    }
  } catch (err) {
    console.error('[glassdoor] lookup failed:', err)
    return EMPTY
  }
}

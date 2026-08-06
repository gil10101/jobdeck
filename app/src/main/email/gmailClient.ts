import { GMAIL_API_403_HINT, getAccessToken } from './gmailAuth'

// Thin Gmail REST client over global fetch — no googleapis dependency. All
// calls are read-only (gmail.readonly scope) and hit gmail.googleapis.com
// directly with a bearer token from gmailAuth. Message ids come back from the
// API / renderer / agent tools, so they are validated before entering a URL.

const API = 'https://gmail.googleapis.com/gmail/v1/users/me'
/** Bodies can be huge (newsletters); cap what crosses IPC / reaches agents. */
const BODY_CHAR_CAP = 50_000

export interface GmailMessageMeta {
  id: string
  threadId: string
  from: string
  subject: string
  /** ISO timestamp from Gmail's internalDate (header Date is unreliable). */
  date: string
  snippet: string
}

function assertMessageId(id: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`invalid message id: ${id}`)
}

async function gmailGet<T>(pathAndQuery: string): Promise<T> {
  const token = await getAccessToken()
  const res = await fetch(`${API}${pathAndQuery}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (!res.ok) {
    if (res.status === 403) throw new Error(GMAIL_API_403_HINT)
    throw new Error(`Gmail API request failed (HTTP ${res.status} ${res.statusText})`)
  }
  return (await res.json()) as T
}

export async function getProfile(): Promise<{ emailAddress: string }> {
  const p = await gmailGet<{ emailAddress?: string }>('/profile')
  return { emailAddress: p.emailAddress ?? '' }
}

export async function listMessages(
  q: string,
  maxResults: number,
  pageToken?: string
): Promise<{ ids: { id: string; threadId: string }[]; nextPageToken: string | null }> {
  const params = new URLSearchParams({ q, maxResults: String(maxResults) })
  if (pageToken) params.set('pageToken', pageToken)
  const res = await gmailGet<{
    messages?: { id: string; threadId: string }[]
    nextPageToken?: string
  }>(`/messages?${params}`)
  return { ids: res.messages ?? [], nextPageToken: res.nextPageToken ?? null }
}

interface RawMessage {
  id: string
  threadId: string
  snippet?: string
  internalDate?: string
  payload?: RawPart
}

interface RawPart {
  mimeType?: string
  headers?: { name: string; value: string }[]
  body?: { data?: string; size?: number }
  parts?: RawPart[]
}

function header(msg: RawMessage, name: string): string {
  const h = msg.payload?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase())
  return h?.value ?? ''
}

export async function getMessageMeta(id: string): Promise<GmailMessageMeta> {
  assertMessageId(id)
  const msg = await gmailGet<RawMessage>(
    `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`
  )
  const internal = Number(msg.internalDate)
  return {
    id: msg.id,
    threadId: msg.threadId,
    from: header(msg, 'From'),
    subject: header(msg, 'Subject'),
    date: Number.isFinite(internal) && internal > 0 ? new Date(internal).toISOString() : new Date().toISOString(),
    snippet: msg.snippet ?? ''
  }
}

/** Gmail body data is base64url; tolerate standard base64 too. */
function decodeBody(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
}

/** Crude but dependency-free HTML → text for messages with no text/plain part. */
function htmlToText(html: string): string {
  return html
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote|table)>/gi, '\n')
    // Table cells: without a separator, adjacent cell texts concatenate.
    .replace(/<\/(td|th)>/gi, ' ')
    // Strip remaining tags to a SPACE, not '': adjacent inline elements
    // ("<span>Event Name</span><span>AI Interview</span>") would otherwise
    // concatenate; the whitespace collapse below eats the extras.
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/^[ \t]+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** True when a text/plain body is actually HTML — some mailers (ATS
 *  notification templates especially) put the full HTML document in the
 *  text/plain part, or send single-part text/plain that is really markup.
 *  High-precision signals first (document wrappers), then a count of
 *  block-level tags so HTML fragments without a wrapper still register while
 *  prose that merely mentions a tag or two does not. */
function looksLikeHtml(text: string): boolean {
  if (/<!doctype\s+html|<html[\s>]|<body[\s>]|<head[\s>]/i.test(text)) return true
  const tags = text.match(/<\/?(p|div|table|tbody|tr|td|span|br|a|strong|em|ul|ol|li|img|h[1-6])\b[^>]*>/gi)
  return (tags?.length ?? 0) >= 4
}

/** Depth-first hunt for the first part whose mime type passes `match`. */
function findPartBy(part: RawPart | undefined, match: (mimeType: string) => boolean): string | null {
  if (!part) return null
  if (part.mimeType && match(part.mimeType) && part.body?.data) return part.body.data
  for (const child of part.parts ?? []) {
    const hit = findPartBy(child, match)
    if (hit) return hit
  }
  return null
}

function findPart(part: RawPart | undefined, mimeType: string): string | null {
  return findPartBy(part, (mt) => mt === mimeType)
}

/** Body as plain text (text/plain part, else stripped text/html). A text/plain
 *  part that is secretly HTML gets stripped too, so the Email tab and the
 *  assistant's get_email never render raw markup. */
function extractText(msg: RawMessage): string {
  const plain = findPart(msg.payload, 'text/plain')
  if (plain) {
    const text = decodeBody(plain)
    return (looksLikeHtml(text) ? htmlToText(text) : text).slice(0, BODY_CHAR_CAP)
  }
  const html = findPart(msg.payload, 'text/html')
  if (html) return htmlToText(decodeBody(html)).slice(0, BODY_CHAR_CAP)
  return msg.snippet ?? ''
}

export async function getMessageBody(id: string): Promise<string> {
  assertMessageId(id)
  const msg = await gmailGet<RawMessage>(`/messages/${id}?format=full`)
  return extractText(msg)
}

/** One format=full fetch yielding body text plus the raw ICS payload (first
 *  text/calendar part at any depth; some mailers label it application/ics),
 *  so callers never pay for two round trips per message. */
export async function getMessageFull(id: string): Promise<{ text: string; ics: string | null }> {
  assertMessageId(id)
  const msg = await gmailGet<RawMessage>(`/messages/${id}?format=full`)
  const ics = findPartBy(
    msg.payload,
    (mt) => mt.toLowerCase().startsWith('text/calendar') || mt.toLowerCase() === 'application/ics'
  )
  return { text: extractText(msg), ics: ics ? decodeBody(ics) : null }
}

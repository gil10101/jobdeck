import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { EmailMessage } from '@shared/types'

// Header/snippet cache for synced Gmail messages, in the app-data dir (0600 —
// mail is personal and must never land in the workspace agents can read; the
// assistant reaches it only through its tools). Bodies are never stored.

const CACHE_CAP = 500

interface EmailCacheFile {
  messages: EmailMessage[]
  lastSyncAt: string | null
}

function cacheFile(): string {
  return path.join(app.getPath('userData'), 'email-cache.json')
}

let cache: EmailCacheFile | null = null

function load(): EmailCacheFile {
  if (cache) return cache
  try {
    const parsed = JSON.parse(fs.readFileSync(cacheFile(), 'utf-8')) as EmailCacheFile
    cache = {
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      lastSyncAt: parsed.lastSyncAt ?? null
    }
  } catch {
    cache = { messages: [], lastSyncAt: null }
  }
  return cache
}

function persist(): void {
  if (!cache) return
  const file = cacheFile()
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), { encoding: 'utf-8', mode: 0o600 })
  fs.renameSync(tmp, file)
}

export function lastSyncAt(): string | null {
  return load().lastSyncAt
}

/** Newest first; 'job' = only messages matched by the job-search query. */
export function listCachedMessages(filter: 'job' | 'all'): EmailMessage[] {
  const all = [...load().messages].sort((a, b) => b.date.localeCompare(a.date))
  return filter === 'job' ? all.filter((m) => m.jobRelated) : all
}

export function getCachedMessage(id: string): EmailMessage | null {
  return load().messages.find((m) => m.id === id) ?? null
}

/** Merge a sync batch by id and stamp lastSyncAt; keeps the newest CACHE_CAP. */
export function upsertMessages(msgs: EmailMessage[]): void {
  const store = load()
  const byId = new Map(store.messages.map((m) => [m.id, m]))
  for (const m of msgs) byId.set(m.id, m)
  store.messages = [...byId.values()]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, CACHE_CAP)
  store.lastSyncAt = new Date().toISOString()
  persist()
}

export function setSuggestionState(id: string, state: 'open' | 'applied' | 'dismissed'): EmailMessage {
  const msg = load().messages.find((m) => m.id === id)
  if (!msg) throw new Error(`email not in cache: ${id}`)
  msg.suggestionState = state
  persist()
  return msg
}

export function openSuggestionCount(): number {
  return load().messages.filter((m) => m.suggestion && m.suggestionState === 'open').length
}

/** Sign-out wipes the cache — cached mail must not outlive the account. */
export function clearEmailCache(): void {
  cache = { messages: [], lastSyncAt: null }
  try {
    fs.rmSync(cacheFile(), { force: true })
  } catch (err) {
    console.error('[email] cache delete failed:', err)
  }
}

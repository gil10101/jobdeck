import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AssistantConversation, AssistantMessage, ConversationMeta, AssistantUsage } from '@shared/types'
import { REPO_ROOT } from '../paths'

// Persists assistant conversations + a running memory note file under
// <workspace>/assistant/. Pure I/O — no agent logic. REPO_ROOT is a live
// binding set by initWorkspace(), so paths are recomputed per call rather
// than cached at module load.

function assistantDir(): string {
  return path.join(REPO_ROOT, 'assistant')
}

function conversationsDir(): string {
  return path.join(assistantDir(), 'conversations')
}

function conversationFile(id: string): string {
  // id is used as a filename — reject anything that could traverse out of the dir.
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`invalid conversation id: ${id}`)
  return path.join(conversationsDir(), `${id}.json`)
}

function memoryFile(): string {
  return path.join(assistantDir(), 'memory.md')
}

export function emptyUsage(): AssistantUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheTokens: 0,
    costUsd: 0,
    contextTokens: 0,
    contextWindow: 200000
  }
}

export function newConversation(): AssistantConversation {
  const now = new Date().toISOString()
  const messages: AssistantMessage[] = []
  return {
    id: randomUUID().slice(0, 8),
    title: 'New chat',
    createdAt: now,
    updatedAt: now,
    messages,
    usage: emptyUsage()
  }
}

/** Newest first by updatedAt; skips files that fail to read or parse. */
export function listConversations(): ConversationMeta[] {
  try {
    const dir = conversationsDir()
    return fs
      .readdirSync(dir)
      // row_* files are detail-chat threads owned by DetailChatManager; they
      // must never surface in the assistant panel's history (resuming one
      // there would rerun it without the folder jail).
      .filter((f) => f.endsWith('.json') && !f.startsWith('row_'))
      .map((f) => {
        try {
          const c = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as AssistantConversation
          return { id: c.id, title: c.title, updatedAt: c.updatedAt }
        } catch {
          return null
        }
      })
      .filter((m): m is ConversationMeta => !!m)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  } catch {
    return []
  }
}

export function loadConversation(id: string): AssistantConversation | null {
  try {
    return JSON.parse(fs.readFileSync(conversationFile(id), 'utf-8')) as AssistantConversation
  } catch {
    return null
  }
}

/** Atomic write (tmp + rename), mirroring profileStore.saveProfile. */
export function saveConversation(c: AssistantConversation): void {
  c.updatedAt = new Date().toISOString()
  fs.mkdirSync(conversationsDir(), { recursive: true })
  const file = conversationFile(c.id)
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(c, null, 2), 'utf-8')
  fs.renameSync(tmp, file)
}

export function deleteConversation(id: string): void {
  fs.rmSync(conversationFile(id), { force: true })
}

export function readMemory(): string {
  try {
    return fs.readFileSync(memoryFile(), 'utf-8')
  } catch {
    return ''
  }
}

export function appendMemory(note: string): void {
  // memory.md is fed back into future sessions, and the note can originate from
  // model output over untrusted posting text — collapse newlines so one note
  // can't forge extra memory lines, and cap runaway length.
  const clean = note.replace(/\s+/g, ' ').trim().slice(0, 500)
  if (!clean) return
  fs.mkdirSync(assistantDir(), { recursive: true })
  fs.appendFileSync(memoryFile(), `- ${clean}\n`, 'utf-8')
}

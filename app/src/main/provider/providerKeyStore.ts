import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

// Provider API keys at rest (Gemini; optional Ollama cloud key): encrypted
// with the OS keychain via safeStorage in the app-data dir — same posture as
// board credentials (never the workspace, never plaintext). Decrypted only in
// the main process, only at the moment a backend request is built; agent
// subprocesses receive the shim's per-launch secret instead, never these.

interface StoredKey {
  keyEnc: string // base64; ciphertext when `encrypted`, plain bytes otherwise
  encrypted: boolean
}

type KeyName = 'gemini' | 'ollama'

type KeyFile = Partial<Record<KeyName, StoredKey>>

function keyFile(): string {
  return path.join(app.getPath('userData'), 'provider-creds.json')
}

function readAll(): KeyFile {
  try {
    return JSON.parse(fs.readFileSync(keyFile(), 'utf-8')) as KeyFile
  } catch {
    return {}
  }
}

function writeAll(all: KeyFile): void {
  const file = keyFile()
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2), { encoding: 'utf-8', mode: 0o600 })
  fs.renameSync(tmp, file)
}

function setKey(name: KeyName, key: string): void {
  const encrypted = safeStorage.isEncryptionAvailable()
  const keyEnc = encrypted
    ? safeStorage.encryptString(key.trim()).toString('base64')
    : Buffer.from(key.trim(), 'utf-8').toString('base64')
  const all = readAll()
  all[name] = { keyEnc, encrypted }
  writeAll(all)
}

function clearKey(name: KeyName): void {
  const all = readAll()
  delete all[name]
  writeAll(all)
}

function getKey(name: KeyName): string | null {
  const stored = readAll()[name]
  if (!stored) return null
  try {
    const buf = Buffer.from(stored.keyEnc, 'base64')
    return stored.encrypted ? safeStorage.decryptString(buf) : buf.toString('utf-8')
  } catch (err) {
    console.error(`[provider] failed to decrypt ${name} key:`, err)
    return null
  }
}

export function setGeminiKey(key: string): void {
  setKey('gemini', key)
}
export function clearGeminiKey(): void {
  clearKey('gemini')
}
export function geminiKeySet(): boolean {
  return readAll().gemini !== undefined
}
export function geminiKey(): string | null {
  return getKey('gemini')
}

export function setOllamaKey(key: string): void {
  setKey('ollama', key)
}
export function clearOllamaKey(): void {
  clearKey('ollama')
}
export function ollamaKeySet(): boolean {
  return readAll().ollama !== undefined
}
export function ollamaKey(): string | null {
  return getKey('ollama')
}

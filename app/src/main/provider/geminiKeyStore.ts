import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

// Gemini API key at rest: encrypted with the OS keychain via safeStorage in
// the app-data dir — same posture as board credentials (never the workspace,
// never plaintext). Decrypted only in the main process, only at the moment a
// backend request is built; agent subprocesses receive the shim's per-launch
// secret instead, never this key.

interface StoredKey {
  keyEnc: string // base64; ciphertext when `encrypted`, plain bytes otherwise
  encrypted: boolean
}

function keyFile(): string {
  return path.join(app.getPath('userData'), 'provider-creds.json')
}

function readStored(): StoredKey | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(keyFile(), 'utf-8')) as { gemini?: StoredKey }
    return parsed.gemini ?? null
  } catch {
    return null
  }
}

export function setGeminiKey(key: string): void {
  const encrypted = safeStorage.isEncryptionAvailable()
  const keyEnc = encrypted
    ? safeStorage.encryptString(key.trim()).toString('base64')
    : Buffer.from(key.trim(), 'utf-8').toString('base64')
  const file = keyFile()
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify({ gemini: { keyEnc, encrypted } }, null, 2), {
    encoding: 'utf-8',
    mode: 0o600
  })
  fs.renameSync(tmp, file)
}

export function clearGeminiKey(): void {
  fs.rmSync(keyFile(), { force: true })
}

export function geminiKeySet(): boolean {
  return readStored() !== null
}

export function geminiKey(): string | null {
  const stored = readStored()
  if (!stored) return null
  try {
    const buf = Buffer.from(stored.keyEnc, 'base64')
    return stored.encrypted ? safeStorage.decryptString(buf) : buf.toString('utf-8')
  } catch (err) {
    console.error('[provider] failed to decrypt Gemini key:', err)
    return null
  }
}

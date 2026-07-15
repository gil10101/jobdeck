import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

// Board credentials at rest: password encrypted with the OS keychain via
// Electron safeStorage, stored in the app-data dir — never in the workspace,
// never in plaintext on disk. Decrypted only at the moment a CLI process is
// spawned, and handed over as env vars (JOBRIGHT_EMAIL / JOBRIGHT_PASSWORD),
// which the CLI checks before any credentials file.

interface StoredCred {
  email: string
  passwordEnc: string // base64; ciphertext when `encrypted`, plain bytes otherwise
  encrypted: boolean
}

interface CredFile {
  jobright?: StoredCred
}

function credFile(): string {
  return path.join(app.getPath('userData'), 'board-creds.json')
}

function readAll(): CredFile {
  try {
    return JSON.parse(fs.readFileSync(credFile(), 'utf-8')) as CredFile
  } catch {
    return {}
  }
}

function writeAll(all: CredFile): void {
  const file = credFile()
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2), { encoding: 'utf-8', mode: 0o600 })
  fs.renameSync(tmp, file)
}

export function setJobrightCred(email: string, password: string): void {
  // Without an OS keyring (some Linux setups) safeStorage can't encrypt; the
  // base64 fallback is obfuscation only, but still beats a workspace file the
  // agents can read.
  const encrypted = safeStorage.isEncryptionAvailable()
  const passwordEnc = encrypted
    ? safeStorage.encryptString(password).toString('base64')
    : Buffer.from(password, 'utf-8').toString('base64')
  const all = readAll()
  all.jobright = { email: email.trim(), passwordEnc, encrypted }
  writeAll(all)
}

export function jobrightCredEmail(): string | null {
  return readAll().jobright?.email ?? null
}

/** Decrypted env for spawning a process that talks to jobright; {} when unset. */
export function jobrightEnv(): Record<string, string> {
  const cred = readAll().jobright
  if (!cred) return {}
  try {
    const buf = Buffer.from(cred.passwordEnc, 'base64')
    const password = cred.encrypted ? safeStorage.decryptString(buf) : buf.toString('utf-8')
    return { JOBRIGHT_EMAIL: cred.email, JOBRIGHT_PASSWORD: password }
  } catch (err) {
    console.error('[boards] failed to decrypt jobright credentials:', err)
    return {}
  }
}

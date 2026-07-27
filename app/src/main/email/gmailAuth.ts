import { app, safeStorage, shell } from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import type { AddressInfo } from 'node:net'

// Gmail OAuth for a BYO Desktop-type client: PKCE loopback flow, no client
// secret (Desktop client IDs are public identifiers). The refresh token is the
// only secret here — encrypted with the OS keychain via safeStorage and kept
// in the app-data dir (0600), never in the workspace, never logged. Scope is
// read-only; the app can never send or modify mail.

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const PROFILE_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/profile'
/** The consent page is human-paced; abandon the loopback server after this. */
const FLOW_TIMEOUT_MS = 2 * 60_000

interface GmailAuthFile {
  clientId?: string
  email?: string
  /** base64; ciphertext when `encrypted`, plain bytes otherwise (no-keyring fallback). */
  refreshTokenEnc?: string
  encrypted?: boolean
}

function authFile(): string {
  return path.join(app.getPath('userData'), 'gmail-auth.json')
}

function readAuth(): GmailAuthFile {
  try {
    return JSON.parse(fs.readFileSync(authFile(), 'utf-8')) as GmailAuthFile
  } catch {
    return {}
  }
}

function writeAuth(data: GmailAuthFile): void {
  const file = authFile()
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 })
  fs.renameSync(tmp, file)
}

function encryptToken(token: string): { enc: string; encrypted: boolean } {
  // Without an OS keyring safeStorage can't encrypt; base64 is obfuscation
  // only, but still beats a plaintext token in a file agents could be pointed at.
  if (safeStorage.isEncryptionAvailable()) {
    return { enc: safeStorage.encryptString(token).toString('base64'), encrypted: true }
  }
  return { enc: Buffer.from(token, 'utf-8').toString('base64'), encrypted: false }
}

function decryptToken(data: GmailAuthFile): string | null {
  if (!data.refreshTokenEnc) return null
  try {
    const buf = Buffer.from(data.refreshTokenEnc, 'base64')
    return data.encrypted ? safeStorage.decryptString(buf) : buf.toString('utf-8')
  } catch (err) {
    console.error('[email] failed to decrypt the stored refresh token:', err)
    return null
  }
}

// Short-lived access token cached in memory only.
let accessCache: { token: string; expiresAt: number } | null = null
let flowActive = false

export function gmailClientId(): string | null {
  return readAuth().clientId ?? null
}

export function gmailEmail(): string | null {
  return readAuth().email ?? null
}

/** Signed in: a client ID is saved and a refresh token is stored. */
export function gmailConfigured(): boolean {
  const data = readAuth()
  return !!data.clientId && !!data.refreshTokenEnc
}

export function setGmailClientId(clientId: string): void {
  const trimmed = clientId.trim()
  const data = readAuth()
  // Tokens are minted per client — switching IDs invalidates them.
  if (data.clientId && data.clientId !== trimmed) {
    delete data.refreshTokenEnc
    delete data.encrypted
    delete data.email
    accessCache = null
  }
  if (trimmed) data.clientId = trimmed
  else delete data.clientId
  writeAuth(data)
}

/** Drop stored tokens (keeps the client ID) and best-effort revoke with Google. */
export function gmailSignOut(): void {
  const data = readAuth()
  const refreshToken = decryptToken(data)
  if (refreshToken) {
    void fetch(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshToken })
    }).catch(() => undefined)
  }
  delete data.refreshTokenEnc
  delete data.encrypted
  delete data.email
  writeAuth(data)
  accessCache = null
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** One-shot loopback server: resolves with the auth code from the first
 *  request that carries ?code/?error (browsers also ask for /favicon.ico). */
function waitForRedirect(server: http.Server): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('sign-in timed out — the consent page was not completed within 2 minutes'))
    }, FLOW_TIMEOUT_MS)
    timeout.unref()
    server.on('request', (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const code = url.searchParams.get('code')
      const error = url.searchParams.get('error')
      if (!code && !error) {
        res.writeHead(404).end()
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(
        code
          ? '<html><body style="font-family:sans-serif">Sign-in complete. You can close this tab and return to the app.</body></html>'
          : '<html><body style="font-family:sans-serif">Sign-in was not completed. Return to the app and try again.</body></html>'
      )
      clearTimeout(timeout)
      if (code) resolve(code)
      else reject(new Error(`sign-in refused: ${(error ?? 'unknown').replace(/[^a-z0-9_ -]/gi, '')}`))
    })
  })
}

async function tokenRequest(params: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params)
  })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    // Google's error field is a short code (e.g. invalid_grant) — safe to surface.
    const code = typeof body.error === 'string' ? body.error : `HTTP ${res.status}`
    throw new Error(`Google token endpoint refused the request: ${code}`)
  }
  return body
}

/** Run the full PKCE consent flow in the default browser; stores the refresh
 *  token (encrypted) and the account email. Rejects on timeout/denial. */
export async function gmailSignIn(): Promise<{ email: string }> {
  const clientId = gmailClientId()
  if (!clientId) throw new Error('save a Google OAuth client ID first (Settings → Email)')
  if (flowActive) throw new Error('a Gmail sign-in is already in progress — finish it in the browser')
  flowActive = true

  // Loopback binds 127.0.0.1 only: no LAN exposure, no macOS firewall prompt.
  const server = http.createServer()
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const port = (server.address() as AddressInfo).port
    const redirectUri = `http://127.0.0.1:${port}`

    const verifier = base64url(randomBytes(32))
    const challenge = base64url(createHash('sha256').update(verifier).digest())
    const consent = new URL(AUTH_URL)
    consent.searchParams.set('client_id', clientId)
    consent.searchParams.set('redirect_uri', redirectUri)
    consent.searchParams.set('response_type', 'code')
    consent.searchParams.set('scope', SCOPE)
    consent.searchParams.set('code_challenge', challenge)
    consent.searchParams.set('code_challenge_method', 'S256')
    consent.searchParams.set('access_type', 'offline')
    consent.searchParams.set('prompt', 'consent')

    const redirect = waitForRedirect(server)
    // Observe the redirect promise up front: if openExternal throws first, the
    // later timeout rejection must not surface as an unhandled rejection.
    redirect.catch(() => undefined)
    await shell.openExternal(consent.toString())
    const code = await redirect

    const tokens = await tokenRequest({
      client_id: clientId,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri
    })
    const accessToken = typeof tokens.access_token === 'string' ? tokens.access_token : null
    const refreshToken = typeof tokens.refresh_token === 'string' ? tokens.refresh_token : null
    if (!accessToken || !refreshToken) {
      throw new Error('Google returned no refresh token — remove the app under myaccount.google.com/permissions and sign in again')
    }

    const profileRes = await fetch(PROFILE_URL, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    if (!profileRes.ok) throw new Error(`could not read the Gmail profile (HTTP ${profileRes.status})`)
    const profile = (await profileRes.json()) as { emailAddress?: string }
    const email = profile.emailAddress ?? ''

    const { enc, encrypted } = encryptToken(refreshToken)
    writeAuth({ clientId, email, refreshTokenEnc: enc, encrypted })
    const expiresIn = typeof tokens.expires_in === 'number' ? tokens.expires_in : 3600
    accessCache = { token: accessToken, expiresAt: Date.now() + expiresIn * 1000 }
    return { email }
  } finally {
    flowActive = false
    server.close()
  }
}

/** Valid access token, refreshing via the stored refresh token when needed. */
export async function getAccessToken(): Promise<string> {
  // 60s slack so a token can't expire mid-request.
  if (accessCache && Date.now() < accessCache.expiresAt - 60_000) return accessCache.token
  const data = readAuth()
  const refreshToken = decryptToken(data)
  if (!data.clientId || !refreshToken) {
    throw new Error('Gmail is not connected — sign in from Settings → Email')
  }
  let tokens: Record<string, unknown>
  try {
    tokens = await tokenRequest({
      client_id: data.clientId,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  } catch (err) {
    // invalid_grant = the refresh token was revoked/expired; force a re-sign-in
    // rather than failing every future call.
    if (String(err).includes('invalid_grant')) {
      gmailSignOut()
      throw new Error('the Gmail session expired or was revoked — sign in again from Settings → Email')
    }
    throw err
  }
  const accessToken = typeof tokens.access_token === 'string' ? tokens.access_token : null
  if (!accessToken) throw new Error('Google returned no access token on refresh')
  const expiresIn = typeof tokens.expires_in === 'number' ? tokens.expires_in : 3600
  accessCache = { token: accessToken, expiresAt: Date.now() + expiresIn * 1000 }
  return accessToken
}

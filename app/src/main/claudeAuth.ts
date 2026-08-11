// Detection of the credential a Claude Code agent run would actually use.
// Shared by the onboarding preflight (coreIpc) and the agent env builder
// (provider/providerRuntime) so both judge "is this machine signed in?" the
// same way.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** ~/.claude.json reaches tens of megabytes for heavy users (it accumulates
 *  per-project history), and this runs on every preflight, so the file is
 *  streamed rather than read whole. JSON key order follows insertion, so the
 *  account block is NOT reliably near the front — scanning only a head would
 *  report "signed out" to precisely the users whose file is large. */
const SCAN_CHUNK_BYTES = 64 * 1024

/** Whether `file` contains `needle`, scanned in fixed-size chunks so memory
 *  stays bounded while coverage is not. Consecutive chunks overlap by
 *  needle.length - 1 bytes, or a match straddling a chunk boundary would be
 *  missed. Returns false for an unreadable or absent file. */
async function fileContains(file: string, needle: string): Promise<boolean> {
  const pattern = Buffer.from(needle)
  const overlap = pattern.length - 1
  let handle: fs.promises.FileHandle | null = null
  try {
    handle = await fs.promises.open(file, 'r')
    const buf = Buffer.alloc(SCAN_CHUNK_BYTES + overlap)
    let carried = 0
    let position = 0
    for (;;) {
      const { bytesRead } = await handle.read(buf, carried, SCAN_CHUNK_BYTES, position)
      if (bytesRead === 0) return false
      const filled = carried + bytesRead
      if (buf.subarray(0, filled).includes(pattern)) return true
      position += bytesRead
      // Carry the tail forward so the next window can complete a split match.
      carried = Math.min(overlap, filled)
      buf.copy(buf, 0, filled - carried, filled)
    }
  } catch {
    return false
  } finally {
    await handle?.close()
  }
}

/**
 * Best-effort evidence of a Claude Code SUBSCRIPTION sign-in — the signal
 * found, or null. Credentials live in the OS keychain on macOS, so absence of
 * every signal means "unconfirmed", never "definitely signed out": callers
 * must not claim more. ANTHROPIC_API_KEY is deliberately NOT a signal here —
 * it is a credential, but not a subscription one, and providerEnv needs the
 * two kept apart to decide which of them a run should use.
 */
export async function claudeSignInSignal(): Promise<string | null> {
  if (process.env.ANTHROPIC_AUTH_TOKEN) return 'ANTHROPIC_AUTH_TOKEN is set in the environment'
  const home = os.homedir()
  const credentials = path.join(home, '.claude', '.credentials.json')
  if (fs.existsSync(credentials)) return credentials
  const claudeJson = path.join(home, '.claude.json')
  if (await fileContains(claudeJson, '"oauthAccount"')) return `a signed-in account in ${claudeJson}`
  return null
}

/**
 * Evidence of ANY credential an agent run could use: the subscription sign-in
 * above, or a bare ANTHROPIC_API_KEY. The CLI authenticates with an API key
 * when one is present, so a key-only machine is configured, not unconfigured —
 * the preflight must not tell that user they are signed out.
 */
export async function claudeCredentialSignal(): Promise<string | null> {
  return (
    (await claudeSignInSignal()) ??
    (process.env.ANTHROPIC_API_KEY ? 'ANTHROPIC_API_KEY is set in the environment' : null)
  )
}

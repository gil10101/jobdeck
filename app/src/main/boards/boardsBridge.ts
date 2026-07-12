import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { BUN_EXE, REPO_ROOT } from '../paths'

const execFileAsync = promisify(execFile)

const JOBRIGHT_SKILL_DIR = path.join(REPO_ROOT, '.agents', 'skills', 'jobright-search')
const CREDS_FILE = path.join(JOBRIGHT_SKILL_DIR, 'credentials.json')
const SESSION_FILE = path.join(JOBRIGHT_SKILL_DIR, '.session.json')
const JOBRIGHT_CLI = path.join(JOBRIGHT_SKILL_DIR, 'cli', 'src', 'cli.ts')

export function getBoardsStatus(): { jobright: { configured: boolean; email: string | null } } {
  try {
    if (fs.existsSync(CREDS_FILE)) {
      const creds = JSON.parse(fs.readFileSync(CREDS_FILE, 'utf-8')) as { email?: string }
      return { jobright: { configured: !!creds.email, email: creds.email ?? null } }
    }
  } catch {
    /* fall through */
  }
  return { jobright: { configured: false, email: null } }
}

/** Write jobright credentials (gitignored file) and clear the cached session. */
export function setJobrightCreds(email: string, password: string): void {
  if (!email.trim() || !password) throw new Error('email and password are required')
  fs.mkdirSync(JOBRIGHT_SKILL_DIR, { recursive: true })
  fs.writeFileSync(CREDS_FILE, JSON.stringify({ email: email.trim(), password }, null, 2), 'utf-8')
  try {
    fs.unlinkSync(SESSION_FILE) // force fresh login with the new creds
  } catch {
    /* ignore */
  }
}

/** Live login test: fetch 1 recommendation through the CLI. */
export async function testJobright(): Promise<{ ok: boolean; message: string }> {
  if (!fs.existsSync(BUN_EXE)) return { ok: false, message: `bun not found at ${BUN_EXE}` }
  if (!fs.existsSync(JOBRIGHT_CLI)) return { ok: false, message: 'jobright CLI not found' }
  try {
    const { stdout } = await execFileAsync(
      BUN_EXE,
      ['run', JOBRIGHT_CLI, 'recommend', '-n', '1', '--format', 'json'],
      { cwd: REPO_ROOT, timeout: 45_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }
    )
    const parsed = JSON.parse(stdout) as { results?: unknown[]; meta?: { fetched?: number } }
    const n = parsed.results?.length ?? 0
    return {
      ok: true,
      message: `Connected — jobright returned ${n} recommendation${n === 1 ? '' : 's'}`
    }
  } catch (err) {
    const e = err as { stderr?: string; message?: string }
    return { ok: false, message: (e.stderr || e.message || String(err)).slice(0, 400) }
  }
}

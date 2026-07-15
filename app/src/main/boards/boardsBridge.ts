import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import type { BoardId, BoardsStatus } from '@shared/types'
import { APP_DIR, REPO_ROOT, resolveBun } from '../paths'
import { jobrightCredEmail, jobrightEnv, setJobrightCred } from './credStore'

const execFileAsync = promisify(execFile)

// The job-board search CLIs are small bun scripts living in the WORKSPACE at
// .agents/skills/<board>-search (agent runs execute them there). The app ships
// pristine copies under its own resources/skills, so a fresh workspace can be
// scaffolded — and a broken install repaired — without any external download.

export const BOARD_IDS: BoardId[] = ['jobright', 'linkedin', 'freehire']

function skillDirName(board: BoardId): string {
  return `${board}-search`
}

function workspaceSkillDir(board: BoardId, root: string = REPO_ROOT): string {
  return path.join(root, '.agents', 'skills', skillDirName(board))
}

function bundledSkillDir(board: BoardId): string {
  return path.join(APP_DIR, 'resources', 'skills', skillDirName(board))
}

function cliEntrypoint(board: BoardId, root: string = REPO_ROOT): string {
  return path.join(workspaceSkillDir(board, root), 'cli', 'src', 'cli.ts')
}

// REPO_ROOT is a live binding set by initWorkspace(), so these paths are
// computed per call rather than cached at module load.
function legacyCredsFile(): string {
  return path.join(workspaceSkillDir('jobright'), 'credentials.json')
}

function sessionFile(): string {
  return path.join(workspaceSkillDir('jobright'), '.session.json')
}

/** One-way migration: a plaintext credentials.json left in the workspace by an
 *  older version is absorbed into the encrypted store and deleted. */
function migrateLegacyCreds(): void {
  try {
    const file = legacyCredsFile()
    if (!fs.existsSync(file)) return
    const creds = JSON.parse(fs.readFileSync(file, 'utf-8')) as { email?: string; password?: string }
    if (creds.email && creds.password) setJobrightCred(creds.email, creds.password)
    fs.rmSync(file, { force: true })
  } catch {
    /* leave the file for manual cleanup rather than losing it */
  }
}

function jobrightCreds(): { configured: boolean; email: string | null } {
  migrateLegacyCreds()
  const email = jobrightCredEmail()
  return { configured: !!email, email }
}

export function getBoardsStatus(): BoardsStatus {
  const bunPath = resolveBun()
  // resolveBun falls back to the bare command name when no known location
  // exists; only an absolute hit counts as "found".
  const bunOk = path.isAbsolute(bunPath) && fs.existsSync(bunPath)
  return {
    bunOk,
    bunPath,
    boards: BOARD_IDS.map((id) => {
      const creds = id === 'jobright' ? jobrightCreds() : { configured: null, email: null }
      return {
        id,
        installed: fs.existsSync(cliEntrypoint(id)),
        path: path.join('.agents', 'skills', skillDirName(id)),
        configured: creds.configured,
        email: creds.email
      }
    })
  }
}

/** Copy the bundled CLI into the workspace. Merges over an existing install
 *  (repair/update) without touching credentials or cached sessions. */
export function installBoard(board: BoardId, root: string = REPO_ROOT): BoardsStatus {
  const src = bundledSkillDir(board)
  if (!fs.existsSync(path.join(src, 'cli', 'src', 'cli.ts'))) {
    throw new Error(`bundled CLI missing for board: ${board}`)
  }
  fs.cpSync(src, workspaceSkillDir(board, root), { recursive: true, force: true })
  return getBoardsStatus()
}

/** Best-effort scaffold of every board CLI into a (new) workspace. */
export function installAllBoards(root: string): void {
  for (const id of BOARD_IDS) {
    try {
      installBoard(id, root)
    } catch (err) {
      console.error(`[boards] failed to scaffold ${id}:`, err)
    }
  }
}

/** Human-readable availability line for the scout prompt; null when everything is usable. */
export function boardsAvailabilityNote(): string | null {
  const status = getBoardsStatus()
  if (!status.bunOk) {
    return 'NONE of the board CLIs can run: the bun runtime is not installed. Skip STEP 2 entirely and tell the user to install bun (https://bun.sh) and the board CLIs from Settings → Job boards.'
  }
  const missing = status.boards.filter((b) => !b.installed)
  if (missing.length === status.boards.length) {
    return 'NONE of the board CLIs are installed in this workspace. Skip STEP 2 and tell the user to install them from Settings → Job boards.'
  }
  const parts: string[] = []
  for (const b of missing) {
    parts.push(`The ${b.id} CLI is not installed — skip it (installable from Settings → Job boards).`)
  }
  const jr = status.boards.find((b) => b.id === 'jobright')
  if (jr?.installed && jr.configured === false) {
    parts.push(
      'jobright has no credentials configured — skip it and note that the user can add credentials in Settings → Job boards.'
    )
  }
  return parts.length ? parts.join(' ') : null
}

/** Throws a user-actionable error when a scout run cannot search anything. */
export function assertScoutable(): void {
  const status = getBoardsStatus()
  if (!status.bunOk) {
    throw new Error(
      'Cannot scout: the bun runtime (runs the job-board CLIs) was not found. Install it from Settings → Job boards (or bun.sh), then retry.'
    )
  }
  if (status.boards.every((b) => !b.installed)) {
    throw new Error(
      'Cannot scout: no job-board CLIs are installed in this workspace. Install them from Settings → Job boards, then retry.'
    )
  }
}

/** Run the official bun installer (bun.sh). The command is a fixed string —
 *  no caller-controlled input reaches the shell — and the installer targets
 *  ~/.bun, the first location resolveBun() probes. */
export async function installBun(): Promise<{ ok: boolean; message: string; status: BoardsStatus }> {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['powershell', ['-NoProfile', '-Command', 'irm bun.sh/install.ps1 | iex']]
      : ['/bin/bash', ['-c', 'curl -fsSL https://bun.sh/install | bash']]
  try {
    await execFileAsync(cmd, args, {
      timeout: 180_000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true
    })
  } catch (err) {
    const e = err as { stderr?: string; message?: string }
    return {
      ok: false,
      message: `bun installer failed: ${(e.stderr || e.message || String(err)).slice(0, 400)}`,
      status: getBoardsStatus()
    }
  }
  const status = getBoardsStatus()
  return status.bunOk
    ? { ok: true, message: `bun installed at ${status.bunPath}`, status }
    : {
        ok: false,
        message: 'The installer completed but bun was still not found — install manually from bun.sh.',
        status
      }
}

/** Store jobright credentials (encrypted, app-data) and clear the cached session. */
export function setJobrightCreds(email: string, password: string): void {
  if (!email.trim() || !password) throw new Error('email and password are required')
  setJobrightCred(email, password)
  // A plaintext file from an older version must not linger once the encrypted
  // store is authoritative.
  fs.rmSync(legacyCredsFile(), { force: true })
  try {
    fs.unlinkSync(sessionFile()) // force fresh login with the new creds
  } catch {
    /* ignore */
  }
}

/** Live login test: fetch 1 recommendation through the CLI. */
export async function testJobright(): Promise<{ ok: boolean; message: string }> {
  const cli = cliEntrypoint('jobright')
  if (!fs.existsSync(cli)) return { ok: false, message: 'jobright CLI not installed' }
  const bun = resolveBun()
  try {
    const { stdout } = await execFileAsync(
      bun,
      ['run', cli, 'recommend', '-n', '1', '--format', 'json'],
      {
        cwd: REPO_ROOT,
        timeout: 45_000,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
        // Credentials travel as env vars for this one process, decrypted here;
        // the CLI checks env before any credentials file.
        env: { ...process.env, ...jobrightEnv() }
      }
    )
    const parsed = JSON.parse(stdout) as { results?: unknown[]; meta?: { fetched?: number } }
    const n = parsed.results?.length ?? 0
    return {
      ok: true,
      message: `Connected — jobright returned ${n} recommendation${n === 1 ? '' : 's'}`
    }
  } catch (err) {
    const e = err as { code?: string; stderr?: string; message?: string }
    if (e.code === 'ENOENT') {
      return { ok: false, message: 'bun not found — install bun (https://bun.sh) or add it to PATH' }
    }
    return { ok: false, message: (e.stderr || e.message || String(err)).slice(0, 400) }
  }
}

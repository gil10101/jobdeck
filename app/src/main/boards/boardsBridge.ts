import { BrowserWindow, dialog } from 'electron'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import type { BoardId, BoardsStatus } from '@shared/types'
import { APP_DIR, REPO_ROOT, resolveBun } from '../paths'
import { validateProfile } from '../profile/profileSchema'
import { loadProfile, saveProfile } from '../profile/profileStore'
import { jobrightCredEmail, jobrightEnv, setJobrightCred } from './credStore'
import { listCustomBoards } from './customBoards'

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
  const boardsConfig = loadProfile()?.searchConfig.boards
  return {
    bunOk,
    bunPath,
    boards: BOARD_IDS.map((id) => {
      const creds = id === 'jobright' ? jobrightCreds() : { configured: null, email: null }
      return {
        id,
        enabled: boardsConfig?.[id]?.enabled ?? true,
        installed: fs.existsSync(cliEntrypoint(id)),
        path: path.join('.agents', 'skills', skillDirName(id)),
        configured: creds.configured,
        email: creds.email
      }
    })
  }
}

/** Flip a board's enabled flag in the profile search config. */
export function setBoardEnabled(board: BoardId, enabled: boolean): BoardsStatus {
  const profile = loadProfile()
  if (!profile) throw new Error('no candidate profile yet — run onboarding first')
  // Clone: loadProfile() returns the module cache by reference, and a
  // validation failure must not leave the flag flipped in the live object.
  const next = structuredClone(profile)
  next.searchConfig.boards[board].enabled = enabled
  const result = validateProfile(next)
  if (!result.ok) throw new Error(`profile invalid after toggling ${board}: ${result.problems.join('; ')}`)
  saveProfile(result.profile)
  return getBoardsStatus()
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

/** Human-readable availability line for the scout prompt; null when everything is usable.
 *  Covers the CLI boards only — custom company boards are prefetched per run,
 *  so their failures are appended by the prompt builder, not decided here. */
export function boardsAvailabilityNote(): string | null {
  const status = getBoardsStatus()
  if (!status.bunOk) {
    return 'NONE of the board CLIs can run: the bun runtime is not installed. Skip every CLI board (jobright, LinkedIn, freehire) and tell the user to install bun (https://bun.sh) and the board CLIs from Settings → Job boards; app-prefetched company-board files and WebSearch still work.'
  }
  const parts: string[] = []
  for (const b of status.boards) {
    if (!b.enabled) {
      parts.push(`The ${b.id} board is DISABLED in Settings — skip it entirely, without comment.`)
    } else if (!b.installed) {
      parts.push(`The ${b.id} CLI is not installed — skip it (installable from Settings → Job boards).`)
    }
  }
  const jr = status.boards.find((b) => b.id === 'jobright')
  if (jr?.enabled && jr.installed && jr.configured === false) {
    parts.push(
      'jobright has no credentials configured — skip it and note that the user can add credentials in Settings → Job boards.'
    )
  }
  if (status.boards.every((b) => !b.enabled || !b.installed)) {
    parts.push('With no board CLI usable, rely on the remaining STEP 2 sources (company boards when listed, WebSearch).')
  }
  return parts.length ? parts.join(' ') : null
}

/** Throws a user-actionable error when a scout run cannot search anything.
 *  Custom company boards need no bun/CLI, so any enabled one keeps scouting viable. */
export function assertScoutable(): void {
  const status = getBoardsStatus()
  const hasCustom = listCustomBoards().some((b) => b.enabled)
  if (!status.bunOk && !hasCustom) {
    throw new Error(
      'Cannot scout: the bun runtime (runs the job-board CLIs) was not found. Install it from Settings → Job boards (or bun.sh), then retry.'
    )
  }
  if (status.boards.every((b) => !b.installed) && !hasCustom) {
    throw new Error(
      'Cannot scout: no job-board CLIs are installed in this workspace. Install them from Settings → Job boards, then retry.'
    )
  }
}

/** The bun release this app installs. Pinned, not "latest": an unpinned
 *  installer means the bytes executed on the user's machine change without any
 *  change here. Bump deliberately. */
const BUN_VERSION = '1.3.14'
const BUN_INSTALLER_URL = 'https://bun.sh/install'

/** Exact command the installer runs, shown verbatim in the consent dialog so
 *  the user approves what actually executes. */
function bunInstallCommand(): [string, string[], string] {
  if (process.platform === 'win32') {
    const script = `iex "& {$(irm ${BUN_INSTALLER_URL}.ps1)} -Version ${BUN_VERSION}"`
    const args = ['-NoProfile', '-Command', script]
    return ['powershell', args, `powershell ${args.join(' ')}`]
  }
  const script = `curl -fsSL ${BUN_INSTALLER_URL} | bash -s "bun-v${BUN_VERSION}"`
  return ['/bin/bash', ['-c', script], script]
}

/**
 * Run the official bun installer (bun.sh) after explicit consent. Downloading a
 * script and executing it is the kind of thing an app must never do silently:
 * the dialog names the URL, the pinned version and the command, and declining
 * is the default button. The command itself is a fixed string — no
 * caller-controlled input reaches the shell — and the installer targets ~/.bun,
 * the first location resolveBun() probes.
 */
export async function installBun(): Promise<{ ok: boolean; message: string; status: BoardsStatus }> {
  const [cmd, args, shown] = bunInstallCommand()
  const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
  const options = {
    type: 'warning' as const,
    title: 'Install the bun runtime?',
    message: `Download and run the bun ${BUN_VERSION} installer from ${BUN_INSTALLER_URL}?`,
    detail: `This downloads a script from bun.sh and executes it with your user account. It installs bun into ~/.bun.\n\nCommand:\n${shown}\n\nOnly the job-board scout needs bun. You can install it yourself from https://bun.sh instead.`,
    buttons: ['Cancel', 'Download and run'],
    defaultId: 0,
    cancelId: 0
  }
  const choice = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options)
  if (choice.response !== 1) {
    return { ok: false, message: 'bun install cancelled', status: getBoardsStatus() }
  }
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
  // The feed cache belongs to the previous account — switching accounts must
  // never serve its personalized feed to the new one.
  fs.rmSync(path.join(workspaceSkillDir('jobright'), '.feed-cache.json'), { force: true })
}

/** Fetch the personalized jobright feed app-side and write it to `outFile`
 *  for the scout agent to Read. The agent then never invokes the jobright CLI
 *  at all: session bursts become structurally impossible, and credentials are
 *  decrypted only into this one app-spawned process (which also self-heals an
 *  expired session, since the CLI re-logs-in with env credentials). */
export async function prefetchJobrightFeed(
  outFile: string
): Promise<{ ok: boolean; count: number; message: string }> {
  const cli = cliEntrypoint('jobright')
  if (!fs.existsSync(cli)) return { ok: false, count: 0, message: 'jobright CLI not installed' }
  const env = jobrightEnv()
  if (!env.JOBRIGHT_EMAIL) return { ok: false, count: 0, message: 'no jobright credentials saved' }
  const board = loadProfile()?.searchConfig.boards.jobright
  if (board && board.enabled === false) {
    return { ok: false, count: 0, message: 'jobright disabled in the profile search config' }
  }
  const maxAge = loadProfile()?.searchConfig.timing.maxAgeDays ?? 14
  const args = [
    'run',
    cli,
    'recommend',
    '-n',
    String(Math.max(board?.limit ?? 0, 60)),
    '--maxage',
    String(maxAge),
    '--refresh',
    '--format',
    'json'
  ]
  if (board?.minSize) args.push('--min-size', String(board.minSize))
  try {
    const { stdout } = await execFileAsync(resolveBun(), args, {
      cwd: REPO_ROOT,
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
      env: { ...process.env, ...env }
    })
    const parsed = JSON.parse(stdout) as { results?: unknown[] }
    const count = parsed.results?.length ?? 0
    fs.mkdirSync(path.dirname(outFile), { recursive: true })
    fs.writeFileSync(
      outFile,
      JSON.stringify({ fetchedAt: new Date().toISOString(), ...parsed }, null, 2),
      'utf-8'
    )
    return { ok: true, count, message: `fetched ${count} jobs` }
  } catch (err) {
    const e = err as { stderr?: string; message?: string }
    return { ok: false, count: 0, message: (e.stderr || e.message || String(err)).slice(0, 400) }
  }
}

/** Mint/refresh the jobright session by running the CLI's `login` with
 *  credentials decrypted into that one process's env. Scout agents then run
 *  every call session-only — the password never enters an agent process. */
export async function refreshJobrightSession(): Promise<{ ok: boolean; message: string }> {
  const cli = cliEntrypoint('jobright')
  if (!fs.existsSync(cli)) return { ok: false, message: 'jobright CLI not installed' }
  const env = jobrightEnv()
  if (!env.JOBRIGHT_EMAIL) return { ok: false, message: 'no jobright credentials saved' }
  try {
    await execFileAsync(resolveBun(), ['run', cli, 'login'], {
      cwd: REPO_ROOT,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      env: { ...process.env, ...env }
    })
    return { ok: true, message: 'jobright session refreshed' }
  } catch (err) {
    const e = err as { stderr?: string; message?: string }
    return { ok: false, message: (e.stderr || e.message || String(err)).slice(0, 400) }
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

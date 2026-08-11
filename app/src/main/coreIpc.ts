import { BrowserWindow, app, dialog, ipcMain } from 'electron'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { EnvCheck, EnvPreflight, PrereqTool, ToolName } from '@shared/types'
import { configError, loadConfig, saveConfig } from './appConfig'
import { claudeCredentialSignal } from './claudeAuth'
import { installAllBoards } from './boards/boardsBridge'
import { normalizeToolOverride, resolveBun, resolveLatex, toolStatus } from './paths'
import { readManifest, verifyAndExtract } from './workspace/archive'

const requireFrom = createRequire(import.meta.url)

/**
 * Path of the Claude Code binary the Agent SDK spawns, or null when no native
 * package for this platform/arch is installed. The SDK resolves this package
 * itself and fails the run if it is absent — a `claude` on PATH is not a
 * substitute.
 */
function claudeRuntimePath(): string | null {
  // Linux ships both glibc and musl builds; either one satisfies the SDK.
  const suffixes = process.platform === 'linux' ? ['', '-musl'] : ['']
  for (const suffix of suffixes) {
    const pkg = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}${suffix}`
    try {
      return path.dirname(requireFrom.resolve(`${pkg}/package.json`))
    } catch {
      /* not installed for this platform/arch */
    }
  }
  return null
}

/** Host prerequisites, worst-first, so the onboarding preflight can show what
 *  is missing before the user triggers an agent run. */
async function checkPrereqs(): Promise<PrereqTool[]> {
  const runtime = claudeRuntimePath()
  const signal = await claudeCredentialSignal()
  const engine = resolveLatex()
  const bun = resolveBun()
  const tools: PrereqTool[] = [
    {
      id: 'claude',
      label: 'Claude Code agent runtime',
      ok: !!runtime,
      required: true,
      detail: runtime ?? `no build for ${process.platform}-${process.arch} in node_modules`,
      remedy: 'Run npm install in the app folder to fetch the Claude Code runtime for this platform.',
      url: 'https://docs.claude.com/en/docs/claude-code/overview'
    },
    {
      id: 'claudeAuth',
      label: 'Claude Code sign-in',
      ok: !!signal,
      required: true,
      detail: signal ?? 'none found for this user (a keychain-stored login cannot be seen from here)',
      remedy:
        'Run claude in a terminal and finish the login, export ANTHROPIC_API_KEY, or switch the model provider to Gemini/Ollama in Settings.',
      url: 'https://docs.claude.com/en/docs/claude-code/setup'
    },
    {
      id: 'latex',
      label: 'LaTeX engine',
      ok: !!engine,
      required: true,
      detail: engine ? `${engine.path} (${engine.kind})` : 'no pdflatex/xelatex/lualatex/tectonic found',
      remedy: 'Install tectonic (single binary) or a TeX distribution; a path override lives in Settings.',
      url: 'https://tectonic-typesetting.github.io'
    },
    {
      id: 'bun',
      label: 'bun runtime',
      // resolveBun() falls back to the bare command when nothing was found.
      ok: bun !== 'bun',
      required: false,
      detail: bun !== 'bun' ? bun : 'not found on PATH or in the usual install locations',
      remedy: 'Install bun (Settings has a one-click install); only job-board scout runs need it.',
      url: 'https://bun.sh'
    }
  ]
  const rank = (t: PrereqTool): number => (t.ok ? 2 : t.required ? 0 : 1)
  return [...tools].sort((a, b) => rank(a) - rank(b))
}

/** True when `child` is `parent` or sits underneath it. Case-insensitive where
 *  the filesystem is (macOS, Windows), so a case variant cannot slip through. */
function isWithin(parent: string, child: string): boolean {
  const fold = (s: string): string =>
    process.platform === 'linux' ? path.resolve(s) : path.resolve(s).toLowerCase()
  const rel = path.relative(fold(parent), fold(child))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** The repository root containing `dir` — `dir` itself or its nearest ancestor
 *  holding a .git entry — or null when no ancestor is a checkout. Walks up, so a
 *  path that merely sits inside a repository is still reported. */
function enclosingGitRoot(dir: string): string | null {
  let cur = path.resolve(dir)
  for (;;) {
    if (fs.existsSync(path.join(cur, '.git'))) return cur
    const parent = path.dirname(cur)
    if (parent === cur) return null
    cur = parent
  }
}

/** The git checkout the app runs from, or null when it runs outside one. */
function appCheckoutRoot(): string | null {
  return enclosingGitRoot(app.getAppPath())
}

const LEAK_WARNING =
  'A workspace holds profile.json and run transcripts with your real name, phone and email'

/**
 * A workspace inside a git checkout would commit personal data on the next
 * `git add`, so every entry point that adopts a directory screens it. The app
 * checkout and a directory that is itself a repository are refused outright;
 * an ancestor repository is a warning the user can accept, because refusing it
 * would strand anyone whose home directory is a repository. Throws with the
 * remedy; callers surface the message verbatim.
 */
async function assertUsableWorkspace(
  dir: string,
  win: BrowserWindow | null
): Promise<void> {
  const abs = path.resolve(dir)
  const checkout = appCheckoutRoot()
  if (checkout && (isWithin(checkout, abs) || isWithin(abs, checkout))) {
    throw new Error(
      `That folder overlaps the app checkout at ${checkout}. ${LEAK_WARNING}, so pick a folder outside the checkout — somewhere in your home directory works well.`
    )
  }
  const repo = enclosingGitRoot(abs)
  if (!repo) return
  if (repo === abs) {
    throw new Error(
      `That folder is a git repository. ${LEAK_WARNING}, so pick a folder that is not under version control.`
    )
  }
  // An ANCESTOR repository cannot be fatal: a dotfiles setup (`git init ~`)
  // puts every folder under the home directory inside one, and refusing them
  // all leaves first-run setup with nowhere to go. Warn, name the repository,
  // and let the user decide — the leak is real but theirs to accept.
  const { response } = await dialog.showMessageBox(win ?? new BrowserWindow({ show: false }), {
    type: 'warning',
    buttons: ['Choose a different folder', 'Use this folder anyway'],
    defaultId: 0,
    cancelId: 0,
    message: 'This folder is inside a git repository',
    detail: `${abs} sits inside the repository at ${repo}. ${LEAK_WARNING}, so committing that repository would publish them. Use this folder only if you are sure it is excluded from commits.`
  })
  if (response !== 1) {
    throw new Error('Workspace setup cancelled — pick a folder outside that repository.')
  }
}

/**
 * IPC that must work BEFORE a workspace exists (first-run/onboarding).
 * Workspace-dependent IPC lives in ipcRegistry.ts and is registered by
 * bootWorkspace() once a workspace is chosen.
 */
export function registerCoreIpc(deps: {
  getWindow: () => BrowserWindow | null
  completeSetup: (workspacePath: string) => Promise<void> | void
  /** Why the configured workspace failed to come up, else null. */
  bootError: () => string | null
  /** True only once a boot ran to completion — live services exist and are
   *  bound to the current root. A half-finished boot is false here even
   *  though workspaceReady() already flipped. */
  workspaceBooted: () => boolean
}): void {
  function envCheck(): EnvCheck {
    return {
      pdflatex: toolStatus('pdflatex'),
      pdftotext: toolStatus('pdftotext'),
      platform: process.platform,
      appVersion: app.getVersion()
    }
  }

  function handle(channel: string, fn: (req: never) => unknown): void {
    ipcMain.handle(channel, async (_event, req) => {
      try {
        return { ok: true, data: await fn(req as never) }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[ipc] ${channel} failed:`, message)
        return { ok: false, error: message }
      }
    })
  }

  handle('config:get', () => {
    const c = loadConfig()
    const failure = deps.bootError()
    // configError is part of the config:get contract and is non-null only when
    // config.json exists but could not be read — an unreadable config must be
    // visible in the UI instead of looking like a first run.
    return {
      // A workspace that failed to boot registered no workspace IPC, so it is
      // reported as absent: the renderer shows first-run recovery instead of an
      // app wired to channels that do not exist.
      workspacePath: failure ? null : c.workspacePath,
      onboardedAt: c.onboardedAt,
      bootError: failure,
      configError: configError()
    }
  })

  // Async on purpose: Settings, onboarding and every Re-check hit this, and
  // the sign-in probe reads a file that can be huge. Nothing here may block
  // the main process.
  // The explicit return type is the contract: EnvPreflight is what
  // IpcInvokeContract declares for this channel, so producer and consumer
  // cannot drift. The per-tool fields serve Settings; `tools` powers
  // onboarding's preflight.
  handle('env:check', async (): Promise<EnvPreflight> => ({
    ...envCheck(),
    tools: await checkPrereqs()
  }))

  // Manual overrides for the two external tools. Validation happens here, so a
  // path that cannot be executed is never persisted and never reaches a run.
  handle('env:setToolPath', ({ tool, path: input }: { tool: ToolName; path: string | null }) => {
    const value = normalizeToolOverride(input)
    saveConfig(tool === 'pdflatex' ? { pdflatexPath: value } : { pdftotextPath: value })
    return envCheck()
  })

  handle('workspace:choose', async (req: { title?: string }) => {
    const win = deps.getWindow()
    const result = await dialog.showOpenDialog(win ?? new BrowserWindow({ show: false }), {
      title: req?.title ?? 'Choose a folder',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return { path: null }
    await assertUsableWorkspace(result.filePaths[0], win)
    return { path: result.filePaths[0] }
  })

  handle('workspace:create', async ({ dir }: { dir: string }) => {
    if (!dir) throw new Error('no folder chosen')
    await assertUsableWorkspace(dir, deps.getWindow())
    fs.mkdirSync(dir, { recursive: true })
    // Scaffold the bundled job-board CLIs so scout runs work out of the box.
    installAllBoards(dir)
    saveConfig({ workspacePath: dir })
    await deps.completeSetup(dir)
    return { workspacePath: dir }
  })

  // Lives here (not ipcRegistry.ts) so onboarding's "Import an export" card
  // works before any workspace is configured.
  handle('workspace:import', async () => {
    const win = deps.getWindow() ?? new BrowserWindow({ show: false })
    const zipPick = await dialog.showOpenDialog(win, {
      title: 'Choose a workspace export',
      properties: ['openFile'],
      filters: [{ name: 'Workspace export', extensions: ['zip'] }]
    })
    const zipPath = zipPick.filePaths[0]
    if (zipPick.canceled || !zipPath) {
      return { imported: false, error: null, restartRequired: false, hasProfile: false }
    }
    // Manifest problems (wrong schema version, corrupt zip) surface as res.error.
    let hasProfile = false
    try {
      hasProfile = readManifest(zipPath).files.some((f) => f.path === 'profile.json')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { imported: false, error: message, restartRequired: false, hasProfile: false }
    }
    const destPick = await dialog.showOpenDialog(win, {
      title: 'Choose an empty destination folder for the imported workspace',
      properties: ['openDirectory', 'createDirectory']
    })
    const destDir = destPick.filePaths[0]
    if (destPick.canceled || !destDir) {
      return { imported: false, error: null, restartRequired: false, hasProfile: false }
    }
    try {
      await assertUsableWorkspace(destDir, win)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { imported: false, error: message, restartRequired: false, hasProfile: false }
    }
    try {
      verifyAndExtract(zipPath, destDir)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { imported: false, error: message, restartRequired: false, hasProfile: false }
    }
    const workspacePath = path.join(destDir, 'workspace')
    // Same config write onboarding's workspace:create uses.
    saveConfig({ workspacePath })
    if (deps.workspaceBooted()) {
      // Live services (store, watchers, runner) are bound to the old root and
      // cannot re-root at runtime — the import goes live on next launch.
      // Gated on the boot completing, not on workspaceReady(): a failed boot
      // also sets the paths, and the user importing to recover from it must
      // not be told to restart when the import can simply come up now.
      return { imported: true, error: null, restartRequired: true, hasProfile }
    }
    // First run (or a failed boot): no live services, so the import boots now.
    await deps.completeSetup(workspacePath)
    return { imported: true, error: null, restartRequired: false, hasProfile }
  })

  handle('onboarding:complete', () => {
    saveConfig({ onboardedAt: new Date().toISOString() })
  })

  handle('app:pickFile', async (req: { filters?: { name: string; extensions: string[] }[] }) => {
    const win = deps.getWindow()
    const result = await dialog.showOpenDialog(win ?? new BrowserWindow({ show: false }), {
      properties: ['openFile'],
      filters: req?.filters
    })
    return { path: result.canceled ? null : (result.filePaths[0] ?? null) }
  })
}

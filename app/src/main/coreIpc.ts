import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { EnvCheck, EnvPreflight, PrereqId, PrereqTool, ToolName } from '@shared/types'
import { configError, loadConfig, saveConfig } from './appConfig'
import { claudeCredentialSignal } from './claudeAuth'
import { installAllBoards } from './boards/boardsBridge'
import { REPO_ROOT, normalizeToolOverride, resolveBun, resolveLatex, toolStatus } from './paths'
import { prereqSpecsFor, scopeNoteFor, sortPrereqs } from './provider/prereqSpec'
import { geminiKeySet } from './provider/providerKeyStore'
import { currentProviderConfigOrNull, ollamaReachability } from './provider/providerRuntime'
import { readManifest, verifyAndExtract } from './workspace/archive'
import { classifyFolder, configPatchForSwitch, hasProfile as folderHasProfile, sameFolder } from './workspace/workspaceState'

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

/** What one prerequisite's live probe found. The static half (label, required,
 *  remedy, url) comes from prereqSpec.ts — this is only the host verdict. */
interface PrereqProbe {
  ok: boolean
  detail: string
}

/** Ollama's verdict: reachable server AND a usable model actually selected.
 *  Uses the same reachability probe provider:status shows in Settings. */
async function probeOllama(config: {
  ollamaUrl: string
  ollamaKey: string | null
  model: string
}): Promise<PrereqProbe> {
  const reach = await ollamaReachability(config.ollamaUrl, config.ollamaKey)
  if (!reach.reachable) return { ok: false, detail: `${config.ollamaUrl} — ${reach.message}` }
  if (!config.model) {
    return { ok: false, detail: `${config.ollamaUrl} — ${reach.message}, but no model is selected` }
  }
  // Tag match mirrors provider:test: a bare name selects its default tag.
  const installed = reach.models.some((m) => m === config.model || m.startsWith(`${config.model}:`))
  return installed
    ? { ok: true, detail: `${config.ollamaUrl} — ${config.model} installed and ready` }
    : {
        ok: false,
        detail: `${config.ollamaUrl} — "${config.model}" is not installed (installed: ${reach.models.join(', ') || 'none'})`
      }
}

/**
 * Live verdict for one prerequisite id. Only the ids the active provider needs
 * are ever probed, so an Ollama-only user pays no Claude sign-in scan and a
 * Claude user makes no request to an Ollama server they never configured.
 */
async function probePrereq(id: PrereqId): Promise<PrereqProbe> {
  if (id === 'claude') {
    const runtime = claudeRuntimePath()
    return {
      ok: !!runtime,
      detail: runtime ?? `no build for ${process.platform}-${process.arch} in node_modules`
    }
  }
  if (id === 'claudeAuth') {
    const signal = await claudeCredentialSignal()
    return {
      ok: !!signal,
      detail: signal ?? 'none found for this user (a keychain-stored login cannot be seen from here)'
    }
  }
  if (id === 'geminiKey') {
    // Presence only — the key itself never leaves the main process.
    return geminiKeySet()
      ? { ok: true, detail: 'a key is stored, encrypted, on this machine' }
      : { ok: false, detail: 'no Gemini API key stored' }
  }
  if (id === 'ollamaServer') {
    const config = currentProviderConfigOrNull()
    // Unreachable in practice: the id is only in the list when a workspace (and
    // therefore a provider) exists. Reported, never guessed.
    if (!config) return { ok: false, detail: 'no workspace yet, so no Ollama server is configured' }
    return probeOllama(config)
  }
  if (id === 'latex') {
    const engine = resolveLatex()
    return {
      ok: !!engine,
      detail: engine ? `${engine.path} (${engine.kind})` : 'no pdflatex/xelatex/lualatex/tectonic found'
    }
  }
  const bun = resolveBun()
  // resolveBun() falls back to the bare command when nothing was found.
  return {
    ok: bun !== 'bun',
    detail: bun !== 'bun' ? bun : 'not found on PATH or in the usual install locations'
  }
}

/**
 * Host prerequisites for the ACTIVE provider, worst-first, so the onboarding
 * preflight and Settings show what is missing before an agent run is possible.
 *
 * The requirement set is derived from the provider (prereqSpec.ts), never
 * fixed: an Ollama user is not told to sign in to Claude, and a Claude user is
 * not asked for an Ollama server. Before a workspace exists the provider is
 * unknown — settings live in the workspace — so only the provider-independent
 * rows are evaluated and scopeNote says the rest waits for a workspace.
 */
async function checkPrereqs(): Promise<Pick<EnvPreflight, 'provider' | 'scopeNote' | 'tools'>> {
  const provider = currentProviderConfigOrNull()?.provider ?? null
  const specs = prereqSpecsFor(provider)
  const tools = await Promise.all(
    specs.map(async (spec): Promise<PrereqTool> => ({ ...spec, ...(await probePrereq(spec.id)) }))
  )
  return { provider, scopeNote: scopeNoteFor(provider), tools: sortPrereqs(tools) }
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
 * Screen a folder for adoption as the workspace: refuse what cannot work and
 * ask before scaffolding into a folder that already holds unrelated files.
 * Returns whether the folder is an existing workspace. Throws with a message
 * the renderer shows verbatim; a declined prompt throws too.
 */
async function vetWorkspaceFolder(dir: string, win: BrowserWindow | null): Promise<boolean> {
  await assertUsableWorkspace(dir, win)
  const kind = classifyFolder(dir)
  if (kind === 'notDirectory') throw new Error(`${dir} is a file, not a folder.`)
  if (kind === 'nonEmptyOther') {
    const { response } = await dialog.showMessageBox(win ?? new BrowserWindow({ show: false }), {
      type: 'question',
      buttons: ['Choose a different folder', 'Use this folder'],
      defaultId: 0,
      cancelId: 0,
      message: 'This folder already contains other files',
      detail: `The app adds its own folders (applications, master, uploads, runs, …) next to what is in ${dir}. Nothing there is changed or removed. An empty folder keeps things tidier.`
    })
    if (response !== 1) throw new Error('Workspace setup cancelled — choose an empty folder.')
  }
  return kind === 'workspace'
}

/** Create the folder if needed, scaffold a fresh one, and point config at it.
 *  An existing workspace is adopted as-is (its board CLIs may be customized). */
function adoptWorkspaceFolder(dir: string, isWorkspace: boolean): void {
  fs.mkdirSync(dir, { recursive: true })
  // Scaffold the bundled job-board CLIs so scout runs work out of the box.
  if (!isWorkspace) installAllBoards(dir)
  saveConfig(configPatchForSwitch(loadConfig(), dir, folderHasProfile(dir)))
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
  /** Restart the process so services come up on the configured workspace. */
  relaunch: () => void
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
  // the probes touch the filesystem and (under Ollama) the network. Nothing
  // here may block the main process.
  // The explicit return type is the contract: EnvPreflight is what
  // IpcInvokeContract declares for this channel, so producer and consumer
  // cannot drift. The per-tool fields serve Settings; `tools` powers
  // onboarding's preflight; `provider`/`scopeNote` tell both which provider the
  // answer is about, so the renderer re-checks after a provider switch.
  handle('env:check', async (): Promise<EnvPreflight> => ({
    ...envCheck(),
    ...(await checkPrereqs())
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
    const isWorkspace = await vetWorkspaceFolder(dir, deps.getWindow())
    adoptWorkspaceFolder(dir, isWorkspace)
    if (deps.workspaceBooted() && !sameFolder(REPO_ROOT, dir)) {
      // Live services are bound to another root and cannot re-root: the new
      // folder goes live after a restart, never silently on some later launch.
      return { workspacePath: dir, restartRequired: true }
    }
    await deps.completeSetup(dir)
    return { workspacePath: dir, restartRequired: false }
  })

  // Settings → Change workspace. Services re-root only in a fresh process, so
  // a confirmed switch writes config and restarts; a declined one writes
  // nothing.
  handle('workspace:switch', async () => {
    const win = deps.getWindow()
    const pick = await dialog.showOpenDialog(win ?? new BrowserWindow({ show: false }), {
      title: 'Choose a workspace folder (an existing workspace, or an empty folder for a new one)',
      properties: ['openDirectory', 'createDirectory']
    })
    const dir = pick.filePaths[0]
    if (pick.canceled || !dir) return { switched: false }
    if (deps.workspaceBooted() && sameFolder(REPO_ROOT, dir)) {
      throw new Error('That folder is already the open workspace.')
    }
    const isWorkspace = await vetWorkspaceFolder(dir, win)
    const { response } = await dialog.showMessageBox(win ?? new BrowserWindow({ show: false }), {
      type: 'question',
      buttons: ['Cancel', 'Switch and restart'],
      defaultId: 1,
      cancelId: 0,
      message: isWorkspace ? 'Open this workspace?' : 'Start a new workspace here?',
      detail: `${dir}\n\nThe app restarts to open it; agent runs in progress are stopped. ${
        isWorkspace ? 'Its tracker, profile and documents load as they are.' : 'Setup runs next so you can add your résumé.'
      } Your current workspace is left untouched and can be reopened the same way. Email and calendar connections belong to this computer, not the workspace, so they carry over.`
    })
    if (response !== 1) return { switched: false }
    adoptWorkspaceFolder(dir, isWorkspace)
    // Deferred so the reply reaches the renderer before the quit begins.
    setImmediate(deps.relaunch)
    return { switched: true }
  })

  handle('workspace:reveal', async () => {
    const dir = deps.workspaceBooted() ? REPO_ROOT : loadConfig().workspacePath
    if (!dir) throw new Error('no workspace configured')
    const problem = await shell.openPath(dir)
    if (problem) throw new Error(problem)
  })

  handle('app:relaunch', () => {
    setImmediate(deps.relaunch)
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
    // Same config transition onboarding's workspace:create uses.
    saveConfig(configPatchForSwitch(loadConfig(), workspacePath, folderHasProfile(workspacePath)))
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

  // Reopen the setup wizard on the current workspace (Settings / Who I am).
  // Nothing in the workspace is touched; finishing setup sets onboardedAt again.
  handle('onboarding:reset', () => {
    saveConfig({ onboardedAt: null })
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

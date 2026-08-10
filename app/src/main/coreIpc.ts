import { BrowserWindow, app, dialog, ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { loadConfig, saveConfig } from './appConfig'
import { installAllBoards } from './boards/boardsBridge'
import { resolveLatex, workspaceReady } from './paths'
import { readManifest, verifyAndExtract } from './workspace/archive'

/**
 * IPC that must work BEFORE a workspace exists (first-run/onboarding).
 * Workspace-dependent IPC lives in ipcRegistry.ts and is registered by
 * bootWorkspace() once a workspace is chosen.
 */
export function registerCoreIpc(deps: {
  getWindow: () => BrowserWindow | null
  completeSetup: (workspacePath: string) => Promise<void> | void
}): void {
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
    return { workspacePath: c.workspacePath, onboardedAt: c.onboardedAt }
  })

  handle('env:check', () => {
    const eng = resolveLatex()
    return {
      pdflatex: {
        ok: !!eng,
        path: eng ? `${eng.path} (${eng.kind})` : 'no LaTeX engine found (install pdflatex or tectonic)'
      },
      platform: process.platform,
      appVersion: app.getVersion()
    }
  })

  handle('workspace:choose', async (req: { title?: string }) => {
    const win = deps.getWindow()
    const result = await dialog.showOpenDialog(win ?? new BrowserWindow({ show: false }), {
      title: req?.title ?? 'Choose a folder',
      properties: ['openDirectory', 'createDirectory']
    })
    return { path: result.canceled ? null : (result.filePaths[0] ?? null) }
  })

  handle('workspace:create', async ({ dir }: { dir: string }) => {
    if (!dir) throw new Error('no folder chosen')
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
      verifyAndExtract(zipPath, destDir)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { imported: false, error: message, restartRequired: false, hasProfile: false }
    }
    const workspacePath = path.join(destDir, 'workspace')
    // Same config write onboarding's workspace:create uses.
    saveConfig({ workspacePath })
    if (workspaceReady()) {
      // Live services (store, watchers, runner) are bound to the old root and
      // cannot re-root at runtime — the import goes live on next launch.
      return { imported: true, error: null, restartRequired: true, hasProfile }
    }
    // First run: no services exist yet, so the imported workspace boots now.
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

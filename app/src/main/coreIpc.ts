import { BrowserWindow, app, dialog, ipcMain } from 'electron'
import fs from 'node:fs'
import { loadConfig, saveConfig } from './appConfig'
import { installAllBoards } from './boards/boardsBridge'
import { resolveLatex } from './paths'

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

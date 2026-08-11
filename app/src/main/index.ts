import { BrowserWindow, app, dialog } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { registerLocalFileScheme, installLocalFileHandler } from './protocol'
import { initWorkspace } from './paths'
import { loadConfig } from './appConfig'
import { registerCoreIpc } from './coreIpc'
import { Store } from './store/Store'
import { TrackerRepo } from './store/trackerRepo'
import { TodoWatcher } from './fsops/TodoWatcher'
import { scanApplications } from './fsops/FolderScanner'
import { RunStore } from './agent/runStore'
import { AgentRunner } from './agent/AgentRunner'
import { initRatingService } from './companies/ratingService'
import { registerIpc } from './ipcRegistry'
import { initProviderRuntime, stopShim } from './provider/providerRuntime'
import { createMainWindow, installWebviewHardening } from './window'

// Dev isolation: distinct userData so an ohmo dev instance never collides
// with an installed build.
if (!app.isPackaged) {
  app.setPath('userData', path.join(app.getPath('appData'), 'OhmoDev'))
}

let mainWindow: BrowserWindow | null = null
let store: Store | null = null
let runner: AgentRunner | null = null
let todo: TodoWatcher | null = null
// Set when bootWorkspace() threw; cleared by a successful retry from first-run.
let bootError: string | null = null
// Only a boot that ran to completion counts — workspaceReady() flips as soon as
// the paths are set, which a half-finished boot also does.
let workspaceBooted = false
// ipcMain.handle() rejects a second registration for the same channel, so the
// workspace handlers are registered at most once per process. registerIpc is
// therefore the LAST fallible step of a boot: reaching it means every service
// it closes over was constructed successfully.
let workspaceIpcRegistered = false

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

/**
 * Bring workspace services online (at boot, or right after first-run setup).
 * Throws when the workspace cannot come up; callers must keep the app alive.
 */
function bootWorkspace(workspacePath: string): void {
  if (workspaceBooted) return // already booted this session
  initWorkspace(workspacePath)

  // A previous attempt may have left a watcher running on the old root.
  todo?.stop()

  store = new Store()
  store.load()
  const tracker = new TrackerRepo(store)
  todo = new TodoWatcher(store, (item) => send('push:todoNew', item))
  const runStore = new RunStore()
  runner = new AgentRunner(store, tracker, todo, runStore, (channel, payload) =>
    send(channel, payload)
  )
  initRatingService(
    (payload) => send('push:companiesChanged', payload),
    () => store!.state.settings.model
  )
  initProviderRuntime(() => store!.state.settings)

  store.on('changed', (domains: string[]) => send('push:storeChanged', { domains }))

  // Reconcile the tracker with what's actually on disk before the renderer
  // hydrates: any application folder gets a row even when the run that built
  // it died before report.json. (The runner's salvage scan covers failures in
  // a live session; this covers folders orphaned in previous sessions.)
  try {
    const scan = tracker.applyScan(scanApplications())
    if (scan.created || scan.updated) {
      console.log(`[boot] folder scan: ${scan.created} row(s) created, ${scan.updated} updated`)
    }
  } catch (err) {
    console.error('[boot] folder scan failed:', err)
  }

  todo.start()

  if (!workspaceIpcRegistered) {
    registerIpc({
      store,
      tracker,
      todo,
      runner,
      runStore,
      send,
      getWindow: () => mainWindow
    })
    workspaceIpcRegistered = true
  }

  workspaceBooted = true
  bootError = null
  // Tell the renderer the workspace is live so it can hydrate + leave first-run.
  send('push:storeChanged', { domains: ['rows', 'intake', 'candidates', 'settings'] })
}

/** Everything this process registers with Electron. Runs only in the instance
 *  that owns the single-instance lock. */
function start(): void {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  // Electron ships no FedCM browser UI, but the API surface feature-detects as
  // present under our plain-Chrome UA — Google's "Continue as …" sign-in chips
  // then take the FedCM path and stall silently on click. Disabling the feature
  // makes Google Identity Services fall back to its popup flow, which the
  // sandboxed-popup handler in window.ts supports. Must run before ready.
  app.commandLine.appendSwitch('disable-features', 'FedCm,FedCmIdpSigninStatus')

  // Must run before app.whenReady().
  registerLocalFileScheme()
  installWebviewHardening()

  app.whenReady().then(() => {
    installLocalFileHandler()

    registerCoreIpc({
      getWindow: () => mainWindow,
      completeSetup: (workspacePath) => bootWorkspace(workspacePath),
      bootError: () => bootError,
      workspaceBooted: () => workspaceBooted
    })

    const config = loadConfig()
    if (config.workspacePath && fs.existsSync(config.workspacePath)) {
      // A failed boot must never cost the user their window: the app still opens
      // (on first-run recovery, since config:get then reports no workspace) and
      // the lifecycle handlers below are still registered.
      try {
        bootWorkspace(config.workspacePath)
      } catch (err) {
        bootError = err instanceof Error ? err.message : String(err)
        console.error('[boot] workspace failed to start:', bootError)
      }
    } else if (config.workspacePath) {
      // A configured folder that is gone (moved, deleted, unmounted, config
      // copied from another machine) must set bootError too: without it config:get
      // still reports the stale path and the renderer skips first-run recovery
      // into a UI whose workspace channels were never registered.
      bootError = `The workspace folder ${config.workspacePath} no longer exists.`
      console.error('[boot] workspace missing:', bootError)
    }

    // Registered before the first window exists: macOS keeps the app alive with
    // no windows, and this handler is the only way back to one.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow(store?.state.settings.theme)
      }
    })

    const theme = store?.state.settings.theme ?? 'dark'
    mainWindow = createMainWindow(theme)
    mainWindow.on('closed', () => {
      mainWindow = null
    })
    mainWindow.on('focus', () => todo?.rescan())

    if (bootError) {
      void dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Workspace could not be opened',
        message: `The workspace at ${config.workspacePath} could not be opened.`,
        detail: `${bootError}\n\nThe app has started without it. Check that the folder exists and is writable, then pick it again in setup.`,
        buttons: ['OK']
      })
    }
  }).catch((err: unknown) => {
    // Last resort: startup failed outside bootWorkspace (window creation, scheme
    // handler). Without this the promise rejects silently and the app sits in the
    // dock with no window and no explanation.
    const message = err instanceof Error ? err.message : String(err)
    console.error('[boot] startup failed:', message)
    dialog.showErrorBox('The app could not start', message)
    app.quit()
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  let quitting = false
  app.on('before-quit', (event) => {
    if (quitting) return
    quitting = true
    event.preventDefault()
    runner?.abortAll('app quit')
    stopShim()
    void (store?.flush() ?? Promise.resolve()).finally(() => {
      app.quit()
    })
  })
}

// Single instance: a second launch hands off to the running one and this
// process registers nothing. app.quit() does not stop the module, so the
// registrations must sit behind the lock — two processes booting the same
// workspace would fight over its files.
if (app.requestSingleInstanceLock()) {
  start()
} else {
  app.quit()
}

import { BrowserWindow, app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { registerLocalFileScheme, installLocalFileHandler } from './protocol'
import { initWorkspace, workspaceReady } from './paths'
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
import { createMainWindow, installWebviewHardening } from './window'

// Dev isolation: distinct userData so an ohmo dev instance never collides
// with an installed build.
if (!app.isPackaged) {
  app.setPath('userData', path.join(app.getPath('appData'), 'OhmoDev'))
}

// Single instance: a second launch focuses the existing window instead.
if (!app.requestSingleInstanceLock()) {
  app.quit()
}
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

// Must run before app.whenReady().
registerLocalFileScheme()
installWebviewHardening()

let mainWindow: BrowserWindow | null = null
let store: Store | null = null
let runner: AgentRunner | null = null
let todo: TodoWatcher | null = null

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

/** Bring workspace services online (at boot, or right after first-run setup). */
function bootWorkspace(workspacePath: string): void {
  if (workspaceReady()) return // already booted this session
  initWorkspace(workspacePath)

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

  store.on('changed', (domains: string[]) => send('push:storeChanged', { domains }))

  registerIpc({
    store,
    tracker,
    todo,
    runner,
    runStore,
    send,
    getWindow: () => mainWindow
  })

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
  // Tell the renderer the workspace is live so it can hydrate + leave first-run.
  send('push:storeChanged', { domains: ['rows', 'intake', 'candidates', 'settings'] })
}

app.whenReady().then(() => {
  installLocalFileHandler()

  registerCoreIpc({
    getWindow: () => mainWindow,
    completeSetup: (workspacePath) => bootWorkspace(workspacePath)
  })

  const config = loadConfig()
  if (config.workspacePath && fs.existsSync(config.workspacePath)) {
    bootWorkspace(config.workspacePath)
  }

  const theme = store?.state.settings.theme ?? 'dark'
  mainWindow = createMainWindow(theme)
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  mainWindow.on('focus', () => todo?.rescan())

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow(store?.state.settings.theme)
    }
  })
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
  void (store?.flush() ?? Promise.resolve()).finally(() => {
    app.quit()
  })
})

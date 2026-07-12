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
import { RunStore } from './agent/runStore'
import { AgentRunner } from './agent/AgentRunner'
import { registerIpc } from './ipcRegistry'
import { createMainWindow, installWebviewHardening } from './window'

// Dev isolation: distinct userData so a JobDeck dev instance never collides
// with an installed build (or with v1, which has its own app name already).
if (!app.isPackaged) {
  app.setPath('userData', path.join(app.getPath('appData'), 'JobDeckDev'))
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

  store.on('changed', (domains: string[]) => send('push:storeChanged', { domains }))

  registerIpc({
    store,
    tracker,
    todo,
    runner,
    getWindow: () => mainWindow
  })

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

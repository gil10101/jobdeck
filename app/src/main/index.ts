import { BrowserWindow, app } from 'electron'
import { registerLocalFileScheme, installLocalFileHandler } from './protocol'
import { ensureAppDataDirs } from './paths'
import { Store } from './store/Store'
import { TrackerRepo } from './store/trackerRepo'
import { TodoWatcher } from './fsops/TodoWatcher'
import { RunStore } from './agent/runStore'
import { AgentRunner } from './agent/AgentRunner'
import { registerIpc } from './ipcRegistry'
import { createMainWindow, installWebviewHardening } from './window'

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

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

app.whenReady().then(() => {
  installLocalFileHandler()
  ensureAppDataDirs()

  store = new Store()
  store.load()
  const tracker = new TrackerRepo(store)
  const todo = new TodoWatcher(store, (item) => send('push:todoNew', item))
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

  mainWindow = createMainWindow(store.state.settings.theme)
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  // Re-check the TODO folder whenever the app regains focus (fs.watch is flaky on Windows).
  mainWindow.on('focus', () => todo.rescan())
  todo.start()

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

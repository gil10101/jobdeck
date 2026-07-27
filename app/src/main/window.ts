import { BrowserWindow, app, shell } from 'electron'
import type { WebContents } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Plain-Chrome UA (Electron token stripped) so ATS/OAuth pages don't flag the embedded browser. */
function chromeUA(): string {
  return app.userAgentFallback
    .replace(/\sElectron\/[\d.]+/i, '')
    .replace(/\sjob-mission-control\/[\d.]+/i, '')
}

export function createMainWindow(theme: 'dark' | 'light' = 'dark'): BrowserWindow {
  const win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: theme === 'light' ? '#ffffff' : '#1A1A1A',
    autoHideMenuBar: true,
    title: 'Mission Control — Job Applications',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
      plugins: true // Chromium PDF viewer
    }
  })

  // Renderer: dev server in dev, built file in prod.
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  // Links from the renderer itself (not the webview) → system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  return win
}

/** Popups from embedded pages become real child windows — OAuth needs a window
 *  whose JS can reach window.opener and self-close, so loading in place breaks
 *  the flow. Children are locked down (isolated context, no node, OS sandbox,
 *  never the app preload) and only web schemes are allowed. Applied recursively
 *  so chained popups (SSO account pickers) get the same treatment. */
function allowSandboxedPopups(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (!/^(https?:|about:blank$)/i.test(url)) return { action: 'deny' }
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        autoHideMenuBar: true,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true
        }
      }
    }
  })
  contents.on('did-create-window', (child) => {
    child.webContents.setUserAgent(chromeUA())
    allowSandboxedPopups(child.webContents)
  })
}

/** Harden every <webview> guest: plain UA (also at session level, so a popup's
 *  very first request predates the per-contents override) + sandboxed popups.
 *  Popup windows are type 'window', so the early return never re-denies them. */
export function installWebviewHardening(): void {
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') return
    contents.setUserAgent(chromeUA())
    contents.session.setUserAgent(chromeUA())
    allowSandboxedPopups(contents)
  })
}

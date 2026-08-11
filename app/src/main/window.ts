import { BrowserWindow, app, shell } from 'electron'
import type { WebContents } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Plain-Chrome UA so ATS/OAuth pages don't flag the embedded browser: both the
 *  Electron token and the app's own product token must go, or the product name
 *  is transmitted to every site the user visits. The product token is derived
 *  from productName rather than hardcoded, so renaming the app cannot leave a
 *  stale pattern that silently matches nothing. */
function chromeUA(): string {
  const product = app.getName().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return app.userAgentFallback
    .replace(/\sElectron\/\S+/i, '')
    // \S+, not [\d.]+: a prerelease version ("2.0.0-dev") would otherwise
    // match only its numeric head and leave the remainder in the UA.
    .replace(new RegExp(`\\s${product}/\\S+`, 'i'), '')
}

/** The one built renderer document the app loads in prod. */
const rendererIndex = path.join(__dirname, '../renderer/index.html')

/** Case-folded absolute path, insensitive where the filesystem is (macOS,
 *  Windows), so a case variant cannot pass for the renderer. */
function foldPath(p: string): string {
  return process.platform === 'linux' ? path.resolve(p) : path.resolve(p).toLowerCase()
}

/** The app's own renderer document: the dev server origin in dev, exactly the
 *  built index.html in prod. Anything else — including any other local file, of
 *  which the workspace holds many written from agent-reachable content — is a
 *  foreign document and must never replace the UI. */
function isAppDocument(target: string): boolean {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  try {
    const url = new URL(target)
    if (devUrl) return url.origin === new URL(devUrl).origin
    if (url.protocol !== 'file:') return false
    return foldPath(fileURLToPath(url)) === foldPath(rendererIndex)
  } catch {
    return false
  }
}

/**
 * Keep the app window showing the app. A stray link, a redirect, or injected
 * markup in the renderer would otherwise navigate the whole UI to a foreign
 * document — and the main frame is where the preload bridge lives. http(s)
 * targets go to the system browser instead; anything else is dropped.
 *
 * Subframes are held to the same rule plus local-file:, the jailed scheme the
 * PDF previews are embedded with. The bridge does not reach them
 * (nodeIntegrationInSubFrames stays off), and the protocol handler already
 * confines that scheme to a few workspace directories.
 */
function installNavigationGuard(contents: WebContents): void {
  contents.on('will-navigate', (event, url) => {
    if (isAppDocument(url)) return
    event.preventDefault()
    if (/^https?:/i.test(url)) void shell.openExternal(url)
  })
  contents.on('will-frame-navigate', (event) => {
    if (event.isMainFrame) return // will-navigate already ruled on it
    if (isAppDocument(event.url) || event.url.startsWith('local-file:')) return
    event.preventDefault()
  })
}

/**
 * Every <webview> guest is forced into the locked-down shape regardless of the
 * attributes on the tag: no preload (a guest must never reach the app bridge),
 * no node, isolated context. Attributes are attacker-reachable through injected
 * markup, so the main process decides these, not the renderer.
 */
function installWebviewAttachGuard(contents: WebContents): void {
  contents.on('will-attach-webview', (_event, webPreferences, params) => {
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.nodeIntegrationInSubFrames = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    webPreferences.webSecurity = true
    delete params.nodeintegration
    delete params.nodeintegrationinsubframes
    delete params.preload
  })
}

export function createMainWindow(theme: 'dark' | 'light' = 'dark'): BrowserWindow {
  const win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: theme === 'light' ? '#ffffff' : '#1A1A1A',
    autoHideMenuBar: true,
    // No explicit title: Electron falls back to productName, so the window
    // and the package agree without a second place to update.
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

  installNavigationGuard(win.webContents)
  installWebviewAttachGuard(win.webContents)

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

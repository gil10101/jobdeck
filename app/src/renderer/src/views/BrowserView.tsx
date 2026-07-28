import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, ChevronLeft, ChevronRight, Play, RefreshCw } from 'lucide-react'
import type { WebviewElement } from '../types.d'
import { call } from '../api'
import { useApp } from '../store'

// Last visited URL survives tab switches and renderer reloads without a store
// slice; cleared when the app quits.
const LAST_URL_KEY = 'browser.lastUrl'

/** Standalone in-app browser tab. Shares the Apply view's persist partition so
 *  one board/ATS login serves both surfaces. */
export default function BrowserView(): JSX.Element {
  const toast = useApp((s) => s.toast)
  const webviewRef = useRef<WebviewElement | null>(null)
  const [src, setSrc] = useState(() => sessionStorage.getItem(LAST_URL_KEY) ?? '')
  const [urlInput, setUrlInput] = useState(src)
  const [currentUrl, setCurrentUrl] = useState(src)
  const [canBack, setCanBack] = useState(false)
  const [canFwd, setCanFwd] = useState(false)
  const [building, setBuilding] = useState(false)

  useEffect(() => {
    const wv = webviewRef.current
    if (!wv) return
    const onNav = (): void => {
      try {
        const u = wv.getURL()
        setCurrentUrl(u)
        setUrlInput(u)
        setCanBack(wv.canGoBack())
        setCanFwd(wv.canGoForward())
        if (/^https?:/i.test(u)) sessionStorage.setItem(LAST_URL_KEY, u)
      } catch {
        /* webview not ready */
      }
    }
    wv.addEventListener('did-navigate', onNav)
    wv.addEventListener('did-navigate-in-page', onNav)
    wv.addEventListener('did-finish-load', onNav)
    return () => {
      wv.removeEventListener('did-navigate', onNav)
      wv.removeEventListener('did-navigate-in-page', onNav)
      wv.removeEventListener('did-finish-load', onNav)
    }
  }, [src])

  const go = (): void => {
    let u = urlInput.trim()
    if (!u) return
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u
    setUrlInput(u)
    setCurrentUrl(u)
    sessionStorage.setItem(LAST_URL_KEY, u)
    // First navigation mounts the webview via src; after that loadURL keeps
    // the element stable so src changes never restart the guest.
    if (webviewRef.current) void webviewRef.current.loadURL(u).catch(() => undefined)
    else setSrc(u)
  }

  // One-click build from the open listing: the guest page's rendered DOM is
  // handed to the main process, which extracts the posting, files an intake
  // item, and queues the build — no copy-paste round trip through Intake.
  const buildFromPage = async (): Promise<void> => {
    const wv = webviewRef.current
    if (!wv || !currentUrl || building) return
    setBuilding(true)
    try {
      const raw = (await wv.executeJavaScript(
        `JSON.stringify({
           html: document.documentElement ? document.documentElement.outerHTML : '',
           title: document.title || '',
           bodyText: document.body ? document.body.innerText : ''
         })`
      )) as string
      const page = JSON.parse(raw) as { html: string; title: string; bodyText: string }
      const { run } = await call('browser:buildFromPage', { url: currentUrl, ...page })
      toast(`Build queued: ${run.slug} — track it in Runs`)
    } catch (err) {
      toast(String(err), 'error')
    } finally {
      setBuilding(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-edge bg-panel px-3 py-2">
        <button className="btn px-2" disabled={!canBack} onClick={() => webviewRef.current?.goBack()}>
          <ChevronLeft size={14} />
        </button>
        <button className="btn px-2" disabled={!canFwd} onClick={() => webviewRef.current?.goForward()}>
          <ChevronRight size={14} />
        </button>
        <button className="btn px-2" onClick={() => webviewRef.current?.reload()}>
          <RefreshCw size={13} />
        </button>
        <input
          className="input flex-1 font-mono text-[11px]"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && go()}
          placeholder="https://…"
        />
        <button
          className="btn"
          disabled={!currentUrl || building}
          title="Build an application from the listing on this page: résumé + cover letter, added to Intake and the Tracker"
          onClick={() => void buildFromPage()}
        >
          <Play size={12} /> {building ? 'Reading…' : 'Build'}
        </button>
        <button
          className="btn"
          disabled={!currentUrl}
          title="Open in your system browser (for OAuth logins that block embedded views)"
          onClick={() =>
            void call('app:openExternal', { url: currentUrl }).catch((err) =>
              toast(String(err), 'error')
            )
          }
        >
          <ArrowUpRight size={13} /> Browser
        </button>
      </div>

      <div className="min-h-0 flex-1 bg-white">
        {src ? (
          <webview
            ref={webviewRef as React.RefObject<HTMLElement>}
            src={src}
            partition="persist:apply"
            // react-dom drops boolean-valued unknown attributes, so the value
            // must be a string at runtime; @types/react types it as boolean.
            allowpopups={'true' as unknown as boolean}
            className="h-full w-full"
            style={{ display: 'flex', height: '100%', width: '100%' }}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 bg-bg text-sm text-gray-500">
            <div>Type a URL above and press Enter to start browsing.</div>
            <div className="text-xs text-gray-600">
              Logins are shared with the Apply view&apos;s embedded browser.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

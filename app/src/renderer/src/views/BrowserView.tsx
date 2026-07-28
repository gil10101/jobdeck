import { useEffect, useRef, useState } from 'react'
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Clock,
  Globe,
  MoreHorizontal,
  Play,
  RefreshCw,
  Star,
  Trash2,
  X
} from 'lucide-react'
import type { WebviewElement } from '../types.d'
import { call } from '../api'
import { useApp } from '../store'

// Last visited URL survives tab switches and renderer reloads without a store
// slice; cleared when the app quits. Bookmarks and history are browser-local
// convenience data, so they live in localStorage rather than the main store.
const LAST_URL_KEY = 'browser.lastUrl'
const BOOKMARKS_KEY = 'browser.bookmarks'
const HISTORY_KEY = 'browser.history'
const BOOKMARK_CAP = 100
const HISTORY_CAP = 200

interface SavedLink {
  url: string
  title: string
  at: string
}

function loadLinks(key: string): SavedLink[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((e): e is SavedLink => typeof (e as SavedLink)?.url === 'string')
  } catch {
    return []
  }
}

function saveLinks(key: string, links: SavedLink[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(links))
  } catch {
    /* storage full or blocked — links just don't persist */
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

/** Site favicon via DuckDuckGo's icon service (the only remote image host the
 *  CSP allows); falls back to a globe glyph when the site has none. */
function Favicon({ url }: { url: string }): JSX.Element {
  const [failed, setFailed] = useState(false)
  if (failed) return <Globe size={14} className="shrink-0 text-gray-500" />
  return (
    <img
      src={`https://icons.duckduckgo.com/ip3/${hostOf(url)}.ico`}
      className="h-3.5 w-3.5 shrink-0 rounded-sm"
      onError={() => setFailed(true)}
      alt=""
    />
  )
}

function LinkRow({
  link,
  onOpen,
  action
}: {
  link: SavedLink
  onOpen: () => void
  action?: JSX.Element
}): JSX.Element {
  return (
    <div className="group flex items-center gap-2 rounded px-2 py-1.5 hover:bg-panel2">
      <Favicon url={link.url} />
      <button className="min-w-0 flex-1 text-left" onClick={onOpen} title={link.url}>
        <span className="block truncate text-xs text-gray-300">
          {link.title || hostOf(link.url)}
        </span>
        <span className="block truncate text-[10px] text-gray-500">{link.url}</span>
      </button>
      {action}
    </div>
  )
}

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
  const [pageTitle, setPageTitle] = useState('')
  const [bookmarks, setBookmarks] = useState<SavedLink[]>(() => loadLinks(BOOKMARKS_KEY))
  const [history, setHistory] = useState<SavedLink[]>(() => loadLinks(HISTORY_KEY))
  const [menuOpen, setMenuOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)

  useEffect(() => saveLinks(BOOKMARKS_KEY, bookmarks), [bookmarks])
  useEffect(() => saveLinks(HISTORY_KEY, history), [history])

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
        if (/^https?:/i.test(u)) {
          sessionStorage.setItem(LAST_URL_KEY, u)
          // Consecutive-dedupe: finish-load re-fires for the same URL.
          setHistory((h) =>
            h[0]?.url === u
              ? h
              : [{ url: u, title: '', at: new Date().toISOString() }, ...h].slice(0, HISTORY_CAP)
          )
        }
      } catch {
        /* webview not ready */
      }
    }
    // Titles arrive after navigation — retitle the newest matching entry.
    const onTitle = (e: Event): void => {
      const title = (e as unknown as { title?: string }).title ?? ''
      setPageTitle(title)
      if (!title) return
      try {
        const u = wv.getURL()
        setHistory((h) => {
          if (!h.length || h[0].url !== u || h[0].title === title) return h
          const next = [...h]
          next[0] = { ...next[0], title }
          return next
        })
      } catch {
        /* webview not ready */
      }
    }
    wv.addEventListener('did-navigate', onNav)
    wv.addEventListener('did-navigate-in-page', onNav)
    wv.addEventListener('did-finish-load', onNav)
    wv.addEventListener('page-title-updated', onTitle)
    return () => {
      wv.removeEventListener('did-navigate', onNav)
      wv.removeEventListener('did-navigate-in-page', onNav)
      wv.removeEventListener('did-finish-load', onNav)
      wv.removeEventListener('page-title-updated', onTitle)
    }
  }, [src])

  const navigateTo = (u: string): void => {
    setUrlInput(u)
    setCurrentUrl(u)
    sessionStorage.setItem(LAST_URL_KEY, u)
    // First navigation mounts the webview via src; after that loadURL keeps
    // the element stable so src changes never restart the guest.
    if (webviewRef.current) void webviewRef.current.loadURL(u).catch(() => undefined)
    else setSrc(u)
  }

  const go = (): void => {
    let u = urlInput.trim()
    if (!u) return
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u
    navigateTo(u)
  }

  const bookmarked = bookmarks.some((b) => b.url === currentUrl)
  const toggleBookmark = (): void => {
    if (!currentUrl) return
    setBookmarks((bs) =>
      bs.some((b) => b.url === currentUrl)
        ? bs.filter((b) => b.url !== currentUrl)
        : [
            { url: currentUrl, title: pageTitle || hostOf(currentUrl), at: new Date().toISOString() },
            ...bs
          ].slice(0, BOOKMARK_CAP)
    )
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
        <div className="relative flex-1">
          <input
            className="input w-full pr-8 font-mono text-[11px]"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && go()}
            placeholder="https://…"
          />
          <button
            className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-amber-300 disabled:opacity-30"
            disabled={!currentUrl}
            title={bookmarked ? 'Remove bookmark' : 'Bookmark this page'}
            onClick={toggleBookmark}
          >
            <Star size={13} className={bookmarked ? 'fill-amber-300 text-amber-300' : ''} />
          </button>
        </div>
        <button
          className="btn"
          disabled={!currentUrl || building}
          title="Build an application from the listing on this page: résumé + cover letter, added to Intake and the Tracker"
          onClick={() => void buildFromPage()}
        >
          <Play size={12} /> {building ? 'Reading…' : 'Build'}
        </button>
        <div className="relative">
          <button className="btn px-2" title="More" onClick={() => setMenuOpen((v) => !v)}>
            <MoreHorizontal size={14} />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 z-50 mt-1 w-56 rounded-md border border-edge bg-panel2 py-1 shadow-xl">
                <button
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-300 hover:bg-panel disabled:opacity-40"
                  disabled={!currentUrl}
                  title="For OAuth logins that block embedded views"
                  onClick={() => {
                    setMenuOpen(false)
                    void call('app:openExternal', { url: currentUrl }).catch((err) =>
                      toast(String(err), 'error')
                    )
                  }}
                >
                  <ArrowUpRight size={13} /> Open in system browser
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-300 hover:bg-panel"
                  onClick={() => {
                    setMenuOpen(false)
                    setHistoryOpen(true)
                  }}
                >
                  <Clock size={13} /> History
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="relative min-h-0 flex-1 bg-white">
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
          <div className="flex h-full flex-col items-center justify-center gap-4 bg-bg p-6">
            <div className="text-center text-sm text-gray-500">
              <div>Type a URL above and press Enter to start browsing.</div>
              <div className="mt-1 text-xs text-gray-600">
                Logins are shared with the Apply view&apos;s embedded browser.
              </div>
            </div>
            {bookmarks.length > 0 && (
              <div className="w-full max-w-md rounded-md border border-edge bg-panel p-2">
                <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  Bookmarks
                </div>
                {bookmarks.map((b) => (
                  <LinkRow
                    key={b.url}
                    link={b}
                    onOpen={() => navigateTo(b.url)}
                    action={
                      <button
                        className="p-1 opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
                        title="Remove bookmark"
                        onClick={() => setBookmarks((bs) => bs.filter((x) => x.url !== b.url))}
                      >
                        <Star size={13} className="fill-amber-300 text-amber-300" />
                      </button>
                    }
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {historyOpen && (
          <div className="absolute bottom-0 right-0 top-0 z-10 flex w-80 flex-col border-l border-edge bg-panel">
            <div className="flex items-center justify-between border-b border-edge px-3 py-2">
              <span className="text-xs font-semibold text-gray-100">History</span>
              <div className="flex items-center gap-1">
                <button
                  className="p-1 text-gray-500 hover:text-red-300"
                  title="Clear history"
                  onClick={() => setHistory([])}
                >
                  <Trash2 size={13} />
                </button>
                <button
                  className="p-1 text-gray-500 hover:text-gray-300"
                  title="Close"
                  onClick={() => setHistoryOpen(false)}
                >
                  <X size={13} />
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-1">
              {history.length === 0 && (
                <div className="px-2 py-2 text-xs text-gray-500">Nothing yet.</div>
              )}
              {history.map((h, i) => (
                <LinkRow key={`${h.url}-${i}`} link={h} onOpen={() => navigateTo(h.url)} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

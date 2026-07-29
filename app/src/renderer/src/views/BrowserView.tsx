import { useEffect, useRef, useState } from 'react'
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Clock,
  Columns2,
  Globe,
  MoreHorizontal,
  Play,
  Plus,
  RefreshCw,
  Star,
  Trash2,
  X
} from 'lucide-react'
import type { WebviewElement } from '../types.d'
import { call } from '../api'
import { useApp } from '../store'

// Tabs (id + last URL + layout) survive renderer reloads via sessionStorage;
// cleared when the app quits. Bookmarks and browsing history are shared across
// all panes and persist in localStorage as browser-local convenience data.
const LAST_URL_KEY = 'browser.lastUrl' // pre-tabs key, read once as migration
const TABS_KEY = 'browser.tabs'
const BOOKMARKS_KEY = 'browser.bookmarks'
const HISTORY_KEY = 'browser.history'
const BOOKMARK_CAP = 100
const HISTORY_CAP = 200

interface SavedLink {
  url: string
  title: string
  at: string
}

interface TabMeta {
  id: string
  url: string
  title: string
}

function newTabMeta(url = ''): TabMeta {
  return { id: crypto.randomUUID().slice(0, 8), url, title: '' }
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

function restoreLayout(): { tabs: TabMeta[]; visible: string[]; focused: string } {
  try {
    const raw = sessionStorage.getItem(TABS_KEY)
    if (raw) {
      const p = JSON.parse(raw) as { tabs?: unknown; visible?: unknown; focused?: unknown }
      const tabs = (Array.isArray(p.tabs) ? p.tabs : [])
        .filter((t): t is TabMeta => typeof (t as TabMeta)?.id === 'string')
        .map((t) => ({
          id: t.id,
          url: typeof t.url === 'string' ? t.url : '',
          title: typeof t.title === 'string' ? t.title : ''
        }))
      if (tabs.length) {
        const ids = new Set(tabs.map((t) => t.id))
        let visible = (Array.isArray(p.visible) ? p.visible : [])
          .filter((v): v is string => typeof v === 'string' && ids.has(v))
          .slice(0, 2)
        if (!visible.length) visible = [tabs[0].id]
        const focused =
          typeof p.focused === 'string' && visible.includes(p.focused) ? p.focused : visible[0]
        return { tabs, visible, focused }
      }
    }
  } catch {
    /* corrupt layout — start fresh below */
  }
  const first = newTabMeta(sessionStorage.getItem(LAST_URL_KEY) ?? '')
  return { tabs: [first], visible: [first.id], focused: first.id }
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
  if (failed || !/^https?:/i.test(url)) {
    return <Globe size={14} className="shrink-0 text-gray-500" />
  }
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

interface PaneProps {
  initialUrl: string
  visible: boolean
  focused: boolean
  split: boolean
  /** 0 = left slot, 1 = right slot; drives CSS order (never DOM order — moving
   *  a webview node in the DOM reloads its guest). */
  slot: number
  bookmarks: SavedLink[]
  history: SavedLink[]
  onFocus: () => void
  onMeta: (patch: { url?: string; title?: string }) => void
  onVisit: (url: string) => void
  onRetitle: (url: string, title: string) => void
  onToggleBookmark: (url: string, title: string) => void
  onRemoveBookmark: (url: string) => void
  onClearHistory: () => void
}

/** One browser pane: toolbar (back/forward/reload, URL + bookmark star, Build,
 *  overflow menu), the webview, its own history sidebar, and the bookmarks
 *  blank state. Stays mounted while hidden so the guest keeps its history. */
function BrowserPane({
  initialUrl,
  visible,
  focused,
  split,
  slot,
  bookmarks,
  history,
  onFocus,
  onMeta,
  onVisit,
  onRetitle,
  onToggleBookmark,
  onRemoveBookmark,
  onClearHistory
}: PaneProps): JSX.Element {
  const toast = useApp((s) => s.toast)
  const webviewRef = useRef<WebviewElement | null>(null)
  const [src, setSrc] = useState(initialUrl)
  const [urlInput, setUrlInput] = useState(initialUrl)
  const [currentUrl, setCurrentUrl] = useState(initialUrl)
  const [canBack, setCanBack] = useState(false)
  const [canFwd, setCanFwd] = useState(false)
  const [building, setBuilding] = useState(false)
  const [pageTitle, setPageTitle] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

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
          onMeta({ url: u })
          onVisit(u)
        }
      } catch {
        /* webview not ready */
      }
    }
    // Titles arrive after navigation — retitle the matching history entry.
    const onTitle = (e: Event): void => {
      const title = (e as unknown as { title?: string }).title ?? ''
      setPageTitle(title)
      if (!title) return
      try {
        const u = wv.getURL()
        onMeta({ title })
        onRetitle(u, title)
      } catch {
        /* webview not ready */
      }
    }
    // A failed navigation otherwise leaves a silent blank page — surface it.
    const onStart = (): void => setLoadError(null)
    const onFail = (e: Event): void => {
      const ev = e as unknown as {
        errorCode: number
        errorDescription: string
        validatedURL: string
        isMainFrame: boolean
      }
      // -3 = ERR_ABORTED: fired by ordinary SPA redirects/cancelled loads.
      if (!ev.isMainFrame || ev.errorCode === -3) return
      setLoadError(
        `Page failed to load: ${ev.errorDescription || 'unknown error'} (${ev.errorCode}) — ${ev.validatedURL}`
      )
    }
    const onGone = (): void => setLoadError('The page crashed — reload to try again.')
    // Clicks inside the guest never bubble to our DOM; the webview's focus
    // event is the only signal that the user is working in this pane.
    const onGuestFocus = (): void => onFocus()
    wv.addEventListener('did-navigate', onNav)
    wv.addEventListener('did-navigate-in-page', onNav)
    wv.addEventListener('did-finish-load', onNav)
    wv.addEventListener('page-title-updated', onTitle)
    wv.addEventListener('did-start-loading', onStart)
    wv.addEventListener('did-fail-load', onFail)
    wv.addEventListener('render-process-gone', onGone)
    wv.addEventListener('focus', onGuestFocus)
    return () => {
      wv.removeEventListener('did-navigate', onNav)
      wv.removeEventListener('did-navigate-in-page', onNav)
      wv.removeEventListener('did-finish-load', onNav)
      wv.removeEventListener('page-title-updated', onTitle)
      wv.removeEventListener('did-start-loading', onStart)
      wv.removeEventListener('did-fail-load', onFail)
      wv.removeEventListener('render-process-gone', onGone)
      wv.removeEventListener('focus', onGuestFocus)
    }
    // Handlers close over stable setters plus parent callbacks kept fresh via
    // the deps below; src gates on webview mount.
  }, [src, onMeta, onVisit, onRetitle, onFocus])

  const navigateTo = (u: string): void => {
    setUrlInput(u)
    setCurrentUrl(u)
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
    <div
      className={
        visible
          ? `flex min-h-0 min-w-0 flex-1 basis-0 flex-col ${slot === 1 ? 'border-l border-edge' : ''} ${
              split && focused ? 'ring-1 ring-inset ring-cyan-800' : ''
            }`
          : 'hidden'
      }
      style={{ order: slot }}
      onMouseDownCapture={onFocus}
    >
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
            onClick={() => onToggleBookmark(currentUrl, pageTitle || hostOf(currentUrl))}
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

      {loadError && (
        <div className="flex items-center gap-2 border-b border-edge bg-panel px-3 py-1.5 text-xs text-red-300">
          <span className="min-w-0 flex-1 truncate" title={loadError}>
            {loadError}
          </span>
          <button
            className="btn px-2 py-0.5"
            onClick={() => {
              setLoadError(null)
              webviewRef.current?.reload()
            }}
          >
            Retry
          </button>
          <button
            className="p-1 text-gray-500 hover:text-gray-300"
            title="Dismiss"
            onClick={() => setLoadError(null)}
          >
            <X size={12} />
          </button>
        </div>
      )}

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
                        onClick={() => onRemoveBookmark(b.url)}
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
          <div className="absolute bottom-0 right-0 top-0 z-10 flex w-80 max-w-full flex-col border-l border-edge bg-panel">
            <div className="flex items-center justify-between border-b border-edge px-3 py-2">
              <span className="text-xs font-semibold text-gray-100">History</span>
              <div className="flex items-center gap-1">
                <button
                  className="p-1 text-gray-500 hover:text-red-300"
                  title="Clear history"
                  onClick={onClearHistory}
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

/** Browser workspace: any number of tabs, one or two visible at a time
 *  (split view). Every tab's pane stays mounted — hiding uses display:none so
 *  webview guests keep their navigation history and page state. */
export default function BrowserView(): JSX.Element {
  const [init] = useState(restoreLayout)
  const [tabs, setTabs] = useState<TabMeta[]>(init.tabs)
  const [visible, setVisible] = useState<string[]>(init.visible)
  const [focused, setFocused] = useState(init.focused)
  const [bookmarks, setBookmarks] = useState<SavedLink[]>(() => loadLinks(BOOKMARKS_KEY))
  const [history, setHistory] = useState<SavedLink[]>(() => loadLinks(HISTORY_KEY))

  useEffect(() => saveLinks(BOOKMARKS_KEY, bookmarks), [bookmarks])
  useEffect(() => saveLinks(HISTORY_KEY, history), [history])
  useEffect(() => {
    try {
      sessionStorage.setItem(TABS_KEY, JSON.stringify({ tabs, visible, focused }))
    } catch {
      /* layout just doesn't survive a reload */
    }
  }, [tabs, visible, focused])

  const split = visible.length === 2

  const updateMeta = (id: string, patch: { url?: string; title?: string }): void => {
    setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }

  const recordVisit = (url: string): void => {
    setHistory((h) =>
      h[0]?.url === url
        ? h
        : [{ url, title: '', at: new Date().toISOString() }, ...h].slice(0, HISTORY_CAP)
    )
  }

  const retitleVisit = (url: string, title: string): void => {
    setHistory((h) => {
      const i = h.findIndex((e) => e.url === url)
      if (i < 0 || h[i].title === title) return h
      const next = [...h]
      next[i] = { ...next[i], title }
      return next
    })
  }

  const toggleBookmark = (url: string, title: string): void => {
    if (!url) return
    setBookmarks((bs) =>
      bs.some((b) => b.url === url)
        ? bs.filter((b) => b.url !== url)
        : [{ url, title, at: new Date().toISOString() }, ...bs].slice(0, BOOKMARK_CAP)
    )
  }

  const selectTab = (id: string): void => {
    if (visible.includes(id)) {
      setFocused(id)
      return
    }
    // Not on screen: the focused slot switches to it, split partner stays.
    setVisible(visible.map((x) => (x === focused ? id : x)))
    setFocused(id)
  }

  const newTab = (): void => {
    const t = newTabMeta()
    setTabs([...tabs, t])
    setVisible(visible.map((x) => (x === focused ? t.id : x)))
    setFocused(t.id)
  }

  const closeTab = (id: string): void => {
    const remaining = tabs.filter((t) => t.id !== id)
    if (!remaining.length) {
      const fresh = newTabMeta()
      setTabs([fresh])
      setVisible([fresh.id])
      setFocused(fresh.id)
      return
    }
    let nextVisible = visible.filter((x) => x !== id)
    // Closing the only visible tab: show the first remaining one instead.
    if (!nextVisible.length) nextVisible = [remaining[0].id]
    setTabs(remaining)
    setVisible(nextVisible)
    setFocused(nextVisible.includes(focused) ? focused : nextVisible[0])
  }

  const toggleSplit = (): void => {
    if (split) {
      setVisible([focused])
      return
    }
    const other = tabs.find((t) => !visible.includes(t.id))
    if (other) {
      setVisible([...visible, other.id])
    } else {
      const t = newTabMeta()
      setTabs([...tabs, t])
      setVisible([...visible, t.id])
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-edge bg-panel px-2 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {tabs.map((t) => {
            const isVisible = visible.includes(t.id)
            const isFocused = focused === t.id
            return (
              <div
                key={t.id}
                className={`group flex max-w-[180px] shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 ${
                  isFocused
                    ? 'border-cyan-700 bg-cyan-950/40 text-cyan-200'
                    : isVisible
                      ? 'border-edge bg-panel2 text-gray-300'
                      : 'border-edge text-gray-500 hover:text-gray-300'
                }`}
                title={t.url || 'New tab'}
                onClick={() => selectTab(t.id)}
              >
                <Favicon url={t.url} />
                <span className="min-w-0 truncate text-[11px]">
                  {t.title || (t.url ? hostOf(t.url) : 'New tab')}
                </span>
                <button
                  className="shrink-0 opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
                  title="Close tab"
                  onClick={(e) => {
                    e.stopPropagation()
                    closeTab(t.id)
                  }}
                >
                  <X size={11} />
                </button>
              </div>
            )
          })}
        </div>
        <button className="btn px-2" title="New tab" onClick={newTab}>
          <Plus size={13} />
        </button>
        <button
          className={`btn px-2 ${split ? 'text-cyan-300' : ''}`}
          title={split ? 'Close split view' : 'Split view'}
          onClick={toggleSplit}
        >
          <Columns2 size={13} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {tabs.map((t) => (
          <BrowserPane
            key={t.id}
            initialUrl={t.url}
            visible={visible.includes(t.id)}
            focused={focused === t.id}
            split={split}
            slot={Math.max(0, visible.indexOf(t.id))}
            bookmarks={bookmarks}
            history={history}
            onFocus={() => setFocused(t.id)}
            onMeta={(patch) => updateMeta(t.id, patch)}
            onVisit={recordVisit}
            onRetitle={retitleVisit}
            onToggleBookmark={toggleBookmark}
            onRemoveBookmark={(url) => setBookmarks((bs) => bs.filter((b) => b.url !== url))}
            onClearHistory={() => setHistory([])}
          />
        ))}
      </div>
    </div>
  )
}

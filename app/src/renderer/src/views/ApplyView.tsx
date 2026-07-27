import { PanelRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ApplicationDetail } from '@shared/types'
import type { WebviewElement } from '../types.d'
import ConfirmDialog from '../components/ConfirmDialog'
import { FolderIcon } from '../components/icons'
import { call } from '../api'
import { useApp } from '../store'
import AnswersPanel from './detail/AnswersPanel'

function FileRow({ label, relPath }: { label: string; relPath: string }): JSX.Element {
  const toast = useApp((s) => s.toast)
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-2 rounded-md border border-edge bg-panel2 px-2.5 py-1.5">
      <span className="min-w-0 flex-1 truncate text-[11px] text-gray-300" title={relPath}>
        {label}
      </span>
      <button
        className="btn px-2 py-0.5 text-[10px]"
        title="Copy the absolute Windows path (paste into upload dialogs)"
        onClick={() => {
          void call('app:absPath', { relPath })
            .then(({ absPath }) => call('app:copy', { text: absPath }))
            .then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1200)
            })
            .catch((err) => toast(String(err), 'error'))
        }}
      >
        {copied ? '✓' : 'Copy path'}
      </button>
      <button
        className="btn px-2 py-0.5 text-[10px]"
        title="Reveal in Explorer"
        onClick={() =>
          void call('app:showItem', { relPath }).catch((err) => toast(String(err), 'error'))
        }
      >
        <FolderIcon />
      </button>
    </div>
  )
}

const PANEL_WIDTH_KEY = 'apply.panelWidth'

export default function ApplyView({ rowId }: { rowId: string }): JSX.Element {
  const rows = useApp((s) => s.rows)
  const navigate = useApp((s) => s.navigate)
  const toast = useApp((s) => s.toast)
  const row = rows.find((r) => r.id === rowId)
  const webviewRef = useRef<WebviewElement | null>(null)
  const [urlInput, setUrlInput] = useState('')
  const [currentUrl, setCurrentUrl] = useState('')
  const [canBack, setCanBack] = useState(false)
  const [canFwd, setCanFwd] = useState(false)
  const [detail, setDetail] = useState<ApplicationDetail | null>(null)
  const [confirmSubmit, setConfirmSubmit] = useState(false)
  const [panelOpen, setPanelOpen] = useState(true)
  const [panelWidth, setPanelWidth] = useState(() => {
    const saved = Number(localStorage.getItem(PANEL_WIDTH_KEY))
    return saved >= 280 && saved <= 640 ? saved : 340
  })
  // While a divider drag is live an overlay must cover the webview, or the
  // guest surface swallows mousemove and the drag freezes.
  const [dragging, setDragging] = useState(false)
  const startUrl = row?.applyUrl && /^https?:/i.test(row.applyUrl) ? row.applyUrl : ''

  const startDrag = (e: React.MouseEvent): void => {
    e.preventDefault()
    setDragging(true)
    const onMove = (ev: MouseEvent): void => {
      setPanelWidth(Math.min(640, Math.max(280, window.innerWidth - ev.clientX)))
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setDragging(false)
      setPanelWidth((w) => {
        localStorage.setItem(PANEL_WIDTH_KEY, String(w))
        return w
      })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  useEffect(() => {
    setUrlInput(startUrl)
    setCurrentUrl(startUrl)
  }, [rowId])

  useEffect(() => {
    call('detail:get', { rowId })
      .then(setDetail)
      .catch(() => setDetail(null))
  }, [rowId, row?.folderPath])

  useEffect(() => {
    const wv = webviewRef.current
    if (!wv) return
    const onNav = (): void => {
      try {
        setCurrentUrl(wv.getURL())
        setUrlInput(wv.getURL())
        setCanBack(wv.canGoBack())
        setCanFwd(wv.canGoForward())
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
  }, [rowId, startUrl])

  const go = (): void => {
    let u = urlInput.trim()
    if (!u) return
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u
    void webviewRef.current?.loadURL(u).catch(() => undefined)
  }

  const markSubmitted = async (): Promise<void> => {
    try {
      await call('tracker:markApplied', { id: rowId })
      toast('Marked as applied — date stamped, folder renamed [DONE]', 'success')
      setConfirmSubmit(false)
    } catch (err) {
      toast(String(err), 'error')
    }
  }

  if (!row) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-500">
        Row not found.
        <button className="btn ml-2" onClick={() => navigate({ view: 'tracker' })}>
          Back
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-edge bg-panel px-3 py-2">
        <button className="btn" onClick={() => navigate({ view: 'detail', rowId })}>
          ←
        </button>
        <button className="btn px-2" disabled={!canBack} onClick={() => webviewRef.current?.goBack()}>
          ◀
        </button>
        <button className="btn px-2" disabled={!canFwd} onClick={() => webviewRef.current?.goForward()}>
          ▶
        </button>
        <button className="btn px-2" onClick={() => webviewRef.current?.reload()}>
          ⟳
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
          title="Open in your system browser (for OAuth logins that block embedded views)"
          onClick={() =>
            void call('app:openExternal', { url: currentUrl || startUrl }).catch((err) =>
              toast(String(err), 'error')
            )
          }
        >
          ↗ Browser
        </button>
        <button
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-panel2 hover:text-gray-200"
          aria-label={panelOpen ? 'Hide side panel' : 'Show side panel'}
          title={panelOpen ? 'Hide side panel' : 'Show side panel'}
          onClick={() => setPanelOpen((v) => !v)}
        >
          <PanelRight size={15} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 bg-white">
          {startUrl || currentUrl ? (
            <webview
              ref={webviewRef as React.RefObject<HTMLElement>}
              src={startUrl || 'about:blank'}
              partition="persist:apply"
              // react-dom drops boolean-valued unknown attributes, so the value
              // must be a string at runtime; @types/react types it as boolean.
              allowpopups={'true' as unknown as boolean}
              className="h-full w-full"
              style={{ display: 'flex', height: '100%', width: '100%' }}
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-bg text-sm text-gray-500">
              No apply URL on this row — paste one in the address bar above.
            </div>
          )}
        </div>

        {panelOpen && (
          <>
            <div
              className="w-1 shrink-0 cursor-col-resize bg-edge transition-colors hover:bg-cyan-500"
              onMouseDown={startDrag}
              title="Drag to resize"
            />
            <div className="flex shrink-0 flex-col" style={{ width: panelWidth }}>
              <div className="border-b border-edge bg-panel px-3 py-2">
                <div className="truncate text-xs font-semibold text-gray-100">
                  {row.position} <span className="text-gray-500">@</span> {row.company}
                </div>
                <div className="mt-2 flex flex-col gap-1.5">
                  {row.resumePath && (
                    <FileRow
                      label={row.resumePath.split('/').pop() ?? 'Resume.pdf'}
                      relPath={row.resumePath}
                    />
                  )}
                  {row.coverLetterPath && (
                    <FileRow
                      label={row.coverLetterPath.split('/').pop() ?? 'Cover_Letter.pdf'}
                      relPath={row.coverLetterPath}
                    />
                  )}
                </div>
                <button
                  className="btn btn-green mt-2 w-full justify-center"
                  onClick={() => setConfirmSubmit(true)}
                >
                  ✓ Mark submitted
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                {detail ? (
                  <AnswersPanel detail={detail} showInsert />
                ) : (
                  <div className="p-4 text-xs text-gray-600">No answers file found.</div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {dragging && <div className="fixed inset-0 z-40 cursor-col-resize" />}

      <ConfirmDialog
        open={confirmSubmit}
        title="Mark as submitted?"
        body="Stamps today's date, flips the status to applied (green), and renames the application folder to the [DONE] convention."
        confirmLabel="Mark submitted"
        onConfirm={() => void markSubmitted()}
        onCancel={() => setConfirmSubmit(false)}
      />
    </div>
  )
}

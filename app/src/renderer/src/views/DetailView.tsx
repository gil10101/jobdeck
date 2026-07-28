import { ArrowLeft, ArrowRight, Check, Mic, PanelRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ApplicationDetail } from '@shared/types'
import StatusBadge from '../components/StatusBadge'
import ConfirmDialog from '../components/ConfirmDialog'
import { FolderIcon } from '../components/icons'
import { call } from '../api'
import { useApp } from '../store'
import PdfPane from './detail/PdfPane'
import AnswersPanel from './detail/AnswersPanel'
import DetailChatPanel from './detail/DetailChatPanel'
import PostingPanel from './detail/PostingPanel'

const PANEL_WIDTH_KEY = 'detail.panelWidth'

export default function DetailView({ rowId }: { rowId: string }): JSX.Element {
  const rows = useApp((s) => s.rows)
  const navigate = useApp((s) => s.navigate)
  const toast = useApp((s) => s.toast)
  const [detail, setDetail] = useState<ApplicationDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'answers' | 'posting' | 'chat'>('answers')
  const [confirmSubmit, setConfirmSubmit] = useState(false)
  // Bumped when the revision chat edits files, forcing PDF iframes to reload.
  const [chatTick, setChatTick] = useState(0)
  const [panelOpen, setPanelOpen] = useState(true)
  const [panelWidth, setPanelWidth] = useState(() => {
    const saved = Number(localStorage.getItem(PANEL_WIDTH_KEY))
    return saved >= 280 && saved <= 640 ? saved : 380
  })
  // While a divider drag is live an overlay must cover the PDF iframes, or
  // the embedded surface swallows mousemove and the drag freezes.
  const [dragging, setDragging] = useState(false)
  const row = rows.find((r) => r.id === rowId)

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
    setDetail(null)
    setError(null)
    call('detail:get', { rowId })
      .then(setDetail)
      .catch((err) => setError(String(err)))
  }, [rowId, row?.folderPath, row?.statusKey, chatTick])

  const markSubmitted = async (): Promise<void> => {
    try {
      await call('tracker:markApplied', { id: rowId })
      toast('Marked as applied — date stamped', 'success')
      setConfirmSubmit(false)
    } catch (err) {
      toast(String(err), 'error')
    }
  }

  if (!row) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-500">
        Row not found.{' '}
        <button className="btn ml-2" onClick={() => navigate({ view: 'tracker' })}>
          Back to tracker
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-edge bg-panel px-4 py-2.5">
        <button className="btn" onClick={() => navigate({ view: 'tracker' })}>
          <ArrowLeft size={14} />
        </button>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-gray-100">
            {row.position} <span className="text-gray-500">@</span> {row.company}
          </div>
          <div className="text-[11px] text-gray-500">
            {[row.salary, row.location, row.dateApplied ? `applied ${row.dateApplied}` : null]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
        <StatusBadge
          statusKey={row.statusKey}
          statusText={row.statusText}
          editable
          onChange={(key) =>
            void call('tracker:upsert', { id: row.id, statusKey: key }).catch((err) =>
              toast(String(err), 'error')
            )
          }
        />
        <div className="ml-auto flex items-center gap-2">
          {row.statusKey === 'not_applied' && (
            <button className="btn btn-green" onClick={() => setConfirmSubmit(true)}>
              <Check size={13} /> Mark submitted
            </button>
          )}
          {row.folderPath && (
            <button
              className="btn"
              title="Spawn an agent that writes interview_prep.md for this application (questions, answers from your real record, gap framings)"
              onClick={() => {
                void call('interview:start', { rowId })
                  .then((meta) => {
                    toast(`Interview prep queued (${meta.slug})`, 'success')
                    navigate({ view: 'runs', runId: meta.id })
                  })
                  .catch((err) => toast(String(err), 'error'))
              }}
            >
              <Mic size={13} /> Prep interview
            </button>
          )}
          {row.folderPath && (
            <button
              className="btn"
              onClick={() =>
                void call('app:openFolder', { relPath: row.folderPath! }).catch((err) =>
                  toast(String(err), 'error')
                )
              }
            >
              <FolderIcon /> Folder
            </button>
          )}
          <button className="btn btn-primary" onClick={() => navigate({ view: 'apply', rowId })}>
            Apply <ArrowRight size={13} />
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
      </div>

      {error && <div className="border-b border-red-900 bg-red-950/40 px-4 py-2 text-xs text-red-300">{error}</div>}

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          {detail ? (
            <PdfPane detail={detail} refreshTick={chatTick} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-gray-600">
              {error ? 'Could not load folder contents' : 'Loading…'}
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
              <div className="flex items-center gap-1 border-b border-edge bg-panel px-2 py-1.5">
                <button
                  onClick={() => setTab('answers')}
                  className={`rounded-md px-3 py-1 text-xs font-medium ${tab === 'answers' ? 'bg-cyan-950/60 text-cyan-200' : 'text-gray-400 hover:bg-panel2'}`}
                >
                  Answers
                </button>
                <button
                  onClick={() => setTab('posting')}
                  className={`rounded-md px-3 py-1 text-xs font-medium ${tab === 'posting' ? 'bg-cyan-950/60 text-cyan-200' : 'text-gray-400 hover:bg-panel2'}`}
                >
                  Posting & Fit
                </button>
                <button
                  onClick={() => setTab('chat')}
                  className={`rounded-md px-3 py-1 text-xs font-medium ${tab === 'chat' ? 'bg-cyan-950/60 text-cyan-200' : 'text-gray-400 hover:bg-panel2'}`}
                >
                  Chat
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                {detail ? (
                  tab === 'answers' ? (
                    <AnswersPanel detail={detail} />
                  ) : tab === 'posting' ? (
                    <PostingPanel detail={detail} />
                  ) : (
                    <DetailChatPanel rowId={rowId} onActivity={() => setChatTick((t) => t + 1)} />
                  )
                ) : null}
              </div>
            </div>
          </>
        )}
      </div>

      {dragging && <div className="fixed inset-0 z-40 cursor-col-resize" />}

      <ConfirmDialog
        open={confirmSubmit}
        title="Mark as submitted?"
        body={`Stamps today's date, flips the status to applied (green), and renames the folder to "[DONE] ${row.slug ?? ''}" per the repo convention (paths update automatically).`}
        confirmLabel="Mark submitted"
        onConfirm={() => void markSubmitted()}
        onCancel={() => setConfirmSubmit(false)}
      />
    </div>
  )
}

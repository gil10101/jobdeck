import { MessageCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useApp } from '../../store'
import AssistantPanel from './AssistantPanel'

// Panel geometry: matches the wrapper classes below; used for drag clamping.
const PANEL_W = 400
const MARGIN = 8
// Keep the panel off the sidebar (w-44 = 176px) so navigation stays reachable.
const SIDEBAR_W = 176

export default function AssistantFab(): JSX.Element {
  const open = useApp((s) => s.assistant.open)
  const toggleAssistant = useApp((s) => s.toggleAssistant)

  // Mounted on first open and kept mounted after, so closing the panel
  // preserves its local state (composer draft, scroll position).
  const [everOpened, setEverOpened] = useState(false)
  useEffect(() => {
    if (open) setEverOpened(true)
  }, [open])

  // null = default docked position (bottom-right); set once the user drags.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  const clampToViewport = (x: number, y: number): { x: number; y: number } => {
    const h = panelRef.current?.getBoundingClientRect().height ?? 600
    return {
      x: Math.min(Math.max(x, SIDEBAR_W + MARGIN), window.innerWidth - PANEL_W - MARGIN),
      y: Math.min(Math.max(y, MARGIN), window.innerHeight - h - MARGIN)
    }
  }

  const onHeaderPointerDown = (e: React.PointerEvent): void => {
    // Header buttons (history, new chat, close) must keep working normally.
    if ((e.target as HTMLElement).closest('button')) return
    const rect = panelRef.current?.getBoundingClientRect()
    if (!rect) return
    const offsetX = e.clientX - rect.left
    const offsetY = e.clientY - rect.top
    setDragging(true)
    const onMove = (ev: PointerEvent): void =>
      setPos(clampToViewport(ev.clientX - offsetX, ev.clientY - offsetY))
    const onUp = (): void => {
      setDragging(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <>
      <button
        className={`fixed bottom-5 right-5 z-50 flex h-[52px] w-[52px] items-center justify-center rounded-full border border-edge bg-panel text-cyan-400 shadow-lg transition-all duration-200 ease-out hover:ring-2 hover:ring-cyan-700 motion-reduce:transition-none ${
          open ? 'pointer-events-none scale-0 opacity-0' : 'scale-100 opacity-100'
        }`}
        onClick={() => toggleAssistant(true)}
        aria-label="Open assistant"
      >
        <MessageCircle size={22} strokeWidth={1.75} aria-hidden="true" />
      </button>
      {/* Wrapper stays mounted while closed (scaled to 0) so both open and close animate. */}
      <div
        ref={panelRef}
        className={`fixed z-50 h-[min(85vh,720px)] w-[400px] max-w-[calc(100vw-2.5rem)] origin-bottom-right overflow-hidden rounded-xl border border-edge bg-panel shadow-2xl motion-reduce:transition-none ${
          dragging ? '' : 'transition-all duration-200 ease-out'
        } ${open ? 'scale-100 opacity-100' : 'pointer-events-none scale-0 opacity-0'}`}
        style={pos ? { left: pos.x, top: pos.y } : { right: 20, bottom: 20 }}
        aria-hidden={!open}
      >
        {everOpened && <AssistantPanel onDragHandlePointerDown={onHeaderPointerDown} />}
      </div>
    </>
  )
}

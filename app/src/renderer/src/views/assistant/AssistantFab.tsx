import { useEffect, useState } from 'react'
import { useApp } from '../../store'
import AssistantPanel from './AssistantPanel'

export default function AssistantFab(): JSX.Element {
  const open = useApp((s) => s.assistant.open)
  const toggleAssistant = useApp((s) => s.toggleAssistant)

  // Mounted on first open and kept mounted after, so closing the panel
  // preserves its local state (composer draft, scroll position).
  const [everOpened, setEverOpened] = useState(false)
  useEffect(() => {
    if (open) setEverOpened(true)
  }, [open])

  return (
    <div className="fixed bottom-5 right-5 z-50 h-[52px] w-[52px]">
      <button
        className={`absolute bottom-0 right-0 flex h-[52px] w-[52px] items-center justify-center rounded-full border border-edge bg-panel text-cyan-400 shadow-lg transition-all duration-200 ease-out hover:ring-2 hover:ring-cyan-700 motion-reduce:transition-none ${
          open ? 'pointer-events-none scale-0 opacity-0' : 'scale-100 opacity-100'
        }`}
        onClick={() => toggleAssistant(true)}
        aria-label="Open assistant"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="4" width="18" height="13" rx="2" />
          <path d="M8 17v4l5-4" />
        </svg>
      </button>
      {/* Wrapper stays mounted while closed (scaled to 0) so both open and close animate. */}
      <div
        className={`absolute bottom-0 right-0 h-[min(85vh,720px)] w-[400px] max-w-[calc(100vw-2.5rem)] origin-bottom-right overflow-hidden rounded-xl border border-edge bg-panel shadow-2xl transition-all duration-200 ease-out motion-reduce:transition-none ${
          open ? 'scale-100 opacity-100' : 'pointer-events-none scale-0 opacity-0'
        }`}
        aria-hidden={!open}
      >
        {everOpened && <AssistantPanel />}
      </div>
    </div>
  )
}

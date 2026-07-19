import { History, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { useApp } from '../../store'
import Composer from './Composer'
import MessageList from './MessageList'
import TokenDonut from './TokenDonut'

export default function AssistantPanel({
  onDragHandlePointerDown
}: {
  /** Attached to the header so the floating panel can be dragged by it. */
  onDragHandlePointerDown?: (e: React.PointerEvent) => void
}): JSX.Element {
  const conversationId = useApp((s) => s.assistant.conversationId)
  const messages = useApp((s) => s.assistant.messages)
  const streaming = useApp((s) => s.assistant.streaming)
  const usage = useApp((s) => s.assistant.usage)
  const status = useApp((s) => s.assistant.status)
  const pendingApproval = useApp((s) => s.assistant.pendingApproval)
  const history = useApp((s) => s.assistant.history)
  const model = useApp((s) => s.assistant.model)
  const toggleAssistant = useApp((s) => s.toggleAssistant)
  const setAssistantModel = useApp((s) => s.setAssistantModel)
  const sendAssistant = useApp((s) => s.sendAssistant)
  const stopAssistant = useApp((s) => s.stopAssistant)
  const approveAssistant = useApp((s) => s.approveAssistant)
  const newAssistantChat = useApp((s) => s.newAssistantChat)
  const openAssistantChat = useApp((s) => s.openAssistantChat)
  const deleteAssistantChat = useApp((s) => s.deleteAssistantChat)
  const refreshAssistantHistory = useApp((s) => s.refreshAssistantHistory)

  const [historyOpen, setHistoryOpen] = useState(false)

  // Conversations are created lazily by sendAssistant and persisted on the
  // first message, so opening the panel or clicking "+" never leaves an empty
  // conversation file behind.
  const title = history.find((h) => h.id === conversationId)?.title ?? 'Assistant'

  const iconBtn =
    'flex h-7 w-7 items-center justify-center rounded-md text-sm text-gray-400 transition-colors hover:bg-panel2 hover:text-gray-200'

  return (
    <div className="flex h-full w-full flex-col">
      <div
        className="flex cursor-grab select-none items-center gap-2 border-b border-edge px-3 py-2 active:cursor-grabbing"
        onPointerDown={onDragHandlePointerDown}
      >
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-gray-100">
          {title}
        </span>
        <TokenDonut usage={usage} />
        <div className="relative">
          <button
            className={iconBtn}
            onClick={() => {
              const next = !historyOpen
              setHistoryOpen(next)
              if (next) void refreshAssistantHistory()
            }}
            onBlur={() => setTimeout(() => setHistoryOpen(false), 150)}
            aria-label="Conversation history"
            title="Conversation history"
          >
            <History size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
          {historyOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 max-h-72 w-56 overflow-auto rounded-md border border-edge bg-panel2 shadow-xl">
              {history.length === 0 && (
                <div className="px-3 py-2 text-[11px] text-gray-500">No past conversations</div>
              )}
              {history.map((h) => (
                <div key={h.id} className="group flex items-center hover:bg-panel">
                  <button
                    className={`min-w-0 flex-1 truncate px-3 py-1.5 text-left text-xs ${
                      h.id === conversationId ? 'text-cyan-300' : 'text-gray-200'
                    }`}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      void openAssistantChat(h.id)
                      setHistoryOpen(false)
                    }}
                  >
                    {h.title}
                  </button>
                  <button
                    className="invisible shrink-0 px-2 py-1.5 text-[10px] text-gray-500 hover:text-red-400 group-hover:visible"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      void deleteAssistantChat(h.id)
                    }}
                    aria-label={`Delete "${h.title}"`}
                    title="Delete conversation"
                  >
                    <X size={11} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <button
          className={iconBtn}
          onClick={() => void newAssistantChat()}
          aria-label="New chat"
          title="New chat"
        >
          <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button
          className={iconBtn}
          onClick={() => toggleAssistant(false)}
          aria-label="Close assistant"
          title="Close assistant"
        >
          <X size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      <MessageList
        messages={messages}
        streaming={streaming}
        pendingApproval={pendingApproval}
        onDecide={approveAssistant}
      />
      <Composer
        status={status}
        model={model}
        onModelChange={setAssistantModel}
        onSend={(text) => void sendAssistant(text)}
        onStop={stopAssistant}
      />
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useApp } from '../../store'
import Composer from './Composer'
import MessageList from './MessageList'
import TokenDonut from './TokenDonut'

export default function AssistantPanel(): JSX.Element {
  const conversationId = useApp((s) => s.assistant.conversationId)
  const messages = useApp((s) => s.assistant.messages)
  const streaming = useApp((s) => s.assistant.streaming)
  const usage = useApp((s) => s.assistant.usage)
  const status = useApp((s) => s.assistant.status)
  const pendingApproval = useApp((s) => s.assistant.pendingApproval)
  const history = useApp((s) => s.assistant.history)
  const toggleAssistant = useApp((s) => s.toggleAssistant)
  const sendAssistant = useApp((s) => s.sendAssistant)
  const stopAssistant = useApp((s) => s.stopAssistant)
  const approveAssistant = useApp((s) => s.approveAssistant)
  const newAssistantChat = useApp((s) => s.newAssistantChat)
  const openAssistantChat = useApp((s) => s.openAssistantChat)
  const refreshAssistantHistory = useApp((s) => s.refreshAssistantHistory)

  const [historyOpen, setHistoryOpen] = useState(false)

  // First-open race guard: pushes are dropped unless conversationId matches the active
  // conversation, so one must exist before the first send can be issued.
  useEffect(() => {
    if (conversationId === null) void newAssistantChat()
  }, [conversationId])

  const title = history.find((h) => h.id === conversationId)?.title ?? 'Assistant'

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-gray-100">
          {title}
        </span>
        <TokenDonut usage={usage} />
        <div className="relative">
          <button
            className="btn px-1.5 py-1"
            onClick={() => {
              const next = !historyOpen
              setHistoryOpen(next)
              if (next) void refreshAssistantHistory()
            }}
            onBlur={() => setTimeout(() => setHistoryOpen(false), 150)}
            aria-label="Conversation history"
            title="Conversation history"
          >
            ▾
          </button>
          {historyOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 max-h-72 w-56 overflow-auto rounded-md border border-edge bg-panel2 shadow-xl">
              {history.length === 0 && (
                <div className="px-3 py-2 text-[11px] text-gray-500">No past conversations</div>
              )}
              {history.map((h) => (
                <button
                  key={h.id}
                  className={`block w-full truncate px-3 py-1.5 text-left text-xs hover:bg-panel ${
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
              ))}
            </div>
          )}
        </div>
        <button
          className="btn px-1.5 py-1"
          onClick={() => void newAssistantChat()}
          aria-label="New chat"
          title="New chat"
        >
          +
        </button>
        <button
          className="btn px-1.5 py-1"
          onClick={() => toggleAssistant(false)}
          aria-label="Close assistant"
          title="Close assistant"
        >
          ✕
        </button>
      </div>
      <MessageList
        messages={messages}
        streaming={streaming}
        pendingApproval={pendingApproval}
        onDecide={approveAssistant}
      />
      <Composer status={status} onSend={(text) => void sendAssistant(text)} onStop={stopAssistant} />
    </div>
  )
}

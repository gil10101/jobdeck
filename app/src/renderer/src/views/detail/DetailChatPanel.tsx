import { useEffect, useRef, useState } from 'react'
import { useApp } from '../../store'
import MessageList from '../assistant/MessageList'

/** Revision chat for one application. Edits apply directly (no approval
 *  cards); onActivity fires when an assistant turn lands so the parent can
 *  re-read the folder and refresh the PDFs. */
export default function DetailChatPanel({
  rowId,
  onActivity
}: {
  rowId: string
  onActivity: () => void
}): JSX.Element {
  const chat = useApp((s) => s.detailChat)
  const openDetailChat = useApp((s) => s.openDetailChat)
  const sendDetailChat = useApp((s) => s.sendDetailChat)
  const stopDetailChat = useApp((s) => s.stopDetailChat)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (chat.rowId !== rowId) void openDetailChat(rowId)
  }, [rowId])

  // Refresh the folder view once per completed assistant turn (not on load).
  const lastCount = useRef<number | null>(null)
  const assistantCount = chat.messages.filter((m) => m.role === 'assistant').length
  useEffect(() => {
    if (lastCount.current !== null && assistantCount > lastCount.current) onActivity()
    lastCount.current = assistantCount
  }, [assistantCount])

  const send = (): void => {
    const text = draft.trim()
    if (!text) return
    void sendDetailChat(text)
    setDraft('')
  }

  return (
    <div className="flex h-full flex-col">
      <MessageList
        messages={chat.messages}
        streaming={chat.streaming}
        pendingApproval={null}
        onDecide={() => undefined}
      />
      {chat.messages.length === 0 && !chat.streaming && (
        <div className="px-4 pb-2 text-[11px] leading-relaxed text-gray-600">
          Ask for revisions ("shorten the cover letter's second paragraph", "swap the featured
          project for Orchid") or paste a question the company asked — the agent drafts an answer
          here and files it once you approve.
        </div>
      )}
      <div className="border-t border-edge p-2">
        <textarea
          className="input min-h-[2.5rem] w-full resize-none"
          rows={2}
          placeholder="Feedback, revision requests, or a question the company asked…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
        />
        <div className="mt-1.5 flex justify-end gap-2">
          {chat.status !== 'idle' && (
            <button className="btn btn-danger" onClick={stopDetailChat}>
              Stop
            </button>
          )}
          <button className="btn btn-primary" disabled={!draft.trim()} onClick={send}>
            Send
          </button>
        </div>
      </div>
    </div>
  )
}

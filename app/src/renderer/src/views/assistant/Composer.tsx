import { useState } from 'react'
import type { AssistantStatus } from '@shared/types'

export default function Composer({
  status,
  onSend,
  onStop
}: {
  status: AssistantStatus
  onSend: (text: string) => void
  onStop: () => void
}): JSX.Element {
  const [draft, setDraft] = useState('')

  const send = (): void => {
    const text = draft.trim()
    if (!text) return
    onSend(text)
    setDraft('')
  }

  return (
    <div className="border-t border-edge p-2">
      <textarea
        className="input min-h-[2.5rem] w-full resize-none"
        rows={2}
        placeholder="Ask the assistant…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            send()
          }
        }}
      />
      <div className="mt-1.5 flex justify-end gap-2">
        {status !== 'idle' && (
          <button className="btn btn-danger" onClick={onStop}>
            Stop
          </button>
        )}
        <button className="btn btn-primary" disabled={!draft.trim()} onClick={send}>
          Send
        </button>
      </div>
    </div>
  )
}

import { useState } from 'react'
import type { AssistantStatus } from '@shared/types'
import { modelOptionsWith } from '../../lib/models'
import { useApp } from '../../store'

export default function Composer({
  status,
  model,
  onModelChange,
  onSend,
  onStop
}: {
  status: AssistantStatus
  model: string
  onModelChange: (model: string) => void
  onSend: (text: string) => void
  onStop: () => void
}): JSX.Element {
  const [draft, setDraft] = useState('')
  // Under gemini/ollama the backend model comes from Settings; a Claude
  // picker here would silently do nothing.
  const provider = useApp((s) => s.settings?.provider ?? 'claude')

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
          // IME users confirm a composition candidate with Enter; that Enter
          // must not send the half-composed draft.
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            send()
          }
        }}
      />
      <div className="mt-1.5 flex items-center gap-2">
        {provider === 'claude' ? (
          <select
            className="input h-6 w-auto px-1.5 py-0 text-[10px] text-gray-400"
            value={model}
            onChange={(e) => onModelChange(e.target.value)}
            aria-label="Model"
            title="Model for assistant replies (applies from the next reply)"
          >
            {modelOptionsWith(model).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <span
            className="text-[10px] text-gray-500"
            title="Model comes from Settings → Model provider"
          >
            via {provider}
          </span>
        )}
        <div className="flex-1" />
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

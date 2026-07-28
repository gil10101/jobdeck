import { useState } from 'react'
import { Check, Keyboard } from 'lucide-react'
import { call } from '../api'
import { useApp } from '../store'

export default function CopyField({
  label,
  value,
  showInsert
}: {
  label: string
  value: string
  showInsert?: boolean
}): JSX.Element {
  const [copied, setCopied] = useState(false)
  const settings = useApp((s) => s.settings)

  const copy = async (): Promise<void> => {
    await call('app:copy', { text: value })
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  const insert = async (e: React.MouseEvent): Promise<void> => {
    e.preventDefault()
    try {
      await call('apply:insertText', { text: value })
    } catch (err) {
      useApp.getState().toast(String(err), 'error')
    }
  }

  return (
    <div
      className="group flex cursor-pointer items-start justify-between gap-2 rounded-md border border-transparent px-2 py-1.5 hover:border-edge hover:bg-panel2"
      onClick={copy}
      title="Click to copy"
    >
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
        <div className="break-words text-xs text-gray-200">{value || '—'}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1 pt-0.5">
        {showInsert && settings?.insertTextEnabled && (
          <button
            className="rounded border border-edge px-1.5 py-0.5 text-[10px] text-gray-400 opacity-0 transition-opacity hover:text-cyan-300 group-hover:opacity-100"
            onMouseDown={insert}
            title="Type into focused field in the embedded browser"
          >
            <Keyboard size={13} />
          </button>
        )}
        <span
          className={`inline-flex items-center gap-0.5 text-[10px] ${copied ? 'text-green-400' : 'text-gray-500 opacity-0 group-hover:opacity-100'}`}
        >
          {copied ? (
            <>
              <Check size={10} /> copied
            </>
          ) : (
            'copy'
          )}
        </span>
      </div>
    </div>
  )
}

import { useState } from 'react'
import type { StatusKey } from '@shared/types'
import { ALL_STATUS_KEYS, STATUS_COLOR_STYLES, STATUS_LABELS, statusColor } from '@shared/status'

export function statusDotColor(key: StatusKey): string {
  return STATUS_COLOR_STYLES[statusColor(key)].dot
}

export default function StatusBadge({
  statusKey,
  statusText,
  editable,
  onChange
}: {
  statusKey: StatusKey
  statusText?: string
  editable?: boolean
  onChange?: (key: StatusKey) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const style = STATUS_COLOR_STYLES[statusColor(statusKey)]

  return (
    <div className="relative inline-block">
      <button
        disabled={!editable}
        onClick={() => editable && setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        title={statusText}
        className="inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
        style={{ background: style.bg, color: style.text }}
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: style.dot }} />
        <span className="truncate">{statusText || STATUS_LABELS[statusKey]}</span>
        {editable && <span className="opacity-60">▾</span>}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-40 overflow-hidden rounded-md border border-edge bg-panel2 shadow-xl">
          {ALL_STATUS_KEYS.map((key) => {
            const s = STATUS_COLOR_STYLES[statusColor(key)]
            return (
              <button
                key={key}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-200 hover:bg-panel"
                onMouseDown={(e) => {
                  e.preventDefault()
                  onChange?.(key)
                  setOpen(false)
                }}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: s.dot }} />
                {STATUS_LABELS[key]}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

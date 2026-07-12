import { useApp } from '../store'

const KIND_STYLES = {
  info: 'border-edge bg-panel2 text-gray-200',
  success: 'border-green-800 bg-green-950 text-green-200',
  error: 'border-red-900 bg-red-950 text-red-200'
} as const

export default function ToastHost(): JSX.Element {
  const toasts = useApp((s) => s.toasts)
  const dismiss = useApp((s) => s.dismissToast)
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-96 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-xs shadow-xl ${KIND_STYLES[t.kind]}`}
        >
          <span className="break-words leading-relaxed">{t.text}</span>
          <button className="shrink-0 opacity-60 hover:opacity-100" onClick={() => dismiss(t.id)}>
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}

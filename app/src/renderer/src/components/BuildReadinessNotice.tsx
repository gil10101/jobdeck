import { AlertTriangle, Info } from 'lucide-react'
import { useApp } from '../store'

/**
 * Why builds will be refused (no candidate material at all) or will run in
 * the reduced no-profile mode, with the one click that fixes it. Renders
 * nothing once a profile exists.
 */
export default function BuildReadinessNotice(): JSX.Element | null {
  const readiness = useApp((s) => s.buildReadiness)
  const navigate = useApp((s) => s.navigate)
  if (!readiness || readiness.mode === 'profile') return null

  if (readiness.mode === 'blocked') {
    return (
      <div className="flex items-center gap-2 border-b border-edge bg-panel2 px-4 py-2 text-[11px] text-amber-300">
        <AlertTriangle size={12} className="shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1">{readiness.message}</span>
        <button className="btn btn-primary px-2 py-0.5 text-[10px]" onClick={() => navigate({ view: 'library' })}>
          Add my résumé
        </button>
        <button className="btn px-2 py-0.5 text-[10px]" onClick={() => navigate({ view: 'settings' })}>
          Set up profile
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 border-b border-edge bg-panel2 px-4 py-1.5 text-[11px] text-gray-400">
      <Info size={12} className="shrink-0 text-cyan-400" aria-hidden="true" />
      <span className="min-w-0 flex-1">{readiness.message}</span>
      <button className="btn px-2 py-0.5 text-[10px]" onClick={() => navigate({ view: 'settings' })}>
        Set up profile
      </button>
    </div>
  )
}

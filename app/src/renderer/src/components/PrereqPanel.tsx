import { useEffect } from 'react'
import { AlertTriangle, Check, ExternalLink, RefreshCw } from 'lucide-react'
import { call } from '../api'
import { PROVIDER_LABEL } from '../lib/providers'
import { useApp } from '../store'

/**
 * What this host is missing for the ACTIVE provider, and how to fix it. Both
 * the rows and the line describing their scope come from env:check — the main
 * process decides which prerequisites apply, so onboarding and Settings render
 * the same verdict and a backend switch moves both at once. Nothing is filtered
 * here. Advisory only: no screen blocks on it, because a check can be wrong and
 * the user may know better.
 */
export default function PrereqPanel({ className = 'mt-4' }: { className?: string }): JSX.Element | null {
  const { tools, provider, scopeNote, error, checking } = useApp((s) => s.preflight)
  const refresh = useApp((s) => s.refreshPreflight)
  // Named only when env:check knew it: before a workspace exists the provider
  // is unknowable, and claiming one would be a guess.
  const subject = provider ? PROVIDER_LABEL[provider] : 'this setup'

  // Self-sufficient: any surface can drop this in without arranging a check.
  useEffect(() => {
    if (!tools && !error && !checking) void refresh()
  }, [])

  const recheck = (
    <button className="btn ml-auto py-0.5 text-[10px]" disabled={checking} onClick={() => void refresh()}>
      <RefreshCw size={10} /> {checking ? 'Checking…' : 'Re-check'}
    </button>
  )

  // A check that failed must never look like a check that passed.
  if (error) {
    return (
      <div className={`${className} rounded-md border border-amber-700 bg-amber-950/30 p-3`}>
        <div className="flex items-center gap-2 text-[11px] font-medium text-amber-300">
          <AlertTriangle size={12} className="shrink-0" />
          Could not check prerequisites
          {recheck}
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-gray-400">{error}</p>
      </div>
    )
  }
  if (!tools || !tools.length) return null

  const missing = tools.filter((t) => !t.ok)
  if (!missing.length) {
    return (
      <div className={`${className} text-[11px] leading-relaxed`}>
        <p className="text-green-300">
          <Check size={11} className="mr-1 inline" />
          Everything {subject} needs was found on this machine: {tools.map((t) => t.label).join(', ')}.
        </p>
        <p className="mt-1 text-[10px] leading-relaxed text-gray-500">{scopeNote}</p>
      </div>
    )
  }
  return (
    <div className={`${className} rounded-md border border-amber-700 bg-amber-950/30 p-3`}>
      <div className="flex items-center gap-2 text-[11px] font-medium text-amber-300">
        <AlertTriangle size={12} className="shrink-0" />
        {missing.length} prerequisite{missing.length === 1 ? '' : 's'}
        {provider ? ` for ${PROVIDER_LABEL[provider]}` : ''} not found
        {recheck}
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-gray-500">{scopeNote}</p>
      <ul className="mt-2 flex flex-col gap-2">
        {missing.map((t) => (
          <li key={t.id} className="text-[11px] leading-relaxed">
            <span className="text-amber-200">{t.label}</span>
            {!t.required && <span className="ml-1 text-[10px] text-gray-500">(optional)</span>}
            <span className="text-gray-500"> — {t.detail}</span>
            <div className="text-gray-400">{t.remedy}</div>
            <button
              className="text-cyan-300 hover:underline"
              onClick={() => void call('app:openExternal', { url: t.url })}
            >
              {t.url} <ExternalLink size={9} className="inline" />
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[10px] leading-relaxed text-gray-500">
        You can continue anyway — agent runs will fail while a required item above is missing.
      </p>
    </div>
  )
}

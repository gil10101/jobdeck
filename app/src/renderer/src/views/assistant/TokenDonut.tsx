import type { AssistantUsage } from '@shared/types'

// r=9 ring; strokeDasharray is the full circumference so strokeDashoffset can reveal a
// fraction of it. The svg is rotated -90deg so the visible arc grows clockwise from 12 o'clock.
const RADIUS = 9
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export default function TokenDonut({ usage }: { usage: AssistantUsage }): JSX.Element {
  const fraction =
    usage.contextWindow > 0 ? Math.min(1, usage.contextTokens / usage.contextWindow) : 0
  const offset = CIRCUMFERENCE * (1 - fraction)
  const contextK = Math.round(usage.contextTokens / 1000)
  const totalK = Math.round((usage.inputTokens + usage.outputTokens + usage.cacheTokens) / 1000)

  return (
    <div
      className="flex items-center gap-1.5"
      title="Total tokens this conversation has consumed, and current context size"
    >
      <svg width="24" height="24" viewBox="0 0 24 24" className="-rotate-90" aria-hidden="true">
        <circle cx="12" cy="12" r={RADIUS} fill="none" strokeWidth="2.5" className="stroke-edge" />
        <circle
          cx="12"
          cy="12"
          r={RADIUS}
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          className="stroke-cyan-500"
        />
      </svg>
      <div className="flex flex-col text-[10px] leading-tight text-muted">
        <span>{totalK}k tok</span>
        <span>{contextK}k ctx</span>
      </div>
    </div>
  )
}

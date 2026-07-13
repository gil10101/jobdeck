import { call } from '../api'

/** Tiny inline Glassdoor rating pill — a muted dash when there's no cached rating. */
export default function RatingBadge(props: {
  rating: number | null
  url?: string | null
}): JSX.Element {
  const { rating, url } = props

  if (rating == null) return <span className="text-[10px] text-gray-500">–</span>

  const content = (
    <>
      <span className="text-amber-300">★</span>
      <span className="text-gray-200">{rating.toFixed(1)}</span>
    </>
  )

  // Defense in depth: the URL originates from an LLM lookup, so only ever hand
  // an https URL to openExternal (blocks javascript:/file: and the like).
  const safeUrl = url && /^https:\/\//i.test(url) ? url : null
  if (!safeUrl) return <span className="chip gap-1 text-[10px]">{content}</span>

  return (
    <button
      type="button"
      className="chip gap-1 text-[10px] hover:border-gray-500"
      title="Open Glassdoor"
      onClick={(e) => {
        e.stopPropagation()
        void call('app:openExternal', { url: safeUrl }).catch(() => undefined)
      }}
    >
      {content}
    </button>
  )
}

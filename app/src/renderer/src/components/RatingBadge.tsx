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

  if (!url) return <span className="chip gap-1 text-[10px]">{content}</span>

  return (
    <button
      type="button"
      className="chip gap-1 text-[10px] hover:border-gray-500"
      title="Open Glassdoor"
      onClick={(e) => {
        e.stopPropagation()
        void call('app:openExternal', { url }).catch(() => undefined)
      }}
    >
      {content}
    </button>
  )
}

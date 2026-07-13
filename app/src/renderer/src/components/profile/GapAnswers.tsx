/**
 * Extraction gaps as answerable questions. Blank answer = dismissed —
 * there is deliberately no dismiss button. Apply sends non-blank answers
 * to a refine agent run that merges them into the draft.
 */
export default function GapAnswers(props: {
  gaps: string[]
  answers: Record<string, string>
  onChange: (a: Record<string, string>) => void
  onApply: () => void
  busy: boolean
}): JSX.Element | null {
  if (!props.gaps.length) return null
  const answered = props.gaps.filter((g) => (props.answers[g] ?? '').trim()).length
  return (
    <div className="mt-2 rounded-md border border-yellow-800/60 bg-yellow-950/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-yellow-500">
        Open questions — answer what you can; leave blank to skip
      </div>
      {props.gaps.map((g) => (
        <div key={g} className="mt-2">
          <div className="text-[11px] leading-snug text-yellow-300">{g}</div>
          <input
            className="input mt-1 w-full text-[11px]"
            value={props.answers[g] ?? ''}
            onChange={(e) => props.onChange({ ...props.answers, [g]: e.target.value })}
          />
        </div>
      ))}
      <button
        className="btn btn-primary mt-3"
        disabled={props.busy || answered === 0}
        onClick={props.onApply}
      >
        Apply{answered > 0 ? ` (${answered})` : ''}
      </button>
    </div>
  )
}

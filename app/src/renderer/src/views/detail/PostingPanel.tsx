import { useState } from 'react'
import type { ApplicationDetail } from '@shared/types'

export default function PostingPanel({ detail }: { detail: ApplicationDetail }): JSX.Element {
  const { posting, rawPostingMd } = detail
  const [openSections, setOpenSections] = useState<Set<number>>(new Set([0]))

  if (!posting && !rawPostingMd) {
    return <div className="p-4 text-xs text-gray-600">No job_posting.md in this folder.</div>
  }
  if (!posting) {
    return (
      <pre className="whitespace-pre-wrap p-3 text-[11px] text-gray-400">{rawPostingMd}</pre>
    )
  }

  const toggle = (i: number): void => {
    setOpenSections((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="text-sm font-semibold leading-snug text-gray-100">{posting.title}</div>
      {posting.meta.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {posting.meta.map((m, i) => (
            <span key={i} className="chip" title={m.label}>
              <span className="text-gray-500">{m.label}:</span> {m.value || '—'}
            </span>
          ))}
        </div>
      )}
      {posting.fitNote && (
        <div className="fit-note px-3 py-2">
          <div className="fit-note-label text-[10px] font-bold uppercase tracking-wide">
            Fit note (honest)
          </div>
          <div className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed">
            {posting.fitNote}
          </div>
        </div>
      )}
      {posting.sections
        .filter((s) => !/^(honest\s+)?fit note/i.test(s.heading))
        .map((s, i) => (
          <div key={i} className="panel">
            <button
              className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold text-gray-200 hover:bg-panel2"
              onClick={() => toggle(i)}
            >
              {s.heading}
              <span className="text-gray-600">{openSections.has(i) ? '▾' : '▸'}</span>
            </button>
            {openSections.has(i) && (
              <div className="whitespace-pre-wrap border-t border-edge/50 px-3 py-2 text-[11px] leading-relaxed text-gray-400">
                {s.body}
              </div>
            )}
          </div>
        ))}
    </div>
  )
}

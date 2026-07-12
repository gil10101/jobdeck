import { useState } from 'react'
import type { ApplicationDetail } from '@shared/types'
import CopyField from '../../components/CopyField'
import { call } from '../../api'
import { useApp } from '../../store'

function SectionBlock({ heading, body }: { heading: string; body: string }): JSX.Element {
  const [copied, setCopied] = useState(false)
  const toast = useApp((s) => s.toast)
  return (
    <div className="panel p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-gray-200">{heading}</div>
        <button
          className="btn px-2 py-0.5 text-[10px]"
          onClick={() => {
            void call('app:copy', { text: body })
              .then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1200)
              })
              .catch((err) => toast(String(err), 'error'))
          }}
        >
          {copied ? '✓' : 'copy'}
        </button>
      </div>
      <div className="mt-1.5 whitespace-pre-wrap text-[11px] leading-relaxed text-gray-400">
        {body}
      </div>
    </div>
  )
}

export default function AnswersPanel({
  detail,
  showInsert
}: {
  detail: ApplicationDetail
  showInsert?: boolean
}): JSX.Element {
  const { answers, rawAnswersMd } = detail

  if (!answers && !rawAnswersMd) {
    return (
      <div className="p-4 text-xs text-gray-600">
        No application_answers.md in this folder.
      </div>
    )
  }

  if (!answers) {
    return (
      <div className="p-3">
        <div className="mb-2 text-[11px] text-amber-300">
          Could not parse the answers file — raw contents:
        </div>
        <pre className="whitespace-pre-wrap rounded bg-bg p-3 text-[11px] text-gray-400">
          {rawAnswersMd}
        </pre>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      {answers.applyLine && (
        <div className="rounded-md border border-cyan-900/60 bg-cyan-950/30 px-3 py-2 text-[11px] text-cyan-200">
          <span className="font-semibold">Apply:</span> {answers.applyLine}
        </div>
      )}
      {answers.fields.length > 0 && (
        <div className="panel divide-y divide-edge/50 py-1">
          {answers.fields.map((f, i) => (
            <CopyField key={i} label={f.label} value={f.value} showInsert={showInsert} />
          ))}
        </div>
      )}
      {answers.sections.map((s, i) => (
        <SectionBlock key={i} heading={s.heading} body={s.body} />
      ))}
      {answers.statusLine && (
        <div className="text-[10px] italic text-gray-600">Status: {answers.statusLine}</div>
      )}
    </div>
  )
}

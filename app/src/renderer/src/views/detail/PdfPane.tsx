import { useState } from 'react'
import type { ApplicationDetail } from '@shared/types'
import { localFileUrl } from '@shared/ipc'
import { call } from '../../api'
import { useApp } from '../../store'

interface Tab {
  key: string
  label: string
  relPath: string | null
  markdown?: string | null
}

export default function PdfPane({ detail }: { detail: ApplicationDetail }): JSX.Element {
  const toast = useApp((s) => s.toast)
  const [nonce, setNonce] = useState(0)
  const [compiling, setCompiling] = useState(false)
  const resume = detail.files.find((f) => f.name.endsWith('_Resume.pdf') && f.exists)
  const cover = detail.files.find((f) => f.name.endsWith('_Cover_Letter.pdf') && f.exists)
  const hasTex = (suffix: string): boolean =>
    detail.files.some((f) => f.name.endsWith(suffix) && f.exists)

  const tabs: Tab[] = [
    { key: 'resume', label: 'Résumé', relPath: resume?.relPath ?? null },
    { key: 'cover', label: 'Cover Letter', relPath: cover?.relPath ?? null },
    ...(detail.messageToHiringTeam
      ? [
          {
            key: 'message',
            label: 'Hiring-Team Message',
            relPath: null,
            markdown: detail.messageToHiringTeam
          }
        ]
      : []),
    ...(detail.interviewPrep
      ? [{ key: 'interview', label: 'Interview Prep', relPath: null, markdown: detail.interviewPrep }]
      : [])
  ]
  const [active, setActive] = useState<string>(tabs.find((t) => t.relPath || t.markdown)?.key ?? 'resume')
  const tab = tabs.find((t) => t.key === active) ?? tabs[0]

  const canRecompile =
    (active === 'resume' && hasTex('_Resume.tex')) ||
    (active === 'cover' && hasTex('_Cover_Letter.tex'))

  const recompile = async (): Promise<void> => {
    setCompiling(true)
    try {
      const res = await call('detail:recompile', {
        rowId: detail.row.id,
        doc: active as 'resume' | 'cover'
      })
      setNonce((n) => n + 1) // reload the iframe with the fresh PDF
      if (res.pages === 1) toast('Recompiled — 1 page ✓', 'success')
      else toast(`Recompiled — ${res.pages ?? '?'} pages (should be 1!)`, 'error')
    } catch (err) {
      toast(String(err), 'error')
    } finally {
      setCompiling(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-edge bg-panel px-2 py-1.5">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActive(t.key)}
            disabled={!t.relPath && !t.markdown}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors disabled:opacity-30 ${
              active === t.key ? 'bg-cyan-950/60 text-cyan-200' : 'text-gray-400 hover:bg-panel2'
            }`}
          >
            {t.label}
            {!t.relPath && !t.markdown && ' (missing)'}
          </button>
        ))}
        {canRecompile && (
          <button
            className="btn ml-auto px-2 py-0.5 text-[10px]"
            disabled={compiling}
            title="Run pdflatex twice on the edited .tex and reload the PDF"
            onClick={recompile}
          >
            {compiling ? 'Compiling…' : '⟳ Recompile'}
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 bg-panel2">
        {tab.relPath ? (
          <iframe
            key={`${tab.relPath}-${nonce}`}
            src={localFileUrl(tab.relPath)}
            className="h-full w-full border-0"
            title={tab.label}
          />
        ) : tab.markdown ? (
          <div className="h-full overflow-auto bg-bg p-6">
            <pre className="mx-auto max-w-2xl whitespace-pre-wrap font-sans text-sm leading-relaxed text-gray-200">
              {tab.markdown}
            </pre>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-gray-500">
            File not found in the application folder
          </div>
        )}
      </div>
    </div>
  )
}

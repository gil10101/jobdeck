import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Upload } from 'lucide-react'
import type { ProfileFile } from '@shared/profile'
import type { RunMeta } from '@shared/types'
import { call, onPush } from '../../api'
import { useApp } from '../../store'
import ProfileEditor from '../../components/profile/ProfileEditor'
import GapAnswers from '../../components/profile/GapAnswers'

type Step = 'workspace' | 'sources' | 'extract' | 'review' | 'done'

/**
 * First-run setup: workspace → feed the agent everything → extracted profile
 * → review → go. Mirrors the repo's /setup flow, in-app.
 */
export default function OnboardingWizard(): JSX.Element {
  const config = useApp((s) => s.config)
  const toast = useApp((s) => s.toast)
  const [step, setStep] = useState<Step>(config?.workspacePath ? 'sources' : 'workspace')
  const [busy, setBusy] = useState(false)
  const [uploadNames, setUploadNames] = useState<string[]>([])
  const [pasteText, setPasteText] = useState('')
  const [run, setRun] = useState<RunMeta | null>(null)
  const [runStatusLine, setRunStatusLine] = useState('starting…')
  const [draft, setDraft] = useState<ProfileFile | null>(null)
  const [gapAnswers, setGapAnswers] = useState<Record<string, string>>({})
  const [runPurpose, setRunPurpose] = useState<'extract' | 'refine'>('extract')

  // ---- extract/refine run watcher ----
  useEffect(() => {
    if (!run) return
    const off = onPush('push:runChanged', (meta) => {
      if (meta.id !== run.id) return
      setRunStatusLine(meta.status)
      if (meta.status === 'succeeded') {
        void call('profile:draft', { runId: meta.id }).then(({ draft: d, error }) => {
          if (d) {
            setDraft(d)
            setGapAnswers({})
            setStep('review')
            if (runPurpose === 'refine') toast('Answers merged into the draft', 'success')
          } else {
            toast(error ?? 'no draft produced', 'error')
            if (runPurpose === 'extract') setStep('sources')
          }
          setRun(null)
        })
      } else if (meta.status === 'failed' || meta.status === 'cancelled') {
        toast(`${runPurpose === 'refine' ? 'Refine' : 'Extraction'} ${meta.status}: ${meta.errorText ?? ''}`, 'error')
        setRun(null)
        if (runPurpose === 'extract') setStep('sources')
        else setStep('review')
      }
    })
    return off
  }, [run?.id, runPurpose])

  // ---- step: workspace ----
  const createWorkspace = async (): Promise<void> => {
    setBusy(true)
    try {
      const { path } = await call('workspace:choose', {
        title: 'Choose (or create) an empty folder for your workspace'
      })
      if (!path) return
      await call('workspace:create', { dir: path })
      await useApp.getState().refreshConfig()
      setStep('sources')
    } catch (err) {
      toast(String(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  // ---- step: sources ----
  const upload = async (): Promise<void> => {
    try {
      const { added, names } = await call('library:upload', undefined)
      if (added) {
        setUploadNames((prev) => [...prev, ...names])
        toast(`${added} file${added === 1 ? '' : 's'} added to your library`, 'success')
      }
    } catch (err) {
      toast(String(err), 'error')
    }
  }

  const extract = async (): Promise<void> => {
    setBusy(true)
    try {
      const meta = await call('onboard:start', {
        source: 'uploads',
        text: pasteText.trim() || undefined
      })
      setRunPurpose('extract')
      setRun(meta)
      setRunStatusLine('running')
      setStep('extract')
      void useApp.getState().refreshRuns()
    } catch (err) {
      toast(String(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  // ---- step: review ----
  const applyAnswers = async (): Promise<void> => {
    if (!draft) return
    const answers = Object.entries(gapAnswers)
      .map(([question, answer]) => ({ question, answer: answer.trim() }))
      .filter((a) => a.answer)
    if (!answers.length) return
    setBusy(true)
    try {
      const meta = await call('onboard:start', { source: 'refine', draft, answers })
      setRunPurpose('refine')
      setRun(meta)
      setRunStatusLine('running')
      setStep('extract')
      void useApp.getState().refreshRuns()
    } catch (err) {
      toast(String(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const saveProfile = async (): Promise<void> => {
    if (!draft) return
    setBusy(true)
    try {
      const saved = await call('profile:save', { profile: draft })
      toast(`Profile saved: ${saved.identity.fullName}`, 'success')
      setStep('done')
    } catch (err) {
      toast(String(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  // ---- finish / skip ----
  const finish = async (): Promise<void> => {
    await call('onboarding:complete', undefined).catch(() => undefined)
    await useApp.getState().refreshConfig()
    await useApp.getState().hydrate()
  }

  const stepIndex: Record<Step, number> = { workspace: 0, sources: 1, extract: 2, review: 3, done: 4 }
  const labels = ['Workspace', 'Your material', 'Extract', 'Review', 'Done']

  return (
    <div className="flex h-full items-center justify-center overflow-auto py-8">
      <div className={`panel p-8 ${step === 'review' ? 'w-[min(1140px,95vw)]' : 'w-[600px]'}`}>
        {/* progress */}
        <div className="mt-1 flex items-center justify-center gap-1">
          {labels.map((l, i) => (
            <div key={l} className="flex items-center gap-1">
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  i === stepIndex[step]
                    ? 'bg-cyan-950/70 text-cyan-200'
                    : i < stepIndex[step]
                      ? 'text-green-400'
                      : 'text-gray-600'
                }`}
              >
                {i < stepIndex[step] && <Check size={10} className="mr-0.5 inline" />}
                {l}
              </span>
              {i < labels.length - 1 && <span className="text-gray-700">·</span>}
            </div>
          ))}
        </div>

        {step === 'workspace' && (
          <div className="mt-6">
            <p className="text-xs leading-relaxed text-gray-400">
              Everything — tracker, tailored documents, agent runs, your library — lives inside one
              workspace folder you choose.
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <button className="btn btn-primary justify-center py-2.5" disabled={busy} onClick={createWorkspace}>
                Create a new workspace…
              </button>
            </div>
          </div>
        )}

        {step === 'sources' && (
          <div className="mt-6">
            <p className="text-xs leading-relaxed text-gray-400">
              Give the agent everything you have — old CVs, résumés, cover letters you liked,
              certificates, a LinkedIn export, notes about your skills and links. It reads all of
              it and drafts your profile; you review before anything is saved.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button className="btn btn-primary" onClick={upload}>
                <Upload size={13} /> Add files…
              </button>
            </div>
            {uploadNames.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {uploadNames.map((n, i) => (
                  <span key={`${n}-${i}`} className="chip text-[10px] text-gray-300">
                    {n}
                  </span>
                ))}
              </div>
            )}
            <textarea
              className="input mt-3 min-h-[120px] w-full resize-y font-mono text-[11px]"
              placeholder="Optional: paste anything extra — profile links (LinkedIn/GitHub/portfolio), skills lists, salary expectations, locations, deal-breakers…"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
            />
            <div className="mt-4 flex items-center gap-2">
              <button
                className="btn btn-primary"
                disabled={busy || (uploadNames.length === 0 && !pasteText.trim())}
                onClick={extract}
              >
                Extract my profile <ArrowRight size={13} />
              </button>
              <button className="btn ml-auto text-gray-500" onClick={finish}>
                Skip setup for now
              </button>
            </div>
          </div>
        )}

        {step === 'extract' && (
          <div className="mt-6 text-center">
            <div className="flex items-center justify-center gap-2 text-sm text-cyan-300">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-cyan-400" />
              {runPurpose === 'refine' ? 'Merging your answers…' : 'Agent is reading your material…'} ({runStatusLine})
            </div>
            <p className="mt-3 text-[11px] text-gray-500">
              This usually takes a minute or two. You can watch the full timeline in Runs later.
            </p>
            {run && (
              <button
                className="btn mt-4"
                onClick={() => void call('runs:cancel', { runId: run.id })}
              >
                Cancel
              </button>
            )}
          </div>
        )}

        {step === 'review' && draft && (
          <div className="mt-6">
            <p className="text-xs text-gray-400">
              Review the draft. Answer the open questions (blank = skip), fix anything wrong, then save.
            </p>
            <div className="mt-3 flex gap-4">
              {draft.gaps.length > 0 && (
                <div className="max-h-[62vh] w-[380px] shrink-0 overflow-auto pr-1">
                  <GapAnswers
                    gaps={draft.gaps}
                    answers={gapAnswers}
                    onChange={setGapAnswers}
                    onApply={() => void applyAnswers()}
                    busy={busy}
                  />
                </div>
              )}
              <div className="max-h-[62vh] min-w-0 flex-1 overflow-auto pr-1">
                <ProfileEditor value={draft} onChange={setDraft} />
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button className="btn btn-green" disabled={busy} onClick={saveProfile}>
                <Check size={13} /> Save profile
              </button>
              <button className="btn" disabled={busy} onClick={() => setStep('sources')}>
                <ArrowLeft size={13} /> Back
              </button>
            </div>
          </div>
        )}

        {step === 'done' && (
          <div className="mt-6 text-center">
            <div className="text-sm font-semibold text-green-300">
              <Check size={14} className="mr-1 inline" />
              You&apos;re set up
            </div>
            <p className="mt-2 text-xs leading-relaxed text-gray-400">
              Scout finds matching jobs, Accept builds your tailored résumé + cover letter, Apply
              opens the posting with your answers docked beside it. Your profile is editable
              anytime in Settings.
            </p>
            <button className="btn btn-primary mt-5 px-6 py-2.5" onClick={finish}>
              Start <ArrowRight size={13} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

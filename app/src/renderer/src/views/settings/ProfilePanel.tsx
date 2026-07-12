import { useEffect, useState } from 'react'
import type { ProfileFile } from '@shared/profile'
import type { RunMeta } from '@shared/types'
import { call, onPush } from '../../api'
import { useApp } from '../../store'

/**
 * M2 minimal profile management: extract via onboarding agent, review the
 * draft as editable JSON, validate + save. The full sectioned form arrives
 * with the M4 wizard.
 */
export default function ProfilePanel(): JSX.Element {
  const toast = useApp((s) => s.toast)
  const navigate = useApp((s) => s.navigate)
  const [profile, setProfile] = useState<ProfileFile | null>(null)
  const [extracting, setExtracting] = useState<RunMeta | null>(null)
  const [draftText, setDraftText] = useState<string | null>(null)
  const [pasteText, setPasteText] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = (): void => {
    void call('profile:get', undefined).then(setProfile).catch(() => undefined)
  }
  useEffect(refresh, [])

  // Watch the extraction run; load the draft when it succeeds.
  useEffect(() => {
    if (!extracting) return
    const off = onPush('push:runChanged', (meta) => {
      if (meta.id !== extracting.id) return
      if (meta.status === 'succeeded') {
        setExtracting(null)
        void call('profile:draft', { runId: meta.id }).then(({ draft, error }) => {
          if (draft) {
            setDraftText(JSON.stringify(draft, null, 2))
            toast(`Draft ready — review the gaps, edit, then Save (${meta.summary ?? ''})`, 'success')
          } else if (error) toast(error, 'error')
        })
      } else if (meta.status === 'failed' || meta.status === 'cancelled') {
        setExtracting(null)
        toast(`Extraction ${meta.status}: ${meta.errorText ?? ''}`, 'error')
      }
    })
    return off
  }, [extracting?.id])

  const startExtract = async (source: 'v1-import' | 'files' | 'text' | 'uploads'): Promise<void> => {
    setBusy(true)
    try {
      let files: string[] | undefined
      if (source === 'files') {
        const { path } = await call('app:pickFile', {
          filters: [{ name: 'Résumé / profile sources', extensions: ['pdf', 'txt', 'md', 'docx'] }]
        })
        if (!path) return
        files = [path]
      }
      const meta = await call('onboard:start', {
        source,
        text: source === 'text' ? pasteText : undefined,
        files
      })
      setExtracting(meta)
      toast('Extraction agent launched — watch it in Runs', 'success')
      void useApp.getState().refreshRuns()
    } catch (err) {
      toast(String(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const saveDraft = async (): Promise<void> => {
    if (!draftText) return
    setBusy(true)
    try {
      const parsed = JSON.parse(draftText) as ProfileFile
      const saved = await call('profile:save', { profile: parsed })
      setProfile(saved)
      setDraftText(null)
      toast(`Profile saved — ${saved.identity.fullName} (${saved.documents.fileBasename}_*)`, 'success')
    } catch (err) {
      toast(String(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel mt-4 px-4 py-3">
      <div className="text-[10px] font-bold uppercase tracking-wide text-muted">
        Candidate profile
      </div>

      <div className="mt-2 flex items-center gap-2">
        {profile ? (
          <>
            <span className="chip border-green-800 text-green-300">
              ✓ {profile.identity.fullName}
            </span>
            <span className="text-[11px] text-gray-500">
              rev {profile.revision} · files: {profile.documents.fileBasename}_* ·{' '}
              {profile.gaps.length} open gap{profile.gaps.length === 1 ? '' : 's'}
            </span>
            <button
              className="btn ml-auto px-2 py-0.5 text-[10px]"
              onClick={() => setDraftText(JSON.stringify(profile, null, 2))}
            >
              Edit
            </button>
          </>
        ) : (
          <span className="chip border-yellow-800 text-yellow-300">
            no profile yet — builds and interview prep need one
          </span>
        )}
      </div>

      {profile?.gaps.length ? (
        <ul className="mt-2 rounded-md border border-yellow-800/60 bg-yellow-950/40 px-4 py-2">
          {profile.gaps.map((g, i) => (
            <li key={i} className="list-disc py-0.5 text-[11px] text-yellow-300">
              {g}
            </li>
          ))}
        </ul>
      ) : null}

      {!extracting && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            className="btn btn-primary"
            disabled={busy}
            title="Re-reads EVERYTHING in your Library uploads (plus any imported v1 files) and re-drafts the profile"
            onClick={() => startExtract('uploads')}
          >
            Extract from my library
          </button>
          <button className="btn" disabled={busy} onClick={() => startExtract('v1-import')}>
            From v1 import
          </button>
          <button className="btn" disabled={busy} onClick={() => startExtract('files')}>
            From a file…
          </button>
          <button
            className="btn"
            disabled={busy || !pasteText.trim()}
            onClick={() => startExtract('text')}
          >
            Extract from pasted text
          </button>
        </div>
      )}
      {!extracting && (
        <textarea
          className="input mt-2 min-h-[60px] w-full resize-y font-mono text-[11px]"
          placeholder="Optional: paste résumé/profile text here, then 'Extract from pasted text'…"
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
        />
      )}
      {extracting && (
        <div className="mt-3 flex items-center gap-2 text-xs text-cyan-300">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
          Extracting profile…
          <button
            className="btn px-2 py-0.5 text-[10px]"
            onClick={() => navigate({ view: 'runs', runId: extracting.id })}
          >
            View run
          </button>
        </div>
      )}

      {draftText !== null && (
        <div className="mt-3">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[11px] font-semibold text-gray-200">
              Draft (edit the JSON, fix gaps, then save)
            </span>
            <button className="btn btn-green ml-auto px-2 py-0.5 text-[10px]" disabled={busy} onClick={saveDraft}>
              Validate & save
            </button>
            <button className="btn px-2 py-0.5 text-[10px]" onClick={() => setDraftText(null)}>
              Discard
            </button>
          </div>
          <textarea
            className="input min-h-[320px] w-full resize-y font-mono text-[10px] leading-relaxed"
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            spellCheck={false}
          />
        </div>
      )}
    </div>
  )
}

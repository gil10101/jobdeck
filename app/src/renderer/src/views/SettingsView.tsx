import { useEffect, useState } from 'react'
import type { AppSettings } from '@shared/types'
import { call } from '../api'
import { useApp } from '../store'
import ProfilePanel from './settings/ProfilePanel'

function Row({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-edge/50 py-3 last:border-b-0">
      <div>
        <div className="text-xs font-medium text-gray-200">{label}</div>
        {hint && <div className="mt-0.5 max-w-md text-[11px] leading-relaxed text-gray-500">{hint}</div>}
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  )
}

function Toggle({
  value,
  onChange
}: {
  value: boolean
  onChange: (v: boolean) => void
}): JSX.Element {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`relative h-5 w-9 rounded-full border transition-colors ${
        value ? 'border-cyan-700 bg-cyan-900' : 'border-edge bg-panel2'
      }`}
    >
      <span
        className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all ${
          value ? 'left-[18px] bg-cyan-300' : 'left-0.5 bg-gray-500'
        }`}
      />
    </button>
  )
}

export default function SettingsView(): JSX.Element {
  const settings = useApp((s) => s.settings)
  const toast = useApp((s) => s.toast)
  const [info, setInfo] = useState<{ repoRoot: string; appDataDir: string } | null>(null)
  const [jobrightEmail, setJobrightEmail] = useState('')
  const [jobrightPassword, setJobrightPassword] = useState('')
  const [boardStatus, setBoardStatus] = useState<string>('checking…')
  const [testing, setTesting] = useState(false)
  const [modelDraft, setModelDraft] = useState('')
  const [maxTurnsDraft, setMaxTurnsDraft] = useState('')
  const [backfillBusy, setBackfillBusy] = useState(false)

  useEffect(() => {
    void call('app:info', undefined).then(setInfo).catch(() => undefined)
    void call('boards:getStatus', undefined)
      .then((s) => {
        setBoardStatus(
          s.jobright.configured ? `configured (${s.jobright.email})` : 'not configured'
        )
        if (s.jobright.email) setJobrightEmail(s.jobright.email)
      })
      .catch(() => setBoardStatus('unknown'))
  }, [])

  useEffect(() => {
    if (settings) {
      setModelDraft(settings.model ?? '')
      setMaxTurnsDraft(String(settings.maxTurns))
    }
  }, [settings?.model, settings?.maxTurns])

  if (!settings) return <div className="p-6 text-sm text-gray-500">Loading…</div>

  const patch = (p: Partial<AppSettings>): void => {
    void call('settings:set', p)
      .then(() => useApp.getState().refreshSettings())
      .catch((err) => toast(String(err), 'error'))
  }

  const saveCreds = async (): Promise<void> => {
    try {
      await call('boards:setCreds', { email: jobrightEmail, password: jobrightPassword })
      setJobrightPassword('')
      setBoardStatus(`configured (${jobrightEmail})`)
      toast('jobright credentials saved (session reset — next call logs in fresh)', 'success')
    } catch (err) {
      toast(String(err), 'error')
    }
  }

  const testBoard = async (): Promise<void> => {
    setTesting(true)
    try {
      const res = await call('boards:test', undefined)
      toast(res.message, res.ok ? 'success' : 'error')
    } catch (err) {
      toast(String(err), 'error')
    } finally {
      setTesting(false)
    }
  }

  const runBackfill = async (): Promise<void> => {
    setBackfillBusy(true)
    try {
      const res = await call('companies:backfill', undefined)
      toast(`Looked up ${res.fetched} companies`, 'success')
      await useApp.getState().refreshCompanies()
    } catch (err) {
      toast(String(err), 'error')
    } finally {
      setBackfillBusy(false)
    }
  }

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-6xl p-6">
        <h1 className="text-sm font-semibold text-gray-100">Settings</h1>

        <ProfilePanel />

        <div className="panel mt-4 px-4 py-1">
          <div className="pt-3 text-[10px] font-bold uppercase tracking-wide text-muted">
            Appearance
          </div>
          <Row label="Theme">
            <div className="flex gap-1">
              {(['dark', 'light'] as const).map((t) => (
                <button
                  key={t}
                  className={`chip ${settings.theme === t ? 'border-cyan-700 bg-cyan-950/60 text-cyan-200' : ''}`}
                  onClick={() => {
                    document.documentElement.dataset.theme = t
                    patch({ theme: t })
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          </Row>
        </div>

        <div className="panel mt-4 px-4 py-1">
          <div className="pt-3 text-[10px] font-bold uppercase tracking-wide text-muted">
            Agent runs
          </div>
          <Row
            label="Model override"
            hint="Blank = your Claude Code default. Accepts model aliases (e.g. sonnet, opus) or full model IDs."
          >
            <input
              className="input w-44"
              placeholder="(default)"
              value={modelDraft}
              onChange={(e) => setModelDraft(e.target.value)}
              onBlur={() => patch({ model: modelDraft.trim() || undefined })}
            />
          </Row>
          <Row label="Max turns per run" hint="Safety ceiling before a run is stopped.">
            <input
              className="input w-20 text-right"
              value={maxTurnsDraft}
              onChange={(e) => setMaxTurnsDraft(e.target.value.replace(/\D/g, ''))}
              onBlur={() => {
                const n = parseInt(maxTurnsDraft, 10)
                if (n >= 10 && n <= 500) patch({ maxTurns: n })
                else setMaxTurnsDraft(String(settings.maxTurns))
              }}
            />
          </Row>
          <Row
            label="Concurrent runs"
            hint="1 is safest (pdflatex + repo writes). 2 works since builds use separate folders."
          >
            <div className="flex gap-1">
              {([1, 2] as const).map((n) => (
                <button
                  key={n}
                  className={`chip ${settings.maxConcurrentRuns === n ? 'border-cyan-700 bg-cyan-950/60 text-cyan-200' : ''}`}
                  onClick={() => patch({ maxConcurrentRuns: n })}
                >
                  {n}
                </button>
              ))}
            </div>
          </Row>
          <Row
            label="Stream agent text live"
            hint="Show the agent's prose as it types (off = only complete messages)."
          >
            <Toggle
              value={settings.includePartialMessages}
              onChange={(v) => patch({ includePartialMessages: v })}
            />
          </Row>
        </div>

        <div className="panel mt-4 px-4 py-1">
          <div className="pt-3 text-[10px] font-bold uppercase tracking-wide text-muted">
            Workflow
          </div>
          <Row
            label="Rename folder to [DONE] on submit"
            hint="Repo convention: submitted applications get a [DONE] prefix; stored paths update automatically."
          >
            <Toggle
              value={settings.renameFolderOnSubmit}
              onChange={(v) => patch({ renameFolderOnSubmit: v })}
            />
          </Row>
          <Row
            label="Experimental: type into apply forms"
            hint='Adds a "⌨" button on answer fields in the Apply view that types the value into the focused field of the embedded browser.'
          >
            <Toggle
              value={settings.insertTextEnabled}
              onChange={(v) => patch({ insertTextEnabled: v })}
            />
          </Row>
        </div>

        <div className="panel mt-4 px-4 py-1">
          <div className="pt-3 text-[10px] font-bold uppercase tracking-wide text-muted">
            Job boards
          </div>
          <Row label="jobright.ai" hint={`Status: ${boardStatus}. Credentials live in a gitignored file; saving clears the cached session.`}>
            <div className="flex flex-col items-end gap-1.5">
              <input
                className="input w-56"
                placeholder="email"
                value={jobrightEmail}
                onChange={(e) => setJobrightEmail(e.target.value)}
              />
              <input
                className="input w-56"
                type="password"
                placeholder="password"
                value={jobrightPassword}
                onChange={(e) => setJobrightPassword(e.target.value)}
              />
              <div className="flex gap-1.5">
                <button
                  className="btn btn-primary px-2 py-1 text-[10px]"
                  disabled={!jobrightEmail || !jobrightPassword}
                  onClick={saveCreds}
                >
                  Save
                </button>
                <button
                  className="btn px-2 py-1 text-[10px]"
                  disabled={testing}
                  onClick={testBoard}
                >
                  {testing ? 'Testing…' : 'Test connection'}
                </button>
              </div>
            </div>
          </Row>
          <Row label="LinkedIn / freehire" hint="Public APIs — no credentials needed.">
            <span className="chip border-green-800 text-green-300">ready</span>
          </Row>
          <Row
            label="Glassdoor ratings"
            hint="Look up and cache a Glassdoor rating for every company across your tracker, intake, and scout candidates."
          >
            <button
              className="btn px-2 py-1 text-[10px]"
              disabled={backfillBusy}
              onClick={runBackfill}
            >
              {backfillBusy ? 'Fetching…' : 'Fetch ratings for all companies'}
            </button>
          </Row>
        </div>

        {info && (
          <div className="panel mt-4 px-4 py-3">
            <div className="text-[10px] font-bold uppercase tracking-wide text-muted">Locations</div>
            <div className="mt-2 flex flex-col gap-1 text-[11px] text-gray-500">
              <div>
                <span className="text-gray-400">Workspace:</span> {info.repoRoot}
              </div>
              <div>
                <span className="text-gray-400">App data:</span> {info.appDataDir}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

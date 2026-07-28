import { useEffect, useState } from 'react'
import type { AppSettings, BoardId, BoardsStatus, EmailStatus } from '@shared/types'
import type { CustomBoard } from '@shared/profile'
import { call } from '../api'
import { modelOptionsWith } from '../lib/models'
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
  const [boards, setBoards] = useState<BoardsStatus | null>(null)
  const [installing, setInstalling] = useState<BoardId | null>(null)
  const [bunInstalling, setBunInstalling] = useState(false)
  const [testing, setTesting] = useState(false)
  const [modelDraft, setModelDraft] = useState('')
  const [maxTurnsDraft, setMaxTurnsDraft] = useState('')
  const [backfillBusy, setBackfillBusy] = useState(false)
  const [masterContext, setMasterContext] = useState('')
  const [masterContextSaved, setMasterContextSaved] = useState(true)
  const [kbNotes, setKbNotes] = useState('')
  const [kbNotesSaved, setKbNotesSaved] = useState(true)
  const [kbFiles, setKbFiles] = useState<{ name: string; sizeKb: number }[]>([])
  const [emailStatus, setEmailStatus] = useState<EmailStatus | null>(null)
  const [clientIdDraft, setClientIdDraft] = useState('')
  // The stored secret is never echoed back; this holds only fresh input.
  const [clientSecretDraft, setClientSecretDraft] = useState('')
  const [emailBusy, setEmailBusy] = useState(false)
  const [customBoards, setCustomBoards] = useState<CustomBoard[]>([])
  const [customUrl, setCustomUrl] = useState('')
  const [customTest, setCustomTest] = useState<{ ok: boolean; text: string } | null>(null)
  const [customBusy, setCustomBusy] = useState<'test' | 'add' | null>(null)

  useEffect(() => {
    void call('master:getContext', undefined)
      .then(({ text }) => setMasterContext(text))
      .catch(() => undefined)
    void call('knowledge:get', undefined)
      .then(({ notes, files }) => {
        setKbNotes(notes)
        setKbFiles(files)
      })
      .catch(() => undefined)
    void call('app:info', undefined).then(setInfo).catch(() => undefined)
    void call('boards:getStatus', undefined)
      .then((s) => {
        setBoards(s)
        const email = s.boards.find((b) => b.id === 'jobright')?.email
        if (email) setJobrightEmail(email)
      })
      .catch(() => setBoards(null))
    void call('email:status', undefined)
      .then((s) => {
        setEmailStatus(s)
        if (s.clientId) setClientIdDraft(s.clientId)
      })
      .catch(() => setEmailStatus(null))
    void call('boards:listCustom', undefined)
      .then(setCustomBoards)
      .catch(() => undefined)
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
      const res = await call('boards:setCreds', { email: jobrightEmail, password: jobrightPassword })
      setJobrightPassword('')
      setBoards(await call('boards:getStatus', undefined))
      toast(
        res.loginOk
          ? 'jobright credentials saved — logged in, session ready'
          : `credentials saved, but login failed: ${res.message}`,
        res.loginOk ? 'success' : 'error'
      )
    } catch (err) {
      toast(String(err), 'error')
    }
  }

  const install = async (board: BoardId): Promise<void> => {
    setInstalling(board)
    try {
      setBoards(await call('boards:install', { board }))
      toast(`${board} CLI installed into the workspace`, 'success')
    } catch (err) {
      toast(String(err), 'error')
    } finally {
      setInstalling(null)
    }
  }

  const setBoardEnabled = async (board: BoardId, enabled: boolean): Promise<void> => {
    try {
      setBoards(await call('boards:setEnabled', { board, enabled }))
    } catch (err) {
      toast(String(err), 'error')
    }
  }

  const saveKbNotes = async (): Promise<void> => {
    try {
      await call('knowledge:setNotes', { text: kbNotes })
      setKbNotesSaved(true)
      toast('Knowledge base saved', 'success')
    } catch (err) {
      toast(String(err), 'error')
    }
  }

  const addKbFiles = async (): Promise<void> => {
    try {
      const { added } = await call('knowledge:addFiles', undefined)
      if (added > 0) {
        const { notes, files } = await call('knowledge:get', undefined)
        setKbNotes(notes)
        setKbFiles(files)
        toast(`Added ${added} file${added === 1 ? '' : 's'}`, 'success')
      }
    } catch (err) {
      toast(String(err), 'error')
    }
  }

  const removeKbFile = async (name: string): Promise<void> => {
    try {
      await call('knowledge:removeFile', { name })
      setKbFiles((prev) => prev.filter((f) => f.name !== name))
    } catch (err) {
      toast(String(err), 'error')
    }
  }

  const saveMasterContext = async (): Promise<void> => {
    try {
      await call('master:setContext', { text: masterContext })
      setMasterContextSaved(true)
      toast('Master context saved', 'success')
    } catch (err) {
      toast(String(err), 'error')
    }
  }

  const installBunNow = async (): Promise<void> => {
    setBunInstalling(true)
    try {
      const res = await call('boards:installBun', undefined)
      setBoards(res.status)
      toast(res.message, res.ok ? 'success' : 'error')
    } catch (err) {
      toast(String(err), 'error')
    } finally {
      setBunInstalling(false)
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

  const testCustom = async (): Promise<void> => {
    setCustomBusy('test')
    setCustomTest(null)
    try {
      const res = await call('boards:testCustom', { url: customUrl.trim() })
      setCustomTest({
        ok: true,
        text: `${res.label} — ${res.ats} board “${res.slug}”, ${res.sampleCount} open role${res.sampleCount === 1 ? '' : 's'} right now`
      })
    } catch (err) {
      // The message IS the product here: it names the decline reason inline.
      setCustomTest({ ok: false, text: err instanceof Error ? err.message : String(err) })
    } finally {
      setCustomBusy(null)
    }
  }

  const addCustom = async (): Promise<void> => {
    setCustomBusy('add')
    try {
      setCustomBoards(await call('boards:addCustom', { url: customUrl.trim() }))
      setCustomUrl('')
      setCustomTest(null)
      toast('Company board added — scouts will fetch it on every run', 'success')
    } catch (err) {
      setCustomTest({ ok: false, text: err instanceof Error ? err.message : String(err) })
    } finally {
      setCustomBusy(null)
    }
  }

  const removeCustom = async (id: string): Promise<void> => {
    try {
      setCustomBoards(await call('boards:removeCustom', { id }))
    } catch (err) {
      toast(String(err), 'error')
    }
  }

  const setCustomEnabled = async (id: string, enabled: boolean): Promise<void> => {
    try {
      setCustomBoards(await call('boards:setCustomEnabled', { id, enabled }))
    } catch (err) {
      toast(String(err), 'error')
    }
  }

  const saveClientId = async (): Promise<void> => {
    try {
      setEmailStatus(
        await call('email:setClientId', {
          clientId: clientIdDraft,
          clientSecret: clientSecretDraft.trim() || undefined
        })
      )
      setClientSecretDraft('')
      toast('Gmail OAuth client saved', 'success')
    } catch (err) {
      toast(String(err), 'error')
    }
  }

  const gmailSignIn = async (): Promise<void> => {
    setEmailBusy(true)
    try {
      const s = await call('email:signIn', undefined)
      setEmailStatus(s)
      toast(s.email ? `Signed in as ${s.email}` : 'Signed in', 'success')
    } catch (err) {
      toast(String(err), 'error')
    } finally {
      setEmailBusy(false)
    }
  }

  const gmailSignOut = async (): Promise<void> => {
    setEmailBusy(true)
    try {
      setEmailStatus(await call('email:signOut', undefined))
      toast('Signed out — tokens and cached mail deleted', 'success')
    } catch (err) {
      toast(String(err), 'error')
    } finally {
      setEmailBusy(false)
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

        <div className="panel mt-4 px-4 py-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-muted">
            Master résumé context
          </div>
          <div className="mt-1 text-[11px] leading-relaxed text-gray-500">
            Free-form context added to every build alongside your profile — extra skills, certs,
            projects, or standing guidance the agent should always know. For one specific
            application, use the notes field on its intake card or scout panel instead.
          </div>
          <textarea
            className="input mt-2 min-h-[7rem] w-full resize-y font-mono text-[11px] leading-relaxed"
            placeholder={'e.g.\n- AWS Solutions Architect Associate (in progress, exam Aug 2026)\n- Coursework (context only — NEVER list on résumé or cover letter): Databases, Distributed Systems, Statistical Learning\n- Prefer "data practitioner" framing over "engineer" for analyst roles'}
            value={masterContext}
            onChange={(e) => {
              setMasterContext(e.target.value)
              setMasterContextSaved(false)
            }}
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              className="btn btn-primary px-2 py-1 text-[10px]"
              disabled={masterContextSaved}
              onClick={() => void saveMasterContext()}
            >
              {masterContextSaved ? 'Saved' : 'Save'}
            </button>
            <span className="text-[10px] text-gray-600">
              Stored at master/context.md in your workspace.
            </span>
          </div>
        </div>

        <div className="panel mt-4 px-4 py-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-muted">
            Knowledge base — background only, never on documents
          </div>
          <div className="mt-1 text-[11px] leading-relaxed text-gray-500">
            Notes and files (transcripts, syllabi, portfolios, old résumés — images and PDFs are
            readable by agents) that inform fit judgment, application answers, and framing. Nothing
            here is ever listed on a résumé or cover letter.
          </div>
          <textarea
            className="input mt-2 min-h-[5rem] w-full resize-y font-mono text-[11px] leading-relaxed"
            placeholder={'e.g.\n- Coursework: Databases, Distributed Systems, Statistical Learning\n- Left retail job off the résumé; fine to mention in "other experience" questions'}
            value={kbNotes}
            onChange={(e) => {
              setKbNotes(e.target.value)
              setKbNotesSaved(false)
            }}
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              className="btn btn-primary px-2 py-1 text-[10px]"
              disabled={kbNotesSaved}
              onClick={() => void saveKbNotes()}
            >
              {kbNotesSaved ? 'Saved' : 'Save notes'}
            </button>
            <button className="btn px-2 py-1 text-[10px]" onClick={() => void addKbFiles()}>
              + Add files
            </button>
            <span className="text-[10px] text-gray-600">
              Stored in master/knowledge/ in your workspace.
            </span>
          </div>
          {kbFiles.length > 0 && (
            <div className="mt-2 flex flex-col gap-1">
              {kbFiles.map((f) => (
                <div
                  key={f.name}
                  className="group flex items-center gap-2 rounded-md border border-edge px-2 py-1 text-[11px]"
                >
                  <span className="min-w-0 flex-1 truncate text-gray-300">{f.name}</span>
                  <span className="shrink-0 text-[10px] text-gray-600">{f.sizeKb} KB</span>
                  <button
                    className="invisible shrink-0 text-gray-500 hover:text-red-400 group-hover:visible"
                    onClick={() => void removeKbFile(f.name)}
                    title="Remove from knowledge base"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

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
            hint="Model used by agent runs. Default = your Claude Code default."
          >
            <select
              className="input w-44"
              value={modelDraft}
              onChange={(e) => {
                setModelDraft(e.target.value)
                patch({ model: e.target.value || undefined })
              }}
            >
              {modelOptionsWith(modelDraft).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
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
            hint="Builds are independent (separate folders + LaTeX processes) — higher values mainly cost API throughput."
          >
            <div className="flex gap-1">
              {([1, 2, 3, 4] as const).map((n) => (
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
          {boards && !boards.bunOk && (
            <div className="mt-2 flex items-center justify-between gap-3 rounded-md border border-amber-700 bg-amber-950/30 px-3 py-2 text-[11px] text-amber-300">
              <span>
                The bun runtime (runs the board CLIs) was not found. Install runs the official{' '}
                <span className="font-semibold">bun.sh</span> installer into ~/.bun.
              </span>
              <button
                className="btn btn-primary shrink-0 px-2 py-1 text-[10px]"
                disabled={bunInstalling}
                onClick={() => void installBunNow()}
              >
                {bunInstalling ? 'Installing…' : 'Install bun'}
              </button>
            </div>
          )}
          {(boards?.boards ?? []).map((b) => {
            const jr = b.id === 'jobright'
            const hint = !b.enabled
              ? 'Disabled — scouts skip this board entirely (no requests are made).'
              : b.installed
                ? jr
                  ? `${b.configured ? `Configured (${b.email})` : 'Installed — add credentials to enable it'}. The password is encrypted with your OS keychain and stored in app data, never in the workspace; saving clears the cached session.`
                  : 'Public API — no credentials needed.'
                : `Not installed. Install copies the bundled search CLI into ${b.path} inside your workspace (no network access needed).`
            return (
              <Row key={b.id} label={jr ? 'jobright.ai' : b.id} hint={hint}>
                <div className="flex flex-col items-end gap-1.5">
                  <div className="flex items-center gap-2">
                    {!b.enabled ? (
                      <span className="chip text-gray-500">off</span>
                    ) : !b.installed ? (
                      <button
                        className="btn btn-primary px-2 py-1 text-[10px]"
                        disabled={installing !== null}
                        onClick={() => void install(b.id)}
                      >
                        {installing === b.id ? 'Installing…' : 'Install CLI'}
                      </button>
                    ) : boards?.bunOk ? (
                      <span className="chip border-green-800 text-green-300">
                        ✓ {jr && !b.configured ? 'installed' : 'ready'}
                      </span>
                    ) : (
                      <span className="chip border-amber-700 text-amber-300">needs bun</span>
                    )}
                    <Toggle value={b.enabled} onChange={(v) => void setBoardEnabled(b.id, v)} />
                  </div>
                  {jr && b.enabled && b.installed && (
                    <>
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
                    </>
                  )}
                </div>
              </Row>
            )
          })}
          {!boards && (
            <Row label="Boards" hint="Could not read board status.">
              <span className="chip">unknown</span>
            </Row>
          )}
          {customBoards.map((b) => (
            <Row
              key={b.id}
              label={b.label}
              hint={`Company board — ${b.ats} · ${b.slug}. ${
                b.enabled
                  ? 'Fetched through the ATS public API before every scout run.'
                  : 'Disabled — scouts skip this board entirely (no requests are made).'
              }`}
            >
              <div className="flex items-center gap-2">
                <Toggle value={b.enabled} onChange={(v) => void setCustomEnabled(b.id, v)} />
                <button
                  className="text-gray-500 hover:text-red-400"
                  onClick={() => void removeCustom(b.id)}
                  title="Remove this company board"
                >
                  ✕
                </button>
              </div>
            </Row>
          ))}
          <Row
            label="Add company board"
            hint="Paste a careers page hosted on Greenhouse (boards.greenhouse.io/<company>), Lever (jobs.lever.co/<company>), or Ashby (jobs.ashbyhq.com/<company>) — Test fetches the live board through the ATS's public API. Other career sites are declined: they have no stable structure to fetch reliably; paste individual postings into Intake by URL instead."
          >
            <div className="flex flex-col items-end gap-1.5">
              <input
                className="input w-72"
                placeholder="https://boards.greenhouse.io/yourcompany"
                value={customUrl}
                onChange={(e) => {
                  setCustomUrl(e.target.value)
                  setCustomTest(null)
                }}
              />
              <div className="flex gap-1.5">
                <button
                  className="btn px-2 py-1 text-[10px]"
                  disabled={!customUrl.trim() || customBusy !== null}
                  onClick={() => void testCustom()}
                >
                  {customBusy === 'test' ? 'Testing…' : 'Test'}
                </button>
                <button
                  className="btn btn-primary px-2 py-1 text-[10px]"
                  disabled={!customUrl.trim() || customBusy !== null}
                  onClick={() => void addCustom()}
                >
                  {customBusy === 'add' ? 'Adding…' : 'Add'}
                </button>
              </div>
              {customTest && (
                <div
                  className={`w-72 text-left text-[11px] leading-relaxed ${
                    customTest.ok ? 'text-green-300' : 'text-amber-300'
                  }`}
                >
                  {customTest.text}
                </div>
              )}
            </div>
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

        <div className="panel mt-4 px-4 py-1">
          <div className="pt-3 text-[10px] font-bold uppercase tracking-wide text-muted">
            Email (Gmail)
          </div>
          <Row
            label="Google OAuth client"
            hint="Your own Desktop-app OAuth client (read-only Gmail scope). Google requires the client secret for Desktop-app token exchanges even with PKCE — it is not truly secret for installed apps. The secret and sign-in tokens are encrypted with your OS keychain and stored in app data — never in the workspace."
          >
            <div className="flex flex-col items-end gap-1.5">
              <input
                className="input w-72"
                placeholder="Client ID (…….apps.googleusercontent.com)"
                value={clientIdDraft}
                onChange={(e) => setClientIdDraft(e.target.value)}
              />
              <input
                className="input w-72"
                type="password"
                placeholder={
                  emailStatus?.hasClientSecret
                    ? 'Client secret (saved — type to replace)'
                    : 'Client secret (GOCSPX-…)'
                }
                value={clientSecretDraft}
                onChange={(e) => setClientSecretDraft(e.target.value)}
              />
              <button
                className="btn btn-primary px-2 py-1 text-[10px]"
                disabled={
                  !clientIdDraft.trim() ||
                  (clientIdDraft.trim() === (emailStatus?.clientId ?? '') && !clientSecretDraft.trim())
                }
                onClick={() => void saveClientId()}
              >
                Save
              </button>
            </div>
          </Row>
          <Row
            label="Account"
            hint={
              emailStatus?.configured
                ? `Signed in${emailStatus.email ? ` as ${emailStatus.email}` : ''}. Signing out revokes the token and deletes cached mail.`
                : 'Sign in opens the Google consent page in your browser; the app only ever reads mail.'
            }
          >
            {emailStatus?.configured ? (
              <button className="btn px-2 py-1 text-[10px]" disabled={emailBusy} onClick={() => void gmailSignOut()}>
                {emailBusy ? 'Working…' : 'Sign out'}
              </button>
            ) : (
              <button
                className="btn btn-primary px-2 py-1 text-[10px]"
                disabled={emailBusy || !emailStatus?.clientId}
                title={
                  !emailStatus?.clientId
                    ? 'Save a client ID first'
                    : emailStatus.hasClientSecret
                      ? undefined
                      : 'No client secret saved — Google Desktop-app clients need one for the token exchange'
                }
                onClick={() => void gmailSignIn()}
              >
                {emailBusy ? 'Waiting for browser…' : 'Sign in with Google'}
              </button>
            )}
          </Row>
          <Row label="Poll interval" hint="How often new mail is fetched; Refresh in the Email tab syncs immediately.">
            <div className="flex gap-1">
              {([3, 5, 10, 30] as const).map((n) => (
                <button
                  key={n}
                  className={`chip ${settings.emailPollMinutes === n ? 'border-cyan-700 bg-cyan-950/60 text-cyan-200' : ''}`}
                  onClick={() => patch({ emailPollMinutes: n })}
                >
                  {n} min
                </button>
              ))}
            </div>
          </Row>
          <Row
            label="Auto-apply tracker suggestions"
            hint="Default (off): classified mail proposes one-click status suggestions in the Email tab. On: matching status changes are applied to the tracker automatically."
          >
            <Toggle
              value={settings.emailAutoApply}
              onChange={(v) => patch({ emailAutoApply: v })}
            />
          </Row>
          <div className="py-3">
            <div className="text-[11px] font-medium text-gray-400">Set up your own OAuth client</div>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-[11px] leading-relaxed text-gray-500">
              <li>
                Open{' '}
                <button
                  className="text-cyan-500 hover:underline"
                  onClick={() =>
                    void call('app:openExternal', { url: 'https://console.cloud.google.com' }).catch(
                      () => undefined
                    )
                  }
                >
                  console.cloud.google.com
                </button>{' '}
                and create (or select) a project.
              </li>
              <li>APIs &amp; Services → Library → search “Gmail API” → Enable.</li>
              <li>
                OAuth consent screen → External → fill the required fields, then add your own
                Google account under Test users.
              </li>
              <li>Credentials → Create credentials → OAuth client ID → Application type “Desktop app”.</li>
              <li>
                Copy both the Client ID (ends in .apps.googleusercontent.com) and the Client secret
                into the fields above and Save — Google requires the secret for Desktop-app token
                exchanges; it is not truly secret for installed apps.
              </li>
            </ol>
          </div>
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

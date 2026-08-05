import { useEffect, useState } from 'react'
import { BookUser, Bot, Briefcase, Check, Cpu, FolderOpen, Mail, Palette, Workflow, X } from 'lucide-react'
import type { AppSettings, BoardId, BoardsStatus, EmailStatus } from '@shared/types'
import type { CustomBoard } from '@shared/profile'
import { call } from '../api'
import { modelOptionsWith } from '../lib/models'
import { useApp } from '../store'
import ProfilePanel from './settings/ProfilePanel'
import glassdoorLogo from '../assets/boards/glassdoor.svg'
import jobrightLogo from '../assets/boards/jobright.svg'
import linkedinLogo from '../assets/boards/linkedin.svg'

/** Board logo URL for a settings row, when one is bundled. */
const BOARD_LOGOS: Record<string, string> = {
  jobright: jobrightLogo,
  linkedin: linkedinLogo,
  glassdoor: glassdoorLogo
}

function Row({
  label,
  hint,
  icon,
  children
}: {
  label: string
  hint?: string
  /** Optional logo URL rendered before the label (board rows). */
  icon?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-edge/50 py-3 last:border-b-0">
      <div>
        <div className="flex items-center gap-2 text-xs font-medium text-gray-200">
          {icon && <img src={icon} alt="" className="h-4 w-4 shrink-0 rounded-sm" />}
          {label}
        </div>
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
  const [gdFeed, setGdFeed] = useState<{ count: number; fetchedAt: string; stale: boolean } | null>(null)
  const [gdSearchesDraft, setGdSearchesDraft] = useState('')
  const [gdSaved, setGdSaved] = useState(true)
  const [provStatus, setProvStatus] = useState<{
    provider: 'claude' | 'gemini' | 'ollama'
    geminiKeySet: boolean
    geminiModels: string[]
    ollama: { reachable: boolean; models: string[]; message: string }
  } | null>(null)
  // Never echoes the stored key back; holds only fresh input until saved.
  const [geminiKeyDraft, setGeminiKeyDraft] = useState('')
  const [geminiModelDraft, setGeminiModelDraft] = useState('')
  const [ollamaUrlDraft, setOllamaUrlDraft] = useState('')
  const [ollamaModelDraft, setOllamaModelDraft] = useState('')
  const [ollamaCtxDraft, setOllamaCtxDraft] = useState('')
  const [provTest, setProvTest] = useState<{ ok: boolean; message: string } | null>(null)
  const [provBusy, setProvBusy] = useState(false)

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
    void call('glassdoor:feedStatus', undefined)
      .then(setGdFeed)
      .catch(() => undefined)
    void call('provider:status', undefined)
      .then(setProvStatus)
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (settings) {
      setGeminiModelDraft(settings.geminiModel)
      setOllamaUrlDraft(settings.ollamaUrl)
      setOllamaModelDraft(settings.ollamaModel)
      setOllamaCtxDraft(String(settings.ollamaNumCtx))
    }
  }, [settings?.geminiModel, settings?.ollamaUrl, settings?.ollamaModel, settings?.ollamaNumCtx])

  useEffect(() => {
    if (settings) setGdSearchesDraft((settings.glassdoorSearches ?? []).join('\n'))
  }, [settings?.glassdoorSearches])

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

  const refreshProviderStatus = async (): Promise<void> => {
    try {
      setProvStatus(await call('provider:status', undefined))
    } catch {
      /* status is advisory */
    }
  }

  const saveGeminiKey = async (): Promise<void> => {
    try {
      await call('provider:setGeminiKey', { key: geminiKeyDraft })
      setGeminiKeyDraft('')
      await refreshProviderStatus()
      toast('Gemini key saved (encrypted with the OS keychain)', 'success')
    } catch (err) {
      toast(String(err), 'error')
    }
  }

  const clearGeminiKeyNow = async (): Promise<void> => {
    try {
      await call('provider:clearGeminiKey', undefined)
      await refreshProviderStatus()
      toast('Gemini key removed', 'success')
    } catch (err) {
      toast(String(err), 'error')
    }
  }

  const runProviderTest = async (): Promise<void> => {
    setProvBusy(true)
    setProvTest(null)
    try {
      setProvTest(await call('provider:test', undefined))
    } catch (err) {
      setProvTest({ ok: false, message: String(err) })
    } finally {
      setProvBusy(false)
    }
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

  const importClientJson = async (): Promise<void> => {
    try {
      const { imported, status } = await call('email:importClientJson', undefined)
      if (!imported) return
      setEmailStatus(status)
      if (status.clientId) setClientIdDraft(status.clientId)
      setClientSecretDraft('')
      toast('Gmail OAuth client imported from JSON', 'success')
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

        {/* One card, two lanes: always-on context (can shape documents) and
            background-only knowledge (never on documents). Separate stores
            (master/context.md vs master/knowledge/) — the split is what keeps
            "never on documents" enforceable at the prompt level. */}
        <div className="panel mt-4 px-4 py-3">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted">
            <BookUser size={11} aria-hidden="true" /> Agent context
          </div>
          <div className="mt-1 text-[11px] leading-relaxed text-gray-500">
            What every agent knows about you beyond the profile. For one specific application, use
            the notes field on its intake card or scout panel instead.
          </div>

          <div className="mt-3 text-[11px] font-semibold text-gray-300">
            Always-on notes
            <span className="ml-2 font-normal text-gray-500">
              added to every build — may shape the résumé and cover letter
            </span>
          </div>
          <textarea
            className="input mt-1.5 min-h-[6rem] w-full resize-y font-mono text-[11px] leading-relaxed"
            placeholder={'e.g.\n- AWS Solutions Architect Associate (in progress, exam Aug 2026)\n- Prefer "data practitioner" framing over "engineer" for analyst roles'}
            value={masterContext}
            onChange={(e) => {
              setMasterContext(e.target.value)
              setMasterContextSaved(false)
            }}
          />

          <div className="mt-4 text-[11px] font-semibold text-gray-300">
            Background only
            <span className="ml-2 font-normal text-gray-500">
              informs judgment and answers — never listed on a résumé or cover letter
            </span>
          </div>
          <textarea
            className="input mt-1.5 min-h-[5rem] w-full resize-y font-mono text-[11px] leading-relaxed"
            placeholder={'e.g.\n- Coursework: Databases, Distributed Systems, Statistical Learning\n- Left retail job off the résumé; fine to mention in "other experience" questions'}
            value={kbNotes}
            onChange={(e) => {
              setKbNotes(e.target.value)
              setKbNotesSaved(false)
            }}
          />
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
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 flex items-center gap-2">
            <button
              className="btn btn-primary px-2 py-1 text-[10px]"
              disabled={masterContextSaved && kbNotesSaved}
              onClick={() =>
                void (async () => {
                  // Sequential: a failed save leaves its own dirty flag set, so
                  // the button stays enabled to retry just that one.
                  if (!masterContextSaved) await saveMasterContext()
                  if (!kbNotesSaved) await saveKbNotes()
                })()
              }
            >
              {masterContextSaved && kbNotesSaved ? 'Saved' : 'Save'}
            </button>
            <button className="btn px-2 py-1 text-[10px]" onClick={() => void addKbFiles()}>
              + Add files
            </button>
            <span className="text-[10px] text-gray-600">
              Stored at master/context.md and master/knowledge/ in your workspace — files (PDFs,
              images) are readable by agents.
            </span>
          </div>
        </div>

        <div className="panel mt-4 px-4 py-1">
          <div className="flex items-center gap-1.5 pt-3 text-[10px] font-bold uppercase tracking-wide text-muted">
            <Palette size={11} aria-hidden="true" /> Appearance
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
          <div className="flex items-center gap-1.5 pt-3 text-[10px] font-bold uppercase tracking-wide text-muted">
            <Cpu size={11} aria-hidden="true" /> Model provider
          </div>
          <Row
            label="Backend"
            hint="Powers every agent (builds, scout, assistant, email drafts). Gemini and Ollama route through a local translation layer; conversations keep their full context when you switch. Web search runs through Gemini grounding whenever a Gemini key is saved — even with Ollama as the backend. Tool-use quality varies by model — Claude models are tuned for this harness."
          >
            <div className="flex gap-1">
              {(['claude', 'gemini', 'ollama'] as const).map((p) => (
                <button
                  key={p}
                  className={`chip ${settings.provider === p ? 'border-cyan-700 bg-cyan-950/60 text-cyan-200' : ''}`}
                  onClick={() => {
                    patch({ provider: p })
                    setProvTest(null)
                    void refreshProviderStatus()
                  }}
                >
                  {p === 'claude' ? 'Claude' : p === 'gemini' ? 'Gemini' : 'Ollama'}
                </button>
              ))}
            </div>
          </Row>
          {settings.provider === 'gemini' && (
            <>
              <Row
                label="Gemini API key"
                hint={
                  provStatus?.geminiKeySet
                    ? 'A key is stored, encrypted with the OS keychain. Paste a new one to replace it.'
                    : 'From Google AI Studio. Stored encrypted with the OS keychain — never in the workspace, never passed to agent processes.'
                }
              >
                <div className="flex items-center gap-1.5">
                  <input
                    type="password"
                    className="input w-52"
                    placeholder={provStatus?.geminiKeySet ? '(key set)' : 'AIza…'}
                    value={geminiKeyDraft}
                    onChange={(e) => setGeminiKeyDraft(e.target.value)}
                  />
                  <button
                    className="btn px-2 py-1 text-[10px]"
                    disabled={!geminiKeyDraft.trim()}
                    onClick={() => void saveGeminiKey()}
                  >
                    Save
                  </button>
                  {provStatus?.geminiKeySet && (
                    <button className="btn px-2 py-1 text-[10px]" onClick={() => void clearGeminiKeyNow()}>
                      Clear
                    </button>
                  )}
                </div>
              </Row>
              <Row
                label="Gemini model"
                hint={
                  provStatus?.geminiModels.length
                    ? `${provStatus.geminiModels.length} chat models available to your key — the list comes from the live catalog.`
                    : 'Flash models are fast and cheap. Save a key to list what it can use.'
                }
              >
                <>
                  <input
                    className="input w-52"
                    list="gemini-model-presets"
                    value={geminiModelDraft}
                    onChange={(e) => setGeminiModelDraft(e.target.value)}
                    onBlur={() => {
                      const v = geminiModelDraft.trim()
                      if (v) patch({ geminiModel: v })
                      else setGeminiModelDraft(settings.geminiModel)
                    }}
                  />
                  <datalist id="gemini-model-presets">
                    {(provStatus?.geminiModels.length
                      ? provStatus.geminiModels
                      : ['gemini-3.6-flash', 'gemini-3.5-flash-lite']
                    ).map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </>
              </Row>
            </>
          )}
          {settings.provider === 'ollama' && (
            <>
              <Row
                label="Ollama URL"
                hint={provStatus ? `Local server: ${provStatus.ollama.message}` : 'Local Ollama server address.'}
              >
                <input
                  className="input w-52"
                  value={ollamaUrlDraft}
                  onChange={(e) => setOllamaUrlDraft(e.target.value)}
                  onBlur={() => {
                    const v = ollamaUrlDraft.trim()
                    if (v) {
                      patch({ ollamaUrl: v })
                      void refreshProviderStatus()
                    } else setOllamaUrlDraft(settings.ollamaUrl)
                  }}
                />
              </Row>
              <Row
                label="Ollama model"
                hint="Must already be pulled (ollama pull …). Pick a tool-capable model — agents depend on function calling."
              >
                <>
                  <input
                    className="input w-52"
                    list="ollama-model-list"
                    placeholder="qwen3:14b"
                    value={ollamaModelDraft}
                    onChange={(e) => setOllamaModelDraft(e.target.value)}
                    onBlur={() => patch({ ollamaModel: ollamaModelDraft.trim() })}
                  />
                  <datalist id="ollama-model-list">
                    {(provStatus?.ollama.models ?? []).map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </>
              </Row>
              <Row
                label="Context window"
                hint="Tokens per request (num_ctx). Agent prompts are large — keep this high; lower it only if the machine runs out of memory."
              >
                <input
                  className="input w-24 text-right"
                  value={ollamaCtxDraft}
                  onChange={(e) => setOllamaCtxDraft(e.target.value.replace(/\D/g, ''))}
                  onBlur={() => {
                    const n = parseInt(ollamaCtxDraft, 10)
                    if (n >= 4096 && n <= 1_048_576) patch({ ollamaNumCtx: n })
                    else setOllamaCtxDraft(String(settings.ollamaNumCtx))
                  }}
                />
              </Row>
            </>
          )}
          {settings.provider !== 'claude' && (
            <Row label="Connection" hint="One tiny request against the backend to validate key, model, and URL.">
              <div className="flex items-center gap-2">
                {provTest && (
                  <span
                    className={`max-w-64 text-right text-[10px] ${provTest.ok ? 'text-green-300' : 'text-amber-300'}`}
                  >
                    {provTest.message}
                  </span>
                )}
                <button className="btn px-2 py-1 text-[10px]" disabled={provBusy} onClick={() => void runProviderTest()}>
                  {provBusy ? 'Testing…' : 'Test'}
                </button>
              </div>
            </Row>
          )}
        </div>

        <div className="panel mt-4 px-4 py-1">
          <div className="flex items-center gap-1.5 pt-3 text-[10px] font-bold uppercase tracking-wide text-muted">
            <Bot size={11} aria-hidden="true" /> Agent runs
          </div>
          {settings.provider === 'claude' && (
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
          )}
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
          <div className="flex items-center gap-1.5 pt-3 text-[10px] font-bold uppercase tracking-wide text-muted">
            <Workflow size={11} aria-hidden="true" /> Workflow
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
            hint="Adds a keyboard button on answer fields in the Apply view that types the value into the focused field of the embedded browser."
          >
            <Toggle
              value={settings.insertTextEnabled}
              onChange={(v) => patch({ insertTextEnabled: v })}
            />
          </Row>
        </div>

        <div className="panel mt-4 px-4 py-1">
          <div className="flex items-center gap-1.5 pt-3 text-[10px] font-bold uppercase tracking-wide text-muted">
            <Briefcase size={11} aria-hidden="true" /> Job boards
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
              <Row key={b.id} label={jr ? 'jobright.ai' : b.id} icon={BOARD_LOGOS[b.id]} hint={hint}>
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
                        <Check size={11} /> {jr && !b.configured ? 'installed' : 'ready'}
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
                  <X size={12} />
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
            icon={glassdoorLogo}
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
          <Row
            label="Glassdoor jobs (browser session)"
            icon={glassdoorLogo}
            hint="When on, the scout button first harvests your target Glassdoor searches through the in-app browser using YOUR logged-in session — no stored password, nothing sent. Safe because you drive it (and solve any bot check); it does automate your session, a gray zone on Glassdoor's ToS, so keep it low-volume. Sign into Glassdoor once in the Browser tab first."
          >
            <div className="flex flex-col items-end gap-1.5">
              <Toggle
                value={settings.scoutGlassdoor}
                onChange={(v) => patch({ scoutGlassdoor: v })}
              />
              {settings.scoutGlassdoor && (
                <>
                  <textarea
                    className="input h-20 w-72 resize-y text-[11px]"
                    placeholder="Paste your Glassdoor LOCATION base URL (…/Job/new-york-jobs-SRCH_IL…IC1132348.htm) to auto-build a precise search per role at that location. Append filters and they carry to every role: ?fromAge=3 (posted <=3d), &seniorityType=internship (or entrylevel). Or paste full search URLs, one per line. Blank = keyword-only default."
                    value={gdSearchesDraft}
                    onChange={(e) => {
                      setGdSearchesDraft(e.target.value)
                      setGdSaved(false)
                    }}
                  />
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted">
                      {gdFeed
                        ? `Feed: ${gdFeed.count} jobs${gdFeed.stale ? ' (stale)' : ''}`
                        : 'No feed yet — runs on your next scout'}
                    </span>
                    <button
                      className="btn px-2 py-1 text-[10px]"
                      disabled={gdSaved}
                      onClick={() => {
                        const list = gdSearchesDraft
                          .split('\n')
                          .map((l) => l.trim())
                          .filter(Boolean)
                        patch({ glassdoorSearches: list })
                        setGdSaved(true)
                      }}
                    >
                      {gdSaved ? 'Saved' : 'Save searches'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </Row>
        </div>

        <div className="panel mt-4 px-4 py-1">
          <div className="flex items-center gap-1.5 pt-3 text-[10px] font-bold uppercase tracking-wide text-muted">
            <Mail size={11} aria-hidden="true" /> Email (Gmail)
          </div>
          <Row
            label="Google OAuth client"
            hint="Your own Desktop-app OAuth client (read-only Gmail scope). Upload the client JSON Google offers on creation, or paste the two fields. Google requires the client secret for Desktop-app token exchanges even with PKCE — it is not truly secret for installed apps. The secret and sign-in tokens are encrypted with your OS keychain and stored in app data — never in the workspace."
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
              <div className="flex gap-1.5">
                <button
                  className="btn px-2 py-1 text-[10px]"
                  title="Pick the client_secret_….json file downloaded from Google Cloud Console"
                  onClick={() => void importClientJson()}
                >
                  Upload client JSON
                </button>
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
              <li>
                Enable the Gmail API for that project:{' '}
                <button
                  className="text-cyan-500 hover:underline"
                  onClick={() =>
                    void call('app:openExternal', {
                      url: 'https://console.cloud.google.com/apis/library/gmail.googleapis.com'
                    }).catch(() => undefined)
                  }
                >
                  APIs &amp; Services → Library → Gmail API
                </button>{' '}
                → Enable. Skipping this is the usual cause of a 403 on sign-in or Refresh.
              </li>
              <li>
                OAuth consent screen → External → fill the required fields, then add your own
                Google account under Test users.
              </li>
              <li>Credentials → Create credentials → OAuth client ID → Application type “Desktop app”.</li>
              <li>
                Download the client JSON Google offers and hit “Upload client JSON” above — or copy
                the Client ID (ends in .apps.googleusercontent.com) and the Client secret into the
                fields and Save. Google requires the secret for Desktop-app token exchanges; it is
                not truly secret for installed apps.
              </li>
            </ol>
          </div>
        </div>

        {info && (
          <div className="panel mt-4 px-4 py-3">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted">
              <FolderOpen size={11} aria-hidden="true" /> Locations
            </div>
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

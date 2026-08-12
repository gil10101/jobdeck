import { useEffect, useState } from 'react'
import { Plug } from 'lucide-react'
import type { IpcInvokeContract } from '@shared/ipc'
import type { AppSettings, ProviderId } from '@shared/types'
import { call } from '../../api'
import { useApp } from '../../store'
import { PROVIDER_LABEL, PROVIDER_RUN_NOTE } from '../../lib/providers'
import PrereqPanel from '../../components/PrereqPanel'

type ProviderStatus = IpcInvokeContract['provider:status']['res']

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Choose the model backend during first-run setup and give it the minimum it
 * needs. Reachable only once a workspace exists: settings:* and provider:* are
 * registered by the workspace boot, and the provider lives in the workspace's
 * settings. Runs before the first agent run, so the preflight below can already
 * describe the backend the user picked.
 */
export default function ProviderStep(): JSX.Element {
  const settings = useApp((s) => s.settings)
  const patchSettings = useApp((s) => s.patchSettings)
  const toast = useApp((s) => s.toast)
  const [status, setStatus] = useState<ProviderStatus | null>(null)
  // Never echoes a stored key back; holds only fresh input until saved.
  const [geminiKeyDraft, setGeminiKeyDraft] = useState('')
  const [ollamaKeyDraft, setOllamaKeyDraft] = useState('')
  const [geminiModelDraft, setGeminiModelDraft] = useState('')
  const [ollamaUrlDraft, setOllamaUrlDraft] = useState('')
  const [ollamaModelDraft, setOllamaModelDraft] = useState('')
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const loadStatus = async (): Promise<void> => {
    try {
      setStatus(await call('provider:status', undefined))
    } catch {
      /* status is advisory — the fields fall back to free text */
    }
  }

  useEffect(() => {
    if (!settings) void useApp.getState().refreshSettings()
    void loadStatus()
  }, [])

  useEffect(() => {
    if (!settings) return
    setGeminiModelDraft(settings.geminiModel)
    setOllamaUrlDraft(settings.ollamaUrl)
    setOllamaModelDraft(settings.ollamaModel)
  }, [settings?.geminiModel, settings?.ollamaUrl, settings?.ollamaModel])

  if (!settings) return <div className="mt-6 text-xs text-gray-500">Loading…</div>

  const provider = settings.provider

  /** Every write goes through the store so the preflight re-evaluates with it. */
  const patch = async (p: Partial<AppSettings>): Promise<void> => {
    try {
      await patchSettings(p)
    } catch (err) {
      toast(errText(err), 'error')
    }
  }

  const choose = async (p: ProviderId): Promise<void> => {
    setTest(null)
    await patch({ provider: p })
    void loadStatus()
  }

  const saveGeminiKey = async (): Promise<void> => {
    try {
      await call('provider:setGeminiKey', { key: geminiKeyDraft })
      setGeminiKeyDraft('')
      await loadStatus()
      // The key is a prerequisite under Gemini — the panel below must not keep
      // reporting the state before this save.
      void useApp.getState().refreshPreflight()
      toast('Gemini key saved (encrypted with the OS keychain)', 'success')
    } catch (err) {
      toast(errText(err), 'error')
    }
  }

  /** Only ollama.com's hosted models need a key; a local server ignores it.
   *  Offered here because a cloud user cannot otherwise satisfy the Ollama
   *  prerequisite during setup, and Settings is unreachable until it ends. */
  const saveOllamaKey = async (): Promise<void> => {
    try {
      await call('provider:setOllamaKey', { key: ollamaKeyDraft })
      setOllamaKeyDraft('')
      await loadStatus()
      void useApp.getState().refreshPreflight()
      toast('Ollama key saved (encrypted with the OS keychain)', 'success')
    } catch (err) {
      toast(errText(err), 'error')
    }
  }

  /** Reachability first (provider:status), then one real round-trip — an
   *  unreachable server must be reported as that, not as a model failure. */
  const runTest = async (): Promise<void> => {
    setBusy(true)
    setTest(null)
    try {
      const next = await call('provider:status', undefined)
      setStatus(next)
      if (provider === 'ollama' && !next.ollama.reachable) {
        setTest({ ok: false, message: next.ollama.message })
        return
      }
      setTest(await call('provider:test', undefined))
    } catch (err) {
      setTest({ ok: false, message: errText(err) })
    } finally {
      // The test just probed the same backend the preflight judges — leaving
      // the panel on the older verdict would contradict the line beside it.
      void useApp.getState().refreshPreflight()
      setBusy(false)
    }
  }

  return (
    <div className="mt-6">
      <p className="text-xs leading-relaxed text-gray-400">
        Pick what powers the agents. You can change this any time in Settings, and every backend can be
        configured further there.
      </p>
      <div className="mt-4 flex gap-1">
        {(['claude', 'gemini', 'ollama'] as const).map((p) => (
          <button
            key={p}
            className={`chip ${provider === p ? 'border-cyan-700 bg-cyan-950/60 text-cyan-200' : ''}`}
            onClick={() => void choose(p)}
          >
            {PROVIDER_LABEL[p]}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-gray-500">{PROVIDER_RUN_NOTE[provider]}</p>

      {provider === 'claude' && (
        <p className="mt-3 text-[11px] leading-relaxed text-gray-400">
          Nothing to configure — runs sign in with the Claude Code login on this machine. If the preflight
          below reports no sign-in, finish <span className="font-mono text-gray-300">claude</span> login in a
          terminal, export <span className="font-mono text-gray-300">ANTHROPIC_API_KEY</span>, or pick Gemini
          or Ollama here instead.
        </p>
      )}

      {provider === 'gemini' && (
        <div className="mt-3 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-gray-300">Gemini API key</span>
            <div className="flex items-center gap-1.5">
              <input
                type="password"
                className="input w-64"
                placeholder={status?.geminiKeySet ? '(key set)' : 'AIza…'}
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
            </div>
            <span className="text-[10px] leading-relaxed text-gray-500">
              From Google AI Studio. Stored encrypted with the OS keychain — never in the workspace.
            </span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-gray-300">Model</span>
            {status?.geminiModels.length ? (
              <select
                className="input h-8 w-64 py-0"
                value={settings.geminiModel}
                onChange={(e) => void patch({ geminiModel: e.target.value })}
              >
                {(status.geminiModels.includes(settings.geminiModel)
                  ? status.geminiModels
                  : [settings.geminiModel, ...status.geminiModels]
                ).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="input w-64"
                placeholder="gemini-3.6-flash"
                value={geminiModelDraft}
                onChange={(e) => setGeminiModelDraft(e.target.value)}
                onBlur={() => {
                  const v = geminiModelDraft.trim()
                  if (v) void patch({ geminiModel: v })
                  else setGeminiModelDraft(settings.geminiModel)
                }}
              />
            )}
            <span className="text-[10px] leading-relaxed text-gray-500">
              {status?.geminiModels.length
                ? `All ${status.geminiModels.length} chat models your key can use, from the live catalog.`
                : 'Save a key to list what it can use.'}
            </span>
          </label>
        </div>
      )}

      {provider === 'ollama' && (
        <div className="mt-3 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-gray-300">Server URL</span>
            <input
              className="input w-64"
              value={ollamaUrlDraft}
              onChange={(e) => setOllamaUrlDraft(e.target.value)}
              onBlur={() => {
                const v = ollamaUrlDraft.trim()
                if (v && v !== settings.ollamaUrl) {
                  void patch({ ollamaUrl: v }).then(loadStatus)
                } else if (!v) setOllamaUrlDraft(settings.ollamaUrl)
              }}
            />
            <span className="text-[10px] leading-relaxed text-gray-500">
              Where your Ollama server listens. The default is right for a local install.
            </span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-gray-300">
              API key <span className="text-gray-500">(cloud models only)</span>
            </span>
            <div className="flex items-center gap-1.5">
              <input
                type="password"
                className="input w-64"
                placeholder={status?.ollamaKeySet ? '(key set)' : 'leave empty for a local server'}
                value={ollamaKeyDraft}
                onChange={(e) => setOllamaKeyDraft(e.target.value)}
              />
              <button
                className="btn px-2 py-1 text-[10px]"
                disabled={!ollamaKeyDraft.trim()}
                onClick={() => void saveOllamaKey()}
              >
                Save
              </button>
            </div>
            <span className="text-[10px] leading-relaxed text-gray-500">
              Needed only for ollama.com hosted models. A local server needs nothing here.
            </span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-gray-300">Model</span>
            {status?.ollama.models.length ? (
              <select
                className="input h-8 w-64 py-0"
                value={settings.ollamaModel}
                onChange={(e) => void patch({ ollamaModel: e.target.value })}
              >
                {(settings.ollamaModel && !status.ollama.models.includes(settings.ollamaModel)
                  ? [settings.ollamaModel, ...status.ollama.models]
                  : ['', ...status.ollama.models]
                ).map((m) => (
                  <option key={m} value={m}>
                    {m ? `${m}${/[-:]cloud$/.test(m) ? '  (cloud)' : ''}` : 'Pick a model…'}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="input w-64"
                placeholder="qwen3:14b"
                value={ollamaModelDraft}
                onChange={(e) => setOllamaModelDraft(e.target.value)}
                onBlur={() => void patch({ ollamaModel: ollamaModelDraft.trim() })}
              />
            )}
            <span className="text-[10px] leading-relaxed text-gray-500">
              {status?.ollama.models.length
                ? 'Pulled models on that server. Pick a tool-capable one — agents depend on function calling.'
                : 'Pull one first (ollama pull …), then Test to list what the server has.'}
            </span>
          </label>
        </div>
      )}

      {provider !== 'claude' && (
        <div className="mt-3 flex items-center gap-2">
          <button className="btn px-2 py-1 text-[10px]" disabled={busy} onClick={() => void runTest()}>
            <Plug size={11} /> {busy ? 'Testing…' : 'Test connection'}
          </button>
          {test && (
            <span className={`text-[10px] leading-relaxed ${test.ok ? 'text-green-300' : 'text-amber-300'}`}>
              {test.message}
            </span>
          )}
        </div>
      )}

      <PrereqPanel />
    </div>
  )
}

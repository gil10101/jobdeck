import { create } from 'zustand'
import type {
  AppSettings,
  AssistantApproval,
  AssistantMessage,
  AssistantStatus,
  AssistantUsage,
  CandidateJob,
  CompanyInfo,
  ConversationMeta,
  IntakeFolder,
  IntakeItem,
  PrereqTool,
  ProviderId,
  RunEvent,
  RunMeta,
  TrackerRow
} from '@shared/types'
import type { IpcInvokeContract } from '@shared/ipc'
import { call, onPush } from './api'

/** Normalize a company name into the key used by the main-process companies map. */
export function companyKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

export type Route =
  | { view: 'tracker' }
  | { view: 'scout' }
  | { view: 'intake' }
  | { view: 'history' }
  | { view: 'browser' }
  | { view: 'email' }
  | { view: 'calendar' }
  | { view: 'runs'; runId?: string }
  | { view: 'library' }
  | { view: 'whoami' }
  | { view: 'settings' }
  | { view: 'detail'; rowId: string }
  | { view: 'apply'; rowId: string }

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error'
  text: string
}

/** Exactly what config:get returns — aliased off the contract so a field the
 *  handler stops sending is a compile error here, not a silent UI degradation. */
export type AppConfigInfo = IpcInvokeContract['config:get']['res']

/**
 * The host prerequisites of the ACTIVE model provider, exactly as env:check
 * last reported them — the one list every surface renders, so onboarding and
 * Settings can never disagree about what the current provider needs. Which
 * rows apply is decided in the main process; nothing here filters them.
 */
export interface PreflightSlice {
  /** null = no successful check yet; a check that failed leaves this null and
   *  fills `error`, so "nothing missing" and "could not look" stay distinct. */
  tools: PrereqTool[] | null
  /** The provider `tools` was judged against; null before a workspace exists. */
  provider: ProviderId | null
  /** Main's own one-line statement of what the list covers. */
  scopeNote: string
  /** Why the check itself could not run; null when it did. */
  error: string | null
  checking: boolean
}

export interface AssistantSlice {
  open: boolean
  conversationId: string | null
  messages: AssistantMessage[]
  streaming: { text: string; events: RunEvent[] } | null
  usage: AssistantUsage
  status: AssistantStatus
  pendingApproval: AssistantApproval | null
  history: ConversationMeta[]
  /** Model override for assistant replies; '' = runtime default. Applies from the next reply. */
  model: string
}

/** Per-application revision chat (detail view Chat tab); one conversation per row. */
export interface DetailChatSlice {
  rowId: string | null
  conversationId: string | null
  messages: AssistantMessage[]
  streaming: { text: string; events: RunEvent[] } | null
  status: AssistantStatus
}

function initialAssistantUsage(): AssistantUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheTokens: 0,
    costUsd: 0,
    contextTokens: 0,
    contextWindow: 200000
  }
}

function initialAssistantSlice(): AssistantSlice {
  return {
    open: false,
    conversationId: null,
    messages: [],
    streaming: null,
    usage: initialAssistantUsage(),
    status: 'idle',
    pendingApproval: null,
    history: [],
    model: ''
  }
}

interface AppState {
  route: Route
  /** null = not fetched yet; workspacePath null = first-run required. */
  config: AppConfigInfo | null
  /** Set when config:get itself failed; the app then shows a retry screen
   *  instead of a main UI wired to channels that may not exist. */
  configLoadError: string | null
  rows: TrackerRow[]
  intake: IntakeItem[]
  intakeFolders: IntakeFolder[]
  candidates: CandidateJob[]
  runs: RunMeta[]
  settings: AppSettings | null
  preflight: PreflightSlice
  companies: Record<string, CompanyInfo>
  /** Count of calendar events awaiting review — drives the sidebar badge.
   *  Seeded from calendar:list on hydrate, then kept live by push:calendarChanged. */
  calendarProposed: number
  toasts: Toast[]
  assistant: AssistantSlice
  detailChat: DetailChatSlice
  /** Non-null while the pre-scout Glassdoor harvest overlay runs; carries the
   *  scout instructions to launch once the harvest finishes. */
  scoutHarvest: { searches: string[]; instructions?: string } | null
  navigate: (route: Route) => void
  refreshConfig: () => Promise<void>
  refreshRows: () => Promise<void>
  refreshIntake: () => Promise<void>
  refreshCandidates: () => Promise<void>
  refreshRuns: () => Promise<void>
  refreshSettings: () => Promise<void>
  /** Write settings and keep the preflight honest — see the action. Rejects
   *  with the main-process message so the caller can surface it. */
  patchSettings: (patch: Partial<AppSettings>) => Promise<void>
  refreshPreflight: () => Promise<void>
  refreshCompanies: () => Promise<void>
  refreshCalendarProposed: () => Promise<void>
  toggleTheme: () => Promise<void>
  hydrate: () => Promise<void>
  upsertRunMeta: (meta: RunMeta) => void
  toast: (text: string, kind?: Toast['kind']) => void
  dismissToast: (id: number) => void
  toggleAssistant: (open?: boolean) => void
  setAssistantModel: (model: string) => void
  sendAssistant: (text: string) => Promise<void>
  stopAssistant: () => void
  approveAssistant: (decision: 'allow' | 'deny') => void
  newAssistantChat: () => Promise<void>
  openAssistantChat: (id: string) => Promise<void>
  deleteAssistantChat: (id: string) => Promise<void>
  refreshAssistantHistory: () => Promise<void>
  openDetailChat: (rowId: string) => Promise<void>
  sendDetailChat: (text: string) => Promise<void>
  stopDetailChat: () => void
  /** Every scout entry point (Scout button, History rerun) goes through here,
   *  so the Glassdoor harvest runs first wherever the scout was launched. */
  requestScout: (instructions?: string) => Promise<void>
  /** Launch the scout run itself (after any harvest). */
  launchScout: (instructions?: string) => Promise<void>
  clearScoutHarvest: () => void
}

/** Settings that change what env:check evaluates — which rows apply (provider)
 *  or what the provider probe talks to. Writing any of them re-runs the check. */
const PREFLIGHT_SETTINGS: (keyof AppSettings)[] = ['provider', 'ollamaUrl', 'ollamaModel']

let toastSeq = 1

/** Sequence of the newest env:check in flight. Probe latency is provider-shaped
 *  — Ollama does a network round-trip, Gemini a local read — so two checks
 *  started in provider order can resolve out of order. Only the latest issued
 *  check may write the slice; earlier ones are discarded. */
let preflightSeq = 0

export const useApp = create<AppState>((set, get) => ({
  route: { view: 'tracker' },
  config: null,
  configLoadError: null,
  rows: [],
  intake: [],
  intakeFolders: [],
  candidates: [],
  runs: [],
  settings: null,
  preflight: { tools: null, provider: null, scopeNote: '', error: null, checking: false },
  companies: {},
  calendarProposed: 0,
  toasts: [],
  assistant: initialAssistantSlice(),
  detailChat: { rowId: null, conversationId: null, messages: [], streaming: null, status: 'idle' },
  scoutHarvest: null,

  navigate: (route) => set({ route }),

  requestScout: async (instructions) => {
    // Glassdoor (when on) is harvested from the logged-in in-app browser first,
    // wherever the scout was launched from — the overlay lives at app level so
    // the History rerun triggers it too, not just the Scout button.
    if (get().settings?.scoutGlassdoor) {
      try {
        const { searches } = await call('glassdoor:searches', undefined)
        if (searches.length) {
          set({ scoutHarvest: { searches, instructions } })
          return
        }
      } catch {
        /* fall through to a plain scout */
      }
    }
    await get().launchScout(instructions)
  },

  launchScout: async (instructions) => {
    try {
      const meta = await call('scout:start', { instructions: instructions?.trim() || undefined })
      get().toast('Scout agent launched — watch it work in Runs', 'success')
      void get().refreshRuns()
      get().navigate({ view: 'runs', runId: meta.id })
    } catch (err) {
      get().toast(String(err), 'error')
    }
  },

  clearScoutHarvest: () => set({ scoutHarvest: null }),

  refreshConfig: async () => {
    try {
      set({ config: await call('config:get', undefined), configLoadError: null })
    } catch (err) {
      console.error('[store] config:get failed:', err)
      // A config already in hand stays authoritative; only a failure before
      // the first answer leaves the app with nothing to route on.
      if (!get().config) set({ configLoadError: err instanceof Error ? err.message : String(err) })
    }
  },

  refreshRows: async () => {
    try {
      set({ rows: await call('tracker:getAll', undefined) })
    } catch (err) {
      get().toast(`Failed to load tracker: ${String(err)}`, 'error')
    }
  },
  refreshIntake: async () => {
    try {
      const [intake, intakeFolders] = await Promise.all([
        call('intake:list', undefined),
        call('intake:listFolders', undefined)
      ])
      set({ intake, intakeFolders })
    } catch (err) {
      // A hydration failure leaves this slice empty; the log is the only trace.
      console.error('[store] intake refresh failed:', err)
    }
  },
  refreshCandidates: async () => {
    try {
      set({ candidates: await call('candidates:list', undefined) })
    } catch (err) {
      console.error('[store] candidates:list failed:', err)
    }
  },
  refreshRuns: async () => {
    try {
      set({ runs: await call('runs:list', undefined) })
    } catch (err) {
      console.error('[store] runs:list failed:', err)
    }
  },
  refreshSettings: async () => {
    try {
      const settings = await call('settings:get', undefined)
      document.documentElement.dataset.theme = settings.theme
      set({ settings })
    } catch (err) {
      console.error('[store] settings:get failed:', err)
    }
  },
  patchSettings: async (patch) => {
    const settings = await call('settings:set', patch)
    document.documentElement.dataset.theme = settings.theme
    set({ settings })
    // Invariant: the preflight always describes the provider that is active
    // now, and the backend it was pointed at. Re-checked here rather than at
    // each call site, so no screen can write one of these and show a stale
    // verdict.
    if (PREFLIGHT_SETTINGS.some((k) => patch[k] !== undefined)) await get().refreshPreflight()
  },
  refreshPreflight: async () => {
    // Claim the sequence BEFORE awaiting: a result may only land while it is
    // still the newest request, which keeps the slice describing the provider
    // that is active now rather than whichever probe happened to finish last.
    const seq = ++preflightSeq
    set((s) => ({ preflight: { ...s.preflight, checking: true } }))
    try {
      const { tools, provider, scopeNote } = await call('env:check', undefined)
      if (seq !== preflightSeq) return
      set({ preflight: { tools, provider, scopeNote, error: null, checking: false } })
    } catch (err) {
      if (seq !== preflightSeq) return
      // A check that could not run must not read as a check that passed.
      const error = err instanceof Error ? err.message : String(err)
      set({ preflight: { tools: null, provider: null, scopeNote: '', error, checking: false } })
    }
  },
  refreshCompanies: async () => {
    try {
      set({ companies: await call('companies:get', undefined) })
    } catch (err) {
      console.error('[store] companies:get failed:', err)
    }
  },
  refreshCalendarProposed: async () => {
    try {
      const events = await call('calendar:list', undefined)
      set({ calendarProposed: events.filter((e) => e.state === 'proposed').length })
    } catch (err) {
      console.error('[store] calendar:list failed:', err)
    }
  },
  toggleTheme: async () => {
    const current = get().settings?.theme ?? 'dark'
    const theme = current === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = theme // instant, before the round-trip
    try {
      const settings = await call('settings:set', { theme })
      set({ settings })
    } catch {
      /* keep the visual toggle even if persisting failed */
    }
  },
  hydrate: async () => {
    await get().refreshConfig()
    if (!get().config?.workspacePath) return // first-run: nothing else exists yet
    await Promise.all([
      get().refreshRows(),
      get().refreshIntake(),
      get().refreshCandidates(),
      get().refreshRuns(),
      get().refreshSettings(),
      get().refreshPreflight(),
      get().refreshCompanies(),
      get().refreshCalendarProposed()
    ])
  },

  upsertRunMeta: (meta) =>
    set((s) => {
      const idx = s.runs.findIndex((r) => r.id === meta.id)
      const runs = [...s.runs]
      if (idx >= 0) runs[idx] = meta
      else runs.unshift(meta)
      return { runs }
    }),

  toast: (text, kind = 'info') => {
    const id = toastSeq++
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }))
    const ttl = kind === 'error' ? 10000 : 5000
    setTimeout(() => get().dismissToast(id), ttl)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  toggleAssistant: (open) =>
    set((s) => ({ assistant: { ...s.assistant, open: open ?? !s.assistant.open } })),

  setAssistantModel: (model) => set((s) => ({ assistant: { ...s.assistant, model } })),

  sendAssistant: async (text) => {
    try {
      // Main starts pushing for this send (user echo, 'thinking') before the
      // send invoke resolves, and every push handler drops payloads whose
      // conversationId doesn't match — so the id must be known BEFORE the
      // first send, never learned from its response.
      let conversationId = get().assistant.conversationId
      if (!conversationId) {
        conversationId = (await call('assistant:newConversation', undefined)).conversationId
        set((s) => ({ assistant: { ...s.assistant, conversationId } }))
      }
      await call('assistant:send', { conversationId, text, model: get().assistant.model || null })
    } catch (err) {
      get().toast(`Failed to send message: ${String(err)}`, 'error')
    }
  },

  stopAssistant: () => {
    const { conversationId } = get().assistant
    if (!conversationId) return
    // Main denies pending approvals on stop without pushing a clearing event —
    // drop ours locally so a stale card can't block the composer.
    set((s) => ({ assistant: { ...s.assistant, pendingApproval: null } }))
    call('assistant:stop', { conversationId }).catch((err) => {
      get().toast(`Failed to stop assistant: ${String(err)}`, 'error')
    })
  },

  approveAssistant: (decision) => {
    const { pendingApproval } = get().assistant
    if (!pendingApproval) return
    call('assistant:approve', { approvalId: pendingApproval.approvalId, decision }).catch((err) => {
      get().toast(`Failed to submit approval: ${String(err)}`, 'error')
    })
    set((s) => ({ assistant: { ...s.assistant, pendingApproval: null } }))
  },

  newAssistantChat: async () => {
    // A pending approval belongs to the conversation being left — deny it so
    // its run isn't parked forever on an answer that can no longer arrive.
    if (get().assistant.pendingApproval) get().approveAssistant('deny')
    try {
      const { conversationId } = await call('assistant:newConversation', undefined)
      set((s) => ({
        assistant: {
          ...s.assistant,
          conversationId,
          messages: [],
          streaming: null,
          usage: initialAssistantUsage(),
          status: 'idle',
          pendingApproval: null
        }
      }))
    } catch (err) {
      get().toast(`Failed to start new chat: ${String(err)}`, 'error')
    }
  },

  openAssistantChat: async (id) => {
    // Same as newAssistantChat: never strand the outgoing conversation's run
    // behind an unanswerable approval.
    if (get().assistant.pendingApproval) get().approveAssistant('deny')
    try {
      const conversation = await call('assistant:getConversation', { id })
      if (!conversation) {
        get().toast('Conversation not found', 'error')
        return
      }
      set((s) => ({
        assistant: {
          ...s.assistant,
          conversationId: id,
          messages: conversation.messages,
          usage: conversation.usage,
          streaming: null,
          pendingApproval: null,
          status: 'idle'
        }
      }))
      // Pushes only fire on transitions, so anything raised while this
      // conversation was off-screen (a parked approval, a still-running turn)
      // has to be re-fetched — the disk snapshot above knows nothing of it.
      const live = await call('assistant:resync', { conversationId: id })
      set((s) =>
        s.assistant.conversationId === id
          ? {
              assistant: {
                ...s.assistant,
                status: live.status,
                pendingApproval: live.pendingApproval
              }
            }
          : s
      )
    } catch (err) {
      get().toast(`Failed to open conversation: ${String(err)}`, 'error')
    }
  },

  deleteAssistantChat: async (id) => {
    try {
      await call('assistant:deleteConversation', { id })
      set((s) => ({
        assistant: {
          ...s.assistant,
          history: s.assistant.history.filter((h) => h.id !== id),
          // Deleting the open conversation leaves a fresh, un-persisted chat.
          ...(s.assistant.conversationId === id
            ? {
                conversationId: null,
                messages: [],
                streaming: null,
                usage: initialAssistantUsage(),
                status: 'idle' as const,
                pendingApproval: null
              }
            : {})
        }
      }))
    } catch (err) {
      get().toast(`Failed to delete conversation: ${String(err)}`, 'error')
    }
  },

  openDetailChat: async (rowId) => {
    // conversationId is deterministic (row_<id>), so the push guards match
    // from the very first send — no create round-trip needed.
    set({
      detailChat: {
        rowId,
        conversationId: `row_${rowId}`,
        messages: [],
        streaming: null,
        status: 'idle'
      }
    })
    try {
      const conversation = await call('detailChat:get', { rowId })
      if (conversation && get().detailChat.rowId === rowId) {
        set((s) => ({
          detailChat: { ...s.detailChat, messages: conversation.messages }
        }))
      }
    } catch {
      /* fresh chat */
    }
  },

  sendDetailChat: async (text) => {
    const { rowId } = get().detailChat
    if (!rowId) return
    try {
      await call('detailChat:send', { rowId, text })
    } catch (err) {
      get().toast(`Failed to send: ${String(err)}`, 'error')
    }
  },

  stopDetailChat: () => {
    const { rowId } = get().detailChat
    if (!rowId) return
    void call('detailChat:stop', { rowId }).catch((err) => {
      get().toast(`Failed to stop: ${String(err)}`, 'error')
    })
  },

  refreshAssistantHistory: async () => {
    try {
      const history = await call('assistant:listConversations', undefined)
      set((s) => ({ assistant: { ...s.assistant, history } }))
    } catch (err) {
      console.error('[store] assistant:listConversations failed:', err)
    }
  }
}))

// Assistant push subscriptions — mirrors the coarse push wiring in main.tsx (module-scope,
// useApp.getState()/setState()), scoped here since this slice's channels are assistant-only.
// Every handler is guarded on conversationId so pushes for a different/background conversation
// are ignored.
onPush('push:assistantMessage', ({ conversationId, message }) => {
  if (conversationId !== useApp.getState().assistant.conversationId) return
  useApp.setState((s) => ({
    assistant: {
      ...s.assistant,
      messages: [...s.assistant.messages, message],
      // The assistant turn is complete once its final message arrives; drop the partial buffer.
      streaming: message.role === 'assistant' ? null : s.assistant.streaming
    }
  }))
})

onPush('push:assistantEvent', ({ conversationId, event }) => {
  if (conversationId !== useApp.getState().assistant.conversationId) return
  useApp.setState((s) => {
    const prev = s.assistant.streaming ?? { text: '', events: [] }
    // 'text' events carry a cumulative buffer, not a delta — replace, don't append.
    const text = event.kind === 'text' ? event.text : prev.text
    return { assistant: { ...s.assistant, streaming: { text, events: [...prev.events, event] } } }
  })
})

onPush('push:assistantUsage', ({ conversationId, ...usage }) => {
  if (conversationId !== useApp.getState().assistant.conversationId) return
  useApp.setState((s) => ({ assistant: { ...s.assistant, usage } }))
})

onPush('push:assistantState', ({ conversationId, status }) => {
  if (conversationId !== useApp.getState().assistant.conversationId) return
  useApp.setState((s) => ({
    assistant: {
      ...s.assistant,
      status,
      // A run exit (error included) denies its approvals main-side without a
      // clearing push — idle therefore implies no live approval.
      pendingApproval: status === 'idle' ? null : s.assistant.pendingApproval
    }
  }))
})

onPush('push:assistantApproval', (approval) => {
  if (approval.conversationId !== useApp.getState().assistant.conversationId) return
  useApp.setState((s) => ({ assistant: { ...s.assistant, pendingApproval: approval } }))
})

// Detail-chat mirrors of the assistant push handlers: same channels, guarded on
// the detailChat conversation (row_<id>), so each push matches exactly one slice.
onPush('push:assistantMessage', ({ conversationId, message }) => {
  if (conversationId !== useApp.getState().detailChat.conversationId) return
  useApp.setState((s) => ({
    detailChat: {
      ...s.detailChat,
      messages: [...s.detailChat.messages, message],
      streaming: message.role === 'assistant' ? null : s.detailChat.streaming
    }
  }))
})

onPush('push:assistantEvent', ({ conversationId, event }) => {
  if (conversationId !== useApp.getState().detailChat.conversationId) return
  useApp.setState((s) => {
    const prev = s.detailChat.streaming ?? { text: '', events: [] }
    const text = event.kind === 'text' ? event.text : prev.text
    return { detailChat: { ...s.detailChat, streaming: { text, events: [...prev.events, event] } } }
  })
})

onPush('push:assistantState', ({ conversationId, status }) => {
  if (conversationId !== useApp.getState().detailChat.conversationId) return
  useApp.setState((s) => ({ detailChat: { ...s.detailChat, status } }))
})

// Calendar pushes are app-wide (sidebar badge, notification-click focus), so
// they subscribe here rather than in the view, which may be unmounted.
onPush('push:calendarChanged', ({ proposed }) => {
  useApp.setState({ calendarProposed: proposed })
})

onPush('push:calendarFocus', () => {
  useApp.setState({ route: { view: 'calendar' } })
})

onPush('push:emailFocus', () => {
  useApp.setState({ route: { view: 'email' } })
})

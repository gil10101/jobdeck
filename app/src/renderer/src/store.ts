import { create } from 'zustand'
import type {
  AppSettings,
  CandidateJob,
  CompanyInfo,
  IntakeItem,
  RunMeta,
  TrackerRow
} from '@shared/types'
import { call } from './api'

/** Normalize a company name into the key used by the main-process companies map. */
export function companyKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

export type Route =
  | { view: 'tracker' }
  | { view: 'scout' }
  | { view: 'intake' }
  | { view: 'runs'; runId?: string }
  | { view: 'library' }
  | { view: 'settings' }
  | { view: 'detail'; rowId: string }
  | { view: 'apply'; rowId: string }

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error'
  text: string
}

export interface AppConfigInfo {
  workspacePath: string | null
  onboardedAt: string | null
}

interface AppState {
  route: Route
  /** null = not fetched yet; workspacePath null = first-run required. */
  config: AppConfigInfo | null
  rows: TrackerRow[]
  intake: IntakeItem[]
  candidates: CandidateJob[]
  runs: RunMeta[]
  settings: AppSettings | null
  companies: Record<string, CompanyInfo>
  toasts: Toast[]
  navigate: (route: Route) => void
  refreshConfig: () => Promise<void>
  refreshRows: () => Promise<void>
  refreshIntake: () => Promise<void>
  refreshCandidates: () => Promise<void>
  refreshRuns: () => Promise<void>
  refreshSettings: () => Promise<void>
  refreshCompanies: () => Promise<void>
  toggleTheme: () => Promise<void>
  hydrate: () => Promise<void>
  upsertRunMeta: (meta: RunMeta) => void
  toast: (text: string, kind?: Toast['kind']) => void
  dismissToast: (id: number) => void
}

let toastSeq = 1

export const useApp = create<AppState>((set, get) => ({
  route: { view: 'tracker' },
  config: null,
  rows: [],
  intake: [],
  candidates: [],
  runs: [],
  settings: null,
  companies: {},
  toasts: [],

  navigate: (route) => set({ route }),

  refreshConfig: async () => {
    try {
      set({ config: await call('config:get', undefined) })
    } catch {
      /* main not ready yet */
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
      set({ intake: await call('intake:list', undefined) })
    } catch {
      /* ignore */
    }
  },
  refreshCandidates: async () => {
    try {
      set({ candidates: await call('candidates:list', undefined) })
    } catch {
      /* ignore */
    }
  },
  refreshRuns: async () => {
    try {
      set({ runs: await call('runs:list', undefined) })
    } catch {
      /* ignore */
    }
  },
  refreshSettings: async () => {
    try {
      const settings = await call('settings:get', undefined)
      document.documentElement.dataset.theme = settings.theme
      set({ settings })
    } catch {
      /* ignore */
    }
  },
  refreshCompanies: async () => {
    try {
      set({ companies: await call('companies:get', undefined) })
    } catch {
      /* ignore */
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
      get().refreshCompanies()
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
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))

// IPC contract — single source of truth for channel names + payload types.
import type {
  ApplicationDetail,
  AppSettings,
  CandidateJob,
  IntakeItem,
  LibraryCategory,
  RunEvent,
  RunMeta,
  ScanResult,
  TrackerRow,
  V1ImportSummary
} from './types'

/** invoke/handle channels: request → response (response is wrapped in IpcResult by the registry). */
export interface IpcInvokeContract {
  'tracker:getAll': { req: void; res: TrackerRow[] }
  'tracker:upsert': { req: Partial<TrackerRow> & { id?: string }; res: TrackerRow }
  'tracker:delete': { req: { id: string }; res: void }
  'tracker:markApplied': { req: { id: string; dateApplied?: string }; res: TrackerRow }
  'tracker:importXlsx': {
    req: { mode: 'replace' | 'merge'; filePath: string }
    res: { imported: number; skipped: number; warnings: string[] }
  }
  'tracker:exportXlsx': { req: void; res: { path: string } }
  'scan:run': { req: void; res: ScanResult }
  'intake:list': { req: void; res: IntakeItem[] }
  'intake:addPasted': {
    req: {
      text: string
      url?: string
      company?: string
      role?: string
      /** Pasted screenshots as base64 PNG payloads (no data: prefix). */
      imagesBase64?: string[]
    }
    res: IntakeItem
  }
  'intake:dismiss': { req: { id: string }; res: void }
  'todo:rescan': { req: void; res: IntakeItem[] }
  'runs:start': {
    req: {
      intakeId?: string
      postingText: string
      applyUrl?: string
      companyHint?: string
      roleHint?: string
      imagePaths?: string[]
    }
    res: RunMeta
  }
  'runs:cancel': { req: { runId: string }; res: void }
  'runs:list': { req: void; res: RunMeta[] }
  'runs:get': { req: { runId: string }; res: { meta: RunMeta; events: RunEvent[] } }
  'detail:get': { req: { rowId: string }; res: ApplicationDetail }
  'scout:start': { req: { instructions?: string }; res: RunMeta }
  'library:list': { req: void; res: LibraryCategory[] }
  'library:read': { req: { relPath: string }; res: { content: string; truncated: boolean } }
  'detail:recompile': {
    req: { rowId: string; doc: 'resume' | 'cover' }
    res: { pages: number | null; logTail: string }
  }
  'interview:start': { req: { rowId: string }; res: RunMeta }
  'boards:getStatus': { req: void; res: { jobright: { configured: boolean; email: string | null } } }
  'boards:setCreds': { req: { email: string; password: string }; res: void }
  'boards:test': { req: void; res: { ok: boolean; message: string } }
  'app:info': { req: void; res: { repoRoot: string; appDataDir: string } }
  'config:get': { req: void; res: { workspacePath: string | null; onboardedAt: string | null } }
  'env:check': {
    req: void
    res: { pdflatex: { ok: boolean; path: string }; platform: string; appVersion: string }
  }
  'workspace:choose': { req: { title?: string }; res: { path: string | null } }
  'workspace:create': { req: { dir: string }; res: { workspacePath: string } }
  'workspace:importV1': { req: { repoRoot: string; dir: string }; res: V1ImportSummary }
  'app:pickFile': {
    req: { filters?: { name: string; extensions: string[] }[] }
    res: { path: string | null }
  }
  'candidates:list': { req: void; res: CandidateJob[] }
  'candidates:accept': { req: { id: string }; res: { candidate: CandidateJob; run: RunMeta } }
  'candidates:reject': { req: { id: string }; res: void }
  'app:showItem': { req: { relPath: string }; res: void }
  'app:openFolder': { req: { relPath: string }; res: void }
  'app:openExternal': { req: { url: string }; res: void }
  'app:copy': { req: { text: string }; res: void }
  'app:absPath': { req: { relPath: string }; res: { absPath: string } }
  'apply:insertText': { req: { text: string }; res: void }
  'settings:get': { req: void; res: AppSettings }
  'settings:set': { req: Partial<AppSettings>; res: AppSettings }
}

export type IpcChannel = keyof IpcInvokeContract

/** main → renderer push channels. */
export interface IpcPushContract {
  'push:runEvent': { runId: string; event: RunEvent }
  'push:runChanged': RunMeta
  'push:todoNew': IntakeItem
  'push:storeChanged': { domains: ('rows' | 'intake' | 'settings' | 'candidates')[] }
}

export type IpcPushChannel = keyof IpcPushContract

export const INVOKE_CHANNELS: IpcChannel[] = [
  'tracker:getAll',
  'tracker:upsert',
  'tracker:delete',
  'tracker:markApplied',
  'tracker:importXlsx',
  'tracker:exportXlsx',
  'scan:run',
  'intake:list',
  'intake:addPasted',
  'intake:dismiss',
  'todo:rescan',
  'runs:start',
  'runs:cancel',
  'runs:list',
  'runs:get',
  'detail:get',
  'scout:start',
  'candidates:list',
  'candidates:accept',
  'candidates:reject',
  'library:list',
  'library:read',
  'detail:recompile',
  'interview:start',
  'boards:getStatus',
  'boards:setCreds',
  'boards:test',
  'app:info',
  'config:get',
  'env:check',
  'workspace:choose',
  'workspace:create',
  'workspace:importV1',
  'app:pickFile',
  'app:showItem',
  'app:openFolder',
  'app:openExternal',
  'app:copy',
  'app:absPath',
  'apply:insertText',
  'settings:get',
  'settings:set'
]

export const PUSH_CHANNELS: IpcPushChannel[] = [
  'push:runEvent',
  'push:runChanged',
  'push:todoNew',
  'push:storeChanged'
]

/** Build a local-file:// URL for a repo-relative path (PDF preview etc.). */
export function localFileUrl(relPath: string): string {
  // Encode each segment; keep slashes as separators.
  const enc = relPath
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/')
  return `local-file://app/${enc}`
}

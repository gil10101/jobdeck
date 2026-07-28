// IPC contract — single source of truth for channel names + payload types.
import type {
  ApplicationDetail,
  AppSettings,
  AssistantApproval,
  AssistantConversation,
  AssistantMessage,
  AssistantStatus,
  AssistantUsage,
  BoardId,
  BoardsStatus,
  CandidateJob,
  CompanyInfo,
  ConversationMeta,
  CustomBoardTest,
  EmailFilter,
  EmailMessage,
  EmailStatus,
  IntakeFolder,
  IntakeItem,
  LibraryCategory,
  RunEvent,
  RunMeta,
  ScanResult,
  ScoutHistoryEntry,
  TrackerRow
} from './types'
import type { CustomBoard, ProfileFile } from './profile'

/** invoke/handle channels: request → response (response is wrapped in IpcResult by the registry). */
export interface IpcInvokeContract {
  'tracker:getAll': { req: void; res: TrackerRow[] }
  'tracker:upsert': { req: Partial<TrackerRow> & { id?: string }; res: TrackerRow }
  'tracker:delete': { req: { id: string; deleteFolder?: boolean }; res: void }
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
  // Fetches a public job-posting page and builds an intake item from its
  // schema.org JobPosting JSON-LD — URL in, structured posting out.
  'intake:fromUrl': { req: { url: string }; res: IntakeItem }
  /** Build straight from the page open in the Browser tab: the rendered DOM
   *  (what a logged-in user sees) is parsed for a JobPosting, an intake item
   *  is created, and a build run starts — one click, no copy-paste. */
  'browser:buildFromPage': {
    req: { url: string; html: string; title: string; bodyText: string }
    res: { item: IntakeItem; run: RunMeta }
  }
  'intake:dismiss': { req: { id: string }; res: void }
  'intake:listFolders': { req: void; res: IntakeFolder[] }
  'intake:createFolder': { req: { name: string; icon: string }; res: IntakeFolder }
  /** Items in the folder return to auto date grouping. */
  'intake:deleteFolder': { req: { id: string }; res: void }
  'intake:moveToFolder': { req: { id: string; folderId: string | null }; res: void }
  'intake:setNotes': { req: { id: string; notes: string }; res: void }
  'candidates:setNotes': { req: { id: string; notes: string }; res: void }
  // Free-form context appended to every build prompt alongside the profile
  // (extra skills/certs/projects); lives at <workspace>/master/context.md.
  'master:getContext': { req: void; res: { text: string } }
  'master:setContext': { req: { text: string }; res: void }
  // Knowledge base: background-only material (notes + attached files) agents
  // may consult but never copy onto generated documents. Lives at
  // <workspace>/master/knowledge/.
  'knowledge:get': {
    req: void
    res: { notes: string; files: { name: string; sizeKb: number }[] }
  }
  'knowledge:setNotes': { req: { text: string }; res: void }
  /** Opens a file picker and copies the chosen files into the knowledge folder. */
  'knowledge:addFiles': { req: void; res: { added: number } }
  'knowledge:removeFile': { req: { name: string }; res: void }
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
  /** Every scout run with its instructions and kept/filtered postings, newest first. */
  'scout:history': { req: void; res: ScoutHistoryEntry[] }
  'library:list': { req: void; res: LibraryCategory[] }
  'library:read': { req: { relPath: string }; res: { content: string; truncated: boolean } }
  /** Restart a dead (failed/cancelled) build with its original input. */
  'runs:rebuild': { req: { runId: string }; res: RunMeta }
  // Per-application revision chat (detail view Chat tab). Streams over the
  // assistant push channels with conversationId `row_<rowId>`.
  'detailChat:send': { req: { rowId: string; text: string }; res: { conversationId: string } }
  'detailChat:stop': { req: { rowId: string }; res: void }
  'detailChat:get': { req: { rowId: string }; res: AssistantConversation | null }
  'detail:recompile': {
    req: { rowId: string; doc: 'resume' | 'cover' }
    res: { pages: number | null; logTail: string }
  }
  'interview:start': { req: { rowId: string }; res: RunMeta }
  'boards:getStatus': { req: void; res: BoardsStatus }
  'boards:install': { req: { board: BoardId }; res: BoardsStatus }
  'boards:setEnabled': { req: { board: BoardId; enabled: boolean }; res: BoardsStatus }
  'boards:installBun': { req: void; res: { ok: boolean; message: string; status: BoardsStatus } }
  'boards:setCreds': {
    req: { email: string; password: string }
    res: { loginOk: boolean; message: string }
  }
  'boards:test': { req: void; res: { ok: boolean; message: string } }
  // ---- custom company boards (ATS public APIs: greenhouse/lever/ashby) ----
  /** Detect + live-fetch a pasted careers URL; the error message carries the decline reason. */
  'boards:testCustom': { req: { url: string }; res: CustomBoardTest }
  /** Test first, save only on success; returns the full custom-board list. */
  'boards:addCustom': { req: { url: string }; res: CustomBoard[] }
  'boards:removeCustom': { req: { id: string }; res: CustomBoard[] }
  'boards:setCustomEnabled': { req: { id: string; enabled: boolean }; res: CustomBoard[] }
  'boards:listCustom': { req: void; res: CustomBoard[] }
  'app:info': { req: void; res: { repoRoot: string; appDataDir: string } }
  'config:get': { req: void; res: { workspacePath: string | null; onboardedAt: string | null } }
  'env:check': {
    req: void
    res: { pdflatex: { ok: boolean; path: string }; platform: string; appVersion: string }
  }
  'workspace:choose': { req: { title?: string }; res: { path: string | null } }
  'workspace:create': { req: { dir: string }; res: { workspacePath: string } }
  'app:pickFile': {
    req: { filters?: { name: string; extensions: string[] }[] }
    res: { path: string | null }
  }
  'profile:get': { req: void; res: ProfileFile | null }
  'profile:save': { req: { profile: ProfileFile }; res: ProfileFile }
  'profile:draft': {
    req: { runId: string }
    res: { draft: ProfileFile | null; error: string | null }
  }
  'onboard:start': {
    req: {
      source: 'text' | 'files' | 'uploads' | 'refine'
      text?: string
      files?: string[]
      /** refine: current draft + gap answers to merge into it. */
      draft?: ProfileFile
      answers?: { question: string; answer: string }[]
    }
    res: RunMeta
  }
  'library:upload': { req: void; res: { added: number; names: string[] } }
  'onboarding:complete': { req: void; res: void }
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
  'companies:get': { req: void; res: Record<string, CompanyInfo> }
  'companies:ensure': { req: { company: string }; res: CompanyInfo | null }
  'companies:backfill': { req: void; res: { fetched: number } }
  // ---- Gmail (read-only; BYO OAuth client ID, PKCE loopback flow) ----
  'email:status': { req: void; res: EmailStatus }
  'email:setClientId': { req: { clientId: string; clientSecret?: string }; res: EmailStatus }
  /** File picker for the client JSON downloaded from Google Cloud; parses it and
   *  stores id + secret. imported=false when the dialog was cancelled. */
  'email:importClientJson': { req: void; res: { imported: boolean; status: EmailStatus } }
  /** Opens the Google consent page in the browser; resolves when sign-in completes. */
  'email:signIn': { req: void; res: EmailStatus }
  'email:signOut': { req: void; res: EmailStatus }
  'email:list': { req: { filter: EmailFilter }; res: EmailMessage[] }
  /** Body text fetched live from Gmail (never cached on disk). */
  'email:getBody': { req: { id: string }; res: { text: string } }
  'email:refresh': { req: void; res: EmailStatus }
  'email:applySuggestion': { req: { emailId: string }; res: void }
  'email:dismissSuggestion': { req: { emailId: string }; res: void }
  /** Per-message user state: star, hide, tag assignment. */
  'email:update': {
    req: { id: string; patch: { favorite?: boolean; hidden?: boolean; tags?: string[] } }
    res: EmailMessage
  }
  /** Assignable tag names: presets plus every user-created tag. */
  'email:tags': { req: void; res: { tags: string[] } }
  'email:createTag': { req: { name: string }; res: { tags: string[]; created: string } }
  'assistant:send': {
    req: { conversationId: string | null; text: string; model: string | null }
    res: { conversationId: string }
  }
  'assistant:stop': { req: { conversationId: string }; res: void }
  'assistant:approve': { req: { approvalId: string; decision: 'allow' | 'deny' }; res: void }
  'assistant:newConversation': { req: void; res: { conversationId: string } }
  'assistant:listConversations': { req: void; res: ConversationMeta[] }
  'assistant:getConversation': { req: { id: string }; res: AssistantConversation | null }
  'assistant:deleteConversation': { req: { id: string }; res: void }
  // Live session state for a conversation being (re)opened — pushes only fire on
  // transitions, so an approval/status raised while another conversation was on
  // screen is re-fetched here instead of being lost.
  'assistant:resync': {
    req: { conversationId: string }
    res: { status: AssistantStatus; pendingApproval: AssistantApproval | null }
  }
}

export type IpcChannel = keyof IpcInvokeContract

/** main → renderer push channels. */
export interface IpcPushContract {
  'push:runEvent': { runId: string; event: RunEvent }
  'push:runChanged': RunMeta
  'push:todoNew': IntakeItem
  'push:storeChanged': { domains: ('rows' | 'intake' | 'settings' | 'candidates' | 'profile')[] }
  'push:companiesChanged': Record<string, CompanyInfo>
  'push:assistantEvent': { conversationId: string; event: RunEvent }
  'push:assistantApproval': AssistantApproval
  'push:assistantUsage': { conversationId: string } & AssistantUsage
  'push:assistantState': { conversationId: string; status: AssistantStatus }
  'push:assistantMessage': { conversationId: string; message: AssistantMessage }
  /** After every email sync / suggestion action: open-suggestion count. */
  'push:emailChanged': { suggestions: number }
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
  'intake:fromUrl',
  'browser:buildFromPage',
  'intake:dismiss',
  'intake:listFolders',
  'intake:createFolder',
  'intake:deleteFolder',
  'intake:moveToFolder',
  'intake:setNotes',
  'candidates:setNotes',
  'master:getContext',
  'master:setContext',
  'knowledge:get',
  'knowledge:setNotes',
  'knowledge:addFiles',
  'knowledge:removeFile',
  'todo:rescan',
  'runs:start',
  'runs:cancel',
  'runs:rebuild',
  'detailChat:send',
  'detailChat:stop',
  'detailChat:get',
  'runs:list',
  'runs:get',
  'detail:get',
  'scout:start',
  'scout:history',
  'candidates:list',
  'candidates:accept',
  'candidates:reject',
  'library:list',
  'library:read',
  'detail:recompile',
  'interview:start',
  'boards:getStatus',
  'boards:install',
  'boards:setEnabled',
  'boards:installBun',
  'boards:setCreds',
  'boards:test',
  'boards:testCustom',
  'boards:addCustom',
  'boards:removeCustom',
  'boards:setCustomEnabled',
  'boards:listCustom',
  'app:info',
  'config:get',
  'env:check',
  'workspace:choose',
  'workspace:create',
  'app:pickFile',
  'profile:get',
  'profile:save',
  'profile:draft',
  'onboard:start',
  'library:upload',
  'onboarding:complete',
  'app:showItem',
  'app:openFolder',
  'app:openExternal',
  'app:copy',
  'app:absPath',
  'apply:insertText',
  'settings:get',
  'settings:set',
  'companies:get',
  'companies:ensure',
  'companies:backfill',
  'email:status',
  'email:setClientId',
  'email:importClientJson',
  'email:signIn',
  'email:signOut',
  'email:list',
  'email:getBody',
  'email:refresh',
  'email:applySuggestion',
  'email:dismissSuggestion',
  'email:update',
  'email:tags',
  'email:createTag',
  'assistant:send',
  'assistant:stop',
  'assistant:approve',
  'assistant:newConversation',
  'assistant:listConversations',
  'assistant:getConversation',
  'assistant:deleteConversation',
  'assistant:resync'
]

export const PUSH_CHANNELS: IpcPushChannel[] = [
  'push:runEvent',
  'push:runChanged',
  'push:todoNew',
  'push:storeChanged',
  'push:companiesChanged',
  'push:assistantEvent',
  'push:assistantApproval',
  'push:assistantUsage',
  'push:assistantState',
  'push:assistantMessage',
  'push:emailChanged'
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

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
  CalendarEvent,
  CandidateJob,
  CompanyInfo,
  ConversationMeta,
  CustomBoardTest,
  EmailFilter,
  EmailInvite,
  EmailMessage,
  EmailStatus,
  EnvCheck,
  EnvPreflight,
  IntakeFolder,
  IntakeItem,
  LibraryCategory,
  ProviderId,
  RunEvent,
  RunMeta,
  ScanResult,
  ScoutHistoryEntry,
  ToolName,
  TrackerRow
} from './types'
import type { CustomBoard, ProfileFile, ProfileModuleName } from './profile'

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
  /** The Glassdoor search URLs to harvest (pasted, else auto-derived). */
  'glassdoor:searches': { req: void; res: { searches: string[]; autoDerived: boolean } }
  /** Persist raw job JSON the browser harvested into the scout feed. */
  'glassdoor:writeFeed': {
    req: { searches: string[]; payloads: unknown[] }
    res: { count: number; fetchedAt: string }
  }
  /** Feed summary for the Settings card; null when never harvested. */
  'glassdoor:feedStatus': { req: void; res: { count: number; fetchedAt: string; stale: boolean } | null }
  // ---- BYO model providers (keys via safeStorage; Ollama local or cloud) ----
  'provider:setGeminiKey': { req: { key: string }; res: { keySet: boolean } }
  'provider:clearGeminiKey': { req: void; res: { keySet: boolean } }
  /** ollama.com key — only needed for cloud models. */
  'provider:setOllamaKey': { req: { key: string }; res: { keySet: boolean } }
  'provider:clearOllamaKey': { req: void; res: { keySet: boolean } }
  /** Key presence + live model catalogs (Gemini per-key, Ollama local/cloud). */
  'provider:status': {
    req: void
    res: {
      provider: ProviderId
      geminiKeySet: boolean
      geminiModels: string[]
      ollamaKeySet: boolean
      ollama: { reachable: boolean; models: string[]; message: string }
    }
  }
  /** Metadata for one Ollama model: context ceiling + tool support. */
  'provider:ollamaShow': {
    req: { model: string }
    res: { contextLength: number | null; tools: boolean | null }
  }
  /** Live round-trip against the active provider's backend. */
  'provider:test': { req: void; res: { ok: boolean; message: string } }
  'app:info': { req: void; res: { repoRoot: string; appDataDir: string } }
  /** workspacePath is reported null when the configured workspace failed to
   *  boot — no workspace IPC exists in that session, so the renderer must show
   *  first-run recovery rather than an app wired to dead channels.
   *  configError is set when config.json exists but could not be read: a null
   *  workspacePath then means "unknown", not "first run". */
  'config:get': {
    req: void
    res: {
      workspacePath: string | null
      onboardedAt: string | null
      bootError: string | null
      configError: string | null
    }
  }
  /** External-tool detection (LaTeX engine + pdftotext) for the Settings rows,
   *  plus the full host-prerequisite list the onboarding preflight renders. */
  'env:check': { req: void; res: EnvPreflight }
  /** Persist a manual tool path. Empty/null clears the override and falls back
   *  to detection; a path the app cannot execute is rejected with an error. */
  'env:setToolPath': { req: { tool: ToolName; path: string | null }; res: EnvCheck }
  'workspace:choose': { req: { title?: string }; res: { path: string | null } }
  'workspace:create': { req: { dir: string }; res: { workspacePath: string } }
  /** Zip the whole workspace (denylist-scanned, hashed manifest) to a user-chosen
   *  file. `skipped` counts credential files held back, so the export never
   *  drops anything without saying so. */
  'workspace:export': {
    req: void
    res: { canceled: boolean; path: string | null; files: number; skipped: number }
  }
  /** Restore an export into an empty folder and point config at it; live services
   *  cannot re-root at runtime, so a successful import asks for a relaunch. */
  'workspace:import': {
    req: void
    res: {
      imported: boolean
      error: string | null
      restartRequired: boolean
      /** The archive carried a profile, so setup has nothing left to ask for. */
      hasProfile: boolean
    }
  }
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
  /** One saved profile section as a standalone <module>.module.json envelope. */
  'profile:exportModule': {
    req: { module: ProfileModuleName }
    res: { canceled: boolean; path: string | null }
  }
  /** Parse + validate a module file; NO write — both sides return for review. */
  'profile:importModule': {
    req: void
    res: {
      canceled: boolean
      error: string | null
      module: ProfileModuleName | null
      current: unknown
      incoming: unknown
    }
  }
  /** Re-validate the reviewed section and write it through the one profile
   *  write path (profile:save's logic), so profile.json is never written twice. */
  'profile:applyModule': {
    req: { module: ProfileModuleName; data: unknown }
    res: void
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
  /** Body text fetched live from Gmail (never cached on disk). invite is the
   *  parsed text/calendar metadata, null when the message carries none —
   *  required so the handler cannot silently drop the invite-healing path. */
  'email:getBody': { req: { id: string }; res: { text: string; invite: EmailInvite | null } }
  /** AI-draft a reply to one message as the candidate. Read-only Gmail scope
   *  means nothing is sent — the draft is returned for the user to copy or
   *  open in a Gmail compose window. */
  'email:draftReply': {
    req: { id: string; instructions?: string }
    res: { draft: string; to: string; subject: string }
  }
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
  // ---- calendar (events extracted from mail, plus manual entries) ----
  'calendar:list': { req: void; res: CalendarEvent[] }
  'calendar:approve': { req: { id: string }; res: CalendarEvent[] }
  'calendar:dismiss': { req: { id: string }; res: CalendarEvent[] }
  'calendar:remove': { req: { id: string }; res: CalendarEvent[] }
  /** Manual entry — created directly in state 'approved'. */
  'calendar:add': {
    req: { title: string; start: string; end: string | null; location: string | null; notes: string | null }
    res: CalendarEvent[]
  }
  'calendar:update': {
    req: {
      id: string
      patch: { title?: string; start?: string; end?: string | null; location?: string | null; notes?: string | null }
    }
    res: CalendarEvent[]
  }
  /** Invite-card proposal — goes through the proposeEvent dedupe path so the
   *  meet link and source message survive (a re-synced copy of the same mail
   *  dedupes against them) and the event lands in state 'proposed' for review. */
  'calendar:propose': {
    req: {
      sourceMessageId: string | null
      title: string
      start: string
      end: string | null
      location: string | null
      meetLink: string | null
      notes: string | null
    }
    res: CalendarEvent[]
  }
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
  /** After any calendar mutation or sync proposal: proposed-event count. */
  'push:calendarChanged': { proposed: number }
  /** Reminder notification clicked — bring the calendar view forward. */
  'push:calendarFocus': Record<string, never>
  /** New-mail notification clicked — bring the email view forward. */
  'push:emailFocus': Record<string, never>
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
  'glassdoor:searches',
  'glassdoor:writeFeed',
  'glassdoor:feedStatus',
  'provider:setGeminiKey',
  'provider:clearGeminiKey',
  'provider:setOllamaKey',
  'provider:clearOllamaKey',
  'provider:status',
  'provider:ollamaShow',
  'provider:test',
  'app:info',
  'config:get',
  'env:check',
  'env:setToolPath',
  'workspace:choose',
  'workspace:create',
  'workspace:export',
  'workspace:import',
  'app:pickFile',
  'profile:get',
  'profile:save',
  'profile:draft',
  'profile:exportModule',
  'profile:importModule',
  'profile:applyModule',
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
  'email:draftReply',
  'email:refresh',
  'email:applySuggestion',
  'email:dismissSuggestion',
  'email:update',
  'email:tags',
  'email:createTag',
  'calendar:list',
  'calendar:approve',
  'calendar:dismiss',
  'calendar:remove',
  'calendar:add',
  'calendar:update',
  'calendar:propose',
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
  'push:emailChanged',
  'push:calendarChanged',
  'push:calendarFocus',
  'push:emailFocus'
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

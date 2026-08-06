import { BrowserWindow, dialog, ipcMain, webContents } from 'electron'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { EmailStatus, IntakeItem, RunMeta, ScoutHistoryEntry } from '@shared/types'
import type { IpcChannel, IpcInvokeContract } from '@shared/ipc'
import type { RunInput } from './agent/AgentRunner'
import { buildApplicationDetail } from './parsers/detail'
import { parseCandidatesFile } from './parsers/report'
import { extractJobPosting, fetchPostingFromUrl } from './parsers/jobPostingUrl'
import { extractGlassdoorRowsFromHtml } from './boards/glassdoorParse'
import { scanApplications } from './fsops/FolderScanner'
import { copyText, openExternal, openFolder, showItem } from './fsops/reveal'
import { importFromXlsx } from './xlsx/importXlsx'
import { exportToXlsx } from './xlsx/exportXlsx'
import { INTAKE_IMAGES_DIR, MASTER_DIR, SCOUT_DIR, UPLOADS_DIR, toAbs, toRel } from './paths'
import { listLibrary, readLibraryFile } from './fsops/library'
import { recompileDoc } from './latex/recompile'
import {
  getBoardsStatus,
  installBoard,
  installBun,
  refreshJobrightSession,
  setBoardEnabled,
  setJobrightCreds,
  testJobright
} from './boards/boardsBridge'
import {
  addCustomBoard,
  listCustomBoards,
  removeCustomBoard,
  setCustomBoardEnabled,
  testCustomBoard
} from './boards/customBoards'
import {
  glassdoorFeedStatus,
  resolveGlassdoorSearches,
  writeGlassdoorFeed
} from './boards/glassdoorFeed'
import { APP_DATA_DIR, REPO_ROOT } from './paths'
import { clearGeminiKey, clearOllamaKey, setGeminiKey, setOllamaKey } from './provider/providerKeyStore'
import { ollamaModelDetails, providerStatus, testProvider } from './provider/providerRuntime'
import { validateProfile } from './profile/profileSchema'
import { loadProfile, saveProfile } from './profile/profileStore'
import type { ProfileFile } from '@shared/profile'
import { allCompanies } from './companies/companiesStore'
import { backfillCompanies, ensureRating, ensureRatingBg, seedFromText } from './companies/ratingService'
import type { AgentRunner } from './agent/AgentRunner'
import type { RunStore } from './agent/runStore'
import type { Store } from './store/Store'
import type { TrackerRepo } from './store/trackerRepo'
import type { TodoWatcher } from './fsops/TodoWatcher'
import { AssistantManager } from './assistant/assistantManager'
import { DetailChatManager } from './assistant/detailChat'
import {
  gmailClientId,
  gmailConfigured,
  gmailEmail,
  gmailHasClientSecret,
  gmailSignIn,
  gmailSignOut,
  parseClientJson,
  setGmailClientId
} from './email/gmailAuth'
import { getMessageFull } from './email/gmailClient'
import { parseIcs } from './email/icsParse'
import { draftEmailReply } from './email/emailReply'
import {
  clearEmailCache,
  createTag,
  getCachedMessage,
  lastSyncAt,
  listCachedMessages,
  listTags,
  openSuggestionCount,
  setSuggestionState,
  updateMessage
} from './email/emailStore'
import { EmailSync, matchTrackerRow } from './email/emailSync'
import {
  addManual,
  approveEvent,
  dismissEvent,
  listEvents,
  proposeEvent,
  proposedCount,
  removeEvent,
  updateEvent
} from './calendar/calendarStore'
import { ReminderLoop } from './calendar/reminders'

export interface Services {
  store: Store
  tracker: TrackerRepo
  todo: TodoWatcher
  runner: AgentRunner
  runStore: RunStore
  send: (channel: string, payload: unknown) => void
  getWindow: () => BrowserWindow | null
}

type Handler<C extends IpcChannel> = (
  req: IpcInvokeContract[C]['req']
) => Promise<IpcInvokeContract[C]['res']> | IpcInvokeContract[C]['res']

/** Register every invoke channel with a uniform {ok,data|error} wrapper. */
export function registerIpc(services: Services): void {
  const { store, tracker, todo, runner, runStore, send } = services

  function handle<C extends IpcChannel>(channel: C, fn: Handler<C>): void {
    ipcMain.handle(channel, async (_event, req) => {
      try {
        const data = await fn(req as IpcInvokeContract[C]['req'])
        return { ok: true, data }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[ipc] ${channel} failed:`, message)
        return { ok: false, error: message }
      }
    })
  }

  // ---- tracker ----
  handle('tracker:getAll', () => tracker.listRows())
  handle('tracker:upsert', (patch) => tracker.upsertRow(patch))
  handle('tracker:delete', ({ id, deleteFolder }) => {
    const row = tracker.getRow(id)
    if (!row) throw new Error(`row not found: ${id}`)
    // Cancel any in-flight build tied to this row, and kill its revision chat
    // before the folder goes away (the chat edits inside that folder).
    if (row.runId) runner.cancel(row.runId)
    detailChat.delete(id)
    // Remember the "no" — flip the source candidate to rejected so scouts
    // never re-suggest a posting the user already looked into and declined.
    store.mutate(['candidates'], (s) => {
      const c = s.candidates.find(
        (x) =>
          (row.runId && x.buildRunId === row.runId) ||
          (x.position.toLowerCase() === row.position.toLowerCase() &&
            x.company.toLowerCase() === row.company.toLowerCase())
      )
      if (c && c.state !== 'rejected') c.state = 'rejected'
    })
    if (deleteFolder && row.folderPath) {
      const abs = toAbs(row.folderPath)
      // Jail: only ever delete inside the workspace applications dir.
      const appsRoot = toAbs('applications')
      if (abs.startsWith(appsRoot + path.sep) && fs.existsSync(abs)) {
        fs.rmSync(abs, { recursive: true, force: true })
      }
    }
    tracker.deleteRow(id)
  })
  handle('tracker:markApplied', ({ id, dateApplied }) => tracker.markApplied(id, dateApplied))
  handle('tracker:importXlsx', async ({ mode, filePath }) => {
    const summary = await importFromXlsx(store, tracker, mode, filePath)
    // Bind folder paths right away so links/reveal work.
    tracker.applyScan(scanApplications())
    return summary
  })
  handle('tracker:exportXlsx', () => exportToXlsx(store))

  // ---- scan ----
  handle('scan:run', () => tracker.applyScan(scanApplications()))

  // ---- intake ----
  handle('intake:list', () => store.state.intake.filter((i) => i.state !== 'dismissed'))
  const createIntakeItem = ({
    text,
    url,
    company,
    role,
    imagesBase64
  }: {
    text: string
    url?: string
    company?: string
    role?: string
    imagesBase64?: string[]
  }): IntakeItem => {
    const id = randomUUID()
    // Persist pasted screenshots so the agent can Read them.
    const imagePaths: string[] = []
    if (imagesBase64?.length) {
      fs.mkdirSync(INTAKE_IMAGES_DIR, { recursive: true })
      imagesBase64.forEach((b64, i) => {
        const file = path.join(INTAKE_IMAGES_DIR, `${id.slice(0, 8)}-${i + 1}.png`)
        fs.writeFileSync(file, Buffer.from(b64, 'base64'))
        imagePaths.push(toRel(file))
      })
    }
    const item: IntakeItem = {
      id,
      kind: 'pasted',
      todoFileName: null,
      title:
        [company, role].filter(Boolean).join(' - ') ||
        (imagePaths.length ? 'Pasted screenshot' : 'Pasted posting'),
      postingText: text,
      imagePaths,
      applyUrl: url || null,
      companyHint: company ?? '',
      roleHint: role ?? '',
      state: 'new',
      runId: null,
      createdAt: new Date().toISOString()
    }
    store.mutate(['intake'], (s) => {
      s.intake.push(item)
    })
    // Company-scoped Glassdoor rating: seed from anything the posting text
    // already quotes, then kick off a background lookup either way.
    seedFromText(item.companyHint, text)
    ensureRatingBg(item.companyHint)
    return item
  }

  handle('intake:addPasted', (req) => {
    if (!req.text.trim() && !req.imagesBase64?.length) {
      throw new Error('paste posting text or at least one screenshot')
    }
    return createIntakeItem(req)
  })

  handle('intake:fromUrl', async ({ url }) => {
    const posting = await fetchPostingFromUrl(url)
    return createIntakeItem({
      text: posting.text,
      url,
      company: posting.company,
      role: posting.role
    })
  })
  handle('browser:buildFromPage', async ({ url, html, title, bodyText }) => {
    if (!/^https?:\/\//i.test(url)) throw new Error('only http(s) pages can be built from')
    // The rendered DOM sees what the logged-in user sees, so its JSON-LD is
    // tried first (auth-gated SPA listings like board detail pages); a
    // server-side refetch covers pages whose markup only ships in the initial
    // response; the visible text is the last resort for pages with no
    // structured data at all. Page content is untrusted third-party data —
    // it flows into postingText, which the build pipeline already treats as
    // untrusted.
    // Glassdoor emits no JSON-LD (non-indexable pages), so extract its embedded
    // job JSON directly — cleaner than the visible-text fallback would manage.
    let posting = extractJobPosting(html.slice(0, 3_000_000), url)
    if (!posting && /glassdoor\./i.test(url)) {
      const rows = extractGlassdoorRowsFromHtml(html, Date.now())
      const job = rows.find((r) => r.description) ?? rows[0]
      if (job) {
        const lines = [
          job.title,
          job.company ? `Company: ${job.company}` : '',
          job.location ? `Location: ${job.location}` : '',
          job.salary ? `Salary: ${job.salary}` : '',
          job.postedAt ? `Posted: ${job.postedAt}` : '',
          `Source: ${job.url || url}`,
          '',
          job.description ?? ''
        ].filter((l) => l !== '')
        posting = { role: job.title, company: job.company, text: lines.join('\n') }
      }
    }
    if (!posting) posting = await fetchPostingFromUrl(url).catch(() => null)
    if (!posting) {
      const text = bodyText.trim().slice(0, 30_000)
      if (text.length < 200) {
        throw new Error(
          'could not find a job posting on this page — open the listing itself (not the results list) and try again'
        )
      }
      posting = {
        role: title.trim().slice(0, 120) || '(untitled role)',
        company: '',
        text: `${title.trim()}\nSource: ${url}\n\n${text}`
      }
    }
    const item = createIntakeItem({
      text: posting.text,
      url,
      company: posting.company,
      role: posting.role
    })
    const run = runner.start({
      intakeId: item.id,
      postingText: item.postingText,
      imagePaths: [],
      applyUrl: url,
      companyHint: item.companyHint,
      roleHint: item.roleHint
    })
    return { item, run }
  })
  handle('intake:dismiss', ({ id }) => {
    store.mutate(['intake'], (s) => {
      const item = s.intake.find((i) => i.id === id)
      if (item) item.state = 'dismissed'
    })
  })
  handle('intake:listFolders', () => store.state.intakeFolders)
  handle('intake:createFolder', ({ name, icon }) => {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('folder name is required')
    const folder = {
      id: randomUUID().slice(0, 8),
      name: trimmed.slice(0, 40),
      icon,
      createdAt: new Date().toISOString()
    }
    store.mutate(['intake'], (s) => {
      s.intakeFolders.push(folder)
    })
    return folder
  })
  handle('intake:deleteFolder', ({ id }) => {
    store.mutate(['intake'], (s) => {
      s.intakeFolders = s.intakeFolders.filter((f) => f.id !== id)
      for (const item of s.intake) {
        if (item.folderId === id) item.folderId = null
      }
    })
  })
  handle('intake:moveToFolder', ({ id, folderId }) => {
    store.mutate(['intake'], (s) => {
      if (folderId !== null && !s.intakeFolders.some((f) => f.id === folderId)) {
        throw new Error('folder not found')
      }
      const item = s.intake.find((i) => i.id === id)
      if (item) item.folderId = folderId
    })
  })
  handle('intake:setNotes', ({ id, notes }) => {
    store.mutate(['intake'], (s) => {
      const item = s.intake.find((i) => i.id === id)
      if (item) item.notes = notes.trim() || null
    })
  })
  handle('candidates:setNotes', ({ id, notes }) => {
    store.mutate(['candidates'], (s) => {
      const c = s.candidates.find((x) => x.id === id)
      if (c) c.notes = notes.trim() || null
    })
  })
  handle('master:getContext', () => {
    try {
      return { text: fs.readFileSync(path.join(MASTER_DIR, 'context.md'), 'utf-8') }
    } catch {
      return { text: '' }
    }
  })
  handle('master:setContext', ({ text }) => {
    fs.mkdirSync(MASTER_DIR, { recursive: true })
    fs.writeFileSync(path.join(MASTER_DIR, 'context.md'), text, 'utf-8')
  })

  // ---- knowledge base: background-only notes + attached files ----
  const knowledgeDir = (): string => path.join(MASTER_DIR, 'knowledge')
  const knowledgeFileName = (name: string): string => {
    // Names come back from the renderer for removal — never let them traverse.
    if (!name || name !== path.basename(name) || name.startsWith('.')) {
      throw new Error(`invalid file name: ${name}`)
    }
    return path.join(knowledgeDir(), name)
  }
  handle('knowledge:get', () => {
    let notes = ''
    try {
      notes = fs.readFileSync(path.join(knowledgeDir(), 'notes.md'), 'utf-8')
    } catch {
      /* none yet */
    }
    let files: { name: string; sizeKb: number }[] = []
    try {
      files = fs
        .readdirSync(knowledgeDir())
        .filter((f) => !f.startsWith('.') && f !== 'notes.md')
        .map((f) => ({
          name: f,
          sizeKb: Math.max(1, Math.round(fs.statSync(path.join(knowledgeDir(), f)).size / 1024))
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
    } catch {
      /* empty */
    }
    return { notes, files }
  })
  handle('knowledge:setNotes', ({ text }) => {
    fs.mkdirSync(knowledgeDir(), { recursive: true })
    fs.writeFileSync(path.join(knowledgeDir(), 'notes.md'), text, 'utf-8')
  })
  handle('knowledge:addFiles', async () => {
    const win = services.getWindow()
    const result = await dialog.showOpenDialog(win ?? new BrowserWindow({ show: false }), {
      title: 'Add knowledge-base files',
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled) return { added: 0 }
    fs.mkdirSync(knowledgeDir(), { recursive: true })
    let added = 0
    for (const src of result.filePaths) {
      const base = path.basename(src)
      // Keep both files on a name collision rather than overwriting.
      let dest = path.join(knowledgeDir(), base)
      let n = 1
      while (fs.existsSync(dest)) {
        const ext = path.extname(base)
        dest = path.join(knowledgeDir(), `${path.basename(base, ext)}-${++n}${ext}`)
      }
      fs.copyFileSync(src, dest)
      added++
    }
    return { added }
  })
  handle('knowledge:removeFile', ({ name }) => {
    fs.rmSync(knowledgeFileName(name), { force: true })
  })
  handle('todo:rescan', () => {
    todo.rescan()
    return store.state.intake.filter((i) => i.state !== 'dismissed')
  })

  // ---- runs ----
  handle('runs:start', (input) => {
    const intake = input.intakeId
      ? store.state.intake.find((i) => i.id === input.intakeId)
      : undefined
    const postingText = input.postingText || intake?.postingText || ''
    const imagePaths = input.imagePaths ?? intake?.imagePaths ?? []
    if (!postingText.trim() && imagePaths.length === 0) {
      throw new Error('nothing to build from: no posting text and no screenshots')
    }
    return runner.start({
      intakeId: input.intakeId,
      postingText,
      imagePaths,
      applyUrl: input.applyUrl ?? intake?.applyUrl ?? undefined,
      companyHint: input.companyHint ?? intake?.companyHint,
      roleHint: input.roleHint ?? intake?.roleHint
    })
  })
  handle('runs:cancel', ({ runId }) => {
    runner.cancel(runId)
  })
  handle('runs:list', () => runner.list())
  handle('runs:get', ({ runId }) => runner.get(runId))

  // ---- detail ----
  handle('detail:get', ({ rowId }) => {
    const row = tracker.getRow(rowId)
    if (!row) throw new Error(`row not found: ${rowId}`)
    return buildApplicationDetail(row)
  })

  // ---- scout: agent scrapes boards → reviewable candidates ----
  handle('scout:start', ({ instructions }) =>
    runner.start({ kind: 'scout', instructions: instructions ?? '' })
  )
  handle('candidates:list', () => store.state.candidates)
  handle('candidates:accept', ({ id }) => {
    const candidate = store.state.candidates.find((c) => c.id === id)
    if (!candidate) throw new Error(`candidate not found: ${id}`)
    if (candidate.state === 'accepted') throw new Error('already accepted')
    if (!candidate.postingText.trim() && !candidate.applyUrl) {
      throw new Error('candidate has no posting text or apply URL to build from')
    }
    // Start the build first so the tracker row can bind to its slug — the
    // finished report then fills in this same row instead of creating a new one.
    const run = runner.start({
      kind: 'build',
      postingText: candidate.postingText,
      applyUrl: candidate.applyUrl || undefined,
      companyHint: candidate.company,
      roleHint: candidate.position,
      notes: candidate.notes ?? undefined
    })
    tracker.upsertRow({
      slug: run.slug,
      folderPath: null,
      position: candidate.position,
      company: candidate.company,
      salary: candidate.salary === 'not listed' ? '' : candidate.salary,
      location: candidate.location,
      datePosted: candidate.datePosted,
      applyUrl: candidate.applyUrl,
      statusText: 'NOT yet submitted - building docs',
      source: 'scout',
      runId: run.id
    })
    const updated = store.mutate(['candidates'], (s) => {
      const c = s.candidates.find((x) => x.id === id)!
      c.state = 'accepted'
      c.buildRunId = run.id
      return c
    })
    return { candidate: { ...updated }, run }
  })
  handle('candidates:reject', ({ id }) => {
    store.mutate(['candidates'], (s) => {
      const c = s.candidates.find((x) => x.id === id)
      if (c) c.state = 'rejected'
    })
  })

  // ---- scout history: per-run instructions + kept/filtered postings ----
  handle('scout:history', () => {
    // runStore.list() is already newest-first.
    return runStore
      .list()
      .filter((m) => m.kind === 'scout')
      .map((meta): ScoutHistoryEntry => {
        const input = runStore.getInput<RunInput>(meta.id)
        let kept: ScoutHistoryEntry['kept'] = []
        let excluded: ScoutHistoryEntry['excluded'] = []
        // Candidates files are absent for failed/cancelled runs and may predate
        // the excluded field — render whatever this run actually has.
        try {
          const raw = fs.readFileSync(path.join(SCOUT_DIR, `${meta.id}.candidates.json`), 'utf-8')
          const parsed = parseCandidatesFile(raw)
          if (!('error' in parsed)) {
            kept = parsed.candidates
              .filter((c) => (c.position ?? '').trim() || (c.company ?? '').trim())
              .map((c) => ({
                position: (c.position ?? '').trim(),
                company: (c.company ?? '').trim(),
                salary: c.salary ?? 'not listed',
                location: c.location ?? '',
                fitScore: typeof c.fitScore === 'number' ? c.fitScore : null,
                fitNote: c.fitNote ?? ''
              }))
            excluded = parsed.excluded
          }
        } catch {
          /* no candidates file for this run */
        }
        return {
          runId: meta.id,
          startedAt: meta.startedAt,
          endedAt: meta.endedAt,
          status: meta.status,
          summary: meta.summary,
          instructions: input?.instructions ?? '',
          keptCount: kept.length,
          excludedCount: excluded.length,
          kept,
          excluded
        }
      })
  })

  // ---- library: workspace reference docs, no Explorer needed ----
  handle('library:list', () => listLibrary())
  handle('library:read', ({ relPath }) => readLibraryFile(relPath))

  // ---- profile ----
  handle('profile:get', () => loadProfile())
  handle('profile:save', ({ profile }) => {
    const result = validateProfile(profile)
    if (!result.ok) throw new Error(`profile invalid: ${result.problems.join('; ')}`)
    const saved = saveProfile(result.profile)
    // Views showing the profile (Who I am, Settings) refetch on this push.
    send('push:storeChanged', { domains: ['profile'] })
    return saved
  })
  handle('profile:draft', ({ runId }) => {
    const meta = runner.get(runId).meta
    if (!meta.resultPath || !fs.existsSync(meta.resultPath)) {
      return { draft: null, error: 'no draft file for this run' }
    }
    try {
      const draft = JSON.parse(fs.readFileSync(meta.resultPath, 'utf-8')) as ProfileFile
      return { draft, error: null }
    } catch (err) {
      return { draft: null, error: String(err) }
    }
  })
  handle('onboard:start', ({ source, text, files, draft, answers }) => {
    if (source === 'refine') {
      const qa = (answers ?? []).filter((a) => a.answer.trim().length > 0)
      if (!draft) throw new Error('refine needs the current draft')
      if (!qa.length) throw new Error('no answers to apply')
      return runner.start({ kind: 'onboard', refineDraft: draft, refineAnswers: qa })
    }
    let sourceFiles: string[] = []
    if (source === 'uploads') {
      // "agent handles the rest": every file the user dropped into the library.
      sourceFiles = fs.existsSync(UPLOADS_DIR)
        ? fs
            .readdirSync(UPLOADS_DIR)
            .filter((f) => !f.startsWith('.'))
            .map((f) => path.join(UPLOADS_DIR, f))
        : []
      if (!sourceFiles.length && !text?.trim()) {
        throw new Error('no uploads yet — add files in Library first')
      }
    } else if (source === 'files') {
      sourceFiles = (files ?? []).filter((f) => fs.existsSync(f))
      if (!sourceFiles.length && !text?.trim()) throw new Error('no readable source files')
    }
    return runner.start({ kind: 'onboard', sourceFiles, sourceText: text ?? '' })
  })

  // ---- library uploads: drop in everything, agents consume it ----
  handle('library:upload', async () => {
    const win = services.getWindow()
    const result = await dialog.showOpenDialog(win!, {
      title: 'Add files to your library (CVs, cover letters, examples, notes — anything)',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Documents', extensions: ['pdf', 'tex', 'md', 'txt', 'docx', 'png', 'jpg', 'jpeg', 'csv'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (result.canceled) return { added: 0, names: [] }
    fs.mkdirSync(UPLOADS_DIR, { recursive: true })
    let added = 0
    const names: string[] = []
    for (const src of result.filePaths) {
      try {
        let name = path.basename(src)
        let dst = path.join(UPLOADS_DIR, name)
        let i = 2
        while (fs.existsSync(dst)) {
          const ext = path.extname(name)
          dst = path.join(UPLOADS_DIR, `${path.basename(name, ext)}_${i++}${ext}`)
        }
        fs.copyFileSync(src, dst)
        names.push(path.basename(dst))
        added++
      } catch (err) {
        console.error('[library] upload copy failed:', err)
      }
    }
    return { added, names }
  })

  // ---- rebuild a dead build run with its original input ----
  const rebuildRun = (runId: string): RunMeta => {
    if (!/^[A-Za-z0-9_-]+$/.test(runId)) throw new Error(`invalid run id: ${runId}`)
    const meta = runStore.getMeta(runId)
    if (!meta) throw new Error(`run not found: ${runId}`)
    if (meta.kind !== 'build') throw new Error('only build runs can be rebuilt')
    if (meta.status !== 'failed' && meta.status !== 'cancelled') {
      throw new Error(`only failed or cancelled builds can be rebuilt (this one is ${meta.status})`)
    }
    // Runs recorded before inputs were persisted can still rebuild from their
    // intake item, which carries the same request.
    let input = runStore.getInput<RunInput>(runId)
    if (!input && meta.intakeId) {
      const item = store.state.intake.find((i) => i.id === meta.intakeId)
      if (item) {
        input = {
          kind: 'build',
          intakeId: item.id,
          postingText: item.postingText,
          imagePaths: item.imagePaths,
          applyUrl: item.applyUrl ?? undefined,
          companyHint: item.companyHint,
          roleHint: item.roleHint,
          notes: item.notes ?? undefined
        }
      }
    }
    if (!input) {
      throw new Error('this run recorded no input and has no intake item — re-add the posting instead')
    }
    return runner.start({ ...input, kind: 'build' })
  }
  handle('runs:rebuild', ({ runId }) => rebuildRun(runId))

  // ---- recompile (edit .tex → rebuild PDF, no agent) ----
  handle('detail:recompile', async ({ rowId, doc }) => {
    const row = tracker.getRow(rowId)
    if (!row?.folderPath) throw new Error('row has no application folder')
    return recompileDoc(row.folderPath, doc)
  })

  // ---- interview prep agent ----
  handle('interview:start', ({ rowId }) => {
    const row = tracker.getRow(rowId)
    if (!row) throw new Error(`row not found: ${rowId}`)
    if (!row.folderPath) throw new Error('row has no application folder to prep from')
    return runner.start({
      kind: 'interview',
      rowFolderRel: row.folderPath,
      rowPosition: row.position,
      rowCompany: row.company
    })
  })

  // ---- job-board credentials ----
  handle('boards:getStatus', () => getBoardsStatus())
  handle('boards:install', ({ board }) => installBoard(board))
  handle('boards:setEnabled', ({ board, enabled }) => setBoardEnabled(board, enabled))
  handle('boards:installBun', () => installBun())
  handle('boards:setCreds', async ({ email, password }) => {
    setJobrightCreds(email, password)
    // Mint the session immediately: agents then run session-only, and the
    // user learns right now whether the credentials actually work.
    const login = await refreshJobrightSession()
    return { loginOk: login.ok, message: login.message }
  })
  handle('boards:test', () => testJobright())

  // ---- custom company boards (ATS public APIs) ----
  handle('boards:testCustom', ({ url }) => testCustomBoard(url))
  handle('boards:addCustom', ({ url }) => addCustomBoard(url))
  handle('boards:removeCustom', ({ id }) => removeCustomBoard(id))
  handle('boards:setCustomEnabled', ({ id, enabled }) => setCustomBoardEnabled(id, enabled))
  handle('boards:listCustom', () => listCustomBoards())
  handle('glassdoor:searches', () => {
    const pasted = store.state.settings.glassdoorSearches ?? []
    const searches = resolveGlassdoorSearches(pasted, loadProfile())
    return { searches, autoDerived: pasted.length === 0 }
  })
  handle('glassdoor:writeFeed', ({ searches, payloads }) => {
    const feed = writeGlassdoorFeed(searches, payloads, Date.now())
    return { count: feed.rows.length, fetchedAt: feed.fetchedAt }
  })
  handle('glassdoor:feedStatus', () => glassdoorFeedStatus(Date.now()))

  // ---- BYO model providers ----
  handle('provider:setGeminiKey', ({ key }) => {
    if (!key.trim()) throw new Error('empty API key')
    setGeminiKey(key)
    return { keySet: true }
  })
  handle('provider:clearGeminiKey', () => {
    clearGeminiKey()
    return { keySet: false }
  })
  handle('provider:setOllamaKey', ({ key }) => {
    if (!key.trim()) throw new Error('empty API key')
    setOllamaKey(key)
    return { keySet: true }
  })
  handle('provider:clearOllamaKey', () => {
    clearOllamaKey()
    return { keySet: false }
  })
  handle('provider:status', () => providerStatus())
  handle('provider:ollamaShow', ({ model }) => ollamaModelDetails(model))
  handle('provider:test', () => testProvider())

  // ---- app info ----
  handle('app:info', () => ({ repoRoot: REPO_ROOT, appDataDir: APP_DATA_DIR }))

  // ---- app helpers ----
  handle('app:showItem', ({ relPath }) => {
    showItem(relPath)
  })
  handle('app:openFolder', async ({ relPath }) => {
    await openFolder(relPath)
  })
  handle('app:openExternal', async ({ url }) => {
    await openExternal(url)
  })
  handle('app:copy', ({ text }) => {
    copyText(text)
  })
  handle('app:absPath', ({ relPath }) => ({ absPath: toAbs(relPath) }))

  // ---- apply (experimental) ----
  handle('apply:insertText', async ({ text }) => {
    // webview guests are separate webContents; find the apply browser guest.
    const guest = webContents.getAllWebContents().find((wc) => wc.getType() === 'webview')
    if (!guest) throw new Error('no apply browser open')
    await guest.insertText(text)
  })

  // ---- settings ----
  handle('settings:get', () => store.state.settings)
  handle('settings:set', (patch) =>
    store.mutate(['settings'], (s) => {
      Object.assign(s.settings, patch)
      return s.settings
    })
  )

  // ---- companies (Glassdoor ratings, company-scoped) ----
  handle('companies:get', () => allCompanies())
  handle('companies:ensure', ({ company }) => ensureRating(company))
  handle('companies:backfill', () => {
    const names = [
      ...store.state.rows.map((r) => r.company),
      ...store.state.candidates.map((c) => c.company),
      ...store.state.intake.filter((i) => i.state !== 'dismissed').map((i) => i.companyHint)
    ]
    return backfillCompanies(names)
  })

  // ---- email: Gmail reader + tracker-status suggestions ----
  const emailSync = new EmailSync({ store, tracker, send })
  if (gmailConfigured()) emailSync.start()
  const emailStatus = (): EmailStatus => ({
    configured: gmailConfigured(),
    clientId: gmailClientId(),
    hasClientSecret: gmailHasClientSecret(),
    email: gmailEmail(),
    polling: emailSync.polling(),
    lastSyncAt: lastSyncAt()
  })
  handle('email:status', () => emailStatus())
  handle('email:setClientId', ({ clientId, clientSecret }) => {
    setGmailClientId(clientId, clientSecret)
    // Switching client IDs invalidates the stored tokens — stop the poll loop
    // rather than let it fail against a connection that no longer exists.
    if (!gmailConfigured()) emailSync.stop()
    return emailStatus()
  })
  handle('email:importClientJson', async () => {
    const win = services.getWindow()
    const result = await dialog.showOpenDialog(win ?? new BrowserWindow({ show: false }), {
      title: 'Choose the OAuth client JSON downloaded from Google Cloud',
      properties: ['openFile'],
      filters: [{ name: 'OAuth client JSON', extensions: ['json'] }]
    })
    const file = result.filePaths[0]
    if (result.canceled || !file) return { imported: false, status: emailStatus() }
    const { clientId, clientSecret } = parseClientJson(fs.readFileSync(file, 'utf-8'))
    setGmailClientId(clientId, clientSecret)
    // See email:setClientId — an ID switch invalidates the stored tokens.
    if (!gmailConfigured()) emailSync.stop()
    return { imported: true, status: emailStatus() }
  })
  handle('email:signIn', async () => {
    await gmailSignIn()
    // start() runs the first sync immediately, so the tab fills right away.
    emailSync.start()
    return emailStatus()
  })
  handle('email:signOut', () => {
    emailSync.stop()
    gmailSignOut()
    clearEmailCache()
    send('push:emailChanged', { suggestions: 0 })
    return emailStatus()
  })
  handle('email:list', ({ filter }) => listCachedMessages(filter))
  handle('email:getBody', async ({ id }) => {
    const { text, ics } = await getMessageFull(id)
    // Opening a message is the chance to reclassify it from the full body,
    // healing a snippet-based miss (e.g. a rejection whose decisive line sat
    // past the preview), refresh its tracker suggestion, and persist a newly
    // parsed invite. An unparseable/absent ICS part must not clear a stored
    // invite, hence undefined (leave alone) instead of null there.
    const parsed = ics ? parseIcs(ics) : null
    emailSync.reclassifyFromBody(id, text, parsed ?? undefined)
    return { text, invite: getCachedMessage(id)?.invite ?? parsed?.invite ?? null }
  })
  handle('email:draftReply', ({ id, instructions }) =>
    draftEmailReply(id, instructions, store.state.settings.model)
  )
  handle('email:refresh', async () => {
    await emailSync.syncNow()
    return emailStatus()
  })
  handle('email:applySuggestion', ({ emailId }) => {
    const msg = getCachedMessage(emailId)
    if (!msg?.suggestion || msg.suggestionState !== 'open') {
      throw new Error('this email has no open suggestion')
    }
    const row = tracker.getRow(msg.suggestion.rowId)
    if (!row) throw new Error('the matched tracker row no longer exists')
    if (msg.suggestion.suggestStatus === 'applied') tracker.markApplied(row.id)
    else tracker.upsertRow({ id: row.id, statusKey: msg.suggestion.suggestStatus })
    setSuggestionState(emailId, 'applied')
    send('push:emailChanged', { suggestions: openSuggestionCount() })
  })
  handle('email:dismissSuggestion', ({ emailId }) => {
    setSuggestionState(emailId, 'dismissed')
    send('push:emailChanged', { suggestions: openSuggestionCount() })
  })
  handle('email:update', ({ id, patch }) => {
    const msg = updateMessage(id, patch)
    // Hiding/unhiding moves mail in or out of the open-suggestion count.
    if (patch.hidden !== undefined) send('push:emailChanged', { suggestions: openSuggestionCount() })
    return msg
  })
  handle('email:tags', () => ({ tags: listTags() }))
  handle('email:createTag', ({ name }) => createTag(name))

  // ---- calendar: events extracted from mail, plus reminders ----
  // Reminders run regardless of Gmail state — manual events exist without it.
  const reminders = new ReminderLoop({ store, send })
  reminders.start()
  const pushCalendarChanged = (): void =>
    send('push:calendarChanged', { proposed: proposedCount() })
  handle('calendar:list', () => listEvents())
  handle('calendar:approve', ({ id }) => {
    approveEvent(id)
    pushCalendarChanged()
    return listEvents()
  })
  handle('calendar:dismiss', ({ id }) => {
    dismissEvent(id)
    pushCalendarChanged()
    return listEvents()
  })
  handle('calendar:remove', ({ id }) => {
    removeEvent(id)
    pushCalendarChanged()
    return listEvents()
  })
  handle('calendar:add', (input) => {
    addManual(input)
    pushCalendarChanged()
    return listEvents()
  })
  handle('calendar:update', ({ id, patch }) => {
    updateEvent(id, patch)
    pushCalendarChanged()
    return listEvents()
  })
  handle('calendar:propose', (input) => {
    // Same tracker match the sync path uses, so a card-proposed event carries
    // its company/row link. The renderer never sees the ICS UID, so dedupe
    // rests on sourceMessageId + title/start-minute.
    const msg = input.sourceMessageId ? getCachedMessage(input.sourceMessageId) : null
    const match = msg ? matchTrackerRow(msg.from, msg.subject, msg.snippet, tracker.listRows()) : null
    proposeEvent({
      ...input,
      icsUid: null,
      company: match?.company ?? null,
      rowId: match?.id ?? null,
      source: 'ics',
      // The card's Propose is an explicit user action — it may resurrect a
      // mistakenly dismissed proposal (automatic re-proposals never do).
      restoreDismissed: true
    })
    pushCalendarChanged()
    return listEvents()
  })

  // ---- assistant: in-app chat, IPC channels mirror AssistantManager 1:1 ----
  const sessionDeps = {
    store,
    tracker,
    runStore,
    startScout: (instructions: string) => runner.start({ kind: 'scout', instructions }),
    rebuildRun,
    send
  }
  const assistant = new AssistantManager(sessionDeps)
  const detailChat = new DetailChatManager(sessionDeps)
  handle('detailChat:send', ({ rowId, text }) => detailChat.send(rowId, text))
  handle('detailChat:stop', ({ rowId }) => detailChat.stop(rowId))
  handle('detailChat:get', ({ rowId }) => detailChat.get(rowId))
  handle('assistant:send', (req) => assistant.send(req))
  handle('assistant:stop', (req) => assistant.stop(req))
  handle('assistant:approve', (req) => assistant.approve(req))
  handle('assistant:newConversation', () => assistant.newConversation())
  handle('assistant:listConversations', () => assistant.list())
  handle('assistant:getConversation', ({ id }) => assistant.get(id))
  handle('assistant:deleteConversation', ({ id }) => assistant.del(id))
  handle('assistant:resync', (req) => assistant.resync(req))
}

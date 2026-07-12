import { BrowserWindow, dialog, ipcMain, webContents } from 'electron'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { IntakeItem } from '@shared/types'
import type { IpcChannel, IpcInvokeContract } from '@shared/ipc'
import { buildApplicationDetail } from './parsers/detail'
import { scanApplications } from './fsops/FolderScanner'
import { copyText, openExternal, openFolder, showItem } from './fsops/reveal'
import { importFromXlsx } from './xlsx/importXlsx'
import { exportToXlsx } from './xlsx/exportXlsx'
import { INTAKE_IMAGES_DIR, UPLOADS_DIR, toAbs, toRel } from './paths'
import { listLibrary, readLibraryFile } from './fsops/library'
import { recompileDoc } from './latex/recompile'
import { getBoardsStatus, setJobrightCreds, testJobright } from './boards/boardsBridge'
import { APP_DATA_DIR, ONBOARDING_DIR, REPO_ROOT } from './paths'
import { validateProfile } from './profile/profileSchema'
import { loadProfile, saveProfile } from './profile/profileStore'
import type { ProfileFile } from '@shared/profile'
import type { AgentRunner } from './agent/AgentRunner'
import type { Store } from './store/Store'
import type { TrackerRepo } from './store/trackerRepo'
import type { TodoWatcher } from './fsops/TodoWatcher'

export interface Services {
  store: Store
  tracker: TrackerRepo
  todo: TodoWatcher
  runner: AgentRunner
  getWindow: () => BrowserWindow | null
}

type Handler<C extends IpcChannel> = (
  req: IpcInvokeContract[C]['req']
) => Promise<IpcInvokeContract[C]['res']> | IpcInvokeContract[C]['res']

/** Register every invoke channel with a uniform {ok,data|error} wrapper. */
export function registerIpc(services: Services): void {
  const { store, tracker, todo, runner } = services

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
    // Cancel any in-flight build tied to this row.
    if (row.runId) runner.cancel(row.runId)
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
  handle('intake:addPasted', ({ text, url, company, role, imagesBase64 }) => {
    if (!text.trim() && !imagesBase64?.length) {
      throw new Error('paste posting text or at least one screenshot')
    }
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
    return item
  })
  handle('intake:dismiss', ({ id }) => {
    store.mutate(['intake'], (s) => {
      const item = s.intake.find((i) => i.id === id)
      if (item) item.state = 'dismissed'
    })
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
      roleHint: candidate.position
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

  // ---- library: workspace reference docs, no Explorer needed ----
  handle('library:list', () => listLibrary())
  handle('library:read', ({ relPath }) => readLibraryFile(relPath))

  // ---- profile (v2 core) ----
  handle('profile:get', () => loadProfile())
  handle('profile:save', ({ profile }) => {
    const result = validateProfile(profile)
    if (!result.ok) throw new Error(`profile invalid: ${result.problems.join('; ')}`)
    return saveProfile(result.profile)
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
  handle('onboard:start', ({ source, text, files }) => {
    let sourceFiles: string[] = []
    if (source === 'v1-import') {
      const stage = path.join(ONBOARDING_DIR, 'v1-import')
      if (!fs.existsSync(stage)) {
        throw new Error('no v1-import sources staged — use "Import from v1" first')
      }
      sourceFiles = fs
        .readdirSync(stage)
        .filter((f) => !f.startsWith('.'))
        .map((f) => path.join(stage, f))
    } else if (source === 'uploads') {
      // "agent handles the rest": every file the user dropped into the library.
      sourceFiles = fs.existsSync(UPLOADS_DIR)
        ? fs
            .readdirSync(UPLOADS_DIR)
            .filter((f) => !f.startsWith('.'))
            .map((f) => path.join(UPLOADS_DIR, f))
        : []
      // Include v1-import staging too when present — more context never hurts extraction.
      const stage = path.join(ONBOARDING_DIR, 'v1-import')
      if (fs.existsSync(stage)) {
        sourceFiles.push(
          ...fs
            .readdirSync(stage)
            .filter((f) => !f.startsWith('.'))
            .map((f) => path.join(stage, f))
        )
      }
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
    if (result.canceled) return { added: 0 }
    fs.mkdirSync(UPLOADS_DIR, { recursive: true })
    let added = 0
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
        added++
      } catch (err) {
        console.error('[library] upload copy failed:', err)
      }
    }
    return { added }
  })

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
  handle('boards:setCreds', ({ email, password }) => {
    setJobrightCreds(email, password)
  })
  handle('boards:test', () => testJobright())

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
}

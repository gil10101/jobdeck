import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { CandidateJob, IntakeItem, RunEvent, RunKind, RunMeta, RunStatus } from '@shared/types'
import type { ProfileFile } from '@shared/profile'
import {
  APPLICATIONS_DIR,
  REPO_ROOT,
  SCOUT_DIR,
  TMP_DIR,
  buildSlug,
  toRel,
  todayMMDD,
  uniqueSlug
} from '../paths'
import { assertScoutable, prefetchJobrightFeed } from '../boards/boardsBridge'
import { scanApplications } from '../fsops/FolderScanner'
import { parseReport, validateReport } from '../parsers/report'
import { validateProfile } from '../profile/profileSchema'
import { loadProfile } from '../profile/profileStore'
import { ensureRatingBg } from '../companies/ratingService'
import type { Store } from '../store/Store'
import type { TrackerRepo } from '../store/trackerRepo'
import type { TodoWatcher } from '../fsops/TodoWatcher'
import { mapMessage, stamp, type PartialRunEvent } from './eventMap'
import { buildInterviewPrompt, buildOnboardPrompt, buildPrompt, buildRefinePrompt, buildScoutPrompt } from './prompt'
import { RunStore } from './runStore'

export interface RunInput {
  kind?: RunKind
  intakeId?: string
  postingText?: string
  imagePaths?: string[]
  applyUrl?: string
  companyHint?: string
  roleHint?: string
  /** Build runs: user notes for this specific application. */
  notes?: string
  /** Scout runs: optional extra instructions from the user. */
  instructions?: string
  /** Interview runs: the tracker row being prepped (folder + position/company). */
  rowFolderRel?: string
  rowPosition?: string
  rowCompany?: string
  /** Onboard runs: profile sources. */
  sourceFiles?: string[]
  sourceText?: string
  /** Onboard refine runs: merge gap answers into this draft instead of extracting. */
  refineDraft?: ProfileFile
  refineAnswers?: { question: string; answer: string }[]
}

interface ActiveRun {
  meta: RunMeta
  input: RunInput
  controller: AbortController
  seq: number
  textBuffer: string
  flushTimer: NodeJS.Timeout | null
  /** Context footprint of the latest completed assistant step (input + cache
   *  tokens) — result-message usage is cumulative and can't provide this. */
  contextTokens?: number
  /** Cumulative tokens for the whole run, from the result message. */
  totalTokens?: number
  /** Scout runs: app-prefetched jobright feed handed to the agent as a file. */
  jobrightFeed?: { relPath: string; count: number } | null
  /** Scout runs: why the prefetch failed (agent must skip jobright then). */
  jobrightUnavailable?: string | null
}

type SendFn = (channel: 'push:runEvent' | 'push:runChanged', payload: unknown) => void

const TEXT_FLUSH_MS = 100

export class AgentRunner {
  private queue: ActiveRun[] = []
  private active = new Map<string, ActiveRun>()

  constructor(
    private store: Store,
    private tracker: TrackerRepo,
    private todo: TodoWatcher,
    private runStore: RunStore,
    private send: SendFn
  ) {
    this.sweepStaleRuns()
  }

  /** Runs can't survive an app restart — anything still marked live is dead. */
  private sweepStaleRuns(): void {
    for (const meta of this.runStore.list()) {
      if (meta.status === 'running' || meta.status === 'queued') {
        meta.status = 'cancelled'
        meta.errorText = 'interrupted by app restart'
        meta.endedAt = meta.endedAt ?? new Date().toISOString()
        this.runStore.saveMeta(meta)
      }
    }
  }

  start(input: RunInput): RunMeta {
    const kind: RunKind = input.kind ?? 'build'
    // Fail scout runs before anything is queued when no board CLI can run at
    // all — the error carries the fix (Settings → Job boards) to the caller.
    if (kind === 'scout') assertScoutable()
    let slug: string
    if (kind === 'scout') {
      const now = new Date()
      slug = `scout_${todayMMDD()}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
    } else if (kind === 'interview') {
      slug = `interview_${path.basename(input.rowFolderRel ?? 'application')}`
    } else if (kind === 'onboard') {
      const now = new Date()
      slug = `onboard_${todayMMDD()}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
    } else {
      slug = uniqueSlug(buildSlug(input.companyHint ?? '', input.roleHint ?? '', todayMMDD()))
    }
    const meta: RunMeta = {
      id: `run_${randomUUID().slice(0, 8)}`,
      kind,
      slug,
      intakeId: input.intakeId ?? null,
      status: 'queued',
      errorText: null,
      summary: null,
      problems: null,
      costUsd: null,
      durationMs: null,
      numTurns: null,
      folderPath: null,
      resultPath: null,
      startedAt: new Date().toISOString(),
      endedAt: null
    }
    const run: ActiveRun = {
      meta,
      input,
      controller: new AbortController(),
      seq: 0,
      textBuffer: '',
      flushTimer: null
    }
    this.runStore.saveMeta(meta)
    this.setIntakeState(input.intakeId, 'building', meta.id)
    this.queue.push(run)
    this.send('push:runChanged', meta)
    this.pump()
    return meta
  }

  cancel(runId: string): void {
    const active = this.active.get(runId)
    if (active) {
      active.controller.abort()
      return
    }
    const idx = this.queue.findIndex((r) => r.meta.id === runId)
    if (idx >= 0) {
      const [run] = this.queue.splice(idx, 1)
      this.finish(run, 'cancelled', 'cancelled before start')
      return
    }
    // Ghost run (e.g. left over from a previous app instance): force-terminal.
    const meta = this.runStore.getMeta(runId)
    if (meta && (meta.status === 'running' || meta.status === 'queued')) {
      meta.status = 'cancelled'
      meta.errorText = 'cancelled (stale run from a previous app session)'
      meta.endedAt = new Date().toISOString()
      this.runStore.saveMeta(meta)
      this.send('push:runChanged', meta)
    }
  }

  abortAll(reason: string): void {
    for (const run of this.queue.splice(0)) this.finish(run, 'cancelled', reason)
    for (const run of this.active.values()) run.controller.abort()
  }

  list(): RunMeta[] {
    return this.runStore.list()
  }

  get(runId: string): { meta: RunMeta; events: RunEvent[] } {
    const meta = this.runStore.getMeta(runId)
    if (!meta) throw new Error(`run not found: ${runId}`)
    return { meta, events: this.runStore.getEvents(runId) }
  }

  private pump(): void {
    const max = this.store.state.settings.maxConcurrentRuns
    while (this.active.size < max && this.queue.length > 0) {
      const run = this.queue.shift()!
      this.active.set(run.meta.id, run)
      void this.execute(run)
    }
  }

  private emit(run: ActiveRun, e: PartialRunEvent): void {
    const event = stamp(++run.seq, e)
    this.runStore.appendEvent(run.meta.id, event)
    this.send('push:runEvent', { runId: run.meta.id, event })
  }

  /** Push without persisting — for streaming partial text (the complete block is persisted). */
  private emitEphemeral(run: ActiveRun, e: PartialRunEvent): void {
    const event = stamp(++run.seq, e)
    this.send('push:runEvent', { runId: run.meta.id, event })
  }

  private flushText(run: ActiveRun, complete: boolean): void {
    if (run.flushTimer) {
      clearTimeout(run.flushTimer)
      run.flushTimer = null
    }
    if (!run.textBuffer) return
    this.emit(run, { kind: 'text', text: run.textBuffer, complete })
    if (complete) run.textBuffer = ''
  }

  private setStatus(run: ActiveRun, status: RunStatus, errorText?: string): void {
    run.meta.status = status
    if (errorText !== undefined) run.meta.errorText = errorText
    if (status === 'succeeded' || status === 'failed' || status === 'cancelled') {
      run.meta.endedAt = new Date().toISOString()
    }
    this.runStore.saveMeta(run.meta)
    this.emit(run, { kind: 'status', status })
    this.send('push:runChanged', { ...run.meta })
  }

  private setIntakeState(
    intakeId: string | undefined | null,
    state: IntakeItem['state'],
    runId?: string
  ): void {
    if (!intakeId) return
    this.store.mutate(['intake'], (s) => {
      const item = s.intake.find((i) => i.id === intakeId)
      if (item) {
        item.state = state
        if (runId) item.runId = runId
      }
    })
  }

  /** Companies/positions the scout must not re-suggest (tracked rows + all prior candidates). */
  private excludeList(): string[] {
    const out = new Set<string>()
    for (const r of this.store.state.rows) {
      if (r.company || r.position) out.add(`${r.position} @ ${r.company}`.trim())
    }
    for (const c of this.store.state.candidates) {
      out.add(`${c.position} @ ${c.company}`.trim())
    }
    return [...out].slice(0, 150)
  }

  /** Build the kind-specific prompt; throws a user-facing error when prerequisites are missing. */
  private buildRunPrompt(run: ActiveRun): string {
    const kind = run.meta.kind
    if (kind === 'onboard') {
      const outputPath = path.join(TMP_DIR, 'profile.draft.json')
      if (run.input.refineDraft) {
        return buildRefinePrompt({
          draft: run.input.refineDraft,
          answers: run.input.refineAnswers ?? [],
          outputPath
        })
      }
      return buildOnboardPrompt({
        sourceFiles: run.input.sourceFiles ?? [],
        sourceText: run.input.sourceText ?? '',
        outputPath
      })
    }
    const profile = loadProfile()
    if (kind === 'scout') {
      return buildScoutPrompt(
        {
          instructions: run.input.instructions ?? '',
          excludeList: this.excludeList(),
          outputPath: path.join(SCOUT_DIR, `${run.meta.id}.candidates.json`),
          jobrightFeed: run.jobrightFeed ?? null,
          jobrightUnavailable: run.jobrightUnavailable ?? null
        },
        profile
      )
    }
    if (!profile) {
      throw new Error('no candidate profile yet — run onboarding first (Settings → Profile)')
    }
    if (kind === 'interview') {
      return buildInterviewPrompt(
        {
          folderRel: run.input.rowFolderRel ?? '',
          position: run.input.rowPosition ?? '',
          company: run.input.rowCompany ?? ''
        },
        profile
      )
    }
    // Notes fall back to the intake item's stored notes so every build path
    // (single build, build-all, retries) picks them up without re-plumbing.
    const notes =
      run.input.notes ??
      (run.input.intakeId
        ? (this.store.state.intake.find((i) => i.id === run.input.intakeId)?.notes ?? null)
        : null)
    return buildPrompt(
      {
        slug: run.meta.slug,
        postingText: run.input.postingText ?? '',
        imagePaths: run.input.imagePaths ?? [],
        applyUrl: run.input.applyUrl ?? null,
        companyHint: run.input.companyHint ?? '',
        roleHint: run.input.roleHint ?? '',
        notes
      },
      profile
    )
  }

  private async execute(run: ActiveRun): Promise<void> {
    this.setStatus(run, 'running')
    if (run.meta.kind === 'scout') {
      // Fetch the jobright feed app-side (credentials stay in this process)
      // and hand the agent a file to Read — it never invokes the jobright CLI,
      // so session bursts are structurally impossible. Best-effort: on failure
      // the prompt falls back to careful CLI use.
      const feedFile = path.join(SCOUT_DIR, `${run.meta.id}.feed.json`)
      const feed = await prefetchJobrightFeed(feedFile)
      if (feed.ok) {
        run.jobrightFeed = { relPath: toRel(feedFile), count: feed.count }
        run.jobrightUnavailable = null
      } else {
        run.jobrightFeed = null
        run.jobrightUnavailable = feed.message
        console.warn('[runner] jobright feed prefetch skipped:', feed.message)
      }
    }
    if (run.meta.kind === 'onboard') {
      try {
        fs.rmSync(path.join(TMP_DIR, 'profile.draft.json'), { force: true })
      } catch {
        // best-effort: a stale draft that can't be removed will still be
        // caught by finalizeOnboard's validation
      }
    }
    try {
      const prompt = this.buildRunPrompt(run)
      this.runStore.savePrompt(run.meta.id, prompt) // audit: exactly what the agent saw

      const { query } = await import('@anthropic-ai/claude-agent-sdk')
      const settings = this.store.state.settings

      const q = query({
        prompt,
        options: {
          cwd: REPO_ROOT,
          systemPrompt: { type: 'preset', preset: 'claude_code' },
          // Explicitly NO settings sources: prompts are fully self-contained
          // (no external instructions-file dependency) — provable by grepping the saved prompt.
          settingSources: [],
          permissionMode: 'bypassPermissions',
          maxTurns: settings.maxTurns,
          abortController: run.controller,
          includePartialMessages: settings.includePartialMessages,
          stderr: (data: string) => this.runStore.appendStderr(run.meta.id, data),
          env: { ...process.env } as Record<string, string>,
          ...(settings.model ? { model: settings.model } : {})
        }
      })

      let resultOk = false
      let resultError: string | null = null

      for await (const msg of q) {
        if (msg.type === 'assistant' && msg.message.usage) {
          const u = msg.message.usage
          run.contextTokens =
            (u.input_tokens ?? 0) +
            (u.cache_read_input_tokens ?? 0) +
            (u.cache_creation_input_tokens ?? 0)
        }
        if (msg.type === 'result') {
          // Result usage is cumulative across the run — exactly right for the
          // run's total token consumption.
          const u = msg.usage
          run.totalTokens =
            (u?.input_tokens ?? 0) +
            (u?.output_tokens ?? 0) +
            ((u?.cache_read_input_tokens as number) ?? 0) +
            ((u?.cache_creation_input_tokens as number) ?? 0)
        }
        const mapped = mapMessage(msg)
        if (mapped.textDelta) {
          run.textBuffer += mapped.textDelta
          if (!run.flushTimer) {
            run.flushTimer = setTimeout(() => {
              run.flushTimer = null
              if (run.textBuffer) {
                this.emitEphemeral(run, { kind: 'text', text: run.textBuffer, complete: false })
              }
            }, TEXT_FLUSH_MS)
          }
        }
        for (const e of mapped.events) {
          if (e.kind === 'text' && e.complete) {
            // Full assistant text supersedes the partial buffer.
            if (run.flushTimer) {
              clearTimeout(run.flushTimer)
              run.flushTimer = null
            }
            run.textBuffer = ''
          }
          if (e.kind === 'result') {
            e.contextTokens = run.contextTokens
            resultOk = e.ok
            resultError = e.errorText ?? null
            run.meta.costUsd = e.costUsd ?? null
            run.meta.durationMs = e.durationMs ?? null
            run.meta.numTurns = e.numTurns ?? null
            run.meta.contextTokens = run.contextTokens ?? null
            run.meta.contextWindow = e.contextWindow ?? null
            run.meta.totalTokens = run.totalTokens ?? null
          }
          this.emit(run, e)
        }
      }
      this.flushText(run, true)

      this.finalize(run, resultOk, resultError)
    } catch (err) {
      this.flushText(run, true)
      if (run.controller.signal.aborted) {
        this.finish(run, 'cancelled', 'cancelled by user')
      } else {
        this.finish(run, 'failed', `agent error: ${String(err)}`)
      }
    } finally {
      this.active.delete(run.meta.id)
      this.pump()
    }
  }

  /** Verify the run output and wire up store state on success. */
  private finalize(run: ActiveRun, sdkOk: boolean, sdkError: string | null): void {
    if (run.controller.signal.aborted) {
      this.finish(run, 'cancelled', 'cancelled by user')
      return
    }
    if (!sdkOk) {
      this.finish(run, 'failed', sdkError ?? 'agent reported failure')
      return
    }
    if (run.meta.kind === 'scout') {
      this.finalizeScout(run)
      return
    }
    if (run.meta.kind === 'onboard') {
      this.finalizeOnboard(run)
      return
    }
    if (run.meta.kind === 'interview') {
      const prepPath = path.join(REPO_ROOT, ...(run.input.rowFolderRel ?? '').split('/'), 'interview_prep.md')
      if (!fs.existsSync(prepPath)) {
        this.finish(run, 'failed', 'agent finished but interview_prep.md was not written')
        return
      }
      run.meta.folderPath = run.input.rowFolderRel ?? null
      run.meta.summary = 'interview_prep.md written'
      this.finish(run, 'succeeded')
      return
    }

    // Folder may have been created with or without exact slug casing; require exact.
    const folderAbs = path.join(APPLICATIONS_DIR, run.meta.slug)
    const reportPath = path.join(folderAbs, 'report.json')
    if (!fs.existsSync(reportPath)) {
      this.finish(run, 'failed', `agent finished but ${run.meta.slug}/report.json is missing`)
      return
    }
    let raw = ''
    try {
      raw = fs.readFileSync(reportPath, 'utf-8')
    } catch (err) {
      this.finish(run, 'failed', `cannot read report.json: ${String(err)}`)
      return
    }
    const parsed = parseReport(raw)
    if ('error' in parsed) {
      this.finish(run, 'failed', parsed.error)
      return
    }
    parsed.slug = parsed.slug || run.meta.slug
    const validation = validateReport(parsed, folderAbs)
    if (!validation.ok) {
      this.finish(run, 'failed', `report validation: ${validation.problems.join('; ')}`)
      return
    }

    const folderRel = toRel(folderAbs)
    run.meta.folderPath = folderRel
    this.tracker.upsertFromReport(parsed, run.meta.id, folderRel)
    ensureRatingBg(parsed.company)

    // TODO-file intake → rename to [DONE]
    const intake = this.store.state.intake.find((i) => i.id === run.meta.intakeId)
    if (intake?.kind === 'todo-file' && intake.todoFileName) {
      this.todo.markTodoDone(intake.todoFileName)
    }
    this.setIntakeState(run.meta.intakeId, 'built')
    this.finish(run, 'succeeded')
  }

  /** Validate the profile draft the onboard agent wrote — reviewed by a human, never auto-saved. */
  private finalizeOnboard(run: ActiveRun): void {
    const draftPath = path.join(TMP_DIR, 'profile.draft.json')
    if (!fs.existsSync(draftPath)) {
      this.finish(run, 'failed', 'onboarding agent finished but wrote no profile draft')
      return
    }
    let raw = ''
    try {
      raw = fs.readFileSync(draftPath, 'utf-8').trim()
      const fence = raw.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/)
      if (fence) raw = fence[1].trim()
      JSON.parse(raw)
    } catch (err) {
      this.finish(run, 'failed', `profile draft is not valid JSON: ${String(err)}`)
      return
    }
    const result = validateProfile(JSON.parse(raw))
    if (!result.ok) {
      run.meta.problems = result.problems
      this.finish(run, 'failed', `profile draft incomplete: ${result.problems.join('; ')}`)
      return
    }
    // Persist the healed draft so the review UI loads a clean object.
    fs.writeFileSync(draftPath, JSON.stringify(result.profile, null, 2), 'utf-8')
    run.meta.resultPath = draftPath
    const gaps = result.profile.gaps.length
    run.meta.summary = `profile draft ready (${gaps} gap${gaps === 1 ? '' : 's'} to review)`
    run.meta.problems = result.healed.length ? result.healed : null
    this.finish(run, 'succeeded')
  }

  /** Parse the scout's candidates file, dedupe against everything known, append to store. */
  private finalizeScout(run: ActiveRun): void {
    const outPath = path.join(SCOUT_DIR, `${run.meta.id}.candidates.json`)
    if (!fs.existsSync(outPath)) {
      this.finish(run, 'failed', 'scout finished but wrote no candidates file')
      return
    }
    let parsed: { candidates?: Partial<CandidateJob>[]; problems?: string[] }
    try {
      let raw = fs.readFileSync(outPath, 'utf-8').trim()
      const fence = raw.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/)
      if (fence) raw = fence[1].trim()
      parsed = JSON.parse(raw)
    } catch (err) {
      this.finish(run, 'failed', `candidates file is not valid JSON: ${String(err)}`)
      return
    }
    const incoming = Array.isArray(parsed.candidates) ? parsed.candidates : []

    const key = (position: string, company: string): string =>
      `${position.toLowerCase().trim()}|${company.toLowerCase().trim()}`
    const known = new Set<string>()
    for (const r of this.store.state.rows) known.add(key(r.position, r.company))
    for (const c of this.store.state.candidates) known.add(key(c.position, c.company))

    const strArray = (v: unknown): string[] | null =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : null

    let added = 0
    const newCompanies: string[] = []
    this.store.mutate(['candidates'], (s) => {
      for (const c of incoming) {
        const position = (c.position ?? '').trim()
        const company = (c.company ?? '').trim()
        if (!position || !company) continue
        if (known.has(key(position, company))) continue
        known.add(key(position, company))
        newCompanies.push(company)
        s.candidates.push({
          id: randomUUID(),
          position,
          company,
          salary: c.salary ?? 'not listed',
          location: c.location ?? '',
          workModel: c.workModel ?? 'unknown',
          datePosted: c.datePosted ?? null,
          applyUrl: c.applyUrl ?? '',
          source: c.source ?? 'scout',
          fitScore: typeof c.fitScore === 'number' ? c.fitScore : null,
          fitNote: c.fitNote ?? '',
          postingText: c.postingText ?? '',
          skills: strArray(c.skills),
          minimumQualifications: strArray(c.minimumQualifications),
          preferredQualifications: strArray(c.preferredQualifications),
          education: strArray(c.education),
          responsibilities: strArray(c.responsibilities),
          benefits: strArray(c.benefits),
          state: 'new',
          scoutRunId: run.meta.id,
          buildRunId: null,
          createdAt: new Date().toISOString()
        })
        added++
      }
    })
    for (const company of newCompanies) ensureRatingBg(company)

    run.meta.summary = `${added} new candidate${added === 1 ? '' : 's'} (${incoming.length} reported)`
    run.meta.problems = parsed.problems?.length ? parsed.problems : null
    this.finish(run, 'succeeded')
  }

  private finish(run: ActiveRun, status: RunStatus, errorText?: string): void {
    if (status === 'failed' || status === 'cancelled') {
      this.setIntakeState(run.meta.intakeId, status === 'failed' ? 'failed' : 'new')
      this.salvageBuildFolder(run)
    }
    this.setStatus(run, status, errorText)
  }

  /**
   * A build that dies mid-run (crash, cancel, missing/invalid report.json) may
   * still have written real documents. Fold whatever is on disk into the
   * tracker so a folder with a built résumé/cover letter is never invisible —
   * the row comes from scan facts (posting metadata, doc paths), same as the
   * manual "Rescan folders" action. Folders with no built documents are left
   * alone: a run that produced nothing has nothing to track.
   */
  private salvageBuildFolder(run: ActiveRun): void {
    if (run.meta.kind !== 'build') return
    try {
      const folderAbs = path.join(APPLICATIONS_DIR, run.meta.slug)
      if (!fs.existsSync(folderAbs)) return
      const names = fs.readdirSync(folderAbs)
      const hasDocs = names.some((n) => /_Resume\.(pdf|tex)$|_Cover_Letter\.(pdf|tex)$/.test(n))
      if (!hasDocs) return
      this.tracker.applyScan(scanApplications())
      const row = this.tracker.findBySlug(run.meta.slug)
      if (row?.folderPath) run.meta.folderPath = row.folderPath
    } catch (err) {
      console.error('[runner] salvage scan after failed build errored:', err)
    }
  }
}

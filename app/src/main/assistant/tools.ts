import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { Store } from '../store/Store'
import type { TrackerRepo } from '../store/trackerRepo'
import type { RunStore } from '../agent/runStore'
import { getBoardsStatus, installBoard } from '../boards/boardsBridge'
import { loadProfile, saveProfile } from '../profile/profileStore'
import { validateProfile } from '../profile/profileSchema'
import { readMemory, appendMemory } from './conversationStore'
import { findSetting } from './settingsMap'
import type { ExperienceEntry, ProjectEntry, SkillCategory } from '@shared/profile'
import { emptyProfile } from '@shared/profile'

// In-process MCP server ("app" namespace) exposing the app's state to the
// assistant agent. READ tools (get_profile, list_applications, …) run freely.
// Of the ACTION tools, add_profile_entry, install_job_board, and start_scout
// gate through `requestApproval`; `remember` appends to long-term memory
// without approval by design.

export interface AssistantToolDeps {
  store: Store
  tracker: TrackerRepo
  runStore: RunStore
  startScout: (instructions: string) => { id: string }
  requestApproval: (tool: string, preview: string) => Promise<boolean>
}

function json(payload: unknown): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] }
}

export function buildAssistantMcp(deps: AssistantToolDeps): ReturnType<typeof createSdkMcpServer> {
  const getProfile = tool(
    'get_profile',
    "Get the candidate's profile: identity, education, experience, skills, behavioral traits, search config, and more.",
    {},
    async () => json(loadProfile() ?? { error: 'no profile' })
  )

  const listApplications = tool(
    'list_applications',
    'List all tracked job applications with their status, salary, location, and fit note.',
    {},
    async () =>
      json(
        deps.tracker.listRows().map((r) => ({
          id: r.id,
          position: r.position,
          company: r.company,
          status: r.statusText,
          salary: r.salary,
          location: r.location,
          datePosted: r.datePosted,
          applyUrl: r.applyUrl,
          fitNote: r.report?.fitNote ?? null
        }))
      )
  )

  const getApplication = tool(
    'get_application',
    'Get the full tracked-application row (including its build report, if any) by id.',
    { id: z.string() },
    async ({ id }) => {
      const row = deps.tracker.getRow(id)
      return json(row ?? { error: `application not found: ${id}` })
    }
  )

  const listRuns = tool(
    'list_runs',
    'List all agent runs (build/scout/interview/onboard) with status, summary, and cost.',
    {},
    async () =>
      json(
        deps.runStore.list().map((m) => ({
          id: m.id,
          kind: m.kind,
          status: m.status,
          summary: m.summary,
          error: m.errorText,
          costUsd: m.costUsd
        }))
      )
  )

  const getRun = tool(
    'get_run',
    "Get an agent run's metadata plus a compact timeline of its most recent events, by run id.",
    { runId: z.string() },
    async ({ runId }) => {
      // runId reaches path.join in RunStore — reject traversal-shaped ids.
      if (!/^[A-Za-z0-9_-]+$/.test(runId)) return json({ error: `invalid run id: ${runId}` })
      const meta = deps.runStore.getMeta(runId)
      if (!meta) return json({ error: `run not found: ${runId}` })
      const events = deps.runStore.getEvents(runId).slice(-40)
      return json({ ...meta, events })
    }
  )

  const listCandidates = tool(
    'list_candidates',
    'List new scouted candidate jobs awaiting review (not yet accepted or rejected).',
    {},
    async () =>
      json(
        deps.store.state.candidates
          .filter((c) => c.state === 'new')
          .map((c) => ({
            id: c.id,
            position: c.position,
            company: c.company,
            salary: c.salary,
            location: c.location,
            workModel: c.workModel,
            fitScore: c.fitScore,
            fitNote: c.fitNote,
            applyUrl: c.applyUrl
          }))
      )
  )

  const getSettings = tool(
    'get_settings',
    'Get the current app settings (agent runs, appearance, workflow, job boards).',
    {},
    async () => json(deps.store.state.settings)
  )

  const whereIsSetting = tool(
    'where_is_setting',
    'Find where a setting lives in the Settings UI, by topic keyword (e.g. "theme", "model override").',
    { topic: z.string() },
    async ({ topic }) => json(findSetting(topic))
  )

  const recallMemory = tool(
    'recall_memory',
    "Recall the assistant's running memory notes carried over from past conversations.",
    {},
    async () => json({ memory: readMemory() })
  )

  const addProfileEntry = tool(
    'add_profile_entry',
    "Add one entry to the candidate's profile. section='experience' needs {title, company, location?, startDate?, endDate?, bullets?, technologies?}; 'project' needs {name, oneLiner?, url?, bullets?, technologies?}; 'skill' needs {category, items}. Requires the user's approval before saving.",
    { section: z.enum(['experience', 'project', 'skill']), entry: z.record(z.string(), z.any()) },
    async ({ section, entry }) => {
      // Build a complete, correctly-shaped entry (the model's input keys are
      // untrusted) so a malformed call can never persist a partial object.
      const str = (v: unknown): string => (typeof v === 'string' ? v : '')
      const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
      const strArr = (v: unknown): string[] =>
        Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
      let built: ExperienceEntry | ProjectEntry | SkillCategory
      if (section === 'experience') {
        if (!str(entry.title) || !str(entry.company)) {
          return json({ error: 'experience entries require string fields "title" and "company"' })
        }
        built = {
          title: str(entry.title),
          company: str(entry.company),
          location: str(entry.location),
          startDate: str(entry.startDate),
          endDate: str(entry.endDate),
          bullets: strArr(entry.bullets),
          technologies: strArr(entry.technologies),
          inclusionRule: strOrNull(entry.inclusionRule),
          framingNotes: strOrNull(entry.framingNotes)
        }
      } else if (section === 'project') {
        if (!str(entry.name)) return json({ error: 'project entries require a string field "name"' })
        built = {
          name: str(entry.name),
          oneLiner: str(entry.oneLiner),
          bullets: strArr(entry.bullets),
          technologies: strArr(entry.technologies),
          url: strOrNull(entry.url),
          mustKeepPhrases: strArr(entry.mustKeepPhrases),
          framingNotes: strOrNull(entry.framingNotes),
          inclusionRule: strOrNull(entry.inclusionRule)
        }
      } else {
        if (!str(entry.category) || strArr(entry.items).length === 0) {
          return json({ error: 'skill entries require a string "category" and a non-empty string array "items"' })
        }
        built = { category: str(entry.category), items: strArr(entry.items) }
      }
      const preview = `${section}: ${JSON.stringify(built)}`
      const ok = await deps.requestApproval('add_profile_entry', preview)
      if (!ok) return json({ denied: true })
      // Clone: loadProfile() returns the module cache by reference, and a
      // validation failure must not leave the entry in the live object.
      const p = structuredClone(loadProfile() ?? emptyProfile())
      if (section === 'experience') p.experience.push(built as ExperienceEntry)
      else if (section === 'project') p.projects.push(built as ProjectEntry)
      else p.skills.push(built as SkillCategory)
      const result = validateProfile(p)
      if (!result.ok) return json({ error: 'invalid profile after adding entry', problems: result.problems })
      saveProfile(result.profile)
      return json({ ok: true, section })
    }
  )

  const checkJobBoards = tool(
    'check_job_boards',
    'Check whether the job-board search CLIs (jobright, linkedin, freehire) and the bun runtime are installed and configured — use this to diagnose scout failures.',
    {},
    async () => {
      const status = getBoardsStatus()
      return json({
        ...status,
        guidance: status.bunOk
          ? 'Missing CLIs can be installed with the install_job_board tool or from Settings → Job boards; jobright additionally needs credentials saved there.'
          : 'The bun runtime is missing, so no board CLI can run. The user must install it themselves from https://bun.sh — the app cannot do that.'
      })
    }
  )

  const installJobBoard = tool(
    'install_job_board',
    "Install one job-board search CLI (bundled with the app) into the user's workspace. Fixes 'CLI not installed' scout failures. Requires the user's approval.",
    { board: z.enum(['jobright', 'linkedin', 'freehire']) },
    async ({ board }) => {
      const ok = await deps.requestApproval(
        'install_job_board',
        `Copy the bundled ${board} search CLI into .agents/skills/${board}-search in the workspace`
      )
      if (!ok) return json({ denied: true })
      return json(installBoard(board))
    }
  )

  const startScout = tool(
    'start_scout',
    "Start a scout run that searches the job boards for matching postings. Requires the user's approval before running.",
    { instructions: z.string().optional() },
    async ({ instructions }) => {
      const preview = instructions ?? '(standard sweep)'
      const ok = await deps.requestApproval('start_scout', preview)
      if (!ok) return json({ denied: true })
      const run = deps.startScout(instructions ?? '')
      return json({ started: run.id })
    }
  )

  const remember = tool(
    'remember',
    'Record a durable, non-obvious fact about the user for future conversations (e.g. a standing preference). Appends to long-term memory.',
    { note: z.string() },
    async ({ note }) => {
      appendMemory(note)
      return json({ ok: true })
    }
  )

  return createSdkMcpServer({
    name: 'app',
    version: '1.0.0',
    tools: [
      getProfile,
      listApplications,
      getApplication,
      listRuns,
      getRun,
      listCandidates,
      getSettings,
      whereIsSetting,
      recallMemory,
      checkJobBoards,
      addProfileEntry,
      installJobBoard,
      startScout,
      remember
    ]
  })
}

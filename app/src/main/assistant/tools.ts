import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { Store } from '../store/Store'
import type { TrackerRepo } from '../store/trackerRepo'
import type { RunStore } from '../agent/runStore'
import { loadProfile, saveProfile } from '../profile/profileStore'
import { validateProfile } from '../profile/profileSchema'
import { readMemory, appendMemory } from './conversationStore'
import { findSetting } from './settingsMap'
import type { ExperienceEntry, ProjectEntry, SkillCategory } from '@shared/profile'
import { emptyProfile } from '@shared/profile'

// In-process MCP server exposing the app's state to the assistant agent.
// This file holds both halves: READ tools (get_profile, list_applications, …)
// and ACTION tools (add_profile_entry, start_scout, remember) that mutate
// store/profile/tracker state, gated through `requestApproval` below.

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
    async () => json(deps.store.state.candidates.filter((c) => c.state === 'new'))
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
    "Add one entry to the candidate's profile: a job (experience), a project, or a skill category. Requires the user's approval before saving.",
    { section: z.enum(['experience', 'project', 'skill']), entry: z.record(z.string(), z.any()) },
    async ({ section, entry }) => {
      const preview = `${section}: ${JSON.stringify(entry)}`
      const ok = await deps.requestApproval('add_profile_entry', preview)
      if (!ok) return json({ denied: true })
      const p = loadProfile() ?? emptyProfile()
      if (section === 'experience') p.experience.push(entry as unknown as ExperienceEntry)
      else if (section === 'project') p.projects.push(entry as unknown as ProjectEntry)
      else p.skills.push(entry as unknown as SkillCategory)
      const result = validateProfile(p)
      if (!result.ok) return json({ error: 'invalid profile after adding entry', problems: result.problems })
      saveProfile(result.profile)
      return json({ ok: true, section })
    }
  )

  const startScout = tool(
    'start_scout',
    'Start a scout run that searches the job boards for matching postings. Requires the user\'s approval before running.',
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
    name: 'deck',
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
      addProfileEntry,
      startScout,
      remember
    ]
  })
}

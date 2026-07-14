import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { Store } from '../store/Store'
import type { TrackerRepo } from '../store/trackerRepo'
import type { RunStore } from '../agent/runStore'
import { loadProfile } from '../profile/profileStore'
import { readMemory } from './conversationStore'
import { findSetting } from './settingsMap'

// In-process MCP server exposing the app's state to the assistant agent.
// This file holds the READ half only (get_profile, list_applications, …) —
// action tools (mutating store/tracker state) land in a later task and will
// use `startScout` + `requestApproval` below.

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
      recallMemory
    ]
  })
}

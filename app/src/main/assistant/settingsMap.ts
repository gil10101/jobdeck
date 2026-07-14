// Static map of "where in Settings does X live" — lets the assistant answer
// wayfinding questions (e.g. "where do I change the model?") without a tool
// that can navigate the UI itself.

export interface SettingEntry {
  topic: string
  location: string
  note?: string
}

export const SETTINGS_MAP: SettingEntry[] = [
  {
    topic: 'job boards',
    location: 'Settings → Job boards',
    note: 'add jobright email/password; LinkedIn/freehire need no auth'
  },
  {
    topic: 'max turns per run',
    location: 'Settings → Agent runs → Max turns per run',
    note: 'safety ceiling before a run is stopped'
  },
  {
    topic: 'concurrent runs',
    location: 'Settings → Agent runs → Concurrent runs',
    note: '1 is safest; 2 works since builds use separate folders'
  },
  {
    topic: 'model override',
    location: 'Settings → Agent runs → Model override',
    note: 'blank = default model; accepts aliases (sonnet, opus) or full model IDs'
  },
  {
    topic: 'theme',
    location: 'Settings → Appearance → Theme',
    note: 'dark or light'
  },
  {
    topic: 'stream agent text live',
    location: 'Settings → Agent runs → Stream agent text live',
    note: 'off shows only complete messages, not live streaming text'
  },
  {
    topic: 'rename on submit',
    location: 'Settings → Workflow',
    note: 'renames the application folder to "[DONE] <name>" once marked applied'
  },
  {
    topic: 'profile editing',
    location: 'Settings → Candidate profile → Edit',
    note: 'opens the candidate profile editor'
  },
  {
    topic: 'workspace/app-data locations',
    location: 'Settings → Locations',
    note: 'shows the workspace and app-data folder paths on disk'
  }
]

/** Lowercase substring match on topic; returns every entry for an empty query. */
export function findSetting(query: string): SettingEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return SETTINGS_MAP
  return SETTINGS_MAP.filter((entry) => entry.topic.toLowerCase().includes(q))
}

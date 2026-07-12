import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

/**
 * App-level config — the ONLY file stored outside the workspace
 * (<userData>/config.json). Everything else lives in the workspace itself,
 * so a workspace folder is fully portable between machines.
 */
export interface AppConfig {
  schema: 'config.v1'
  workspacePath: string | null
  onboardedAt: string | null
  pdflatexPath: string | null
  pdftotextPath: string | null
}

function configPath(): string {
  return path.join(app.getPath('userData'), 'config.json')
}

function defaults(): AppConfig {
  return {
    schema: 'config.v1',
    workspacePath: null,
    onboardedAt: null,
    pdflatexPath: null,
    pdftotextPath: null
  }
}

let cached: AppConfig | null = null

export function loadConfig(): AppConfig {
  if (cached) return cached
  try {
    const raw = fs.readFileSync(configPath(), 'utf-8')
    const parsed = JSON.parse(raw) as AppConfig
    cached = { ...defaults(), ...parsed, schema: 'config.v1' }
  } catch {
    cached = defaults()
  }
  return cached
}

export function saveConfig(patch: Partial<AppConfig>): AppConfig {
  const next = { ...loadConfig(), ...patch }
  cached = next
  fs.mkdirSync(app.getPath('userData'), { recursive: true })
  const tmp = configPath() + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf-8')
  fs.renameSync(tmp, configPath())
  return next
}

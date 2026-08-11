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
let loadError: string | null = null

/**
 * Non-null when config.json exists but could not be read or parsed. A missing
 * file is a legitimate first run; an unreadable one means the workspace
 * pointer is UNKNOWN, not absent — the difference must never be silent,
 * because treating it as absent restarts onboarding and the next setup
 * overwrites the pointer to the user's real workspace.
 */
export function configError(): string | null {
  return loadError
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function loadConfig(): AppConfig {
  if (cached) return cached
  let raw: string | null = null
  try {
    raw = fs.readFileSync(configPath(), 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      loadError = `Could not read ${configPath()}: ${describe(err)}`
      console.error('[config]', loadError)
    }
  }
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw) as AppConfig
      cached = { ...defaults(), ...parsed, schema: 'config.v1' }
      return cached
    } catch (err) {
      loadError = `${configPath()} is not valid JSON: ${describe(err)}`
      console.error('[config]', loadError)
    }
  }
  cached = defaults()
  return cached
}

export function saveConfig(patch: Partial<AppConfig>): AppConfig {
  const next = { ...loadConfig(), ...patch }
  // An unreadable config.json may still hold the only pointer to the user's
  // workspace, so it is moved aside — never overwritten in place.
  if (loadError) {
    const backup = `${configPath()}.corrupt-${Date.now()}`
    try {
      fs.renameSync(configPath(), backup)
      console.error(`[config] unreadable config preserved as ${backup}`)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(
          `${configPath()} could not be read and could not be set aside (${describe(err)}). ` +
            'Fix its permissions or move it away, then retry — overwriting it would lose the ' +
            'path to any existing workspace.'
        )
      }
    }
    loadError = null
  }
  cached = next
  fs.mkdirSync(app.getPath('userData'), { recursive: true })
  const tmp = configPath() + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf-8')
  fs.renameSync(tmp, configPath())
  return next
}

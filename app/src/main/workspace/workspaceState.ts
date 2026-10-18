// Pure workspace-folder classification and the config transition for adopting
// a folder. No electron import, and relative imports carry their .ts extension,
// so the selftests load this module directly under node type stripping.
import fs from 'node:fs'
import path from 'node:path'

export type FolderKind = 'missing' | 'notDirectory' | 'empty' | 'workspace' | 'nonEmptyOther'

/** Files only an app workspace holds. Either one marks the folder as adopted
 *  rather than fresh: tracker.json is written on first boot, profile.json once
 *  setup saves a profile (or an import restores one). */
const WORKSPACE_MARKERS = ['tracker.json', 'profile.json']

/** OS litter that does not make a folder "in use". */
const IGNORABLE = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])

export function classifyFolder(dir: string): FolderKind {
  let stat: fs.Stats
  try {
    stat = fs.statSync(dir)
  } catch {
    return 'missing'
  }
  if (!stat.isDirectory()) return 'notDirectory'
  if (WORKSPACE_MARKERS.some((m) => fs.existsSync(path.join(dir, m)))) return 'workspace'
  const entries = fs.readdirSync(dir).filter((e) => !IGNORABLE.has(e))
  return entries.length === 0 ? 'empty' : 'nonEmptyOther'
}

export function hasProfile(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'profile.json'))
}

export function sameFolder(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  return path.resolve(a) === path.resolve(b)
}

/**
 * Config patch for pointing the app at `target`. Setup completion belongs to
 * a workspace, not to the machine: a different folder without a profile goes
 * back through setup, while adopting a folder that already holds a profile
 * skips it. The same folder keeps whatever state it had.
 */
export function configPatchForSwitch(
  current: { workspacePath: string | null; onboardedAt: string | null },
  target: string,
  targetHasProfile: boolean,
  now: () => string = () => new Date().toISOString()
): { workspacePath: string; onboardedAt: string | null } {
  if (sameFolder(current.workspacePath, target)) {
    return { workspacePath: target, onboardedAt: current.onboardedAt }
  }
  return {
    workspacePath: target,
    onboardedAt: targetHasProfile ? (current.onboardedAt ?? now()) : null
  }
}

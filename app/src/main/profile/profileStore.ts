import fs from 'node:fs'
import type { ProfileFile } from '@shared/profile'
import { PROFILE_FILE } from '../paths'

let cached: ProfileFile | null = null

export function profileExists(): boolean {
  return fs.existsSync(PROFILE_FILE)
}

export function loadProfile(): ProfileFile | null {
  if (cached) return cached
  try {
    if (!fs.existsSync(PROFILE_FILE)) return null
    cached = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf-8')) as ProfileFile
    return cached
  } catch (err) {
    console.error('[profile] load failed:', err)
    return null
  }
}

/** Atomic write (tmp + rename), matching Store.ts semantics. */
export function saveProfile(profile: ProfileFile): ProfileFile {
  profile.revision = (profile.revision ?? 0) + 1
  profile.updatedAt = new Date().toISOString()
  const tmp = PROFILE_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(profile, null, 2), 'utf-8')
  fs.renameSync(tmp, PROFILE_FILE)
  cached = profile
  return profile
}

/** Drop the cache (e.g. after a workspace switch). */
export function resetProfileCache(): void {
  cached = null
}

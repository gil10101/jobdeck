import { MASTER_DIR, UPLOADS_DIR } from '../paths'
import { loadProfile } from '../profile/profileStore'
import { assessBuildReadiness, readCandidateMaterial, type BuildMode } from './buildReadiness'

/** Build readiness of the live workspace (see assessBuildReadiness). */
export function workspaceBuildReadiness(): { mode: BuildMode; message: string | null } {
  const profile = loadProfile()
  return assessBuildReadiness(
    readCandidateMaterial({
      masterDir: MASTER_DIR,
      uploadsDir: UPLOADS_DIR,
      hasProfile: profile !== null,
      fileBasename: profile?.documents.fileBasename || null
    })
  )
}

/** Refuse a build before anything is created for it — a run, a tracker row,
 *  a candidate state — when there is nothing about the candidate to build on. */
export function assertCanBuild(): void {
  const { mode, message } = workspaceBuildReadiness()
  if (mode === 'blocked') throw new Error(message ?? 'nothing to build from')
}

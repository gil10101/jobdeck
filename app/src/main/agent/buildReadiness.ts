// What candidate material a workspace holds, and whether a build can run on
// it. Pure: every directory is passed in, there is no electron import, and
// relative imports carry .ts, so the selftests load it under node type
// stripping. The main process calls it with the live workspace paths.
import fs from 'node:fs'
import path from 'node:path'
import type { FolderEntry } from '@shared/types'
import { docxToText } from '../parsers/docx.ts'

/** Visible entries of `dir`, sorted by name. Each entry is stat'ed on its own,
 *  so one unreadable entry (a broken symlink) is skipped instead of emptying
 *  the whole listing. A missing directory lists as empty. */
export function listFolder(dir: string, exclude: string[] = []): FolderEntry[] {
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return []
  }
  const out: FolderEntry[] = []
  for (const name of names) {
    if (name.startsWith('.') || exclude.includes(name)) continue
    try {
      const stat = fs.statSync(path.join(dir, name))
      out.push({
        name,
        sizeKb: Math.max(1, Math.round(stat.size / 1024)),
        kind: stat.isDirectory() ? 'dir' : 'file'
      })
    } catch {
      /* unreadable entry: leave it out */
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** The ONLY filenames read as a master résumé from master/: the profile's own
 *  output stem, then the shipped starter template's name. Without a profile
 *  there is no stem, so only the starter name counts. */
export function masterResumeNames(fileBasename: string | null): string[] {
  return fileBasename ? [`${fileBasename}_Resume.tex`, 'main_example.tex'] : ['main_example.tex']
}

/** File name of the master résumé in `masterDir`, or null when there is none. */
export function resolveMasterResume(masterDir: string, fileBasename: string | null): string | null {
  for (const name of masterResumeNames(fileBasename)) {
    if (fs.existsSync(path.join(masterDir, name))) return name
  }
  return null
}

/** Path an agent can Read for `src`: the file itself, or for a .docx its text
 *  converted under `convertDir`. Null when a .docx cannot be converted. */
export function agentReadablePath(src: string, convertDir: string): string | null {
  if (path.extname(src).toLowerCase() !== '.docx') return src
  try {
    const text = docxToText(fs.readFileSync(src))
    fs.mkdirSync(convertDir, { recursive: true })
    const out = path.join(convertDir, `${path.basename(src)}.txt`)
    fs.writeFileSync(out, text, 'utf-8')
    return out
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error(`[material] could not convert ${path.basename(src)}: ${reason}`)
    return null
  }
}

/**
 * Absolute paths an agent can Read for the candidate's uploaded material.
 * A .docx is converted to text under `convertDir` (the Read tool cannot open
 * Word files); one that fails to convert is reported, not passed through.
 */
export function agentReadableUploads(
  uploadsDir: string,
  convertDir: string
): { files: string[]; skipped: string[] } {
  const files: string[] = []
  const skipped: string[] = []
  for (const entry of listFolder(uploadsDir)) {
    if (entry.kind !== 'file') continue
    const readable = agentReadablePath(path.join(uploadsDir, entry.name), convertDir)
    if (readable) files.push(readable)
    else skipped.push(entry.name)
  }
  return { files, skipped }
}

export interface CandidateMaterial {
  hasProfile: boolean
  uploads: number
  masterResume: string | null
  /** master/context.md has non-blank text. */
  hasContext: boolean
}

export function readCandidateMaterial(dirs: {
  masterDir: string
  uploadsDir: string
  hasProfile: boolean
  fileBasename: string | null
}): CandidateMaterial {
  let context = ''
  try {
    context = fs.readFileSync(path.join(dirs.masterDir, 'context.md'), 'utf-8')
  } catch {
    /* none yet */
  }
  return {
    hasProfile: dirs.hasProfile,
    uploads: listFolder(dirs.uploadsDir).filter((e) => e.kind === 'file').length,
    masterResume: resolveMasterResume(dirs.masterDir, dirs.fileBasename),
    hasContext: context.trim().length > 0
  }
}

export type BuildMode = 'profile' | 'minimal' | 'blocked'

export const NO_MATERIAL_MESSAGE =
  'Add your résumé first: upload it in Library (or Settings → Candidate profile), or write about yourself in Settings → Master résumé context.'

/**
 * A build needs facts about the candidate. A profile is the full-quality path;
 * without one, uploaded files, a master résumé or free-text context still give
 * the agent something true to tailor ("minimal"). The knowledge base alone
 * does not count: it is background-only and may never appear on a document.
 */
export function assessBuildReadiness(m: CandidateMaterial): { mode: BuildMode; message: string | null } {
  if (m.hasProfile) return { mode: 'profile', message: null }
  if (m.uploads > 0 || m.masterResume || m.hasContext) {
    return {
      mode: 'minimal',
      message: 'No profile yet: builds read your uploaded files and notes directly. Set up a profile for better tailoring.'
    }
  }
  return { mode: 'blocked', message: NO_MATERIAL_MESSAGE }
}

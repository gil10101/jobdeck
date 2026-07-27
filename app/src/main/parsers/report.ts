import fs from 'node:fs'
import path from 'node:path'
import type { CandidateJob, ReportJson, ScoutExcludedItem } from '@shared/types'

/** Tolerant parse: agents occasionally wrap JSON in ```json fences. */
export function parseReport(text: string): ReportJson | { error: string } {
  let t = text.trim()
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/)
  if (fence) t = fence[1].trim()
  try {
    const obj = JSON.parse(t) as ReportJson
    if (!obj || typeof obj !== 'object') return { error: 'report.json is not an object' }
    return obj
  } catch (err) {
    return { error: `report.json parse failed: ${String(err)}` }
  }
}

/** The scout prompt caps triage-drop entries at this many; enforce it on read too. */
export const SCOUT_EXCLUDED_CAP = 40

export interface CandidatesFile {
  candidates: Partial<CandidateJob>[]
  excluded: ScoutExcludedItem[]
  problems: string[]
}

/** Tolerant parse of a scout candidates file: fences stripped, arrays
 *  normalized, `excluded` entries coerced and capped (older files lack them). */
export function parseCandidatesFile(raw: string): CandidatesFile | { error: string } {
  let t = raw.trim()
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/)
  if (fence) t = fence[1].trim()
  let obj: { candidates?: unknown; excluded?: unknown; problems?: unknown }
  try {
    obj = JSON.parse(t) as typeof obj
  } catch (err) {
    return { error: `candidates file is not valid JSON: ${String(err)}` }
  }
  if (!obj || typeof obj !== 'object') return { error: 'candidates file is not an object' }
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  const excluded = (Array.isArray(obj.excluded) ? obj.excluded : [])
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .map((e) => ({ position: str(e.position), company: str(e.company), reason: str(e.reason) }))
    .filter((e) => e.position || e.company || e.reason)
    .slice(0, SCOUT_EXCLUDED_CAP)
  return {
    candidates: (Array.isArray(obj.candidates) ? obj.candidates : []) as Partial<CandidateJob>[],
    excluded,
    problems: (Array.isArray(obj.problems) ? obj.problems : []).filter(
      (p): p is string => typeof p === 'string' && !!p.trim()
    )
  }
}

/** Validate a build report against what's actually on disk. */
export function validateReport(
  r: ReportJson,
  folderAbs: string
): { ok: boolean; problems: string[] } {
  const problems: string[] = []
  if (!r.slug) problems.push('report missing slug')
  if (!r.position || !r.company) problems.push('report missing position/company')
  if (r.resumePages !== 1) problems.push(`resume is ${r.resumePages ?? '?'} pages (must be 1)`)
  if (r.coverLetter && r.coverLetterPages !== 1) {
    problems.push(`cover letter is ${r.coverLetterPages ?? '?'} pages (must be 1)`)
  }
  if (String(r.noEmDashes).toLowerCase() !== 'confirmed') {
    problems.push('noEmDashes not confirmed')
  }
  const files = r.files ?? {}
  for (const key of ['resumePdf', 'answers', 'posting'] as const) {
    const f = files[key]
    if (!f) {
      problems.push(`report.files missing ${key}`)
      continue
    }
    if (!fs.existsSync(path.join(folderAbs, f))) problems.push(`file missing on disk: ${f}`)
  }
  if (r.coverLetter) {
    const f = files.coverLetterPdf
    if (!f) problems.push('coverLetter=true but files.coverLetterPdf missing')
    else if (!fs.existsSync(path.join(folderAbs, f))) problems.push(`file missing on disk: ${f}`)
  }
  return { ok: problems.length === 0, problems }
}

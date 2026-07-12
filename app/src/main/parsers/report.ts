import fs from 'node:fs'
import path from 'node:path'
import type { ReportJson } from '@shared/types'

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

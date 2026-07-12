import fs from 'node:fs'
import path from 'node:path'
import type { ApplicationDetail, AppFileInfo, TrackerRow } from '@shared/types'
import { toAbs } from '../paths'
import { parseAnswers } from './answers'
import { parsePosting } from './posting'
import { parseReport } from './report'

const FILE_KINDS: { name: string; kind: AppFileInfo['kind'] }[] = [
  { name: 'Gil_Lu_Resume.pdf', kind: 'pdf' },
  { name: 'Gil_Lu_Cover_Letter.pdf', kind: 'pdf' },
  { name: 'Gil_Lu_Resume.tex', kind: 'tex' },
  { name: 'Gil_Lu_Cover_Letter.tex', kind: 'tex' },
  { name: 'application_answers.md', kind: 'md' },
  { name: 'job_posting.md', kind: 'md' },
  { name: 'message_to_hiring_team.md', kind: 'md' },
  { name: 'interview_prep.md', kind: 'md' },
  { name: 'report.json', kind: 'json' }
]

function readIfExists(abs: string): string | null {
  try {
    return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf-8') : null
  } catch {
    return null
  }
}

/** Assemble everything the Detail view needs for one tracker row. */
export function buildApplicationDetail(row: TrackerRow): ApplicationDetail {
  const detail: ApplicationDetail = {
    row,
    files: [],
    answers: null,
    posting: null,
    report: row.report,
    messageToHiringTeam: null,
    interviewPrep: null,
    rawAnswersMd: null,
    rawPostingMd: null
  }
  if (!row.folderPath) return detail

  const folderAbs = toAbs(row.folderPath)
  for (const f of FILE_KINDS) {
    const abs = path.join(folderAbs, f.name)
    detail.files.push({
      name: f.name,
      relPath: `${row.folderPath}/${f.name}`,
      exists: fs.existsSync(abs),
      kind: f.kind
    })
  }

  const answersRaw = readIfExists(path.join(folderAbs, 'application_answers.md'))
  if (answersRaw !== null) {
    detail.rawAnswersMd = answersRaw
    try {
      detail.answers = parseAnswers(answersRaw)
    } catch {
      detail.answers = null // UI falls back to raw markdown
    }
  }

  const postingRaw = readIfExists(path.join(folderAbs, 'job_posting.md'))
  if (postingRaw !== null) {
    detail.rawPostingMd = postingRaw
    try {
      detail.posting = parsePosting(postingRaw)
    } catch {
      detail.posting = null
    }
  }

  detail.messageToHiringTeam = readIfExists(path.join(folderAbs, 'message_to_hiring_team.md'))
  detail.interviewPrep = readIfExists(path.join(folderAbs, 'interview_prep.md'))

  if (!detail.report) {
    const reportRaw = readIfExists(path.join(folderAbs, 'report.json'))
    if (reportRaw) {
      const parsed = parseReport(reportRaw)
      if (!('error' in parsed)) detail.report = parsed
    }
  }

  return detail
}

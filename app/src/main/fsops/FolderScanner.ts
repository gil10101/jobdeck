import fs from 'node:fs'
import path from 'node:path'
import { APPLICATIONS_DIR, DONE_PREFIX_RE, stripDonePrefix, toRel } from '../paths'
import { parsePosting } from '../parsers/posting'
import { parseAnswers } from '../parsers/answers'

export interface FolderFacts {
  slug: string
  /** repo-relative path of the CURRENT on-disk folder (may include "[DONE] "). */
  folderRel: string
  doneOnDisk: boolean
  files: {
    /** Real on-disk filename of the doc matching this suffix, or null when absent. */
    resumePdf: string | null
    resumeTex: string | null
    coverPdf: string | null
    coverTex: string | null
    answers: boolean
    posting: boolean
    report: boolean
    message: boolean
  }
  positionGuess: string | null
  companyGuess: string | null
  salaryGuess: string | null
  applyUrlGuess: string | null
}

const KNOWN_FILES = {
  answers: 'application_answers.md',
  posting: 'job_posting.md',
  report: 'report.json',
  message: 'message_to_hiring_team.md'
} as const

/** First filename in `names` ending with `suffix` (case-sensitive), or null. */
function findBySuffix(names: string[], suffix: string): string | null {
  return names.find((n) => n.endsWith(suffix)) ?? null
}

/** Scan the workspace applications/* folders and return per-folder facts. */
export function scanApplications(): FolderFacts[] {
  const facts: FolderFacts[] = []
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(APPLICATIONS_DIR, { withFileTypes: true })
  } catch {
    return facts
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name === 'TODO') continue
    const abs = path.join(APPLICATIONS_DIR, entry.name)
    const slug = stripDonePrefix(entry.name)
    const doneOnDisk = DONE_PREFIX_RE.test(entry.name)

    const has = (name: string): boolean => fs.existsSync(path.join(abs, name))
    let dirNames: string[] = []
    try {
      dirNames = fs.readdirSync(abs)
    } catch {
      /* unreadable folder; résumé/cover fields resolve to null below */
    }
    const files = {
      resumePdf: findBySuffix(dirNames, '_Resume.pdf'),
      resumeTex: findBySuffix(dirNames, '_Resume.tex'),
      coverPdf: findBySuffix(dirNames, '_Cover_Letter.pdf'),
      coverTex: findBySuffix(dirNames, '_Cover_Letter.tex'),
      answers: has(KNOWN_FILES.answers),
      posting: has(KNOWN_FILES.posting),
      report: has(KNOWN_FILES.report),
      message: has(KNOWN_FILES.message)
    }

    let positionGuess: string | null = null
    let companyGuess: string | null = null
    let salaryGuess: string | null = null
    let applyUrlGuess: string | null = null

    // Prefer the posting metadata; fall back to answers title.
    if (files.posting) {
      try {
        const doc = parsePosting(fs.readFileSync(path.join(abs, KNOWN_FILES.posting), 'utf-8'))
        // Title convention: "<Role> — <Company>" (separator varies)
        const m = doc.title.match(/^(.+?)\s+[-—–]\s+(.+)$/)
        if (m) {
          positionGuess = m[1].trim()
          companyGuess = m[2].trim()
        } else if (doc.title) {
          positionGuess = doc.title
        }
        salaryGuess = doc.salary
        applyUrlGuess = doc.applyUrl
      } catch {
        /* ignore parse issues */
      }
    }
    if ((!positionGuess || !companyGuess) && files.answers) {
      try {
        const doc = parseAnswers(fs.readFileSync(path.join(abs, KNOWN_FILES.answers), 'utf-8'))
        companyGuess = companyGuess ?? doc.title.company
        positionGuess = positionGuess ?? doc.title.role
      } catch {
        /* ignore */
      }
    }

    facts.push({
      slug,
      folderRel: toRel(abs),
      doneOnDisk,
      files,
      positionGuess,
      companyGuess,
      salaryGuess,
      applyUrlGuess
    })
  }
  return facts
}

/** Newest folder containing the full document set — used as the agent's example. */
export function pickExampleFolder(): string | null {
  let best: { rel: string; mtime: number } | null = null
  for (const f of scanApplications()) {
    if (f.files.resumeTex && f.files.resumePdf && f.files.coverTex && f.files.coverPdf && f.files.answers && f.files.posting) {
      try {
        const abs = path.join(APPLICATIONS_DIR, path.basename(f.folderRel))
        const mtime = fs.statSync(abs).mtimeMs
        if (!best || mtime > best.mtime) best = { rel: f.folderRel, mtime }
      } catch {
        /* ignore */
      }
    }
  }
  return best?.rel ?? null
}

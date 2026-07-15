// Best-effort splitter for raw posting text → structured sections.
// Used as a fallback for candidates scraped before the scout extracted
// structured fields itself.
import type { CandidateJob } from '@shared/types'

export interface PostingSections {
  skills: string[]
  minimum: string[]
  preferred: string[]
  education: string[]
  responsibilities: string[]
  benefits: string[]
}

type Bucket = keyof PostingSections

const HEADING_RULES: { bucket: Bucket; re: RegExp }[] = [
  { bucket: 'minimum', re: /^(minimum|basic|required)\s+(qualification|requirement)/i },
  { bucket: 'minimum', re: /^(requirements?|qualifications?|what you(?:'|w)?ll need|must have)\b/i },
  {
    bucket: 'preferred',
    re: /^(preferred|desirable|nice[- ]to[- ]have|bonus|plusses|a plus|ideal(?:ly)?)/i
  },
  { bucket: 'skills', re: /^(skills?|technical skills|technologies|tech stack|tools)\b/i },
  { bucket: 'education', re: /^(education|degree)\b/i },
  {
    bucket: 'responsibilities',
    re: /^(responsibilit|duties|what you(?:'|w)?ll do|the role|day[- ]to[- ]day|key tasks)/i
  },
  { bucket: 'benefits', re: /^(benefits?|perks|compensation|what we offer|why join)/i }
]

function headingBucket(line: string): Bucket | null {
  const t = line.replace(/^[#*\s-]+/, '').replace(/[:*]+\s*$/, '').trim()
  if (!t || t.length > 60) return null
  for (const rule of HEADING_RULES) {
    if (rule.re.test(t)) return rule.bucket
  }
  return null
}

const BULLET_RE = /^\s*[-*•·–▪]\s+/

export function parsePostingSections(text: string): PostingSections {
  const out: PostingSections = {
    skills: [],
    minimum: [],
    preferred: [],
    education: [],
    responsibilities: [],
    benefits: []
  }
  let current: Bucket | null = null
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const bucket = headingBucket(line)
    if (bucket) {
      current = bucket
      continue
    }
    if (!current) continue
    const item = line.replace(BULLET_RE, '').trim()
    if (!item) continue
    // A long non-bullet paragraph likely means we've left the section.
    if (!BULLET_RE.test(rawLine) && item.length > 220) {
      current = null
      continue
    }
    if (out[current].length < 20) out[current].push(item)
  }

  // Inline fallbacks for one-paragraph summaries (jobright style):
  // "Skills: Excel, Tableau, SQL. Seniority: Entry Level. ..."
  if (out.skills.length === 0) {
    const m = text.match(/\bSkills?:\s*([^.\n]+)/i)
    if (m) {
      out.skills = m[1]
        .split(/,|;|·/)
        .map((s) => s.trim())
        .filter((s) => s && s.length < 50)
        .slice(0, 20)
    }
  }
  if (out.minimum.length === 0) {
    const m = text.match(/\b(?:Requirements?|Qualifications?):\s*([^\n]+)/i)
    if (m) {
      out.minimum = m[1]
        .split(/(?<=[a-z0-9)])\.\s+|;/)
        .map((s) => s.trim().replace(/\.$/, ''))
        .filter((s) => s.length > 8)
        .slice(0, 12)
    }
  }
  if (out.education.length === 0) {
    const sentences = text.match(
      /[^.\n]*\b(bachelor'?s?|master'?s?|b\.?s\.?|m\.?s\.?|associate'?s?|ph\.?d|degree in)\b[^.\n]*/gi
    )
    if (sentences) {
      out.education = [...new Set(sentences.map((s) => s.trim()))]
        .filter((s) => s.length > 15 && s.length < 200)
        .slice(0, 3)
    }
  }
  return out
}

/** Leading prose of a posting — everything before the first recognized section
 *  heading — for an "About the role" blurb. Capped; '' when nothing usable. */
export function leadingProse(text: string, maxChars = 600): string {
  const lines: string[] = []
  for (const rawLine of (text || '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) {
      if (lines.length) lines.push('')
      continue
    }
    if (headingBucket(line)) break
    lines.push(line)
    if (lines.join(' ').length > maxChars) break
  }
  const prose = lines.join('\n').replace(/\n{2,}/g, '\n\n').trim()
  if (prose.length <= maxChars) return prose
  return `${prose.slice(0, maxChars).replace(/\s+\S*$/, '')}…`
}

/** Prefer the scout's structured extraction; fall back to text parsing. */
export function candidateSections(c: CandidateJob): PostingSections {
  const has = (v: string[] | null | undefined): v is string[] => Array.isArray(v) && v.length > 0
  const structured: PostingSections = {
    skills: has(c.skills) ? c.skills : [],
    minimum: has(c.minimumQualifications) ? c.minimumQualifications : [],
    preferred: has(c.preferredQualifications) ? c.preferredQualifications : [],
    education: has(c.education) ? c.education : [],
    responsibilities: has(c.responsibilities) ? c.responsibilities : [],
    benefits: has(c.benefits) ? c.benefits : []
  }
  const anyStructured = Object.values(structured).some((arr) => arr.length > 0)
  if (anyStructured) return structured
  return parsePostingSections(c.postingText || '')
}

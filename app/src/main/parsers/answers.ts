import type { AnswersDoc, AnswersField } from '@shared/types'

/** Strip markdown emphasis/backticks from a table value. */
function cleanValue(v: string): string {
  return v
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^\s*_(.*)_\s*$/, '$1')
    .trim()
}

/**
 * Parse application_answers.md.
 * Structure (observed across all real folders):
 *   # Application Answers — <Company>, <Role>     (separator varies: -, —, :)
 *   **Apply at:** ...
 *   ## Copy-paste fields   → 2-col GitHub pipe table (variable rows)
 *   ## <other sections>    → free markdown
 *   _Status: ..._          (trailing italic line)
 */
export function parseAnswers(md: string): AnswersDoc {
  const lines = md.split(/\r?\n/)

  // Title
  let rawTitle = ''
  let company: string | null = null
  let role: string | null = null
  for (const line of lines) {
    const h1 = line.match(/^#\s+(.*)$/)
    if (h1) {
      rawTitle = h1[1].trim()
      const m = rawTitle.match(/^Application Answers\s*[-—–:]\s*(.+)$/i)
      if (m) {
        const rest = m[1]
        const comma = rest.indexOf(', ')
        if (comma > 0) {
          company = rest.slice(0, comma).trim()
          role = rest.slice(comma + 2).trim()
        } else {
          company = rest.trim()
        }
      }
      break
    }
  }

  // Apply line
  const applyMatch = md.match(/^\*\*Apply (?:at|via)[^:]*:\*\*\s*(.+)$/im)
  const applyLine = applyMatch ? cleanValue(applyMatch[1]) : null

  // Status line
  const statusMatch = md.match(/^_Status:\s*(.*?)_\s*$/im)
  const statusLine = statusMatch ? statusMatch[1].trim() : null

  // Split into ## sections
  const sections: { heading: string; body: string }[] = []
  let current: { heading: string; body: string[] } | null = null
  for (const line of lines) {
    const h2 = line.match(/^##\s+(.*)$/)
    if (h2) {
      if (current) sections.push({ heading: current.heading, body: current.body.join('\n').trim() })
      current = { heading: h2[1].trim(), body: [] }
    } else if (current) {
      current.body.push(line)
    }
  }
  if (current) sections.push({ heading: current.heading, body: current.body.join('\n').trim() })

  // Copy-paste fields table
  const fields: AnswersField[] = []
  const fieldsSection = sections.find((s) => /copy-?paste fields/i.test(s.heading))
  if (fieldsSection) {
    for (const line of fieldsSection.body.split('\n')) {
      const t = line.trim()
      if (!t.startsWith('|')) continue
      if (/^\|\s*:?-{2,}/.test(t)) continue // separator row
      const cells = t
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((c) => c.trim())
      if (cells.length < 2) continue
      const label = cleanValue(cells[0])
      const value = cleanValue(cells.slice(1).join(' | '))
      if (!label || /^field$/i.test(label)) continue // header row
      fields.push({ label, value })
    }
  }

  // Remaining sections: strip the fields table + blockquote markers
  const otherSections = sections
    .filter((s) => !/copy-?paste fields/i.test(s.heading))
    .map((s) => ({
      heading: s.heading,
      body: s.body
        .split('\n')
        .map((l) => l.replace(/^>\s?/, ''))
        .join('\n')
        .replace(/^-{3,}\s*$/gm, '')
        .trim()
    }))
    .filter((s) => s.body.length > 0)

  return {
    title: { raw: rawTitle, company, role },
    applyLine,
    fields,
    sections: otherSections,
    statusLine
  }
}

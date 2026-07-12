import type { PostingDoc } from '@shared/types'

function clean(v: string): string {
  return v
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .trim()
}

/**
 * Parse job_posting.md: H1 title, a leading bold-label bullet metadata block,
 * then ## sections whose headings vary — classified fuzzily.
 */
export function parsePosting(md: string): PostingDoc {
  const lines = md.split(/\r?\n/)

  let title = ''
  const meta: { label: string; value: string }[] = []
  const sections: { heading: string; body: string }[] = []
  let current: { heading: string; body: string[] } | null = null
  let seenSection = false

  for (const line of lines) {
    const h1 = line.match(/^#\s+(.*)$/)
    if (h1 && !title) {
      title = clean(h1[1])
      continue
    }
    const h2 = line.match(/^##+\s+(.*)$/)
    if (h2) {
      if (current) sections.push({ heading: current.heading, body: current.body.join('\n').trim() })
      current = { heading: clean(h2[1]), body: [] }
      seenSection = true
      continue
    }
    if (!seenSection) {
      // metadata bullets: "- **Label:** value"
      const m = line.match(/^\s*[-*]\s+\*\*([^:*]+):?\*\*:?\s*(.*)$/)
      if (m) {
        meta.push({ label: clean(m[1]), value: clean(m[2]) })
        continue
      }
    }
    if (current) current.body.push(line)
  }
  if (current) sections.push({ heading: current.heading, body: current.body.join('\n').trim() })

  // Fit note: dedicated section else meta
  const fitSection = sections.find((s) => /^(honest\s+)?fit note/i.test(s.heading))
  const fitNote = fitSection ? fitSection.body : null

  // Salary: meta label else first $ pattern anywhere
  const salaryMeta = meta.find((m) => /salary|compensation|pay/i.test(m.label))
  let salary: string | null = salaryMeta ? salaryMeta.value : null
  if (!salary) {
    const m = md.match(/\$[\d,]+(?:\.\d+)?(?:\s*[-–]\s*\$?[\d,]+(?:\.\d+)?)?(?:\s*(?:\/|per\s+)\s*\w+)?/)
    salary = m ? m[0] : null
  }

  // Apply URL: meta label else first URL in the doc
  const applyMeta = meta.find((m) => /source|apply|link/i.test(m.label))
  let applyUrl: string | null = null
  const urlIn = (s: string): string | null => {
    const m = s.match(/https?:\/\/[^\s)>\]]+/)
    return m ? m[0] : null
  }
  if (applyMeta) applyUrl = urlIn(applyMeta.value)
  if (!applyUrl) applyUrl = urlIn(md)

  return { title, meta, sections, fitNote, salary, applyUrl }
}

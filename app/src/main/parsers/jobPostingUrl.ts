// Fetch a public job-posting page and extract its schema.org JobPosting
// JSON-LD. Job boards embed this markup for search engines (jobright,
// LinkedIn, Greenhouse, Lever, …), so a bare URL is enough to capture the
// full structured posting — no credentials, no fragile HTML scraping.

interface ExtractedPosting {
  role: string
  company: string
  text: string
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export async function fetchPostingFromUrl(rawUrl: string): Promise<ExtractedPosting> {
  let url: URL
  try {
    url = new URL(rawUrl.trim())
  } catch {
    throw new Error('that is not a valid URL')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('only http(s) URLs are supported')
  }
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000)
  })
  if (!res.ok) throw new Error(`page fetch failed: HTTP ${res.status}`)
  const html = await res.text()
  const posting = extractJobPosting(html, url.toString())
  if (!posting) {
    throw new Error(
      'no JobPosting data found on that page — it may need a login, or the site does not embed structured data; paste the posting text instead'
    )
  }
  return posting
}

/** Scan every JSON-LD block for a JobPosting node (top-level, array, or @graph). */
export function extractJobPosting(html: string, sourceUrl: string): ExtractedPosting | null {
  const blocks = html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )
  for (const m of blocks) {
    let parsed: unknown
    try {
      parsed = JSON.parse(m[1].trim())
    } catch {
      continue
    }
    const nodes: unknown[] = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { '@graph'?: unknown[] })['@graph'])
        ? ((parsed as { '@graph': unknown[] })['@graph'])
        : [parsed]
    for (const node of nodes) {
      if (isJobPosting(node)) return normalize(node as Record<string, unknown>, sourceUrl)
    }
  }
  return null
}

function isJobPosting(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false
  const t = (node as Record<string, unknown>)['@type']
  return t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'))
}

function normalize(job: Record<string, unknown>, sourceUrl: string): ExtractedPosting {
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  const role = str(job.title) || '(untitled role)'
  const org = job.hiringOrganization as Record<string, unknown> | undefined
  const company = str(org?.name)

  const lines: string[] = [role]
  if (company) lines.push(`Company: ${company}`)
  const location = formatLocation(job.jobLocation)
  if (location) lines.push(`Location: ${location}`)
  if (str(job.employmentType)) lines.push(`Employment type: ${str(job.employmentType)}`)
  const salary = formatSalary(job.baseSalary)
  if (salary) lines.push(`Salary: ${salary}`)
  if (str(job.datePosted)) lines.push(`Posted: ${str(job.datePosted)}`)
  if (str(job.validThrough)) lines.push(`Apply by: ${str(job.validThrough)}`)
  lines.push(`Source: ${sourceUrl}`, '', htmlToText(str(job.description)))

  return { role, company, text: lines.join('\n').trim() }
}

function formatLocation(loc: unknown): string {
  const first = Array.isArray(loc) ? loc[0] : loc
  if (!first || typeof first !== 'object') return typeof first === 'string' ? first : ''
  const addr = (first as Record<string, unknown>).address
  if (!addr || typeof addr !== 'object') return ''
  const a = addr as Record<string, unknown>
  return [a.streetAddress, a.addressLocality, a.addressRegion, a.addressCountry]
    .filter((p): p is string => typeof p === 'string' && !!p.trim())
    .join(', ')
}

function formatSalary(sal: unknown): string {
  if (!sal || typeof sal !== 'object') return ''
  const s = sal as Record<string, unknown>
  const currency = typeof s.currency === 'string' ? s.currency : ''
  const value = s.value
  if (!value || typeof value !== 'object') return ''
  const v = value as Record<string, unknown>
  const min = typeof v.minValue === 'number' ? v.minValue : null
  const max = typeof v.maxValue === 'number' ? v.maxValue : null
  const unit = typeof v.unitText === 'string' ? v.unitText.toLowerCase() : ''
  if (min === null && max === null) return ''
  const range = min !== null && max !== null && min !== max ? `${min}-${max}` : String(max ?? min)
  return [currency, range, unit ? `per ${unit}` : ''].filter(Boolean).join(' ')
}

/** JSON-LD descriptions are HTML; flatten to readable plain text. */
function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

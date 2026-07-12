// exceljs cell values are polymorphic; normalize them to plain strings/dates.
// Observed shapes in the real applications.xlsx: string, Date, number,
// { text, hyperlink }, { formula, result }, { richText: [{text}...] }, null.

type ExcelCellValue = unknown

export function cellToString(v: ExcelCellValue): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return toISODate(v)
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o.text === 'string') return o.text.trim() // hyperlink cell → visible text
    if (Array.isArray(o.richText)) {
      return (o.richText as { text?: string }[]).map((r) => r.text ?? '').join('').trim()
    }
    if ('result' in o) return cellToString(o.result) // formula cell
    if ('hyperlink' in o && typeof o.hyperlink === 'string') return o.hyperlink
  }
  return String(v).trim()
}

/** For link columns: prefer the hyperlink target over the display text. */
export function cellToLink(v: ExcelCellValue): string {
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o.hyperlink === 'string' && /^https?:/i.test(o.hyperlink)) return o.hyperlink
    if (typeof o.text === 'string') return o.text.trim()
  }
  return cellToString(v)
}

/** For path columns (resume/cover): prefer display text (repo-relative path) over file:// hyperlink. */
export function cellToPathText(v: ExcelCellValue): string {
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o.text === 'string') return o.text.trim()
  }
  return cellToString(v)
}

/** Date-ish cell → 'YYYY-MM-DD' when possible, else raw string, else null. */
export function cellToDateString(v: ExcelCellValue): string | null {
  if (v === null || v === undefined || v === '') return null
  if (v instanceof Date) return toISODate(v)
  const s = cellToString(v)
  if (!s) return null
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  return s // keep raw text (e.g. "posted 3 days ago")
}

function toISODate(d: Date): string {
  // exceljs dates come in as UTC; use UTC getters to avoid off-by-one-day.
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${d.getUTCFullYear()}-${mm}-${dd}`
}

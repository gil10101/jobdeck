import ExcelJS from 'exceljs'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { EXPORTS_DIR, toAbs } from '../paths'
import type { Store } from '../store/Store'

const COLUMNS = [
  { header: 'Position', key: 'position', width: 34 },
  { header: 'Company', key: 'company', width: 26 },
  { header: 'Salary', key: 'salary', width: 20 },
  { header: 'Location', key: 'location', width: 24 },
  { header: 'Date Posted', key: 'datePosted', width: 13 },
  { header: 'Job App Link', key: 'applyUrl', width: 40 },
  { header: 'Date Applied', key: 'dateApplied', width: 13 },
  { header: 'Cover Letter (Y/N)', key: 'coverLetter', width: 10 },
  { header: 'Cover Letter Link', key: 'coverLetterPath', width: 44 },
  { header: 'Resume Link', key: 'resumePath', width: 44 },
  { header: 'Status', key: 'statusText', width: 34 }
]

// Classic Excel CF palette (matches the old applications.xlsx scheme).
const FILL = {
  red: { bg: 'FFFFC7CE', font: 'FF9C0006' },
  yellow: { bg: 'FFFFEB9C', font: 'FF9C6500' },
  green: { bg: 'FFC6EFCE', font: 'FF006100' },
  blue: { bg: 'FFBDD7EE', font: 'FF1F4E79' }
} as const

function cfStyle(c: { bg: string; font: string }): Partial<ExcelJS.Style> {
  return {
    fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: c.bg } },
    font: { color: { argb: c.font } }
  }
}

/** Export the tracker to a NEW timestamped xlsx (never touches the live applications.xlsx). */
export async function exportToXlsx(store: Store): Promise<{ path: string }> {
  fs.mkdirSync(EXPORTS_DIR, { recursive: true })
  const stamp = new Date()
  const name = `applications_${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, '0')}-${String(
    stamp.getDate()
  ).padStart(2, '0')}_${String(stamp.getHours()).padStart(2, '0')}${String(stamp.getMinutes()).padStart(2, '0')}.xlsx`
  const outPath = path.join(EXPORTS_DIR, name)

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Applications')
  ws.columns = COLUMNS as Partial<ExcelJS.Column>[]
  ws.getRow(1).font = { bold: true }

  for (const r of store.state.rows) {
    const row = ws.addRow({
      position: r.position,
      company: r.company,
      salary: r.salary,
      location: r.location,
      datePosted: r.datePosted ?? '',
      applyUrl: r.applyUrl,
      dateApplied: r.dateApplied ?? '',
      coverLetter: r.coverLetter ? 'Y' : 'N',
      coverLetterPath: r.coverLetterPath ?? '',
      resumePath: r.resumePath ?? '',
      statusText: r.statusText
    })
    row.alignment = { vertical: 'top', wrapText: true }
    // Hyperlinks: apply URL + file links.
    if (r.applyUrl && /^https?:/i.test(r.applyUrl)) {
      row.getCell(6).value = { text: r.applyUrl, hyperlink: r.applyUrl }
      row.getCell(6).font = { color: { argb: 'FF0563C1' }, underline: true }
    }
    for (const [col, rel] of [
      [9, r.coverLetterPath],
      [10, r.resumePath]
    ] as const) {
      if (rel) {
        try {
          row.getCell(col).value = { text: rel, hyperlink: pathToFileURL(toAbs(rel)).toString() }
          row.getCell(col).font = { color: { argb: 'FF0563C1' }, underline: true }
        } catch {
          /* keep plain text */
        }
      }
    }
    row.getCell(11).font = { bold: true }
  }

  // Conditional formatting — priority order with stopIfTrue, "not yet" BEFORE the applied family.
  const rules: { text: string; color: keyof typeof FILL }[] = [
    { text: 'reject', color: 'red' },
    { text: 'no offer', color: 'red' },
    { text: 'declin', color: 'red' },
    { text: 'withdraw', color: 'red' },
    { text: 'interview', color: 'blue' },
    { text: 'in process', color: 'blue' },
    { text: 'screen', color: 'blue' },
    { text: 'assessment', color: 'blue' },
    { text: 'offer', color: 'blue' },
    { text: 'not yet', color: 'yellow' },
    { text: 'cv ready', color: 'yellow' },
    { text: 'applied', color: 'green' },
    { text: 'submitted', color: 'green' }
  ]
  ws.addConditionalFormatting({
    ref: 'K2:K1000',
    rules: [
      ...rules.map((r, i) => ({
        type: 'containsText' as const,
        operator: 'containsText' as const,
        text: r.text,
        priority: i + 1,
        stopIfTrue: true,
        style: cfStyle(FILL[r.color])
      })),
      // Anything else non-empty → yellow.
      {
        type: 'expression' as const,
        priority: rules.length + 1,
        formulae: ['LEN(K2)>0'],
        style: cfStyle(FILL.yellow)
      }
    ]
  })

  await wb.xlsx.writeFile(outPath)
  return { path: outPath }
}

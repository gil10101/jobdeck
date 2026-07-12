import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { PDFLATEX, toAbs } from '../paths'

const execFileAsync = promisify(execFile)

const DOC_FILES = {
  resume: 'Gil_Lu_Resume.tex',
  cover: 'Gil_Lu_Cover_Letter.tex'
} as const

/** Compile a document twice (hyperref), report page count, clean aux files. */
export async function recompileDoc(
  folderRel: string,
  doc: keyof typeof DOC_FILES
): Promise<{ pages: number | null; logTail: string }> {
  const folderAbs = toAbs(folderRel)
  const texName = DOC_FILES[doc]
  const texAbs = path.join(folderAbs, texName)
  if (!fs.existsSync(PDFLATEX)) throw new Error(`pdflatex not found at ${PDFLATEX}`)
  if (!fs.existsSync(texAbs)) {
    // Fall back to any single .tex matching the doc type loosely (renamed templates).
    throw new Error(`${texName} not found in ${folderRel}`)
  }

  let stdout = ''
  for (let i = 0; i < 2; i++) {
    try {
      const res = await execFileAsync(PDFLATEX, ['-interaction=nonstopmode', texName], {
        cwd: folderAbs,
        timeout: 90_000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true
      })
      stdout = res.stdout ?? ''
    } catch (err) {
      // pdflatex exits non-zero on warnings too; keep its output for diagnosis.
      const e = err as { stdout?: string; message?: string }
      stdout = e.stdout ?? e.message ?? String(err)
    }
  }

  const pageMatch = stdout.match(/Output written on .*\((\d+) pages?/)
  const pages = pageMatch ? parseInt(pageMatch[1], 10) : null

  const base = texName.replace(/\.tex$/, '')
  for (const ext of ['.aux', '.log', '.out']) {
    try {
      fs.unlinkSync(path.join(folderAbs, base + ext))
    } catch {
      /* ignore */
    }
  }

  return { pages, logTail: stdout.slice(-1500) }
}

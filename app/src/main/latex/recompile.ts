import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { resolveLatex, toAbs } from '../paths'

const execFileAsync = promisify(execFile)

const DOC_SUFFIXES = {
  resume: '_Resume.tex',
  cover: '_Cover_Letter.tex'
} as const

/** Compile a document twice (hyperref), report page count, clean aux files. */
export async function recompileDoc(
  folderRel: string,
  doc: keyof typeof DOC_SUFFIXES
): Promise<{ pages: number | null; logTail: string }> {
  const folderAbs = toAbs(folderRel)
  const suffix = DOC_SUFFIXES[doc]
  const eng = resolveLatex()
  if (!eng) throw new Error('no LaTeX engine found — install pdflatex or tectonic')

  // The build agent writes `<profile.documents.fileBasename>_Resume.tex` etc.,
  // so resolve the real on-disk name by suffix instead of a fixed filename.
  let dirNames: string[] = []
  try {
    dirNames = fs.readdirSync(folderAbs)
  } catch {
    /* folder missing; dirNames stays empty, falls through to the not-found error */
  }
  const texName = dirNames.find((n) => n.endsWith(suffix))
  if (!texName) {
    throw new Error(`no file ending in ${suffix} found in ${folderRel}`)
  }

  // tectonic auto-runs enough passes in one invocation and takes no
  // -interaction flag; the pdflatex family needs two passes for hyperref.
  const passes = eng.kind === 'tectonic' ? 1 : 2
  const args = eng.kind === 'tectonic' ? [texName] : ['-interaction=nonstopmode', texName]
  let stdout = ''
  for (let i = 0; i < passes; i++) {
    try {
      const res = await execFileAsync(eng.path, args, {
        cwd: folderAbs,
        timeout: 90_000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true
      })
      stdout = (res.stdout ?? '') + (res.stderr ?? '')
    } catch (err) {
      // pdflatex/tectonic exit non-zero on warnings too; keep output for diagnosis.
      const e = err as { stdout?: string; stderr?: string; message?: string }
      stdout = (e.stdout ?? '') + (e.stderr ?? '') || e.message || String(err)
    }
  }

  // pdflatex: "Output written on X.pdf (1 page, …)". tectonic is terser, so
  // fall back to any "(N page[s]" the log contains.
  const pageMatch =
    stdout.match(/Output written on .*?\((\d+) pages?/) ?? stdout.match(/\((\d+) pages?[,)]/)
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

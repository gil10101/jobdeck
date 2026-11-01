// Selftest for candidate-material handling: renderer-name containment, .docx
// text extraction, folder listings that survive bad entries, master résumé
// resolution, and the Library's category split.
// Runs under plain node type stripping: `node scripts/material-selftest.ts`
// from app/.
import fs from 'node:fs'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { check, checkThrows, finish, tmpDir } from './lib/harness.ts'

const { safeChildPath } = await import('../src/main/fsops/safePath.ts')
const { docxToText } = await import('../src/main/parsers/docx.ts')
const {
  agentReadablePath,
  agentReadableUploads,
  listFolder,
  masterResumeNames,
  resolveMasterResume
} = await import('../src/main/agent/buildReadiness.ts')
const paths = await import('../src/main/paths.ts')
const { listLibrary } = await import('../src/main/fsops/library.ts')

/** A minimal but real .docx: a zip with word/document.xml. */
function makeDocx(paragraphs: string[]): Buffer {
  const body = paragraphs
    .map((p) => `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`)
    .join('')
  const xml = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`
  const zip = new AdmZip()
  zip.addFile('[Content_Types].xml', Buffer.from('<Types/>'))
  zip.addFile('word/document.xml', Buffer.from(xml))
  return zip.toBuffer()
}

const root = tmpDir('material-selftest')

// ---- safeChildPath ----

check('plain name resolves inside the dir', safeChildPath('/ws/uploads', 'cv.pdf'), path.join('/ws/uploads', 'cv.pdf'))
checkThrows('parent hop refused', () => safeChildPath('/ws/uploads', '../profile.json'), 'invalid file name')
checkThrows('nested path refused', () => safeChildPath('/ws/uploads', 'a/b.pdf'), 'invalid file name')
checkThrows('backslash refused', () => safeChildPath('/ws/uploads', 'a\\b.pdf'), 'invalid file name')
checkThrows('absolute refused', () => safeChildPath('/ws/uploads', '/etc/passwd'), 'invalid file name')
checkThrows('drive refused', () => safeChildPath('/ws/uploads', 'C:evil'), 'invalid file name')
checkThrows('dotfile refused', () => safeChildPath('/ws/uploads', '.env'), 'invalid file name')
checkThrows('empty refused', () => safeChildPath('/ws/uploads', ''), 'invalid file name')

// ---- docxToText ----

check(
  'paragraphs become lines, entities decode',
  docxToText(makeDocx(['Alex Example', 'Data Analyst &amp; Engineer', 'alex@example.com'])),
  'Alex Example\nData Analyst & Engineer\nalex@example.com'
)
checkThrows('a non-Word zip is refused', () => {
  const zip = new AdmZip()
  zip.addFile('hello.txt', Buffer.from('hi'))
  docxToText(zip.toBuffer())
}, 'not a Word document')

// ---- listFolder ----

const kb = path.join(root, 'knowledge')
fs.mkdirSync(path.join(kb, 'course-notes'), { recursive: true })
fs.writeFileSync(path.join(kb, 'notes.md'), 'n')
fs.writeFileSync(path.join(kb, 'cert.pdf'), Buffer.alloc(3000))
fs.writeFileSync(path.join(kb, '.hidden'), 'x')
let symlinked = true
try {
  fs.symlinkSync(path.join(kb, 'does-not-exist'), path.join(kb, 'broken-link'))
} catch {
  symlinked = false // symlinks need privileges on some Windows hosts
}
const listed = listFolder(kb, ['notes.md'])
check(
  'listing skips dotfiles, excluded names and broken entries; tags folders',
  listed.map((e) => `${e.name}:${e.kind}`),
  ['cert.pdf:file', 'course-notes:dir']
)
check('broken symlink was actually exercised', symlinked || process.platform === 'win32', true)
check('missing directory lists as empty', listFolder(path.join(root, 'nope')), [])

// ---- uploads handed to agents ----

const uploads = path.join(root, 'uploads')
const convert = path.join(root, 'tmp', 'sources')
fs.mkdirSync(uploads)
fs.writeFileSync(path.join(uploads, 'resume.pdf'), 'pdf')
fs.writeFileSync(path.join(uploads, 'resume.docx'), makeDocx(['Alex Example', 'SQL, Python']))
fs.writeFileSync(path.join(uploads, 'broken.docx'), 'not a zip')
fs.mkdirSync(path.join(uploads, 'a-folder'))

const readable = agentReadableUploads(uploads, convert)
check(
  'pdf passes through, docx becomes text, folders skipped',
  readable.files.map((f) => path.relative(root, f).split(path.sep).join('/')).sort(),
  ['tmp/sources/resume.docx.txt', 'uploads/resume.pdf']
)
check('converted text content', fs.readFileSync(path.join(convert, 'resume.docx.txt'), 'utf-8'), 'Alex Example\nSQL, Python')
check('unconvertible docx is reported, not passed through', readable.skipped, ['broken.docx'])
check('single non-docx path is unchanged', agentReadablePath('/x/cv.pdf', convert), '/x/cv.pdf')

// ---- master résumé resolution ----

const master = path.join(root, 'master')
fs.mkdirSync(master)
check('no profile: only the starter name counts', masterResumeNames(null), ['main_example.tex'])
check('profile stem first', masterResumeNames('Alex_Example'), ['Alex_Example_Resume.tex', 'main_example.tex'])
check('none present', resolveMasterResume(master, 'Alex_Example'), null)
fs.writeFileSync(path.join(master, 'main_example.tex'), '%')
check('starter template found without a profile', resolveMasterResume(master, null), 'main_example.tex')
fs.writeFileSync(path.join(master, 'Alex_Example_Resume.tex'), '%')
check('profile-stem file wins over the starter', resolveMasterResume(master, 'Alex_Example'), 'Alex_Example_Resume.tex')

// ---- Library categories: master résumé vs background notes ----

const ws = path.join(root, 'ws')
paths.initWorkspace(ws)
fs.writeFileSync(path.join(ws, 'master', 'Alex_Example_Resume.tex'), '%')
fs.writeFileSync(path.join(ws, 'master', 'context.md'), 'ctx')
fs.mkdirSync(path.join(ws, 'master', 'knowledge'), { recursive: true })
fs.writeFileSync(path.join(ws, 'master', 'knowledge', 'notes.md'), 'n')
fs.writeFileSync(path.join(ws, 'uploads', 'cv.pdf'), 'pdf')
const cats = Object.fromEntries(listLibrary().map((c) => [c.title, c.files.map((f) => f.relPath).sort()]))
check('master résumé category holds only the .tex', cats['Master résumé'], ['master/Alex_Example_Resume.tex'])
check(
  'context and knowledge listed as background',
  cats['Background notes (never on documents)'],
  ['master/context.md', 'master/knowledge/notes.md']
)
check('uploads listed', cats['My uploads'], ['uploads/cv.pdf'])

finish()

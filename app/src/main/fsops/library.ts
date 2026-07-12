import fs from 'node:fs'
import path from 'node:path'
import type { LibraryCategory, LibraryFile } from '@shared/types'
import { REPO_ROOT, toAbs, toRel } from '../paths'

const TEXT_EXT = new Set(['.md', '.tex', '.txt', '.csv', '.json', '.cls', '.yml', '.yaml', '.sty'])
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])

function kindOf(name: string): LibraryFile['kind'] {
  const ext = path.extname(name).toLowerCase()
  if (ext === '.pdf') return 'pdf'
  if (IMAGE_EXT.has(ext)) return 'image'
  if (TEXT_EXT.has(ext)) return 'text'
  return 'other'
}

function listDir(relDir: string, opts?: { excludeDirs?: string[]; depth?: number }): LibraryFile[] {
  const out: LibraryFile[] = []
  const excludeDirs = new Set((opts?.excludeDirs ?? []).map((d) => d.toLowerCase()))
  const maxDepth = opts?.depth ?? 2

  const walk = (abs: string, depth: number): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const entryAbs = path.join(abs, entry.name)
      if (entry.isDirectory()) {
        if (depth < maxDepth && !excludeDirs.has(entry.name.toLowerCase())) {
          walk(entryAbs, depth + 1)
        }
        continue
      }
      if (entry.name === '.gitkeep') continue
      let sizeKb = 0
      try {
        sizeKb = Math.round(fs.statSync(entryAbs).size / 1024)
      } catch {
        continue
      }
      out.push({ name: entry.name, relPath: toRel(entryAbs), kind: kindOf(entry.name), sizeKb })
    }
  }

  walk(path.join(REPO_ROOT, relDir), 0)
  // PDFs first (most useful to eyeball), then text, then the rest; alpha within kind.
  const order: Record<LibraryFile['kind'], number> = { pdf: 0, image: 1, text: 2, other: 3 }
  return out.sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name))
}

function singleFiles(relPaths: string[]): LibraryFile[] {
  const out: LibraryFile[] = []
  for (const rel of relPaths) {
    const abs = toAbs(rel)
    if (!fs.existsSync(abs)) continue
    out.push({
      name: path.basename(rel),
      relPath: rel.split(path.sep).join('/'),
      kind: kindOf(rel),
      sizeKb: Math.round(fs.statSync(abs).size / 1024)
    })
  }
  return out
}

/** Directories whose files the library (and the local-file protocol) may expose. */
export const LIBRARY_DIRS = ['cv', 'resume_examples', 'cover_letters', 'templates', 'myinfo']

export function listLibrary(): LibraryCategory[] {
  const guides = [
    'CLAUDE.md',
    ...listDir('.claude/skills/job-application-assistant').map((f) => f.relPath)
  ]
  return [
    { title: 'Master résumé (cv/)', files: listDir('cv') },
    { title: 'Résumé examples', files: listDir('resume_examples') },
    { title: 'Cover letters', files: listDir('cover_letters', { excludeDirs: ['OpenFonts'] }) },
    { title: 'Templates', files: listDir('templates') },
    { title: 'My info', files: listDir('myinfo') },
    { title: 'Guides & rules', files: singleFiles(guides) }
  ].filter((c) => c.files.length > 0)
}

const READ_CAP_BYTES = 400 * 1024

/** Read a text file for preview — jailed to the library dirs + guides. */
export function readLibraryFile(relPath: string): { content: string; truncated: boolean } {
  const norm = relPath.split('\\').join('/')
  const allowed =
    norm === 'CLAUDE.md' ||
    norm.startsWith('.claude/skills/') ||
    LIBRARY_DIRS.some((d) => norm === d || norm.startsWith(d + '/'))
  if (!allowed || norm.includes('..')) throw new Error(`not a library path: ${relPath}`)
  const abs = toAbs(norm)
  const stat = fs.statSync(abs)
  const truncated = stat.size > READ_CAP_BYTES
  const fd = fs.openSync(abs, 'r')
  try {
    const buf = Buffer.alloc(Math.min(stat.size, READ_CAP_BYTES))
    fs.readSync(fd, buf, 0, buf.length, 0)
    return { content: buf.toString('utf-8'), truncated }
  } finally {
    fs.closeSync(fd)
  }
}

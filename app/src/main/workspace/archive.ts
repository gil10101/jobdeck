// Pure workspace archive module — no electron imports, so plain node
// (scripts/portable-selftest.ts) can exercise the full round-trip.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import AdmZip from 'adm-zip'

export interface ExportManifest {
  schema: 'ohmo-export.v1'
  appVersion: string
  createdAt: string
  files: { path: string; bytes: number; sha256: string }[]
}

const SCHEMA = 'ohmo-export.v1'

/** All files in the zip live under this prefix; manifest.json sits beside it at the root. */
const ZIP_PREFIX = 'workspace/'

// CREDENTIALS INVARIANT: board-creds.json and token/credential/session files
// must never enter an export archive (bundled board CLIs write live auth
// sessions like .agents/skills/*/.session.json inside the workspace). A hit
// here is skipped and recorded nowhere in the zip.
function isDenied(name: string): boolean {
  const n = name.toLowerCase()
  if (n === 'board-creds.json') return true
  if (n.includes('token') && n.endsWith('.json')) return true
  if (n.includes('session') && n.endsWith('.json')) return true
  if (n.includes('credential')) return true
  return false
}

function isExcludedFile(name: string): boolean {
  return name === '.DS_Store' || name.endsWith('.tmp')
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

/** Workspace-relative paths (forward slashes) of every file the archive carries. */
function walkIncluded(root: string): string[] {
  const out: string[] = []
  const visit = (dir: string): void => {
    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const abs = path.join(dir, entry.name)
      const rel = path.relative(root, abs).split(path.sep).join('/')
      if (entry.isDirectory()) {
        // The workspace tmp/ subtree is scratch space — never exported.
        if (rel === 'tmp') continue
        visit(abs)
      } else if (entry.isFile()) {
        if (isExcludedFile(entry.name)) continue
        if (isDenied(entry.name)) continue
        out.push(rel)
      }
      // Anything else (symlinks, sockets) is not portable — skipped.
    }
  }
  visit(root)
  return out
}

export function buildArchive(
  workspaceDir: string,
  outZipPath: string,
  appVersion: string
): ExportManifest {
  if (!fs.existsSync(workspaceDir) || !fs.statSync(workspaceDir).isDirectory()) {
    throw new Error(`workspace folder not found: ${workspaceDir}`)
  }
  const zip = new AdmZip()
  const files: ExportManifest['files'] = []
  for (const rel of walkIncluded(workspaceDir)) {
    const buf = fs.readFileSync(path.join(workspaceDir, ...rel.split('/')))
    files.push({ path: rel, bytes: buf.length, sha256: sha256(buf) })
    zip.addFile(ZIP_PREFIX + rel, buf)
  }
  const manifest: ExportManifest = {
    schema: SCHEMA,
    appVersion,
    createdAt: new Date().toISOString(),
    files
  }
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8'))
  // Atomic: a crash mid-write leaves only a .tmp, never a truncated .zip.
  const tmp = `${outZipPath}.tmp`
  zip.writeZip(tmp)
  fs.renameSync(tmp, outZipPath)
  return manifest
}

function validateManifest(value: unknown): ExportManifest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('manifest.json is not an object')
  }
  const m = value as Record<string, unknown>
  if (m.schema !== SCHEMA) {
    throw new Error(
      `unsupported export schema: ${JSON.stringify(m.schema)} — this app reads ${SCHEMA}`
    )
  }
  if (typeof m.appVersion !== 'string') throw new Error('manifest appVersion must be a string')
  if (typeof m.createdAt !== 'string') throw new Error('manifest createdAt must be a string')
  if (!Array.isArray(m.files)) throw new Error('manifest files must be an array')
  for (const f of m.files as unknown[]) {
    if (typeof f !== 'object' || f === null) throw new Error('manifest file entry is not an object')
    const e = f as Record<string, unknown>
    if (typeof e.path !== 'string' || e.path.length === 0) {
      throw new Error('manifest file entry has no path')
    }
    // Extraction jail: entry paths must stay relative and inside the tree.
    const segs = e.path.split('/')
    if (e.path.startsWith('/') || e.path.includes('\\') || segs.some((s) => s === '..' || s === '')) {
      throw new Error(`manifest file path is not a safe relative path: ${e.path}`)
    }
    if (typeof e.bytes !== 'number' || !Number.isInteger(e.bytes) || e.bytes < 0) {
      throw new Error(`manifest entry has invalid bytes: ${e.path}`)
    }
    if (typeof e.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(e.sha256)) {
      throw new Error(`manifest entry has invalid sha256: ${e.path}`)
    }
  }
  return value as ExportManifest
}

export function readManifest(zipPath: string): ExportManifest {
  let zip: AdmZip
  try {
    zip = new AdmZip(zipPath)
  } catch (err) {
    throw new Error(`not a readable zip archive: ${err instanceof Error ? err.message : String(err)}`)
  }
  const entry = zip.getEntry('manifest.json')
  if (!entry) throw new Error('not a workspace export: manifest.json missing from zip root')
  let parsed: unknown
  try {
    parsed = JSON.parse(zip.readAsText(entry))
  } catch {
    throw new Error('manifest.json is not valid JSON')
  }
  return validateManifest(parsed)
}

export function verifyAndExtract(zipPath: string, destDir: string): { files: number } {
  if (!fs.existsSync(destDir) || !fs.statSync(destDir).isDirectory()) {
    throw new Error(`destination folder does not exist: ${destDir}`)
  }
  if (fs.readdirSync(destDir).length > 0) {
    throw new Error(`destination folder is not empty: ${destDir}`)
  }
  const manifest = readManifest(zipPath)
  const zip = new AdmZip(zipPath)
  const rootAbs = path.join(destDir, 'workspace')
  try {
    for (const f of manifest.files) {
      const entry = zip.getEntry(ZIP_PREFIX + f.path)
      if (!entry) throw new Error(`archive is missing a manifest-listed file: ${f.path}`)
      const buf = entry.getData()
      // Every entry re-hashed against the manifest — any mismatch aborts.
      if (buf.length !== f.bytes || sha256(buf) !== f.sha256) {
        throw new Error(`archive verification failed — content mismatch at: ${f.path}`)
      }
      const abs = path.join(rootAbs, ...f.path.split('/'))
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, buf)
    }
  } catch (err) {
    // A failed verification must not leave a half-written workspace behind.
    fs.rmSync(rootAbs, { recursive: true, force: true })
    throw err
  }
  return { files: manifest.files.length }
}

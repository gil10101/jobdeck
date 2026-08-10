// Selftest for the portable-workspace pure modules. Runs under plain node type
// stripping (node >= 23): `node scripts/portable-selftest.ts` from app/.
// Fixtures use example.com/Acme placeholders only.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { buildArchive, readManifest, verifyAndExtract } from '../src/main/workspace/archive.ts'
import { buildEnvelope, parseEnvelope, validateModuleData } from '../src/main/profile/moduleEnvelope.ts'

let pass = 0
let fail = 0

function check(name: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    pass++
  } else {
    fail++
    console.error(`FAIL ${name}`)
    console.error(`  expected: ${JSON.stringify(expected)}`)
    console.error(`  actual:   ${JSON.stringify(actual)}`)
  }
}

function checkThrows(name: string, fn: () => unknown, messageIncludes: string): void {
  try {
    fn()
    fail++
    console.error(`FAIL ${name}`)
    console.error('  expected a throw, got none')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes(messageIncludes)) {
      pass++
    } else {
      fail++
      console.error(`FAIL ${name}`)
      console.error(`  expected message including: ${messageIncludes}`)
      console.error(`  actual message:             ${message}`)
    }
  }
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

function write(root: string, rel: string, content: string): void {
  const abs = path.join(root, ...rel.split('/'))
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content, 'utf-8')
}

// ---- archive: fake workspace fixture ----

const tmpRoot = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'portable-selftest-'))
const ws = path.join(tmpRoot, 'ws')
fs.mkdirSync(ws)

// Included files: nested dirs plus weird names (spaces, unicode).
const included = [
  'profile.json',
  'tracker.json',
  'applications/acme_data_analyst_08_10/resume.tex',
  'applications/acme_data_analyst_08_10/notes with spaces.md',
  'master/résumé–nötes ✓.md'
]
for (const rel of included) write(ws, rel, `content of ${rel}\n`)
// Excluded: tmp/ subtree, *.tmp, .DS_Store.
write(ws, 'tmp/scratch.txt', 'scratch')
write(ws, 'applications/draft.tmp', 'half-written')
write(ws, '.DS_Store', 'finder junk')
// Denied: credentials must never enter the archive.
write(ws, 'board-creds.json', '{"email":"user@example.com","password":"nope"}')
write(ws, 'master/gmail-token-cache.json', '{"refresh":"nope"}')
write(ws, 'library/acme-credentials.txt', 'nope')
write(ws, '.agents/skills/jobright-search/.session.json', '{"sessionId":"nope"}')

const zipPath = path.join(tmpRoot, 'export.zip')
const manifest = buildArchive(ws, zipPath, '2.0.0-test')

check('manifest schema', manifest.schema, 'jobdeck-export.v1')
check('manifest appVersion', manifest.appVersion, '2.0.0-test')
check(
  'manifest lists exactly the expected files',
  manifest.files.map((f) => f.path).sort(),
  [...included].sort()
)
const zipEntries = new AdmZip(zipPath).getEntries().map((e) => e.entryName)
check(
  'no denied/excluded name appears anywhere in the zip',
  zipEntries.filter((n) => /creds|credential|token|session|\.tmp$|DS_Store|^workspace\/tmp\//i.test(n)),
  []
)
check('zip carries manifest.json plus one entry per file', zipEntries.length, included.length + 1)
check('readManifest round-trips the written manifest', readManifest(zipPath), manifest)

// ---- verifyAndExtract: round-trip ----

const dest = path.join(tmpRoot, 'dest')
fs.mkdirSync(dest)
check('extract returns the file count', verifyAndExtract(zipPath, dest), { files: included.length })
check(
  'extracted tree is byte-identical (per-file sha256)',
  included.map((rel) => sha256(fs.readFileSync(path.join(dest, 'workspace', ...rel.split('/'))))).sort(),
  included.map((rel) => sha256(fs.readFileSync(path.join(ws, ...rel.split('/'))))).sort()
)
checkThrows('non-empty destination throws', () => verifyAndExtract(zipPath, dest), 'not empty')

// ---- readManifest: bad archives ----

const noManifestZip = path.join(tmpRoot, 'no-manifest.zip')
const bare = new AdmZip()
bare.addFile('workspace/profile.json', Buffer.from('{}'))
bare.writeZip(noManifestZip)
checkThrows('zip without manifest.json rejected', () => readManifest(noManifestZip), 'manifest.json missing')

const futureZip = path.join(tmpRoot, 'future.zip')
const future = new AdmZip()
future.addFile(
  'manifest.json',
  Buffer.from(JSON.stringify({ schema: 'jobdeck-export.v2', appVersion: 'x', createdAt: 'x', files: [] }))
)
future.writeZip(futureZip)
checkThrows('unknown schema version rejected', () => readManifest(futureZip), 'unsupported export schema')

// ---- verifyAndExtract: tampered content ----

const tamperedZip = path.join(tmpRoot, 'tampered.zip')
fs.copyFileSync(zipPath, tamperedZip)
const tampered = new AdmZip(tamperedZip)
const original = tampered.getEntry('workspace/profile.json')!.getData()
original[0] = original[0] ^ 0xff
tampered.updateFile('workspace/profile.json', original)
tampered.writeZip(tamperedZip)

const dest2 = path.join(tmpRoot, 'dest2')
fs.mkdirSync(dest2)
checkThrows(
  'tampered entry fails verification naming the path',
  () => verifyAndExtract(tamperedZip, dest2),
  'content mismatch at: profile.json'
)
check('partial extraction is cleaned up', fs.existsSync(path.join(dest2, 'workspace')), false)

fs.rmSync(tmpRoot, { recursive: true, force: true })

// ---- profile module envelope ----

const skillsData = [{ category: 'Data', items: ['SQL', 'dbt'] }]
const envelope = buildEnvelope('skills', 1, skillsData)
check('envelope schema id', envelope.schema, 'jobdeck-profile-module.v1')
const parsedEnvelope = parseEnvelope(JSON.stringify(envelope))
check(
  'envelope round-trips through JSON',
  { module: parsedEnvelope.module, schemaVersion: parsedEnvelope.schemaVersion, data: parsedEnvelope.data },
  { module: 'skills', schemaVersion: 1, data: skillsData }
)
const validated = validateModuleData('skills', parsedEnvelope.data)
check('module data validates and survives healing', validated.ok ? validated.data : validated, skillsData)
checkThrows(
  'wrong module name rejected',
  () => parseEnvelope(JSON.stringify({ ...envelope, module: 'passwords' })),
  'unknown profile module'
)
checkThrows('malformed JSON rejected', () => parseEnvelope('{not json'), 'not valid JSON')
checkThrows(
  'foreign schema id rejected',
  () => parseEnvelope(JSON.stringify({ ...envelope, schema: 'jobdeck-profile-module.v2' })),
  'unsupported profile module schema'
)
check(
  'array module rejects an object payload (no silent reset)',
  validateModuleData('skills', { nope: true }),
  { ok: false, problems: ['skills: expected an array'] }
)
checkThrows(
  'future schemaVersion rejected',
  () => parseEnvelope(JSON.stringify({ ...envelope, schemaVersion: 99 })),
  'unsupported profile module schemaVersion: 99'
)
checkThrows(
  'non-positive schemaVersion rejected',
  () => parseEnvelope(JSON.stringify({ ...envelope, schemaVersion: 0 })),
  'invalid profile module schemaVersion'
)
// The adversarial case: a valid export of one section imported as another.
const experienceData = [
  {
    title: 'Analyst',
    company: 'Acme',
    location: 'Remote',
    startDate: '2020',
    endDate: '',
    bullets: [],
    technologies: [],
    inclusionRule: null,
    framingNotes: null
  }
]
check(
  'skills module rejects an experience payload',
  validateModuleData('skills', experienceData),
  { ok: false, problems: ['skills: entry 0 is not a skill category'] }
)
check('customRules module rejects non-strings', validateModuleData('customRules', [1, 2, 3]), {
  ok: false,
  problems: ['customRules: entry 0 is not a string']
})
check(
  'string entries never spread into education objects',
  validateModuleData('education', ['nope', 42]),
  { ok: false, problems: ['education: entry 0 is not an education entry'] }
)
// Ingest normalizes each entry against the element skeleton: missing keys get
// their default (never `undefined` in the agent prompts), unknown keys go.
const importedAward = validateModuleData('awards', [{ title: 'Best Analyst', inclusionRule: 'x' }])
check(
  'imported entries are filled from the element skeleton and stripped of unknown keys',
  importedAward.ok ? importedAward.data : importedAward,
  [{ title: 'Best Analyst', issuer: '', date: null, note: null }]
)
// Export ('local') must never refuse what the profile is already allowed to hold.
const looseExperience = [{ title: 'Analyst', employer: 'Acme', bullets: ['x'] }]
check(
  'local-source experience heals instead of rejecting',
  validateModuleData('experience', looseExperience, 'local'),
  {
    ok: true,
    data: [
      {
        title: 'Analyst',
        company: '',
        location: '',
        startDate: '',
        endDate: '',
        bullets: ['x'],
        technologies: [],
        inclusionRule: null,
        framingNotes: null
      }
    ],
    healed: []
  }
)
check(
  'the same payload is still refused on ingest',
  validateModuleData('experience', looseExperience),
  { ok: false, problems: ['experience: entry 0 is not an experience entry'] }
)

console.log(`PASS ${pass}/${pass + fail}`)
if (fail > 0) process.exit(1)

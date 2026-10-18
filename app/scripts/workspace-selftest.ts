// Selftest for the workspace lifecycle: folder classification, the config
// transition for adopting a folder, and path/caches state across a re-root.
// Runs under plain node type stripping: `node scripts/workspace-selftest.ts`
// from app/.
import fs from 'node:fs'
import path from 'node:path'
import { check, checkThrows, finish, tmpDir } from './lib/harness.ts'

const { classifyFolder, configPatchForSwitch, sameFolder } = await import(
  '../src/main/workspace/workspaceState.ts'
)
const paths = await import('../src/main/paths.ts')
const profileStore = await import('../src/main/profile/profileStore.ts')

// ---- classifyFolder ----

const root = tmpDir('workspace-selftest')
const empty = path.join(root, 'empty')
fs.mkdirSync(empty)
check('empty folder', classifyFolder(empty), 'empty')

fs.writeFileSync(path.join(empty, '.DS_Store'), '')
check('OS litter does not make a folder in use', classifyFolder(empty), 'empty')

check('missing folder', classifyFolder(path.join(root, 'nope')), 'missing')

const file = path.join(root, 'a-file.txt')
fs.writeFileSync(file, 'x')
check('a file is not a folder', classifyFolder(file), 'notDirectory')

const docs = path.join(root, 'docs')
fs.mkdirSync(docs)
fs.writeFileSync(path.join(docs, 'taxes.pdf'), 'x')
check('folder with unrelated files', classifyFolder(docs), 'nonEmptyOther')

const wsTracker = path.join(root, 'ws-tracker')
fs.mkdirSync(wsTracker)
fs.writeFileSync(path.join(wsTracker, 'tracker.json'), '{}')
check('tracker.json marks a workspace', classifyFolder(wsTracker), 'workspace')

const wsProfile = path.join(root, 'ws-profile')
fs.mkdirSync(wsProfile)
fs.writeFileSync(path.join(wsProfile, 'profile.json'), '{}')
check('profile.json marks a workspace', classifyFolder(wsProfile), 'workspace')

// ---- configPatchForSwitch: setup completion belongs to a workspace ----

const now = (): string => '2026-01-01T00:00:00.000Z'
const onboarded = { workspacePath: '/w/old', onboardedAt: '2025-06-01T00:00:00.000Z' }

check(
  'same folder keeps setup state',
  configPatchForSwitch(onboarded, '/w/old/', false, now),
  { workspacePath: '/w/old/', onboardedAt: onboarded.onboardedAt }
)
check(
  'new folder without a profile goes back through setup',
  configPatchForSwitch(onboarded, '/w/new', false, now),
  { workspacePath: '/w/new', onboardedAt: null }
)
check(
  'adopting a folder with a profile keeps setup complete',
  configPatchForSwitch(onboarded, '/w/new', true, now),
  { workspacePath: '/w/new', onboardedAt: onboarded.onboardedAt }
)
check(
  'first run adopting a folder with a profile skips setup',
  configPatchForSwitch({ workspacePath: null, onboardedAt: null }, '/w/new', true, now),
  { workspacePath: '/w/new', onboardedAt: now() }
)
check(
  'first run on a fresh folder runs setup',
  configPatchForSwitch({ workspacePath: null, onboardedAt: null }, '/w/new', false, now),
  { workspacePath: '/w/new', onboardedAt: null }
)
// The missing-folder recovery path: setup was finished on a folder that is
// gone; picking a fresh one must not drop the user into an empty main UI.
check(
  'recovering from a missing workspace onto a fresh folder runs setup',
  configPatchForSwitch(onboarded, '/w/replacement', false, now).onboardedAt,
  null
)
check('sameFolder normalizes trailing separators', sameFolder('/a/b', '/a/b/'), true)
check('sameFolder with null', sameFolder(null, '/a'), false)

// ---- initWorkspace / resetWorkspace ----

check('not ready before init', paths.workspaceReady(), false)
checkThrows('path helpers refuse before init', () => paths.toAbs('x'), 'workspace not initialized')

const wsA = path.join(root, 'A')
paths.initWorkspace(wsA)
check('ready after init', paths.workspaceReady(), true)
check('layout created', fs.existsSync(path.join(wsA, 'uploads')) && fs.existsSync(path.join(wsA, 'master')), true)

paths.resetWorkspace()
check('reset after a failed boot clears readiness', paths.workspaceReady(), false)
check('reset clears derived bindings too', paths.UPLOADS_DIR.includes(wsA), false)

// ---- profile cache does not leak across workspaces ----

paths.initWorkspace(wsA)
fs.writeFileSync(
  path.join(wsA, 'profile.json'),
  JSON.stringify({ identity: { fullName: 'Alex Example', email: 'alex@example.com' } })
)
check('profile loads from workspace A', profileStore.loadProfile()?.identity.fullName, 'Alex Example')

const wsB = path.join(root, 'B')
paths.initWorkspace(wsB)
profileStore.resetProfileCache()
check('workspace B has no profile after the cache reset', profileStore.loadProfile(), null)

finish()

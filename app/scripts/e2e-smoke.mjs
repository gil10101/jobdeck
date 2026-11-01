// End-to-end smoke test of the first-run and workspace flows a new user hits,
// against the real built app (npm run build first; `npm run test:e2e` does
// both). Each run uses a throwaway userData (OHMO_USER_DATA) and temp
// workspaces, so it never touches a real install. Native dialogs are replaced
// in the main process with scripted answers: open dialogs return the queued
// paths, message boxes pick their LAST button (every confirm in the app puts
// the confirming action last), trash deletes, and relaunch/quit are recorded
// instead of performed so a workspace switch does not end the test.
// Linux CI needs a display: run under xvfb-run.
import { _electron } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import AdmZip from 'adm-zip'

const APP = path.resolve(import.meta.dirname, '..')
const electronPath = createRequire(APP + '/package.json')('electron')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ohmo-smoke-'))
const userData = path.join(root, 'userData')
const wsA = path.join(root, 'wsA')
const wsB = path.join(root, 'wsB')
const wsC = path.join(root, 'wsC')
const src = path.join(root, 'src'); fs.mkdirSync(src)
fs.writeFileSync(path.join(src, 'resume.pdf'), '%PDF-1.4 fake')
const zip = new AdmZip(); zip.addFile('word/document.xml', Buffer.from('<w:document><w:body><w:p><w:r><w:t>Alex Example</w:t></w:r></w:p></w:body></w:document>')); fs.writeFileSync(path.join(src, 'resume.docx'), zip.toBuffer())

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { if (ok) { pass++; console.log('ok   ', name) } else { fail++; console.log('FAIL ', name, detail) } }
const config = () => JSON.parse(fs.readFileSync(path.join(userData, 'config.json'), 'utf-8'))
const env = { ...process.env, OHMO_USER_DATA: userData }
delete env.ELECTRON_RENDERER_URL; delete env.OHMO_RELAUNCH_EXIT_CODE

const live = new Set()
setTimeout(() => { console.log('WATCHDOG: timeout'); for (const a of live) a.process().kill('SIGKILL'); process.exit(2) }, Number(process.env.SMOKE_TIMEOUT ?? 240000)).unref()
async function launch() {
  // Ubuntu runners restrict the unprivileged user namespaces Chromium's
  // sandbox needs; CI-only, the app under test is our own.
  const args = process.env.CI && process.platform === 'linux' ? ['--no-sandbox', APP] : [APP]
  const app = await _electron.launch({ executablePath: electronPath, args, env })
  live.add(app); app.on('close', () => live.delete(app))
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  // Native dialogs replaced by scripted answers; trash = delete; no real relaunch.
  await app.evaluate(({ dialog, shell, app: a }) => {
    globalThis.__smoke = { open: [], box: [], relaunched: 0 }
    dialog.showOpenDialog = async () => { const p = globalThis.__smoke.open.shift(); return p ? { canceled: false, filePaths: p } : { canceled: true, filePaths: [] } }
    dialog.showMessageBox = async (_w, o) => ({ response: (o ?? _w).buttons.length - 1 })
    shell.trashItem = async (p) => { process.getBuiltinModule('node:fs').rmSync(p, { recursive: true, force: true }) }
    shell.openPath = async () => ''
    a.relaunch = () => { globalThis.__smoke.relaunched++ }
    a.quit = () => {}
  })
  const queueOpen = (paths) => app.evaluate((_e, p) => { globalThis.__smoke.open.push(p) }, paths)
  const invoke = (ch, req) => page.evaluate(([c, r]) => window.api.invoke(c, r), [ch, req])
  // app.quit is stubbed (a switch must not end the test), so closing exits hard.
  const close = async () => { const done = new Promise((r) => app.process().once('exit', r)); await app.evaluate(({ app: a }) => setTimeout(() => a.exit(0), 50)).catch(() => {}); await done }
  return { app, page, queueOpen, invoke, close }
}
const btn = (page, name) => page.getByRole('button', { name, exact: false }).first()
const visible = async (loc, t = 8000) => { try { await loc.waitFor({ state: 'visible', timeout: t }); return true } catch { return false } }
const nav = async (page, label) => { await page.getByRole('button', { name: label, exact: true }).first().click() }

// ---------- 1. fresh first run ----------
let s = await launch()
check('fresh run shows workspace step', await visible(btn(s.page, 'Create a new workspace')))
await s.queueOpen([wsA])
await btn(s.page, 'Create a new workspace').click()
check('after create: model step', await visible(btn(s.page, 'Skip setup for now')))
check('config onboardedAt null on fresh folder', config().onboardedAt === null && config().workspacePath === wsA, JSON.stringify(config()))
await btn(s.page, 'Skip setup for now').click()
check('skip lands in main UI', await visible(s.page.getByText('Setup skipped', { exact: false })))

// ---------- 2. no material: blocked ----------
let r = await s.invoke('build:readiness')
check('readiness blocked with nothing', r.ok && r.data.mode === 'blocked', JSON.stringify(r))
await nav(s.page, 'Intake')
check('intake shows blocked notice', await visible(btn(s.page, 'Add my résumé')))
r = await s.invoke('runs:start', { postingText: 'Acme hiring analyst' })
check('runs:start refused before queueing', !r.ok && /résumé/.test(r.error), JSON.stringify(r))
const runs0 = await s.invoke('runs:list')
check('no run created by refused build', runs0.ok && runs0.data.length === 0)

// ---------- 3. upload pdf + docx: minimal ----------
await btn(s.page, 'Add my résumé').click()
await s.queueOpen([path.join(src, 'resume.pdf'), path.join(src, 'resume.docx')])
await btn(s.page, 'Add files').click()
check('library lists uploads', await visible(s.page.getByText('resume.docx', { exact: true })))
r = await s.invoke('build:readiness')
check('readiness minimal with uploads', r.ok && r.data.mode === 'minimal', JSON.stringify(r))

// ---------- 4. remove an upload ----------
await s.page.getByText('resume.pdf', { exact: true }).first().click()
await btn(s.page, 'Move resume.pdf to the trash').click()
await s.page.waitForTimeout(500)
check('pdf removed from disk', !fs.existsSync(path.join(wsA, 'uploads', 'resume.pdf')))
check('pdf gone from library', !(await s.page.getByText('resume.pdf', { exact: true }).count()))

// ---------- 5. re-run setup wizard ----------
await nav(s.page, 'Settings')
await btn(s.page, 'Re-run setup').click()
check('wizard reopens at model step', await visible(btn(s.page, 'Skip setup for now')))
await btn(s.page, 'Continue').click()
check('sources step lists on-disk upload', await visible(s.page.getByText('resume.docx', { exact: true })))
check('extract enabled from disk uploads', await btn(s.page, 'Extract my profile').isEnabled())
await btn(s.page, 'Skip setup for now').click()
await visible(s.page.getByText('Setup skipped', { exact: false }))

// ---------- 6. change workspace ----------
await nav(s.page, 'Settings')
await s.queueOpen([wsB])
await btn(s.page, 'Change workspace').click()
await s.page.waitForTimeout(800)
const relaunched = await s.app.evaluate(() => globalThis.__smoke.relaunched)
check('switch requested a relaunch', relaunched === 1, String(relaunched))
check('config points at B, setup pending', config().workspacePath === wsB && config().onboardedAt === null, JSON.stringify(config()))
check('fresh folder scaffolded with the board CLIs', fs.existsSync(path.join(wsB, '.agents')))
await s.close()

s = await launch()
check('new workspace opens into setup', await visible(btn(s.page, 'Skip setup for now')))
let info = await s.invoke('app:info')
check('live root is B', info.ok && info.data.repoRoot === wsB, JSON.stringify(info))
await btn(s.page, 'Skip setup for now').click()
await visible(s.page.getByText('Setup skipped', { exact: false }))

// switch back to A, which now holds a profile -> skips setup
fs.writeFileSync(path.join(wsA, 'profile.json'), JSON.stringify({ identity: { fullName: 'Alex Example', email: 'alex@example.com' }, experience: [{ title: 'Analyst', company: 'Example Co', bullets: ['x'] }] }))
await nav(s.page, 'Settings')
await s.queueOpen([wsA])
await btn(s.page, 'Change workspace').click()
await s.page.waitForTimeout(800)
check('back to A keeps setup complete (has profile)', config().workspacePath === wsA && config().onboardedAt !== null, JSON.stringify(config()))
await s.close()
s = await launch()
check('A opens straight into the main UI', await visible(s.page.getByText('Intake', { exact: true }).first()) && !(await btn(s.page, 'Skip setup for now').count()))
info = await s.invoke('app:info')
check('live root is A', info.ok && info.data.repoRoot === wsA)
r = await s.invoke('build:readiness')
check('readiness profile in A', r.ok && r.data.mode === 'profile', JSON.stringify(r))
await s.close()

// ---------- 7. missing workspace folder ----------
fs.renameSync(wsA, wsA + '-moved')
s = await launch()
check('missing folder: workspace step with banner', await visible(s.page.getByText('could not be opened', { exact: false })))
await s.queueOpen([wsC])
await btn(s.page, 'Create a new workspace').click()
check('fresh replacement folder runs setup (not empty main UI)', await visible(btn(s.page, 'Skip setup for now')))
await s.close()

console.log(`\nPASS ${pass}/${pass + fail}`)
process.exit(fail ? 1 : 0)

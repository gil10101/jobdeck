// Selftest for builds without a profile or master résumé: the readiness gate,
// and the build/interview prompts in each case (no unfilled slots, no
// instruction pointing at a file that does not exist, no contradiction).
// Runs under plain node type stripping: `node scripts/build-readiness-selftest.ts`
// from app/.
import fs from 'node:fs'
import path from 'node:path'
import { check, finish, tmpDir } from './lib/harness.ts'

const { assessBuildReadiness, readCandidateMaterial } = await import('../src/main/agent/buildReadiness.ts')
const paths = await import('../src/main/paths.ts')
const { buildPrompt, buildInterviewPrompt } = await import('../src/main/agent/prompt.ts')
const profileStore = await import('../src/main/profile/profileStore.ts')
const { validateProfile } = await import('../src/main/profile/profileSchema.ts')
const { renderProfileMd } = await import('../src/main/profile/render.ts')
const { workspaceBuildReadiness } = await import('../src/main/agent/readinessCheck.ts')

const none = { hasProfile: false, uploads: 0, masterResume: null, hasContext: false }

// ---- the gate ----

check('nothing at all is blocked', assessBuildReadiness(none).mode, 'blocked')
check('a profile is the full path', assessBuildReadiness({ ...none, hasProfile: true }).mode, 'profile')
check('uploads alone allow a minimal build', assessBuildReadiness({ ...none, uploads: 1 }).mode, 'minimal')
check('a master résumé alone allows a minimal build', assessBuildReadiness({ ...none, masterResume: 'main_example.tex' }).mode, 'minimal')
check('context notes alone allow a minimal build', assessBuildReadiness({ ...none, hasContext: true }).mode, 'minimal')
check('blocked carries a remedy', (assessBuildReadiness(none).message ?? '').includes('Library'), true)

const root = tmpDir('build-readiness-selftest')
const ws = path.join(root, 'ws')
paths.initWorkspace(ws)

// Knowledge-base material is background-only and must not unblock a build.
fs.mkdirSync(path.join(ws, 'master', 'knowledge'), { recursive: true })
fs.writeFileSync(path.join(ws, 'master', 'knowledge', 'notes.md'), 'background')
check(
  'knowledge base alone stays blocked',
  readCandidateMaterial({ masterDir: paths.MASTER_DIR, uploadsDir: paths.UPLOADS_DIR, hasProfile: false, fileBasename: null }),
  none
)
check('live workspace with no material is blocked', workspaceBuildReadiness().mode, 'blocked')

fs.writeFileSync(path.join(ws, 'master', 'context.md'), '   \n')
check('blank context does not count', workspaceBuildReadiness().mode, 'blocked')

// ---- minimal build prompt: uploads, no profile, no master ----

fs.writeFileSync(path.join(ws, 'uploads', 'resume.pdf'), 'pdf')
check('uploads unblock the live workspace', workspaceBuildReadiness().mode, 'minimal')

const slots = {
  slug: 'acme_data_analyst_01_01',
  postingText: 'Acme is hiring a Data Analyst.',
  imagePaths: [],
  applyUrl: null,
  companyHint: 'Acme',
  roleHint: 'Data Analyst',
  notes: null
}
const minimal = buildPrompt(slots, null)
check('minimal: every slot filled', minimal.match(/\{\{[A-Z_]+\}\}/g), null)
check('minimal: lists the upload for the agent to Read', minimal.includes(path.join(ws, 'uploads', 'resume.pdf')), true)
check('minimal: names the source-material section', minimal.includes('CANDIDATE SOURCE MATERIAL'), true)
check('minimal: does not claim everything is in the prompt', minimal.includes('do not look for profile files'), false)
check('minimal: the agent derives the file stem', minimal.includes('`<FirstName_LastName>_Resume.tex`'), true)
check('minimal: no master to copy', minimal.includes('There is no master résumé'), true)
check('minimal: no instruction to copy a missing preamble', minimal.includes('copy its preamble/macros EXACTLY'), false)
check('minimal: no "follow the master résumé"', minimal.includes('follow the master résumé'), false)
check('minimal: no blank identity values', /- (Phone|Email|Full name): \n/.test(minimal), false)

// ---- profile, no master ----

const draft = validateProfile({
  identity: { fullName: 'Alex Example', email: 'alex@example.com' },
  experience: [{ title: 'Analyst', company: 'Example Co', bullets: ['Built dashboards'] }]
})
check('fixture profile validates', draft.ok, true)
if (!draft.ok) throw new Error('fixture profile invalid')
profileStore.saveProfile(draft.profile)
const stem = draft.profile.documents.fileBasename
check('live workspace with a profile is full mode', workspaceBuildReadiness().mode, 'profile')

const withProfile = buildPrompt(slots, draft.profile)
check('profile: every slot filled', withProfile.match(/\{\{[A-Z_]+\}\}/g), null)
check('profile: candidate named', withProfile.includes('for Alex Example'), true)
check('profile: self-contained claim kept', withProfile.includes('do not look for profile files'), true)
check('profile: stem used', withProfile.includes(`\`${stem}_Resume.tex\``), true)
check('profile: no master wording', withProfile.includes('There is no master résumé'), true)
check('profile: no blank phone line', withProfile.includes('- Phone: \n'), false)

// ---- profile + master résumé ----

fs.writeFileSync(path.join(ws, 'master', `${stem}_Resume.tex`), '\\documentclass{article}')
const withMaster = buildPrompt(slots, draft.profile)
check('master: named as the file to copy', withMaster.includes(`Read the master résumé: \`master/${stem}_Resume.tex\``), true)
check('master: no-master wording gone', withMaster.includes('There is no master résumé'), false)

// ---- interview prep without a profile ----

const interview = buildInterviewPrompt({ folderRel: 'applications/acme', position: 'Data Analyst', company: 'Acme' }, null)
check('interview without profile: every slot filled', interview.match(/\{\{[A-Z_]+\}\}/g), null)
check('interview without profile: sources listed', interview.includes('CANDIDATE SOURCE MATERIAL'), true)
check('interview without profile: no stem instruction', interview.includes('<FirstName_LastName>'), false)

// ---- an incomplete profile.json on disk loads healed, never raw ----

fs.writeFileSync(paths.PROFILE_FILE, JSON.stringify({ identity: { fullName: 'Alex Example' } }))
profileStore.resetProfileCache()
const healed = profileStore.loadProfile()
check('incomplete profile still loads', healed?.identity.fullName, 'Alex Example')
check('missing arrays healed to empty', healed?.identity.languages, [])
let rendered = ''
try {
  rendered = renderProfileMd(healed!)
} catch (err) {
  rendered = `THREW: ${String(err)}`
}
check('renderer does not throw on the healed profile', rendered.startsWith('THREW'), false)

fs.writeFileSync(paths.PROFILE_FILE, '"just a string"')
profileStore.resetProfileCache()
check('a non-object profile.json loads as no profile', profileStore.loadProfile(), null)

finish()

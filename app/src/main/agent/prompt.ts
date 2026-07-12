import fs from 'node:fs'
import path from 'node:path'
import type { ProfileFile } from '@shared/profile'
import { emptyProfile } from '@shared/profile'
import { APP_DIR, BUN_EXE, MASTER_DIR, PDFLATEX, REPO_ROOT, toAbs, todayISO, todayMMDD } from '../paths'
import { loadConfig } from '../appConfig'
import { pickExampleFolder } from '../fsops/FolderScanner'
import {
  renderAnswersInfoMd,
  renderCoverLetterStyleMd,
  renderExtraRulesMd,
  renderLogisticsMd,
  renderProfileMd,
  renderSearchCriteriaMd,
  renderStoriesMd,
  renderTailoringRulesMd
} from '../profile/render'

const TEMPLATE_PATH = path.join(APP_DIR, 'resources', 'prompts', 'build_application.md')
const SCOUT_TEMPLATE_PATH = path.join(APP_DIR, 'resources', 'prompts', 'scout_jobs.md')
const INTERVIEW_TEMPLATE_PATH = path.join(APP_DIR, 'resources', 'prompts', 'interview_prep.md')
const ONBOARD_TEMPLATE_PATH = path.join(APP_DIR, 'resources', 'prompts', 'onboard_profile.md')

function fill(template: string, replacements: Record<string, string>): string {
  let out = template
  for (const [key, value] of Object.entries(replacements)) {
    out = out.split(`{{${key}}}`).join(value)
  }
  return out
}

export interface PromptSlots {
  slug: string
  postingText: string
  imagePaths: string[]
  applyUrl: string | null
  companyHint: string
  roleHint: string
}

function imagesSection(imagePaths: string[]): string {
  if (!imagePaths.length) return ''
  const list = imagePaths.map((p) => `- ${toAbs(p)}`).join('\n')
  return [
    '## POSTING SCREENSHOTS (Read these FIRST)',
    'The posting was provided fully or partly as screenshot image(s). Before anything else,',
    'use the Read tool on EACH image below and treat their contents as part of the posting text:',
    list,
    ''
  ].join('\n')
}

function masterResumePath(p: ProfileFile): string {
  const candidates = [
    path.join(MASTER_DIR, `${p.documents.fileBasename}_Resume.tex`),
    path.join(MASTER_DIR, 'main_example.tex') // v1 import before master regeneration
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return `master/${path.basename(c)}`
  }
  return '(no master résumé yet — construct the preamble yourself: article class, ATS-safe single column, lmodern, glyphtounicode)'
}

function exampleFolderLine(): string {
  const example = pickExampleFolder()
  return example
    ? `Also read \`${example}/\` (a COMPLETED application) and replicate its structure and quality.`
    : 'No completed example exists yet — follow the master résumé and this spec exactly.'
}

function pdftotextLine(): string {
  const configured = loadConfig().pdftotextPath
  if (configured && fs.existsSync(configured)) {
    return `Run \`"${configured}" -layout <resume pdf> -\` and verify: name/email/phone extract as literal text, no ligature garbage (e.g. "eciency"), top posting keywords present in the text layer. Record the outcome in report.json atsCheck.`
  }
  return 'pdftotext is not available on this machine — set `"atsCheck": "skipped"` in report.json (do not fail the build over this).'
}

/** Build-application prompt — fully self-contained; requires a profile. */
export function buildPrompt(slots: PromptSlots, profile: ProfileFile): string {
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf-8')
  return fill(template, {
    CANDIDATE_NAME: profile.identity.fullName,
    FILE_BASENAME: profile.documents.fileBasename,
    PROFILE_MD: renderProfileMd(profile),
    TAILORING_RULES_MD: renderTailoringRulesMd(profile),
    ANSWERS_INFO_MD: renderAnswersInfoMd(profile),
    COVER_LETTER_STORIES_MD: renderStoriesMd(profile, 'cover_letter'),
    COVER_LETTER_STYLE_MD: renderCoverLetterStyleMd(profile),
    EXTRA_RULES_MD: renderExtraRulesMd(profile),
    MASTER_RESUME_PATH: masterResumePath(profile),
    EXAMPLE_FOLDER_LINE: exampleFolderLine(),
    PDFTOTEXT_LINE: pdftotextLine(),
    SLUG: slots.slug,
    POSTING_TEXT:
      slots.postingText.trim() ||
      '(no text provided — use the screenshots below and/or WebFetch the apply URL to obtain the posting)',
    IMAGES_SECTION: imagesSection(slots.imagePaths),
    APPLY_URL: slots.applyUrl ?? 'not provided (note "apply on company site" in the answers file)',
    COMPANY_HINT: slots.companyHint || 'derive from the posting',
    ROLE_HINT: slots.roleHint || 'derive from the posting',
    TODAY_ISO: todayISO(),
    DATE_MMDD: todayMMDD(),
    PDFLATEX: PDFLATEX,
    REPO_ROOT: REPO_ROOT
  })
}

export function buildInterviewPrompt(
  s: { folderRel: string; position: string; company: string },
  profile: ProfileFile
): string {
  const template = fs.readFileSync(INTERVIEW_TEMPLATE_PATH, 'utf-8')
  return fill(template, {
    CANDIDATE_NAME: profile.identity.fullName,
    PROFILE_MD: renderProfileMd(profile),
    INTERVIEW_STORIES_MD: renderStoriesMd(profile, 'interview'),
    LOGISTICS_MD: renderLogisticsMd(profile),
    REPO_ROOT: REPO_ROOT,
    TODAY_ISO: todayISO(),
    FOLDER: s.folderRel,
    POSITION: s.position || 'the role',
    COMPANY: s.company || 'the company'
  })
}

export interface ScoutSlots {
  instructions: string
  excludeList: string[]
  outputPath: string
}

/** M3 replaces this with the judge prompt; criteria already come from the profile. */
export function buildScoutPrompt(s: ScoutSlots, profile: ProfileFile | null): string {
  let out = fs.readFileSync(SCOUT_TEMPLATE_PATH, 'utf-8')
  const exclude =
    s.excludeList.length > 0
      ? s.excludeList.map((e) => `  - ${e}`).join('\n')
      : '  (nothing tracked yet)'
  const criteria = profile
    ? renderSearchCriteriaMd(profile)
    : '(no profile configured — use conservative judgment)'
  const replacements: Record<string, string> = {
    REPO_ROOT: REPO_ROOT,
    TODAY_ISO: todayISO(),
    BUN: BUN_EXE,
    EXCLUDE_LIST: exclude,
    OUTPUT_PATH: s.outputPath,
    SEARCH_CRITERIA_MD: criteria,
    INSTRUCTIONS: s.instructions.trim() || '(none — run the standard sweep)'
  }
  return fill(out, replacements)
}

export interface OnboardSlots {
  /** Absolute paths of source files (uploaded résumé PDFs, v1-import staging, …). */
  sourceFiles: string[]
  /** Pasted source text (résumé text, LinkedIn about, …). */
  sourceText: string
  outputPath: string
}

export function buildOnboardPrompt(s: OnboardSlots): string {
  const template = fs.readFileSync(ONBOARD_TEMPLATE_PATH, 'utf-8')
  const parts: string[] = []
  if (s.sourceFiles.length) {
    parts.push(
      'Read EACH of these files with the Read tool (PDFs and images are readable directly):',
      ...s.sourceFiles.map((f) => `- ${f}`)
    )
  }
  if (s.sourceText.trim()) {
    parts.push('', 'Additionally, this pasted source text:', '<source>', s.sourceText.trim(), '</source>')
  }
  if (!parts.length) parts.push('(no sources provided — leave the profile empty and fill `gaps` with what to ask)')
  return fill(template, {
    REPO_ROOT: REPO_ROOT,
    TODAY_ISO: todayISO(),
    OUTPUT_PATH: s.outputPath,
    SOURCE_SECTION: parts.join('\n'),
    PROFILE_JSON_SCHEMA: JSON.stringify(emptyProfile(), null, 2)
  })
}

import fs from 'node:fs'
import path from 'node:path'
import { APP_DIR, BUN_EXE, PDFLATEX, REPO_ROOT, toAbs, todayISO, todayMMDD } from '../paths'
import { pickExampleFolder } from '../fsops/FolderScanner'

const TEMPLATE_PATH = path.join(APP_DIR, 'resources', 'prompts', 'build_application.md')
const SCOUT_TEMPLATE_PATH = path.join(APP_DIR, 'resources', 'prompts', 'scout_jobs.md')
const INTERVIEW_TEMPLATE_PATH = path.join(APP_DIR, 'resources', 'prompts', 'interview_prep.md')

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

export function loadTemplate(): string {
  return fs.readFileSync(TEMPLATE_PATH, 'utf-8')
}

export function fillSlots(template: string, s: PromptSlots): string {
  const example = pickExampleFolder() ?? 'documents/applications (pick the most complete folder)'
  const replacements: Record<string, string> = {
    SLUG: s.slug,
    POSTING_TEXT:
      s.postingText.trim() ||
      '(no text provided — use the screenshots below and/or WebFetch the apply URL to obtain the posting)',
    IMAGES_SECTION: imagesSection(s.imagePaths),
    APPLY_URL: s.applyUrl ?? 'not provided (note "apply on company site" in the answers file)',
    COMPANY_HINT: s.companyHint || 'derive from the posting',
    ROLE_HINT: s.roleHint || 'derive from the posting',
    TODAY_ISO: todayISO(),
    DATE_MMDD: todayMMDD(),
    EXAMPLE_FOLDER: example,
    PDFLATEX: PDFLATEX,
    REPO_ROOT: REPO_ROOT
  }
  let out = template
  for (const [key, value] of Object.entries(replacements)) {
    out = out.split(`{{${key}}}`).join(value)
  }
  return out
}

export function buildPrompt(slots: PromptSlots): string {
  return fillSlots(loadTemplate(), slots)
}

export function buildInterviewPrompt(s: {
  folderRel: string
  position: string
  company: string
}): string {
  let out = fs.readFileSync(INTERVIEW_TEMPLATE_PATH, 'utf-8')
  const replacements: Record<string, string> = {
    REPO_ROOT: REPO_ROOT,
    TODAY_ISO: todayISO(),
    FOLDER: s.folderRel,
    POSITION: s.position || 'the role',
    COMPANY: s.company || 'the company'
  }
  for (const [key, value] of Object.entries(replacements)) {
    out = out.split(`{{${key}}}`).join(value)
  }
  return out
}

export interface ScoutSlots {
  instructions: string
  excludeList: string[]
  outputPath: string
}

export function buildScoutPrompt(s: ScoutSlots): string {
  let out = fs.readFileSync(SCOUT_TEMPLATE_PATH, 'utf-8')
  const exclude =
    s.excludeList.length > 0
      ? s.excludeList.map((e) => `  - ${e}`).join('\n')
      : '  (nothing tracked yet)'
  const replacements: Record<string, string> = {
    REPO_ROOT: REPO_ROOT,
    TODAY_ISO: todayISO(),
    BUN: BUN_EXE,
    EXCLUDE_LIST: exclude,
    OUTPUT_PATH: s.outputPath,
    INSTRUCTIONS: s.instructions.trim() || '(none — run the standard sweep)'
  }
  for (const [key, value] of Object.entries(replacements)) {
    out = out.split(`{{${key}}}`).join(value)
  }
  return out
}

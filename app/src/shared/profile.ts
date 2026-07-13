// The candidate profile — the app's single source of truth, stored at
// <workspace>/profile.json. Pure types + defaults; shared by main and renderer.
// The agent prompts read everything about the candidate from here.

export const PROFILE_SCHEMA_ID = 'profile.v1'

export interface ProfileFile {
  schema: typeof PROFILE_SCHEMA_ID
  revision: number
  updatedAt: string
  identity: Identity
  education: EducationEntry[]
  experience: ExperienceEntry[]
  projects: ProjectEntry[]
  skills: SkillCategory[]
  certifications: Certification[]
  publications: Publication[]
  awards: Award[]
  behavioral: BehavioralProfile
  narrative: Narrative
  evaluation: EvaluationConfig
  tailoring: TailoringConfig
  searchConfig: SearchConfig
  documents: DocumentPrefs
  /** Free-form per-user agent rules the profile owner defines during setup
   *  (e.g. a rule that a certain job portal needs an extra note of a set length).
   *  Rendered into every build prompt. */
  customRules: string[]
  /** Onboarding: questions the extractor could not answer — surfaced in the wizard. */
  gaps: string[]
}

export interface Identity {
  fullName: string
  location: string
  phone: string
  email: string
  linkedin: string
  github: string
  website: string
  languages: { name: string; proficiency: string }[]
  workAuth: string
  status: string
}

export interface EducationEntry {
  degree: string
  institution: string
  location: string
  startDate: string
  endDate: string
  gpa: string | null
  thesis: string | null
  coursework: string[]
  notes: string | null
}

export interface ExperienceEntry {
  title: string
  company: string
  location: string
  startDate: string
  endDate: string // "" = present
  bullets: string[]
  technologies: string[]
  /** When to include this role on a tailored résumé; null = always. */
  inclusionRule: string | null
  /** Constraints on rewording (e.g. "keep all numeric results exactly"). */
  framingNotes: string | null
}

export interface ProjectEntry {
  name: string
  oneLiner: string
  bullets: string[]
  technologies: string[]
  url: string | null
  /** Phrases that must appear VERBATIM whenever this project is described. */
  mustKeepPhrases: string[]
  framingNotes: string | null
  inclusionRule: string | null
}

export interface SkillCategory {
  category: string
  items: string[]
}

export interface Certification {
  title: string
  issuer: string
  date: string | null
  inclusionRule: string | null
}

export interface Publication {
  citation: string
  url: string | null
}

export interface Award {
  title: string
  issuer: string
  date: string | null
  note: string | null
}

export interface BehavioralProfile {
  traits: string[]
  strengths: string[]
  growthAreas: string[]
  thrivesIn: string[]
  jobPostingLanguageMapping: { postingPhrase: string; candidateTrait: string }[]
  assessmentSource: string | null
}

export interface Story {
  id: string
  title: string
  text: string
  use: ('cover_letter' | 'interview' | 'answers')[]
}

export interface Narrative {
  whatExcites: string[]
  targetSectors: string[]
  dealBreakers: string[]
  stories: Story[]
}

export interface EvaluationConfig {
  dimensions: { name: string; weight: number; guidance: string }[]
  strongMatchAreas: string[]
  moderateMatchAreas: string[]
  weakMatchAreas: string[]
  calibrationNotes: string[]
}

export interface RoleProfile {
  /** Case-insensitive substrings matched against the posting title. */
  match: string[]
  label: string
  skillCategoryOrder: string[]
  projectPriority: string[]
  profileStatement: string | null
  notes: string | null
}

export interface TailoringConfig {
  roleProfiles: RoleProfile[]
  hardRules: string[]
}

export type EmploymentType = 'full-time' | 'part-time' | 'contract' | 'internship'

export interface SearchConfig {
  /** Ordered by priority: index 0 = highest. `priority` mirrors the 1-based position. */
  targetRoles: { title: string; priority: number }[]
  timing: { maxAgeDays: number }
  availability: string
  salary: {
    desired: string
    ftPostedMaxUsd: number | null
    internshipsExempt: boolean
  }
  teamPreference: string | null
  minCompanySize: number | null
  locationTiers: { tier: 'ideal' | 'acceptable' | 'borderline'; description: string }[]
  workModels: ('onsite' | 'hybrid' | 'remote')[]
  employmentTypes: EmploymentType[]
  excludeCompanies: string[]
  extraHardFilters: string[]
  boards: {
    jobright: { enabled: boolean; minSize: number | null; limit: number }
    linkedin: { enabled: boolean; queries: string[]; location: string; limitPerQuery: number }
    freehire: { enabled: boolean; queries: string[]; limitPerQuery: number }
  }
}

export interface DocumentPrefs {
  /** Sanitized output-file stem: "Jane_Doe" → Jane_Doe_Resume.tex. [A-Za-z0-9_]+ only. */
  fileBasename: string
  coverLetterWordRange: [number, number]
  coverLetterRegister: string
  answersTemplateNotes: string | null
}

export function emptyProfile(): ProfileFile {
  return {
    schema: PROFILE_SCHEMA_ID,
    revision: 0,
    updatedAt: new Date(0).toISOString(),
    identity: {
      fullName: '',
      location: '',
      phone: '',
      email: '',
      linkedin: '',
      github: '',
      website: '',
      languages: [],
      workAuth: '',
      status: ''
    },
    education: [],
    experience: [],
    projects: [],
    skills: [],
    certifications: [],
    publications: [],
    awards: [],
    behavioral: {
      traits: [],
      strengths: [],
      growthAreas: [],
      thrivesIn: [],
      jobPostingLanguageMapping: [],
      assessmentSource: null
    },
    narrative: { whatExcites: [], targetSectors: [], dealBreakers: [], stories: [] },
    evaluation: {
      dimensions: [],
      strongMatchAreas: [],
      moderateMatchAreas: [],
      weakMatchAreas: [],
      calibrationNotes: []
    },
    tailoring: {
      roleProfiles: [],
      hardRules: [
        'Never fabricate a skill, experience, metric, or company fact the candidate does not have.',
        'NO em-dashes: the characters — and --- must not appear anywhere in generated documents (date ranges use --).',
        'Every generated document must be exactly 1 page.'
      ]
    },
    searchConfig: {
      targetRoles: [],
      timing: { maxAgeDays: 14 },
      availability: '',
      salary: { desired: '', ftPostedMaxUsd: null, internshipsExempt: true },
      teamPreference: null,
      minCompanySize: null,
      locationTiers: [],
      workModels: ['onsite', 'hybrid', 'remote'],
      employmentTypes: [],
      excludeCompanies: [],
      extraHardFilters: [],
      boards: {
        jobright: { enabled: true, minSize: null, limit: 40 },
        linkedin: { enabled: true, queries: [], location: '', limitPerQuery: 25 },
        freehire: { enabled: false, queries: [], limitPerQuery: 25 }
      }
    },
    documents: {
      fileBasename: 'Candidate',
      coverLetterWordRange: [250, 280],
      coverLetterRegister:
        'formal; no casual sign-offs; close with "I would welcome the opportunity to discuss how I can contribute to [company]"',
      answersTemplateNotes: null
    },
    customRules: [],
    gaps: []
  }
}

export function sanitizeBasename(name: string): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return cleaned || 'Candidate'
}

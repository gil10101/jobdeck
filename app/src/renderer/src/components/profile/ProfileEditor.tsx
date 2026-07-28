import type {
  BehavioralProfile,
  EducationEntry,
  EvaluationConfig,
  ExperienceEntry,
  Identity,
  Narrative,
  ProfileFile,
  ProjectEntry,
  SearchConfig,
  Story
} from '@shared/profile'
import {
  CheckField,
  CommaList,
  EntryList,
  JsonBlock,
  NumField,
  Section,
  SelectField,
  StringList,
  TextAreaField,
  TextField,
  ToggleChips
} from './fields'
import CategoryPicker from './CategoryPicker'
import {
  EMPLOYMENT_TYPES,
  PROFICIENCY_OPTIONS,
  ROLE_TAXONOMY,
  WORK_AUTH_OPTIONS,
  WORK_MODELS
} from './roleTaxonomy'

const n = (v: string): string | null => (v.trim() ? v : null)

/** Every per-section form edits the whole ProfileFile: current value in,
 *  updated value out — so one draft object can flow through any section. */
export interface SectionFormProps {
  value: ProfileFile
  onChange: (p: ProfileFile) => void
}

export function IdentityForm({ value: p, onChange }: SectionFormProps): JSX.Element {
  const identity = (part: Partial<Identity>): void =>
    onChange({ ...p, identity: { ...p.identity, ...part } })
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Full name" value={p.identity.fullName} onChange={(v) => identity({ fullName: v })} />
        <TextField label="Location" value={p.identity.location} onChange={(v) => identity({ location: v })} />
        <TextField label="Email" value={p.identity.email} onChange={(v) => identity({ email: v })} />
        <TextField label="Phone" value={p.identity.phone} onChange={(v) => identity({ phone: v })} />
        <TextField label="LinkedIn" value={p.identity.linkedin} onChange={(v) => identity({ linkedin: v })} />
        <TextField label="GitHub" value={p.identity.github} onChange={(v) => identity({ github: v })} />
        <TextField label="Website" value={p.identity.website} onChange={(v) => identity({ website: v })} />
        <SelectField
          label="Work authorization"
          value={p.identity.workAuth}
          onChange={(v) => identity({ workAuth: v })}
          options={WORK_AUTH_OPTIONS}
          allowOther
        />
      </div>
      <div className="mt-2">
        <TextField label="Current status" value={p.identity.status} onChange={(v) => identity({ status: v })} placeholder="e.g. M.S. candidate, actively looking" />
      </div>
      <div className="mt-2">
        <EntryList
          items={p.identity.languages}
          onChange={(languages) => identity({ languages })}
          makeEmpty={() => ({ name: '', proficiency: '' })}
          title={(l) => l.name}
          addLabel="language"
          render={(l, set) => (
            <div className="mt-1 grid grid-cols-2 gap-2">
              <TextField label="Language" value={l.name} onChange={(v) => set({ name: v })} />
              <SelectField
                label="Proficiency"
                value={l.proficiency}
                onChange={(v) => set({ proficiency: v })}
                options={PROFICIENCY_OPTIONS}
                allowOther
              />
            </div>
          )}
        />
      </div>
    </>
  )
}

export function EducationForm({ value: p, onChange }: SectionFormProps): JSX.Element {
  return (
    <EntryList
      items={p.education}
      onChange={(education) => onChange({ ...p, education })}
      makeEmpty={(): EducationEntry => ({
        degree: '', institution: '', location: '', startDate: '', endDate: '',
        gpa: null, thesis: null, coursework: [], notes: null
      })}
      title={(e) => `${e.degree}${e.institution ? ` — ${e.institution}` : ''}`}
      addLabel="education entry"
      render={(e, set) => (
        <div className="mt-1">
          <div className="grid grid-cols-2 gap-2">
            <TextField label="Degree" value={e.degree} onChange={(v) => set({ degree: v })} />
            <TextField label="Institution" value={e.institution} onChange={(v) => set({ institution: v })} />
            <TextField label="Location" value={e.location} onChange={(v) => set({ location: v })} />
            <TextField label="GPA" value={e.gpa} onChange={(v) => set({ gpa: n(v) })} />
            <TextField label="Start" value={e.startDate} onChange={(v) => set({ startDate: v })} />
            <TextField label="End (expected ok)" value={e.endDate} onChange={(v) => set({ endDate: v })} />
          </div>
          <div className="mt-2">
            <TextField label="Thesis" value={e.thesis} onChange={(v) => set({ thesis: n(v) })} />
          </div>
          <CommaList label="Coursework" items={e.coursework} onChange={(coursework) => set({ coursework })} />
          <div className="mt-2">
            <TextField label="Notes" value={e.notes} onChange={(v) => set({ notes: n(v) })} />
          </div>
        </div>
      )}
    />
  )
}

export function ExperienceForm({ value: p, onChange }: SectionFormProps): JSX.Element {
  return (
    <EntryList
      items={p.experience}
      onChange={(experience) => onChange({ ...p, experience })}
      makeEmpty={(): ExperienceEntry => ({
        title: '', company: '', location: '', startDate: '', endDate: '',
        bullets: [], technologies: [], inclusionRule: null, framingNotes: null
      })}
      title={(e) => `${e.title}${e.company ? ` — ${e.company}` : ''}`}
      addLabel="experience entry"
      render={(e, set) => (
        <div className="mt-1">
          <div className="grid grid-cols-2 gap-2">
            <TextField label="Title" value={e.title} onChange={(v) => set({ title: v })} />
            <TextField label="Company" value={e.company} onChange={(v) => set({ company: v })} />
            <TextField label="Location" value={e.location} onChange={(v) => set({ location: v })} />
            <div className="grid grid-cols-2 gap-2">
              <TextField label="Start" value={e.startDate} onChange={(v) => set({ startDate: v })} />
              <TextField label="End (blank = present)" value={e.endDate} onChange={(v) => set({ endDate: v })} />
            </div>
          </div>
          <StringList label="Bullets" items={e.bullets} onChange={(bullets) => set({ bullets })} addLabel="bullet" />
          <div className="mt-2">
            <CommaList label="Technologies" items={e.technologies} onChange={(technologies) => set({ technologies })} />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <TextField label="Include when (blank = always)" value={e.inclusionRule} onChange={(v) => set({ inclusionRule: n(v) })} />
            <TextField label="Framing notes" value={e.framingNotes} onChange={(v) => set({ framingNotes: n(v) })} />
          </div>
        </div>
      )}
    />
  )
}

export function ProjectsForm({ value: p, onChange }: SectionFormProps): JSX.Element {
  return (
    <EntryList
      items={p.projects}
      onChange={(projects) => onChange({ ...p, projects })}
      makeEmpty={(): ProjectEntry => ({
        name: '', oneLiner: '', bullets: [], technologies: [], url: null,
        mustKeepPhrases: [], framingNotes: null, inclusionRule: null
      })}
      title={(pr) => pr.name}
      addLabel="project"
      render={(pr, set) => (
        <div className="mt-1">
          <div className="grid grid-cols-2 gap-2">
            <TextField label="Name" value={pr.name} onChange={(v) => set({ name: v })} />
            <TextField label="URL" value={pr.url} onChange={(v) => set({ url: n(v) })} />
          </div>
          <div className="mt-2">
            <TextField label="One-liner" value={pr.oneLiner} onChange={(v) => set({ oneLiner: v })} />
          </div>
          <StringList label="Bullets" items={pr.bullets} onChange={(bullets) => set({ bullets })} addLabel="bullet" />
          <div className="mt-2">
            <CommaList label="Technologies" items={pr.technologies} onChange={(technologies) => set({ technologies })} />
          </div>
          <StringList label="Must-keep phrases (verbatim)" items={pr.mustKeepPhrases} onChange={(mustKeepPhrases) => set({ mustKeepPhrases })} addLabel="phrase" />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <TextField label="Include when (blank = always)" value={pr.inclusionRule} onChange={(v) => set({ inclusionRule: n(v) })} />
            <TextField label="Framing notes" value={pr.framingNotes} onChange={(v) => set({ framingNotes: n(v) })} />
          </div>
        </div>
      )}
    />
  )
}

export function SkillsForm({ value: p, onChange }: SectionFormProps): JSX.Element {
  return (
    <EntryList
      items={p.skills}
      onChange={(skills) => onChange({ ...p, skills })}
      makeEmpty={() => ({ category: '', items: [] })}
      title={(s) => s.category}
      addLabel="category"
      render={(s, set) => (
        <div className="mt-1">
          <TextField label="Category" value={s.category} onChange={(v) => set({ category: v })} />
          <div className="mt-2">
            <CommaList label="Skills" items={s.items} onChange={(items) => set({ items })} />
          </div>
        </div>
      )}
    />
  )
}

export function CertificationsForm({ value: p, onChange }: SectionFormProps): JSX.Element {
  return (
    <EntryList
      items={p.certifications}
      onChange={(certifications) => onChange({ ...p, certifications })}
      makeEmpty={() => ({ title: '', issuer: '', date: null, inclusionRule: null })}
      title={(c) => c.title}
      addLabel="certification"
      render={(c, set) => (
        <div className="mt-1 grid grid-cols-2 gap-2">
          <TextField label="Title" value={c.title} onChange={(v) => set({ title: v })} />
          <TextField label="Issuer" value={c.issuer} onChange={(v) => set({ issuer: v })} />
          <TextField label="Date" value={c.date} onChange={(v) => set({ date: n(v) })} />
          <TextField label="Include when (blank = always)" value={c.inclusionRule} onChange={(v) => set({ inclusionRule: n(v) })} />
        </div>
      )}
    />
  )
}

export function PublicationsForm({ value: p, onChange }: SectionFormProps): JSX.Element {
  return (
    <EntryList
      items={p.publications}
      onChange={(publications) => onChange({ ...p, publications })}
      makeEmpty={() => ({ citation: '', url: null })}
      title={(x) => x.citation?.slice(0, 60) ?? ''}
      addLabel="publication"
      render={(x, set) => (
        <div className="mt-1">
          <TextField label="Citation" value={x.citation} onChange={(v) => set({ citation: v })} />
          <div className="mt-2">
            <TextField label="URL" value={x.url} onChange={(v) => set({ url: n(v) })} />
          </div>
        </div>
      )}
    />
  )
}

export function AwardsForm({ value: p, onChange }: SectionFormProps): JSX.Element {
  return (
    <EntryList
      items={p.awards}
      onChange={(awards) => onChange({ ...p, awards })}
      makeEmpty={() => ({ title: '', issuer: '', date: null, note: null })}
      title={(a) => a.title}
      addLabel="award"
      render={(a, set) => (
        <div className="mt-1 grid grid-cols-2 gap-2">
          <TextField label="Title" value={a.title} onChange={(v) => set({ title: v })} />
          <TextField label="Issuer" value={a.issuer} onChange={(v) => set({ issuer: v })} />
          <TextField label="Date" value={a.date} onChange={(v) => set({ date: n(v) })} />
          <TextField label="Note" value={a.note} onChange={(v) => set({ note: n(v) })} />
        </div>
      )}
    />
  )
}

export function BehavioralForm({ value: p, onChange }: SectionFormProps): JSX.Element {
  const behavioral = (part: Partial<BehavioralProfile>): void =>
    onChange({ ...p, behavioral: { ...p.behavioral, ...part } })
  return (
    <>
      <StringList label="Traits" items={p.behavioral.traits} onChange={(traits) => behavioral({ traits })} addLabel="trait" />
      <StringList label="Strengths" items={p.behavioral.strengths} onChange={(strengths) => behavioral({ strengths })} addLabel="strength" />
      <StringList label="Growth areas" items={p.behavioral.growthAreas} onChange={(growthAreas) => behavioral({ growthAreas })} addLabel="growth area" />
      <StringList label="Thrives in" items={p.behavioral.thrivesIn} onChange={(thrivesIn) => behavioral({ thrivesIn })} addLabel="item" />
      <div className="mt-2">
        <TextField label="Assessment source" value={p.behavioral.assessmentSource} onChange={(v) => behavioral({ assessmentSource: n(v) })} />
      </div>
      <JsonBlock
        label="Posting-language mapping"
        value={p.behavioral.jobPostingLanguageMapping}
        onChange={(jobPostingLanguageMapping) => behavioral({ jobPostingLanguageMapping })}
      />
    </>
  )
}

export function NarrativeForm({ value: p, onChange }: SectionFormProps): JSX.Element {
  const narrative = (part: Partial<Narrative>): void =>
    onChange({ ...p, narrative: { ...p.narrative, ...part } })
  return (
    <>
      <StringList label="What excites" items={p.narrative.whatExcites} onChange={(whatExcites) => narrative({ whatExcites })} addLabel="item" />
      <StringList label="Target sectors" items={p.narrative.targetSectors} onChange={(targetSectors) => narrative({ targetSectors })} addLabel="sector" />
      <StringList label="Deal-breakers" items={p.narrative.dealBreakers} onChange={(dealBreakers) => narrative({ dealBreakers })} addLabel="deal-breaker" />
      <div className="mt-2">
        <EntryList
          items={p.narrative.stories}
          onChange={(stories) => narrative({ stories })}
          makeEmpty={(): Story => ({
            id: `story_${p.narrative.stories.length + 1}`, title: '', text: '', use: []
          })}
          title={(s) => s.title}
          addLabel="story"
          render={(s, set) => (
            <div className="mt-1">
              <TextField label="Title" value={s.title} onChange={(v) => set({ title: v })} />
              <div className="mt-2">
                <TextAreaField label="Story" value={s.text} onChange={(v) => set({ text: v })} rows={4} />
              </div>
              <div className="mt-1 flex gap-3">
                {(['cover_letter', 'interview', 'answers'] as const).map((tag) => (
                  <CheckField
                    key={tag}
                    label={tag.replace('_', ' ')}
                    checked={(s.use ?? []).includes(tag)}
                    onChange={(on) =>
                      set({ use: on ? [...(s.use ?? []), tag] : (s.use ?? []).filter((u) => u !== tag) })
                    }
                  />
                ))}
              </div>
            </div>
          )}
        />
      </div>
    </>
  )
}

export function EvaluationForm({ value: p, onChange }: SectionFormProps): JSX.Element {
  const evaluation = (part: Partial<EvaluationConfig>): void =>
    onChange({ ...p, evaluation: { ...p.evaluation, ...part } })
  return (
    <>
      <StringList label="Strong match areas" items={p.evaluation.strongMatchAreas} onChange={(strongMatchAreas) => evaluation({ strongMatchAreas })} addLabel="area" />
      <StringList label="Moderate match areas" items={p.evaluation.moderateMatchAreas} onChange={(moderateMatchAreas) => evaluation({ moderateMatchAreas })} addLabel="area" />
      <StringList label="Weak match areas" items={p.evaluation.weakMatchAreas} onChange={(weakMatchAreas) => evaluation({ weakMatchAreas })} addLabel="area" />
      <StringList label="Calibration notes" items={p.evaluation.calibrationNotes} onChange={(calibrationNotes) => evaluation({ calibrationNotes })} addLabel="note" />
      <JsonBlock label="Dimensions" value={p.evaluation.dimensions} onChange={(dimensions) => evaluation({ dimensions })} />
    </>
  )
}

export function TailoringForm({ value: p, onChange }: SectionFormProps): JSX.Element {
  return (
    <>
      <StringList
        label="Hard rules"
        items={p.tailoring.hardRules}
        onChange={(hardRules) => onChange({ ...p, tailoring: { ...p.tailoring, hardRules } })}
        addLabel="rule"
      />
      <JsonBlock
        label="Role profiles"
        value={p.tailoring.roleProfiles}
        onChange={(roleProfiles) => onChange({ ...p, tailoring: { ...p.tailoring, roleProfiles } })}
      />
    </>
  )
}

export function SearchConfigForm({ value: p, onChange }: SectionFormProps): JSX.Element {
  const search = (part: Partial<SearchConfig>): void =>
    onChange({ ...p, searchConfig: { ...p.searchConfig, ...part } })
  return (
    <>
      <div className="text-[10px] uppercase tracking-wide text-gray-500">
        Target roles <span className="normal-case text-gray-600">(order = priority)</span>
      </div>
      <div className="mt-1">
        <CategoryPicker
          taxonomy={ROLE_TAXONOMY}
          selected={p.searchConfig.targetRoles}
          onChange={(targetRoles) => search({ targetRoles })}
        />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <TextField label="Availability" value={p.searchConfig.availability} onChange={(v) => search({ availability: v })} />
        <TextField
          label="Desired salary"
          value={p.searchConfig.salary.desired}
          onChange={(v) => search({ salary: { ...p.searchConfig.salary, desired: v } })}
        />
        <NumField
          label="FT posted-max ceiling (USD)"
          value={p.searchConfig.salary.ftPostedMaxUsd}
          onChange={(ftPostedMaxUsd) => search({ salary: { ...p.searchConfig.salary, ftPostedMaxUsd } })}
        />
        <NumField label="Min company size" value={p.searchConfig.minCompanySize} onChange={(minCompanySize) => search({ minCompanySize })} />
        <NumField
          label="Max posting age (days)"
          value={p.searchConfig.timing.maxAgeDays}
          onChange={(v) => search({ timing: { maxAgeDays: v ?? 14 } })}
        />
        <TextField label="Team preference" value={p.searchConfig.teamPreference} onChange={(v) => search({ teamPreference: n(v) })} />
      </div>
      <div className="mt-2 flex items-center gap-4">
        <CheckField
          label="internships exempt from salary ceiling"
          checked={p.searchConfig.salary.internshipsExempt}
          onChange={(internshipsExempt) => search({ salary: { ...p.searchConfig.salary, internshipsExempt } })}
        />
      </div>
      <div className="mt-2 text-[10px] uppercase tracking-wide text-gray-500">Work models</div>
      <ToggleChips
        options={WORK_MODELS}
        selected={p.searchConfig.workModels}
        onChange={(workModels) => search({ workModels })}
      />
      <div className="mt-2 text-[10px] uppercase tracking-wide text-gray-500">Employment types</div>
      <ToggleChips
        options={EMPLOYMENT_TYPES}
        selected={p.searchConfig.employmentTypes ?? []}
        onChange={(employmentTypes) => search({ employmentTypes })}
      />
      <div className="mt-2">
        <EntryList
          items={p.searchConfig.locationTiers}
          onChange={(locationTiers) => search({ locationTiers })}
          makeEmpty={() => ({ tier: 'ideal' as const, description: '' })}
          title={(t) => `${t.tier}: ${t.description?.slice(0, 50) ?? ''}`}
          addLabel="location tier"
          render={(t, set) => (
            <div className="mt-1 grid grid-cols-[110px_1fr] gap-2">
              <label className="block">
                <span className="text-[10px] uppercase tracking-wide text-gray-500">Tier</span>
                <select
                  className="input mt-0.5 w-full text-[11px]"
                  value={t.tier}
                  onChange={(e) => set({ tier: e.target.value as 'ideal' | 'acceptable' | 'borderline' })}
                >
                  <option value="ideal">ideal</option>
                  <option value="acceptable">acceptable</option>
                  <option value="borderline">borderline</option>
                </select>
              </label>
              <TextField label="Description" value={t.description} onChange={(v) => set({ description: v })} />
            </div>
          )}
        />
      </div>
      <StringList label="Excluded companies" items={p.searchConfig.excludeCompanies} onChange={(excludeCompanies) => search({ excludeCompanies })} addLabel="company" />
      <StringList label="Extra hard filters" items={p.searchConfig.extraHardFilters} onChange={(extraHardFilters) => search({ extraHardFilters })} addLabel="filter" />
      <JsonBlock label="Boards" value={p.searchConfig.boards} onChange={(boards) => search({ boards })} />
    </>
  )
}

export function DocumentsForm({ value: p, onChange }: SectionFormProps): JSX.Element {
  const patch = (part: Partial<ProfileFile>): void => onChange({ ...p, ...part })
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <TextField
          label="File basename (Name_Resume.pdf)"
          value={p.documents.fileBasename}
          onChange={(v) => patch({ documents: { ...p.documents, fileBasename: v } })}
        />
        <div className="grid grid-cols-2 gap-2">
          <NumField
            label="CL words min"
            value={p.documents.coverLetterWordRange[0]}
            onChange={(v) =>
              patch({
                documents: {
                  ...p.documents,
                  coverLetterWordRange: [v ?? 250, p.documents.coverLetterWordRange[1]]
                }
              })
            }
          />
          <NumField
            label="CL words max"
            value={p.documents.coverLetterWordRange[1]}
            onChange={(v) =>
              patch({
                documents: {
                  ...p.documents,
                  coverLetterWordRange: [p.documents.coverLetterWordRange[0], v ?? 280]
                }
              })
            }
          />
        </div>
      </div>
      <div className="mt-2">
        <TextAreaField
          label="Cover letter register"
          value={p.documents.coverLetterRegister}
          onChange={(v) => patch({ documents: { ...p.documents, coverLetterRegister: v } })}
          rows={2}
        />
      </div>
      <div className="mt-2">
        <TextAreaField
          label="Answers template notes"
          value={p.documents.answersTemplateNotes}
          onChange={(v) => patch({ documents: { ...p.documents, answersTemplateNotes: n(v) } })}
          rows={2}
        />
      </div>
    </>
  )
}

export function CustomRulesForm({ value: p, onChange }: SectionFormProps): JSX.Element {
  return (
    <StringList items={p.customRules} onChange={(customRules) => onChange({ ...p, customRules })} addLabel="rule" />
  )
}

export interface ProfileSection {
  key: string
  title: string
  summary: (p: ProfileFile) => string
  defaultOpen: (p: ProfileFile) => boolean
  Form: (props: SectionFormProps) => JSX.Element
}

/** Single source of truth for the editor's sections: the Settings editor
 *  renders them as collapsible rows, the Who I am edit mode as a nav list. */
export const PROFILE_SECTIONS: ProfileSection[] = [
  { key: 'identity', title: 'Identity', summary: (p) => p.identity.fullName, defaultOpen: () => true, Form: IdentityForm },
  { key: 'education', title: 'Education', summary: (p) => `${p.education.length}`, defaultOpen: (p) => p.education.length > 0, Form: EducationForm },
  { key: 'experience', title: 'Experience', summary: (p) => `${p.experience.length}`, defaultOpen: (p) => p.experience.length > 0, Form: ExperienceForm },
  { key: 'projects', title: 'Projects', summary: (p) => `${p.projects.length}`, defaultOpen: (p) => p.projects.length > 0, Form: ProjectsForm },
  { key: 'skills', title: 'Skills', summary: (p) => `${p.skills.length} categories`, defaultOpen: (p) => p.skills.length > 0, Form: SkillsForm },
  { key: 'certifications', title: 'Certifications', summary: (p) => `${p.certifications.length}`, defaultOpen: () => false, Form: CertificationsForm },
  { key: 'publications', title: 'Publications', summary: (p) => `${p.publications.length}`, defaultOpen: () => false, Form: PublicationsForm },
  { key: 'awards', title: 'Awards', summary: (p) => `${p.awards.length}`, defaultOpen: () => false, Form: AwardsForm },
  { key: 'behavioral', title: 'Behavioral', summary: (p) => `${p.behavioral.traits.length + p.behavioral.strengths.length} items`, defaultOpen: () => false, Form: BehavioralForm },
  { key: 'narrative', title: 'Narrative & stories', summary: (p) => `${p.narrative.stories.length} stories`, defaultOpen: () => false, Form: NarrativeForm },
  { key: 'evaluation', title: 'Fit evaluation', summary: (p) => `${p.evaluation.dimensions.length} dimensions`, defaultOpen: () => false, Form: EvaluationForm },
  { key: 'tailoring', title: 'Tailoring', summary: (p) => `${p.tailoring.roleProfiles.length} role profiles`, defaultOpen: () => false, Form: TailoringForm },
  { key: 'searchConfig', title: 'Job search', summary: (p) => `${p.searchConfig.targetRoles.length} target roles`, defaultOpen: () => false, Form: SearchConfigForm },
  { key: 'documents', title: 'Documents', summary: (p) => p.documents.fileBasename, defaultOpen: () => false, Form: DocumentsForm },
  { key: 'customRules', title: 'Custom agent rules', summary: (p) => `${p.customRules.length}`, defaultOpen: () => false, Form: CustomRulesForm }
]

/**
 * Structured, human-readable editor for the whole ProfileFile. Deeply nested
 * config (role profiles, evaluation dimensions, boards, language mapping)
 * stays behind small per-section JSON escape hatches.
 * schema/revision/updatedAt are carried through untouched, never rendered.
 */
export default function ProfileEditor(props: {
  value: ProfileFile
  onChange: (p: ProfileFile) => void
}): JSX.Element {
  return (
    <div>
      {PROFILE_SECTIONS.map(({ key, title, summary, defaultOpen, Form }) => (
        <Section key={key} title={title} summary={summary(props.value)} defaultOpen={defaultOpen(props.value)}>
          <Form value={props.value} onChange={props.onChange} />
        </Section>
      ))}
    </div>
  )
}

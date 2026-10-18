// "Who I am" page: everything the agents know about the user, in one place —
// the full profile, the master résumé context, and the knowledge base. Edit
// switches to an in-view section-by-section editor over a single draft; the
// per-section forms are the same components the Settings editor renders.

import { useEffect, useState } from 'react'
import { SquarePen, UserRound, X } from 'lucide-react'
import type { ProfileFile } from '@shared/profile'
import type { FolderEntry } from '@shared/types'
import { call, onPush } from '../api'
import { useApp } from '../store'
import { PROFILE_SECTIONS } from '../components/profile/ProfileEditor'
import SkillsChipEditor from '../components/profile/SkillsChipEditor'

interface KnowledgeInfo {
  notes: string
  files: FolderEntry[]
}

/** "start – end", with an explicit Present while the end is open. */
function formatDates(start: string, end: string): string {
  if (!start && !end) return ''
  if (!end) return `${start} – Present`
  if (!start) return end
  return `${start} – ${end}`
}

function Section({
  title,
  note,
  children
}: {
  title: string
  note?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="panel mt-4 px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <div className="text-[10px] font-bold uppercase tracking-wide text-muted">{title}</div>
        {note && <div className="text-[10px] text-gray-600">{note}</div>}
      </div>
      {children}
    </div>
  )
}

/** One entry in a list section (a role, a project, a degree…). */
function Entry({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="border-b border-edge/50 py-3 last:border-b-0 last:pb-0">{children}</div>
}

function Chips({ items }: { items: string[] }): JSX.Element | null {
  if (items.length === 0) return null
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {items.map((item, i) => (
        <span key={`${item}-${i}`} className="chip">
          {item}
        </span>
      ))}
    </div>
  )
}

function LabeledChips({ label, items }: { label: string; items: string[] }): JSX.Element | null {
  if (items.length === 0) return null
  return (
    <div className="mt-2">
      <div className="text-[11px] font-medium text-gray-400">{label}</div>
      <Chips items={items} />
    </div>
  )
}

function Bullets({ items }: { items: string[] }): JSX.Element | null {
  if (items.length === 0) return null
  return (
    <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs leading-relaxed text-gray-300">
      {items.map((b, i) => (
        <li key={i}>{b}</li>
      ))}
    </ul>
  )
}

/** Muted per-entry instruction the agents follow when they use the entry. */
function Guidance({ kind, text }: { kind: string; text: string }): JSX.Element {
  return (
    <div className="mt-1 flex items-baseline gap-1.5 text-[11px] leading-relaxed">
      <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-gray-600">
        {kind}
      </span>
      <span className="italic text-gray-500">{text}</span>
    </div>
  )
}

function ExternalLink({ url }: { url: string }): JSX.Element {
  return (
    <button
      className="text-[11px] text-cyan-500 hover:underline"
      onClick={() => void call('app:openExternal', { url }).catch(() => undefined)}
    >
      {url}
    </button>
  )
}

function PreBlock({ text }: { text: string }): JSX.Element {
  return (
    <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-edge bg-bg px-3 py-2 font-mono text-[11px] leading-relaxed text-gray-300">
      {text}
    </pre>
  )
}

export default function WhoAmIView(): JSX.Element {
  const toast = useApp((s) => s.toast)
  const navigate = useApp((s) => s.navigate)
  const materialRev = useApp((s) => s.materialRev)
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<ProfileFile | null>(null)
  const [masterContext, setMasterContext] = useState('')
  const [kb, setKb] = useState<KnowledgeInfo>({ notes: '', files: [] })
  // Edit mode: non-null draft = editing; all section forms mutate this one
  // object and a single Save validates + persists every change at once.
  const [draft, setDraft] = useState<ProfileFile | null>(null)
  const [sectionKey, setSectionKey] = useState(PROFILE_SECTIONS[0].key)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void Promise.all([
      call('profile:get', undefined).catch(() => null),
      call('master:getContext', undefined).catch(() => ({ text: '' })),
      call('knowledge:get', undefined).catch((): KnowledgeInfo => ({ notes: '', files: [] }))
    ]).then(([p, master, knowledge]) => {
      setProfile(p)
      setMasterContext(master.text)
      setKb(knowledge)
      setLoading(false)
    })
  }, [])

  // Material changed elsewhere (Settings, Library): refresh the read-only
  // context and knowledge sections. The profile has its own push below.
  useEffect(() => {
    if (materialRev === 0) return
    void call('master:getContext', undefined)
      .then(({ text }) => setMasterContext(text))
      .catch(() => undefined)
    void call('knowledge:get', undefined).then(setKb).catch(() => undefined)
  }, [materialRev])

  const removeKbFile = async (name: string): Promise<void> => {
    try {
      const { removed } = await call('knowledge:removeFile', { name })
      if (removed) setKb((prev) => ({ ...prev, files: prev.files.filter((f) => f.name !== name) }))
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  // Clearing setup completion flips App's gate straight to the wizard.
  const rerunSetup = async (): Promise<void> => {
    try {
      await call('onboarding:reset', undefined)
      await useApp.getState().refreshConfig()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  // Assistant-made profile edits land while this tab is open — refetch on
  // push, but never while an edit draft is in progress (it must not be lost).
  useEffect(() => {
    if (draft) return
    return onPush('push:storeChanged', ({ domains }) => {
      if (!domains.includes('profile')) return
      void call('profile:get', undefined).then(setProfile).catch(() => undefined)
    })
  }, [draft])

  const save = async (): Promise<void> => {
    if (!draft) return
    setSaving(true)
    try {
      const saved = await call('profile:save', { profile: draft })
      setProfile(saved)
      setDraft(null)
      toast('Profile saved — every agent sees the update immediately', 'success')
    } catch (err) {
      // Typically a validation refusal — keep the draft so nothing is lost.
      toast(String(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading…</div>

  if (!profile) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="panel flex max-w-md flex-col items-center px-8 py-10 text-center">
          <UserRound size={28} strokeWidth={1.5} className="text-gray-500" />
          <div className="mt-3 text-sm font-semibold text-gray-100">No profile yet</div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">
            Your profile is the source for every search, evaluation, and generated document.
            Build it from your résumé — upload a file, pick one, or paste text — and review it
            before anything is saved. Until then, builds read your uploaded files directly.
          </p>
          <div className="mt-4 flex gap-2">
            <button
              className="btn btn-primary"
              onClick={() => navigate({ view: 'settings' })}
            >
              Set up my profile
            </button>
            <button className="btn" onClick={() => void rerunSetup()}>
              Re-run setup wizard
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (draft) {
    const section = PROFILE_SECTIONS.find((s) => s.key === sectionKey) ?? PROFILE_SECTIONS[0]
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 border-b border-edge bg-panel px-4 py-2.5">
          <SquarePen size={14} className="shrink-0 text-cyan-300" />
          <h1 className="text-sm font-semibold text-gray-100">Editing profile</h1>
          <span className="text-[11px] text-gray-500">
            Changes stay in a draft until you Save.
          </span>
        </div>
        <div className="flex min-h-0 flex-1">
          <nav className="w-48 shrink-0 overflow-auto border-r border-edge bg-panel py-2">
            {PROFILE_SECTIONS.map((s) => (
              <button
                key={s.key}
                className={`block w-full px-4 py-1.5 text-left text-[11px] ${
                  s.key === section.key
                    ? 'bg-cyan-950/60 font-medium text-cyan-200'
                    : 'text-gray-400 hover:bg-panel2 hover:text-gray-200'
                }`}
                onClick={() => setSectionKey(s.key)}
              >
                {s.title}
              </button>
            ))}
          </nav>
          <div className="min-w-0 flex-1 overflow-auto px-6 py-4">
            <div className="mx-auto max-w-3xl">
              <div className="text-[10px] font-bold uppercase tracking-wide text-muted">
                {section.title}
              </div>
              <div className="mt-2">
                {section.key === 'skills' ? (
                  <SkillsChipEditor
                    value={draft.skills}
                    onChange={(skills) => setDraft({ ...draft, skills })}
                  />
                ) : (
                  <section.Form value={draft} onChange={setDraft} />
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-edge bg-panel px-4 py-2.5">
          <button className="btn btn-green" disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button className="btn" disabled={saving} onClick={() => setDraft(null)}>
            Cancel
          </button>
          <span className="text-[10px] text-gray-600">
            Save validates and writes every changed section at once; Cancel discards the draft.
          </span>
        </div>
      </div>
    )
  }

  const id = profile.identity
  const contact = [id.location, id.email, id.phone, id.linkedin, id.github, id.website].filter(
    Boolean
  )
  const b = profile.behavioral
  const behavioralEmpty =
    b.traits.length === 0 &&
    b.strengths.length === 0 &&
    b.growthAreas.length === 0 &&
    b.thrivesIn.length === 0
  const n = profile.narrative
  const narrativeEmpty =
    n.whatExcites.length === 0 &&
    n.targetSectors.length === 0 &&
    n.dealBreakers.length === 0 &&
    n.stories.length === 0
  const sc = profile.searchConfig
  const salaryBits = [
    sc.salary.desired && `desired ${sc.salary.desired}`,
    sc.salary.ftPostedMaxUsd !== null &&
      `posted full-time max $${sc.salary.ftPostedMaxUsd.toLocaleString()}`,
    sc.salary.internshipsExempt && 'internships exempt'
  ].filter(Boolean)

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-4xl p-6 pb-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-sm font-semibold text-gray-100">Who I am</h1>
            <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
              Everything the agents know about you — sourced from your profile, master context, and
              knowledge base.
            </p>
          </div>
          <button
            className="btn shrink-0"
            onClick={() => {
              setSectionKey(PROFILE_SECTIONS[0].key)
              setDraft(structuredClone(profile))
            }}
          >
            <SquarePen size={13} />
            Edit
          </button>
        </div>

        <Section title="Identity">
          <div className="mt-2 text-lg font-semibold leading-tight text-gray-100">
            {id.fullName || 'Unnamed'}
          </div>
          {contact.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-400">
              {contact.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </div>
          )}
          {(id.workAuth || id.status || id.languages.length > 0) && (
            <div className="mt-2 flex flex-col gap-0.5 text-[11px]">
              {id.workAuth && (
                <div>
                  <span className="text-gray-500">Work authorization: </span>
                  <span className="text-gray-300">{id.workAuth}</span>
                </div>
              )}
              {id.status && (
                <div>
                  <span className="text-gray-500">Status: </span>
                  <span className="text-gray-300">{id.status}</span>
                </div>
              )}
              {id.languages.length > 0 && (
                <div>
                  <span className="text-gray-500">Languages: </span>
                  <span className="text-gray-300">
                    {id.languages.map((l) => `${l.name} (${l.proficiency})`).join(', ')}
                  </span>
                </div>
              )}
            </div>
          )}
        </Section>

        {profile.education.length > 0 && (
          <Section title="Education">
            {profile.education.map((e, i) => (
              <Entry key={i}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <div className="text-xs font-semibold text-gray-100">
                    {e.degree} <span className="font-normal text-gray-400">· {e.institution}</span>
                  </div>
                  <div className="text-[11px] text-gray-500">
                    {[formatDates(e.startDate, e.endDate), e.location].filter(Boolean).join(' · ')}
                  </div>
                </div>
                {e.gpa && <div className="mt-1 text-[11px] text-gray-400">GPA {e.gpa}</div>}
                {e.thesis && <div className="mt-1 text-[11px] text-gray-400">Thesis: {e.thesis}</div>}
                <Chips items={e.coursework} />
                {e.notes && <Guidance kind="notes" text={e.notes} />}
              </Entry>
            ))}
          </Section>
        )}

        {profile.experience.length > 0 && (
          <Section title="Experience">
            {profile.experience.map((e, i) => (
              <Entry key={i}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <div className="text-xs font-semibold text-gray-100">
                    {e.title} <span className="font-normal text-gray-400">@ {e.company}</span>
                  </div>
                  <div className="text-[11px] text-gray-500">
                    {[formatDates(e.startDate, e.endDate), e.location].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <Bullets items={e.bullets} />
                <Chips items={e.technologies} />
                {e.inclusionRule && <Guidance kind="inclusion rule" text={e.inclusionRule} />}
                {e.framingNotes && <Guidance kind="framing" text={e.framingNotes} />}
              </Entry>
            ))}
          </Section>
        )}

        {profile.projects.length > 0 && (
          <Section title="Projects">
            {profile.projects.map((p, i) => (
              <Entry key={i}>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <div className="text-xs font-semibold text-gray-100">{p.name}</div>
                  {p.oneLiner && <div className="text-[11px] text-gray-400">{p.oneLiner}</div>}
                </div>
                {p.url && (
                  <div className="mt-0.5">
                    <ExternalLink url={p.url} />
                  </div>
                )}
                <Bullets items={p.bullets} />
                <Chips items={p.technologies} />
                {p.mustKeepPhrases.length > 0 && (
                  <Guidance
                    kind="keep verbatim"
                    text={p.mustKeepPhrases.map((s) => `“${s}”`).join(' · ')}
                  />
                )}
                {p.framingNotes && <Guidance kind="framing" text={p.framingNotes} />}
                {p.inclusionRule && <Guidance kind="inclusion rule" text={p.inclusionRule} />}
              </Entry>
            ))}
          </Section>
        )}

        {profile.skills.length > 0 && (
          <Section title="Skills">
            {profile.skills.map((c) => (
              <div
                key={c.category}
                className="flex items-start gap-3 border-b border-edge/50 py-2 last:border-b-0 last:pb-0"
              >
                <div className="w-36 shrink-0 pt-1 text-[11px] font-medium text-gray-400">
                  {c.category}
                </div>
                <div className="flex flex-wrap gap-1">
                  {c.items.map((s, i) => (
                    <span key={`${s}-${i}`} className="chip">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </Section>
        )}

        {profile.certifications.length > 0 && (
          <Section title="Certifications">
            {profile.certifications.map((c, i) => (
              <Entry key={i}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <div className="text-xs font-medium text-gray-100">
                    {c.title}
                    {c.issuer && <span className="font-normal text-gray-400"> · {c.issuer}</span>}
                  </div>
                  {c.date && <div className="text-[11px] text-gray-500">{c.date}</div>}
                </div>
                {c.inclusionRule && <Guidance kind="inclusion rule" text={c.inclusionRule} />}
              </Entry>
            ))}
          </Section>
        )}

        {profile.publications.length > 0 && (
          <Section title="Publications">
            {profile.publications.map((p, i) => (
              <Entry key={i}>
                <div className="text-[11px] leading-relaxed text-gray-300">{p.citation}</div>
                {p.url && (
                  <div className="mt-0.5">
                    <ExternalLink url={p.url} />
                  </div>
                )}
              </Entry>
            ))}
          </Section>
        )}

        {profile.awards.length > 0 && (
          <Section title="Awards">
            {profile.awards.map((a, i) => (
              <Entry key={i}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <div className="text-xs font-medium text-gray-100">
                    {a.title}
                    {a.issuer && <span className="font-normal text-gray-400"> · {a.issuer}</span>}
                  </div>
                  {a.date && <div className="text-[11px] text-gray-500">{a.date}</div>}
                </div>
                {a.note && <div className="mt-1 text-[11px] text-gray-400">{a.note}</div>}
              </Entry>
            ))}
          </Section>
        )}

        {!behavioralEmpty && (
          <Section title="Behavioral profile" note="how the agents read your working style">
            <LabeledChips label="Traits" items={b.traits} />
            <LabeledChips label="Strengths" items={b.strengths} />
            <LabeledChips label="Growth areas" items={b.growthAreas} />
            <LabeledChips label="Thrives in" items={b.thrivesIn} />
            {b.assessmentSource && (
              <div className="mt-2 text-[10px] text-gray-600">Source: {b.assessmentSource}</div>
            )}
          </Section>
        )}

        {!narrativeEmpty && (
          <Section title="Narrative">
            {n.whatExcites.length > 0 && (
              <div className="mt-2">
                <div className="text-[11px] font-medium text-gray-400">What excites me</div>
                <Bullets items={n.whatExcites} />
              </div>
            )}
            <LabeledChips label="Target sectors" items={n.targetSectors} />
            {n.dealBreakers.length > 0 && (
              <div className="mt-2">
                <div className="text-[11px] font-medium text-gray-400">Deal-breakers</div>
                <Bullets items={n.dealBreakers} />
              </div>
            )}
            {n.stories.length > 0 && (
              <div className="mt-2">
                <div className="text-[11px] font-medium text-gray-400">Stories</div>
                {n.stories.map((s) => (
                  <div key={s.id} className="mt-1.5 rounded-md border border-edge bg-bg px-3 py-2">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <div className="text-[11px] font-medium text-gray-200">{s.title}</div>
                      <div className="text-[10px] text-gray-600">
                        {s.use.map((u) => u.replace('_', ' ')).join(' · ')}
                      </div>
                    </div>
                    <div className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-gray-400">
                      {s.text}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}

        <Section title="Search config" note="what the scouts hunt for">
          {sc.targetRoles.length > 0 && (
            <div className="mt-2">
              <div className="text-[11px] font-medium text-gray-400">
                Target roles, highest priority first
              </div>
              <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-xs text-gray-300">
                {[...sc.targetRoles]
                  .sort((x, y) => x.priority - y.priority)
                  .map((r) => (
                    <li key={r.title}>{r.title}</li>
                  ))}
              </ol>
            </div>
          )}
          {salaryBits.length > 0 && (
            <div className="mt-2 text-[11px]">
              <span className="text-gray-500">Salary: </span>
              <span className="text-gray-300">{salaryBits.join(' · ')}</span>
            </div>
          )}
          {sc.locationTiers.length > 0 && (
            <div className="mt-2">
              <div className="text-[11px] font-medium text-gray-400">Locations</div>
              <div className="mt-1 flex flex-col gap-0.5 text-[11px]">
                {sc.locationTiers.map((t, i) => (
                  <div key={i}>
                    <span className="text-gray-500">{t.tier}: </span>
                    <span className="text-gray-300">{t.description}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <LabeledChips label="Employment types" items={sc.employmentTypes} />
          <LabeledChips label="Work models" items={sc.workModels} />
        </Section>

        <Section title="Master résumé context" note="may be listed on documents">
          {masterContext.trim() ? (
            <PreBlock text={masterContext} />
          ) : (
            <div className="mt-2 text-[11px] text-gray-500">
              Empty — the agents work from the profile above alone.
            </div>
          )}
        </Section>

        <Section title="Knowledge base" note="background only — never on documents">
          {kb.notes.trim() ? (
            <PreBlock text={kb.notes} />
          ) : (
            <div className="mt-2 text-[11px] text-gray-500">No notes.</div>
          )}
          {kb.files.length > 0 && (
            <div className="mt-2 flex flex-col gap-1">
              {kb.files.map((f) => (
                <div
                  key={f.name}
                  className="group flex items-center gap-2 rounded-md border border-edge px-2 py-1 text-[11px]"
                >
                  <span className="min-w-0 flex-1 truncate text-gray-300">
                    {f.name}
                    {f.kind === 'dir' ? '/' : ''}
                  </span>
                  {f.kind === 'file' && <span className="shrink-0 text-[10px] text-gray-600">{f.sizeKb} KB</span>}
                  <button
                    className="shrink-0 text-gray-500 opacity-0 hover:text-red-400 focus:opacity-100 group-hover:opacity-100"
                    onClick={() => void removeKbFile(f.name)}
                    aria-label={`Remove ${f.name} from the knowledge base`}
                    title="Move to the trash"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>

        {(profile.tailoring.hardRules.length > 0 || profile.customRules.length > 0) && (
          <Section title="Tailoring hard rules" note="enforced on every generated document">
            {profile.tailoring.hardRules.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-[11px] leading-relaxed text-gray-300">
                {profile.tailoring.hardRules.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
            {profile.customRules.length > 0 && (
              <>
                <div className="mt-3 text-[11px] font-medium text-gray-400">Your custom rules</div>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-[11px] leading-relaxed text-gray-300">
                  {profile.customRules.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </>
            )}
          </Section>
        )}
      </div>
    </div>
  )
}

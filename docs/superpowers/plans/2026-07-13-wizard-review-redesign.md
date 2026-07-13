# Wizard Review Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw-JSON profile review (onboarding wizard + Settings) with a structured editor plus per-gap answer inputs whose answers an agent run merges into the profile.

**Architecture:** A shared `ProfileEditor` React component (sectioned, collapsible, object-state) replaces both JSON textareas. Gap answers go through a new "refine" variant of the existing `onboard` run kind: same output path (`TMP_DIR/profile.draft.json`), same `finalizeOnboard` validation, new prompt template. `library:upload` additionally returns copied file names for display.

**Tech Stack:** Electron + electron-vite, React 18, TypeScript, Tailwind (existing `panel`/`input`/`btn`/`chip` classes), zustand store via existing `call`/`onPush` IPC helpers.

**Spec:** `docs/superpowers/specs/2026-07-13-wizard-review-redesign-design.md`

## Global Constraints

- No test framework exists in `app/` — the per-task gate is `npm run typecheck` (run from `app/`) plus the listed manual checks in the running dev app (`npm run dev`, renderer hot-reloads).
- Code style: no semicolons, single quotes, 2-space indent, explicit return types on exported functions (match existing files).
- All renderer paths below are relative to `app/` unless absolute.
- No in-app product branding: the wizard must not display "JOBDECK"/"JobDeck" or the tagline "agent-powered job application pipeline".
- Button label for applying gap answers is exactly `Apply` (with an answered-count suffix like `Apply (2)` when > 0).
- No dismiss button for gaps: a blank answer means dismissed; Apply clears `gaps` entirely (agent instruction).
- `schema`, `revision`, `updatedAt` are never rendered in the editor.
- Commits: conventional messages, each ending with the trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: `library:upload` returns file names; wizard shows them as chips

**Files:**
- Modify: `app/src/shared/ipc.ts:95` (`library:upload` channel type)
- Modify: `app/src/main/ipcRegistry.ts:288-320` (upload handler)
- Modify: `app/src/renderer/src/views/onboarding/OnboardingWizard.tsx` (sources step)

**Interfaces:**
- Produces: `call('library:upload')` now resolves `{ added: number; names: string[] }` — `names` are the basenames as stored in the library (post de-dupe rename).

- [ ] **Step 1: Change the channel type**

In `app/src/shared/ipc.ts` replace:

```ts
  'library:upload': { req: void; res: { added: number } }
```

with:

```ts
  'library:upload': { req: void; res: { added: number; names: string[] } }
```

- [ ] **Step 2: Collect names in the main handler**

In `app/src/main/ipcRegistry.ts`, inside `handle('library:upload', …)`: read the current loop first (it copies each `src` to a de-duped `dst`). Add a `names` accumulator and return it. The handler becomes (structure — keep the existing dialog options and de-dupe loop exactly as they are):

```ts
  handle('library:upload', async () => {
    const win = services.getWindow()
    const result = await dialog.showOpenDialog(win!, {
      title: 'Add files to your library (CVs, cover letters, examples, notes — anything)',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Documents', extensions: ['pdf', 'tex', 'md', 'txt', 'docx', 'png', 'jpg', 'jpeg', 'csv'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (result.canceled) return { added: 0, names: [] }
    fs.mkdirSync(UPLOADS_DIR, { recursive: true })
    let added = 0
    const names: string[] = []
    for (const src of result.filePaths) {
      try {
        let name = path.basename(src)
        let dst = path.join(UPLOADS_DIR, name)
        let i = 2
        while (fs.existsSync(dst)) {
          const ext = path.extname(name)
          dst = path.join(UPLOADS_DIR, `${path.basename(name, ext)}_${i++}${ext}`)
        }
        fs.copyFileSync(src, dst)
        names.push(path.basename(dst))
        added++
      } catch {
        // skip unreadable file, keep going
      }
    }
    return { added, names }
  })
```

Keep whatever the existing catch/`added++` bodies already do if they differ — the only required changes are `names` collection, `names.push(path.basename(dst))` after a successful copy, and both return values.

- [ ] **Step 3: Show names in the wizard sources step**

In `OnboardingWizard.tsx`:

Replace state `const [uploadCount, setUploadCount] = useState(0)` with:

```ts
  const [uploadNames, setUploadNames] = useState<string[]>([])
```

Replace the `upload` function body:

```ts
  const upload = async (): Promise<void> => {
    try {
      const { added, names } = await call('library:upload', undefined)
      if (added) {
        setUploadNames((prev) => [...prev, ...names])
        toast(`${added} file${added === 1 ? '' : 's'} added to your library`, 'success')
      }
    } catch (err) {
      toast(String(err), 'error')
    }
  }
```

Replace the Add-files button and add a chip list under it (in the `sources` step JSX):

```tsx
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button className="btn btn-primary" onClick={upload}>
                ⇪ Add files…
              </button>
              {importedV1 && (
                <span className="chip border-green-800 text-green-300">
                  ✓ old workspace staged as a source
                </span>
              )}
            </div>
            {uploadNames.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {uploadNames.map((n, i) => (
                  <span key={`${n}-${i}`} className="chip text-[10px] text-gray-300">
                    {n}
                  </span>
                ))}
              </div>
            )}
```

Update the extract-button disabled condition: `uploadCount === 0` → `uploadNames.length === 0`.

- [ ] **Step 4: Typecheck**

Run: `cd /Users/gil/Stuff/jobdeck/app && npm run typecheck`
Expected: exit 0, no errors.

- [ ] **Step 5: Manual check**

In the running app (wizard sources step): click "Add files…", pick 2 files → both names appear as chips; add another → appended. Extract button enables once ≥1 chip (or pasted text / v1 import).

- [ ] **Step 6: Commit**

```bash
cd /Users/gil/Stuff/jobdeck && git add app/src && git commit -m "feat(wizard): show uploaded file names as chips

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Refine-run backend (IPC + prompt + template)

**Files:**
- Create: `app/resources/prompts/refine_profile.md`
- Modify: `app/src/shared/ipc.ts:87-94` (`onboard:start` req)
- Modify: `app/src/main/agent/prompt.ts` (add `RefineSlots` + `buildRefinePrompt`)
- Modify: `app/src/main/agent/AgentRunner.ts` (`RunInput` + `buildRunPrompt`)
- Modify: `app/src/main/ipcRegistry.ts:248-285` (`onboard:start` handler)

**Interfaces:**
- Produces: `call('onboard:start', { source: 'refine', draft: ProfileFile, answers: { question: string; answer: string }[] })` → `RunMeta` (kind `'onboard'`). On success, `call('profile:draft', { runId })` returns the merged draft with `gaps: []` — identical consumption path to extraction runs.
- Consumes: existing `finalizeOnboard` (AgentRunner.ts:432) — untouched; refine writes the same `TMP_DIR/profile.draft.json`.

- [ ] **Step 1: Create the prompt template**

Create `app/resources/prompts/refine_profile.md`:

````markdown
# Refine a candidate profile draft

Workspace root: `{{REPO_ROOT}}` (cwd). Today: {{TODAY_ISO}}.
The candidate reviewed their profile draft and answered follow-up questions. Merge each answer into the correct fields and write the COMPLETE updated profile as VALID JSON to `{{OUTPUT_PATH}}`.

## CURRENT DRAFT
```json
{{DRAFT_JSON}}
```

## CANDIDATE ANSWERS
{{ANSWERS_SECTION}}

## MERGE RULES
- Apply ONLY what the answers state. Change nothing the answers do not cover. Never invent.
- One answer may touch several fields (e.g. "M.S. student graduating Aug 2026, available now" → `identity.status` AND `searchConfig.availability`).
- Preserve exact numbers, dates, and phrasing from the answers.
- After merging, set `gaps` to `[]` — questions the candidate left unanswered are dismissed, do not carry them over.
- Output must keep the exact schema of the draft (same keys and types, `schema`/`revision`/`updatedAt` unchanged).

## DO NOT
- Do NOT write any file other than `{{OUTPUT_PATH}}`.
- Do NOT re-read source documents — the draft plus the answers are your only inputs.

## FINALLY
Reply with a short list of each field you changed and why.
````

(The nested ```json fence inside the template is fine — the file is consumed as plain text by `fill()`, never rendered as markdown.)

- [ ] **Step 2: Extend the `onboard:start` channel type**

In `app/src/shared/ipc.ts` replace the `'onboard:start'` entry with:

```ts
  'onboard:start': {
    req: {
      source: 'v1-import' | 'text' | 'files' | 'uploads' | 'refine'
      text?: string
      files?: string[]
      /** refine: current draft + gap answers to merge into it. */
      draft?: ProfileFile
      answers?: { question: string; answer: string }[]
    }
    res: RunMeta
  }
```

(`ProfileFile` is already imported in this file for `profile:get`.)

- [ ] **Step 3: Add `buildRefinePrompt` to prompt.ts**

In `app/src/main/agent/prompt.ts` add below the `ONBOARD_TEMPLATE_PATH` constant:

```ts
const REFINE_TEMPLATE_PATH = path.join(APP_DIR, 'resources', 'prompts', 'refine_profile.md')
```

and below `buildOnboardPrompt` add:

```ts
export interface RefineSlots {
  draft: ProfileFile
  answers: { question: string; answer: string }[]
  outputPath: string
}

/** Merge gap answers into an existing draft — much shorter run than a full extraction. */
export function buildRefinePrompt(s: RefineSlots): string {
  const template = fs.readFileSync(REFINE_TEMPLATE_PATH, 'utf-8')
  const answersMd = s.answers
    .map((a) => `- Q: ${a.question}\n  A: ${a.answer}`)
    .join('\n')
  return fill(template, {
    REPO_ROOT: REPO_ROOT,
    TODAY_ISO: todayISO(),
    OUTPUT_PATH: s.outputPath,
    DRAFT_JSON: JSON.stringify(s.draft, null, 2),
    ANSWERS_SECTION: answersMd || '(none)'
  })
}
```

- [ ] **Step 4: Extend `RunInput` and `buildRunPrompt`**

In `app/src/main/agent/AgentRunner.ts`:

Add to the imports: `import type { ProfileFile } from '@shared/profile'` and add `buildRefinePrompt` to the existing `./prompt` import.

In `RunInput`, after `sourceText?: string` add:

```ts
  /** Onboard refine runs: merge gap answers into this draft instead of extracting. */
  refineDraft?: ProfileFile
  refineAnswers?: { question: string; answer: string }[]
```

In `buildRunPrompt` replace the onboard branch with:

```ts
    if (kind === 'onboard') {
      const outputPath = path.join(TMP_DIR, 'profile.draft.json')
      if (run.input.refineDraft) {
        return buildRefinePrompt({
          draft: run.input.refineDraft,
          answers: run.input.refineAnswers ?? [],
          outputPath
        })
      }
      return buildOnboardPrompt({
        sourceFiles: run.input.sourceFiles ?? [],
        sourceText: run.input.sourceText ?? '',
        outputPath
      })
    }
```

`finalizeOnboard` needs no change.

- [ ] **Step 5: Handle `source: 'refine'` in ipcRegistry**

In `app/src/main/ipcRegistry.ts`, at the top of the `handle('onboard:start', …)` callback (destructure becomes `({ source, text, files, draft, answers })`), add before the existing `if (source === 'v1-import')`:

```ts
    if (source === 'refine') {
      const qa = (answers ?? []).filter((a) => a.answer.trim().length > 0)
      if (!draft) throw new Error('refine needs the current draft')
      if (!qa.length) throw new Error('no answers to apply')
      return runner.start({ kind: 'onboard', refineDraft: draft, refineAnswers: qa })
    }
```

- [ ] **Step 6: Typecheck**

Run: `cd /Users/gil/Stuff/jobdeck/app && npm run typecheck`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
cd /Users/gil/Stuff/jobdeck && git add app/src app/resources && git commit -m "feat(onboard): refine run merges gap answers into profile draft

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Field primitives for the profile editor

**Files:**
- Create: `app/src/renderer/src/components/profile/fields.tsx`

**Interfaces:**
- Produces (all named exports, consumed by Tasks 4-5):
  - `Section({ title, summary?, defaultOpen?, children })` — collapsible card
  - `TextField({ label, value: string | null, onChange: (v: string) => void, placeholder? })`
  - `TextAreaField({ label, value: string | null, onChange: (v: string) => void, rows? })`
  - `NumField({ label, value: number | null, onChange: (v: number | null) => void })`
  - `CheckField({ label, checked, onChange: (v: boolean) => void })`
  - `StringList({ label?, items: string[], onChange: (items: string[]) => void, addLabel? })`
  - `CommaList({ label, items: string[], onChange })` — comma-separated single input, parsed on blur
  - `JsonBlock<T>({ label, value: T, onChange: (v: T) => void })` — escape hatch, parse on blur, inline error
  - `EntryList<T>({ items, onChange, makeEmpty: () => T, title: (item, i) => string, addLabel, render: (item, set: (patch: Partial<T>) => void) => ReactNode })`

- [ ] **Step 1: Write the file**

Create `app/src/renderer/src/components/profile/fields.tsx`:

```tsx
import { useState } from 'react'
import type { ReactNode } from 'react'

/** Collapsible editor section. */
export function Section(props: {
  title: string
  summary?: string
  defaultOpen?: boolean
  children: ReactNode
}): JSX.Element {
  const [open, setOpen] = useState(props.defaultOpen ?? false)
  return (
    <div className="mt-2 rounded-md border border-gray-800">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="w-3 text-[10px] text-gray-500">{open ? '▾' : '▸'}</span>
        <span className="text-[11px] font-semibold text-gray-200">{props.title}</span>
        {props.summary && (
          <span className="ml-auto text-[10px] text-gray-500">{props.summary}</span>
        )}
      </button>
      {open && <div className="border-t border-gray-800 px-3 py-2 pb-3">{props.children}</div>}
    </div>
  )
}

export function TextField(props: {
  label: string
  value: string | null
  onChange: (v: string) => void
  placeholder?: string
}): JSX.Element {
  return (
    <label className="block min-w-0">
      <span className="text-[10px] uppercase tracking-wide text-gray-500">{props.label}</span>
      <input
        className="input mt-0.5 w-full text-[11px]"
        value={props.value ?? ''}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </label>
  )
}

export function TextAreaField(props: {
  label: string
  value: string | null
  onChange: (v: string) => void
  rows?: number
}): JSX.Element {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wide text-gray-500">{props.label}</span>
      <textarea
        className="input mt-0.5 w-full resize-y text-[11px]"
        rows={props.rows ?? 3}
        value={props.value ?? ''}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </label>
  )
}

export function NumField(props: {
  label: string
  value: number | null
  onChange: (v: number | null) => void
}): JSX.Element {
  return (
    <label className="block min-w-0">
      <span className="text-[10px] uppercase tracking-wide text-gray-500">{props.label}</span>
      <input
        className="input mt-0.5 w-full text-[11px]"
        type="number"
        value={props.value ?? ''}
        onChange={(e) => props.onChange(e.target.value === '' ? null : Number(e.target.value))}
      />
    </label>
  )
}

export function CheckField(props: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}): JSX.Element {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-gray-300">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      {props.label}
    </label>
  )
}

/** One input row per item, add/remove. */
export function StringList(props: {
  label?: string
  items: string[]
  onChange: (items: string[]) => void
  addLabel?: string
}): JSX.Element {
  const set = (i: number, v: string): void => {
    const next = [...props.items]
    next[i] = v
    props.onChange(next)
  }
  return (
    <div className="mt-1">
      {props.label && (
        <div className="text-[10px] uppercase tracking-wide text-gray-500">{props.label}</div>
      )}
      {props.items.map((item, i) => (
        <div key={i} className="mt-1 flex items-center gap-1">
          <input
            className="input w-full text-[11px]"
            value={item}
            onChange={(e) => set(i, e.target.value)}
          />
          <button
            type="button"
            className="btn px-1.5 py-0.5 text-[10px] text-gray-500"
            onClick={() => props.onChange(props.items.filter((_, j) => j !== i))}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn mt-1 px-2 py-0.5 text-[10px]"
        onClick={() => props.onChange([...props.items, ''])}
      >
        + {props.addLabel ?? 'add'}
      </button>
    </div>
  )
}

/** Comma-separated list in one input; parsed on blur so typing isn't clobbered. */
export function CommaList(props: {
  label: string
  items: string[]
  onChange: (items: string[]) => void
}): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = (): void => {
    if (draft === null) return
    props.onChange(
      draft
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    )
    setDraft(null)
  }
  return (
    <label className="block min-w-0">
      <span className="text-[10px] uppercase tracking-wide text-gray-500">
        {props.label} <span className="normal-case text-gray-600">(comma-separated)</span>
      </span>
      <input
        className="input mt-0.5 w-full text-[11px]"
        value={draft ?? props.items.join(', ')}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
      />
    </label>
  )
}

/** JSON escape hatch for deep nested structures; parses on blur, inline error. */
export function JsonBlock<T>(props: {
  label: string
  value: T
  onChange: (v: T) => void
}): JSX.Element {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const commit = (): void => {
    if (text === null) return
    try {
      props.onChange(JSON.parse(text) as T)
      setText(null)
      setError(null)
    } catch (err) {
      setError(String(err))
    }
  }
  return (
    <div className="mt-2">
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{props.label} (JSON)</div>
      <textarea
        className="input mt-0.5 min-h-[80px] w-full resize-y font-mono text-[10px] leading-relaxed"
        value={text ?? JSON.stringify(props.value, null, 2)}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
      />
      {error && <div className="mt-0.5 text-[10px] text-red-400">{error}</div>}
    </div>
  )
}

/** Card-per-entry editor for arrays of objects. */
export function EntryList<T>(props: {
  items: T[]
  onChange: (items: T[]) => void
  makeEmpty: () => T
  title: (item: T, i: number) => string
  addLabel: string
  render: (item: T, set: (patch: Partial<T>) => void) => ReactNode
}): JSX.Element {
  const setAt = (i: number, patch: Partial<T>): void => {
    const next = [...props.items]
    next[i] = { ...next[i], ...patch }
    props.onChange(next)
  }
  return (
    <div>
      {props.items.map((item, i) => (
        <div key={i} className="mt-2 rounded-md border border-gray-800 p-2">
          <div className="flex items-center">
            <span className="text-[11px] font-medium text-gray-300">
              {props.title(item, i) || `#${i + 1}`}
            </span>
            <button
              type="button"
              className="btn ml-auto px-1.5 py-0.5 text-[10px] text-gray-500"
              onClick={() => props.onChange(props.items.filter((_, j) => j !== i))}
            >
              ✕ remove
            </button>
          </div>
          {props.render(item, (patch) => setAt(i, patch))}
        </div>
      ))}
      <button
        type="button"
        className="btn mt-2 px-2 py-0.5 text-[10px]"
        onClick={() => props.onChange([...props.items, props.makeEmpty()])}
      >
        + {props.addLabel}
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /Users/gil/Stuff/jobdeck/app && npm run typecheck`
Expected: exit 0 (file compiles standalone; nothing imports it yet).

- [ ] **Step 3: Commit**

```bash
cd /Users/gil/Stuff/jobdeck && git add app/src/renderer/src/components/profile/fields.tsx && git commit -m "feat(profile): field primitives for structured profile editor

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `ProfileEditor` component (all sections)

**Files:**
- Create: `app/src/renderer/src/components/profile/ProfileEditor.tsx`

**Interfaces:**
- Consumes: everything from `./fields` (Task 3 signatures), types from `@shared/profile`.
- Produces: `export default function ProfileEditor(props: { value: ProfileFile; onChange: (p: ProfileFile) => void }): JSX.Element` — consumed by Tasks 5-6.

- [ ] **Step 1: Write the component**

Create `app/src/renderer/src/components/profile/ProfileEditor.tsx`:

```tsx
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
  StringList,
  TextAreaField,
  TextField
} from './fields'

const n = (v: string): string | null => (v.trim() ? v : null)

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
  const p = props.value
  const patch = (part: Partial<ProfileFile>): void => props.onChange({ ...p, ...part })
  const identity = (part: Partial<Identity>): void =>
    patch({ identity: { ...p.identity, ...part } })
  const behavioral = (part: Partial<BehavioralProfile>): void =>
    patch({ behavioral: { ...p.behavioral, ...part } })
  const narrative = (part: Partial<Narrative>): void =>
    patch({ narrative: { ...p.narrative, ...part } })
  const evaluation = (part: Partial<EvaluationConfig>): void =>
    patch({ evaluation: { ...p.evaluation, ...part } })
  const search = (part: Partial<SearchConfig>): void =>
    patch({ searchConfig: { ...p.searchConfig, ...part } })

  return (
    <div>
      <Section title="Identity" summary={p.identity.fullName} defaultOpen>
        <div className="grid grid-cols-2 gap-2">
          <TextField label="Full name" value={p.identity.fullName} onChange={(v) => identity({ fullName: v })} />
          <TextField label="Location" value={p.identity.location} onChange={(v) => identity({ location: v })} />
          <TextField label="Email" value={p.identity.email} onChange={(v) => identity({ email: v })} />
          <TextField label="Phone" value={p.identity.phone} onChange={(v) => identity({ phone: v })} />
          <TextField label="LinkedIn" value={p.identity.linkedin} onChange={(v) => identity({ linkedin: v })} />
          <TextField label="GitHub" value={p.identity.github} onChange={(v) => identity({ github: v })} />
          <TextField label="Website" value={p.identity.website} onChange={(v) => identity({ website: v })} />
          <TextField label="Work authorization" value={p.identity.workAuth} onChange={(v) => identity({ workAuth: v })} />
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
                <TextField label="Proficiency" value={l.proficiency} onChange={(v) => set({ proficiency: v })} />
              </div>
            )}
          />
        </div>
      </Section>

      <Section title="Education" summary={`${p.education.length}`} defaultOpen={p.education.length > 0}>
        <EntryList
          items={p.education}
          onChange={(education) => patch({ education })}
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
      </Section>

      <Section title="Experience" summary={`${p.experience.length}`} defaultOpen={p.experience.length > 0}>
        <EntryList
          items={p.experience}
          onChange={(experience) => patch({ experience })}
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
      </Section>

      <Section title="Projects" summary={`${p.projects.length}`} defaultOpen={p.projects.length > 0}>
        <EntryList
          items={p.projects}
          onChange={(projects) => patch({ projects })}
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
      </Section>

      <Section title="Skills" summary={`${p.skills.length} categories`} defaultOpen={p.skills.length > 0}>
        <EntryList
          items={p.skills}
          onChange={(skills) => patch({ skills })}
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
      </Section>

      <Section title="Certifications" summary={`${p.certifications.length}`} defaultOpen={false}>
        <EntryList
          items={p.certifications}
          onChange={(certifications) => patch({ certifications })}
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
      </Section>

      <Section title="Publications" summary={`${p.publications.length}`} defaultOpen={false}>
        <EntryList
          items={p.publications}
          onChange={(publications) => patch({ publications })}
          makeEmpty={() => ({ citation: '', url: null })}
          title={(x) => x.citation.slice(0, 60)}
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
      </Section>

      <Section title="Awards" summary={`${p.awards.length}`} defaultOpen={false}>
        <EntryList
          items={p.awards}
          onChange={(awards) => patch({ awards })}
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
      </Section>

      <Section
        title="Behavioral"
        summary={`${p.behavioral.traits.length + p.behavioral.strengths.length} items`}
        defaultOpen={false}
      >
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
      </Section>

      <Section
        title="Narrative & stories"
        summary={`${p.narrative.stories.length} stories`}
        defaultOpen={false}
      >
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
                      checked={s.use.includes(tag)}
                      onChange={(on) =>
                        set({ use: on ? [...s.use, tag] : s.use.filter((u) => u !== tag) })
                      }
                    />
                  ))}
                </div>
              </div>
            )}
          />
        </div>
      </Section>

      <Section title="Fit evaluation" summary={`${p.evaluation.dimensions.length} dimensions`} defaultOpen={false}>
        <StringList label="Strong match areas" items={p.evaluation.strongMatchAreas} onChange={(strongMatchAreas) => evaluation({ strongMatchAreas })} addLabel="area" />
        <StringList label="Moderate match areas" items={p.evaluation.moderateMatchAreas} onChange={(moderateMatchAreas) => evaluation({ moderateMatchAreas })} addLabel="area" />
        <StringList label="Weak match areas" items={p.evaluation.weakMatchAreas} onChange={(weakMatchAreas) => evaluation({ weakMatchAreas })} addLabel="area" />
        <StringList label="Calibration notes" items={p.evaluation.calibrationNotes} onChange={(calibrationNotes) => evaluation({ calibrationNotes })} addLabel="note" />
        <JsonBlock label="Dimensions" value={p.evaluation.dimensions} onChange={(dimensions) => evaluation({ dimensions })} />
      </Section>

      <Section title="Tailoring" summary={`${p.tailoring.roleProfiles.length} role profiles`} defaultOpen={false}>
        <StringList
          label="Hard rules"
          items={p.tailoring.hardRules}
          onChange={(hardRules) => patch({ tailoring: { ...p.tailoring, hardRules } })}
          addLabel="rule"
        />
        <JsonBlock
          label="Role profiles"
          value={p.tailoring.roleProfiles}
          onChange={(roleProfiles) => patch({ tailoring: { ...p.tailoring, roleProfiles } })}
        />
      </Section>

      <Section title="Job search" summary={`${p.searchConfig.targetRoles.length} target roles`} defaultOpen={false}>
        <EntryList
          items={p.searchConfig.targetRoles}
          onChange={(targetRoles) => search({ targetRoles })}
          makeEmpty={() => ({ title: '', priority: 1 as const })}
          title={(r) => `P${r.priority} ${r.title}`}
          addLabel="target role"
          render={(r, set) => (
            <div className="mt-1 grid grid-cols-[1fr_90px] gap-2">
              <TextField label="Role title" value={r.title} onChange={(v) => set({ title: v })} />
              <label className="block">
                <span className="text-[10px] uppercase tracking-wide text-gray-500">Priority</span>
                <select
                  className="input mt-0.5 w-full text-[11px]"
                  value={r.priority}
                  onChange={(e) => set({ priority: Number(e.target.value) as 1 | 2 | 3 | 4 })}
                >
                  {[1, 2, 3, 4].map((x) => (
                    <option key={x} value={x}>
                      P{x}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        />
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
        <div className="mt-2 flex items-center gap-4">
          {(['onsite', 'hybrid', 'remote'] as const).map((m) => (
            <CheckField
              key={m}
              label={m}
              checked={p.searchConfig.workModels.includes(m)}
              onChange={(on) =>
                search({
                  workModels: on
                    ? [...p.searchConfig.workModels, m]
                    : p.searchConfig.workModels.filter((x) => x !== m)
                })
              }
            />
          ))}
        </div>
        <div className="mt-2">
          <EntryList
            items={p.searchConfig.locationTiers}
            onChange={(locationTiers) => search({ locationTiers })}
            makeEmpty={() => ({ tier: 'ideal' as const, description: '' })}
            title={(t) => `${t.tier}: ${t.description.slice(0, 50)}`}
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
      </Section>

      <Section title="Documents" summary={p.documents.fileBasename} defaultOpen={false}>
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
      </Section>

      <Section title="Custom agent rules" summary={`${p.customRules.length}`} defaultOpen={false}>
        <StringList items={p.customRules} onChange={(customRules) => patch({ customRules })} addLabel="rule" />
      </Section>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /Users/gil/Stuff/jobdeck/app && npm run typecheck`
Expected: exit 0. If `makeEmpty={(): EducationEntry => …}` style annotations error under the project's TSX config, drop the return-type annotation (the object literal already infers).

- [ ] **Step 3: Commit**

```bash
cd /Users/gil/Stuff/jobdeck && git add app/src/renderer/src/components/profile/ProfileEditor.tsx && git commit -m "feat(profile): structured ProfileEditor component

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: `GapAnswers` component

**Files:**
- Create: `app/src/renderer/src/components/profile/GapAnswers.tsx`

**Interfaces:**
- Produces: `export default function GapAnswers(props: { gaps: string[]; answers: Record<string, string>; onChange: (a: Record<string, string>) => void; onApply: () => void; busy: boolean }): JSX.Element | null` — consumed by Tasks 6-7. Renders `null` when `gaps` is empty. Apply button label: `Apply` / `Apply (N)`; disabled when busy or zero non-blank answers.

- [ ] **Step 1: Write the component**

Create `app/src/renderer/src/components/profile/GapAnswers.tsx`:

```tsx
/**
 * Extraction gaps as answerable questions. Blank answer = dismissed —
 * there is deliberately no dismiss button. Apply sends non-blank answers
 * to a refine agent run that merges them into the draft.
 */
export default function GapAnswers(props: {
  gaps: string[]
  answers: Record<string, string>
  onChange: (a: Record<string, string>) => void
  onApply: () => void
  busy: boolean
}): JSX.Element | null {
  if (!props.gaps.length) return null
  const answered = props.gaps.filter((g) => (props.answers[g] ?? '').trim()).length
  return (
    <div className="mt-2 rounded-md border border-yellow-800/60 bg-yellow-950/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-yellow-500">
        Open questions — answer what you can; leave blank to skip
      </div>
      {props.gaps.map((g) => (
        <div key={g} className="mt-2">
          <div className="text-[11px] leading-snug text-yellow-300">{g}</div>
          <input
            className="input mt-1 w-full text-[11px]"
            value={props.answers[g] ?? ''}
            onChange={(e) => props.onChange({ ...props.answers, [g]: e.target.value })}
          />
        </div>
      ))}
      <button
        className="btn btn-primary mt-3"
        disabled={props.busy || answered === 0}
        onClick={props.onApply}
      >
        Apply{answered > 0 ? ` (${answered})` : ''}
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /Users/gil/Stuff/jobdeck/app && npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/gil/Stuff/jobdeck && git add app/src/renderer/src/components/profile/GapAnswers.tsx && git commit -m "feat(profile): GapAnswers component (blank answer = dismiss)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Wizard review step rework + debranding

**Files:**
- Modify: `app/src/renderer/src/views/onboarding/OnboardingWizard.tsx`

**Interfaces:**
- Consumes: `ProfileEditor` (Task 4), `GapAnswers` (Task 5), `onboard:start` refine payload (Task 2).

- [ ] **Step 1: Rework state and the run watcher**

In `OnboardingWizard.tsx`:

Add imports:

```ts
import ProfileEditor from '../../components/profile/ProfileEditor'
import GapAnswers from '../../components/profile/GapAnswers'
```

Replace draft/gaps state:

```ts
  const [draft, setDraft] = useState<ProfileFile | null>(null)
  const [gapAnswers, setGapAnswers] = useState<Record<string, string>>({})
  const [runPurpose, setRunPurpose] = useState<'extract' | 'refine'>('extract')
```

(delete `draftText` and `gaps` state.)

Replace the whole extract-run `useEffect` with one that handles both purposes:

```ts
  // ---- extract/refine run watcher ----
  useEffect(() => {
    if (!run) return
    const off = onPush('push:runChanged', (meta) => {
      if (meta.id !== run.id) return
      setRunStatusLine(meta.status)
      if (meta.status === 'succeeded') {
        void call('profile:draft', { runId: meta.id }).then(({ draft: d, error }) => {
          if (d) {
            setDraft(d)
            setGapAnswers({})
            setStep('review')
            if (runPurpose === 'refine') toast('Answers merged into the draft', 'success')
          } else {
            toast(error ?? 'no draft produced', 'error')
            if (runPurpose === 'extract') setStep('sources')
          }
          setRun(null)
        })
      } else if (meta.status === 'failed' || meta.status === 'cancelled') {
        toast(`${runPurpose === 'refine' ? 'Refine' : 'Extraction'} ${meta.status}: ${meta.errorText ?? ''}`, 'error')
        setRun(null)
        if (runPurpose === 'extract') setStep('sources')
        else setStep('review')
      }
    })
    return off
  }, [run?.id, runPurpose])
```

In `extract()`, before `setRun(meta)` add `setRunPurpose('extract')`.

Add the refine starter next to `saveProfile`:

```ts
  const applyAnswers = async (): Promise<void> => {
    if (!draft) return
    const answers = Object.entries(gapAnswers)
      .map(([question, answer]) => ({ question, answer: answer.trim() }))
      .filter((a) => a.answer)
    if (!answers.length) return
    setBusy(true)
    try {
      const meta = await call('onboard:start', { source: 'refine', draft, answers })
      setRunPurpose('refine')
      setRun(meta)
      setRunStatusLine('running')
      setStep('extract')
      void useApp.getState().refreshRuns()
    } catch (err) {
      toast(String(err), 'error')
    } finally {
      setBusy(false)
    }
  }
```

Replace `saveProfile`:

```ts
  const saveProfile = async (): Promise<void> => {
    if (!draft) return
    setBusy(true)
    try {
      const saved = await call('profile:save', { profile: draft })
      toast(`Profile saved: ${saved.identity.fullName}`, 'success')
      setStep('done')
    } catch (err) {
      toast(String(err), 'error')
    } finally {
      setBusy(false)
    }
  }
```

- [ ] **Step 2: Debrand the header + widen review panel**

Replace the panel wrapper line:

```tsx
      <div className={`panel p-8 ${step === 'review' ? 'w-[780px]' : 'w-[600px]'}`}>
```

Delete the branding block entirely:

```tsx
        <div className="text-center">
          <div className="text-lg font-bold tracking-wide text-cyan-300">JOBDECK</div>
          <div className="mt-1 text-xs text-muted">agent-powered job application pipeline</div>
        </div>
```

and change the progress row's `mt-6` to `mt-1` so the step indicator becomes the top element.

In the `done` step, change the button text `Start using JobDeck →` to `Start →`.

- [ ] **Step 3: Rework the review step JSX**

Replace the `step === 'review'` block:

```tsx
        {step === 'review' && draft && (
          <div className="mt-6">
            <p className="text-xs text-gray-400">
              Review the draft. Answer the open questions (blank = skip), fix anything wrong, then save.
            </p>
            <GapAnswers
              gaps={draft.gaps}
              answers={gapAnswers}
              onChange={setGapAnswers}
              onApply={() => void applyAnswers()}
              busy={busy}
            />
            <div className="mt-3 max-h-[46vh] overflow-auto pr-1">
              <ProfileEditor value={draft} onChange={setDraft} />
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button className="btn btn-green" disabled={busy} onClick={saveProfile}>
                ✓ Save profile
              </button>
              <button className="btn" disabled={busy} onClick={() => setStep('sources')}>
                ← Back
              </button>
            </div>
          </div>
        )}
```

Also update the extract-step status line so refine runs don't claim to read material:

```tsx
              {runPurpose === 'refine' ? 'Merging your answers…' : 'Agent is reading your material…'} ({runStatusLine})
```

- [ ] **Step 4: Typecheck**

Run: `cd /Users/gil/Stuff/jobdeck/app && npm run typecheck`
Expected: exit 0. (`ProfileFile` import already exists in this file.)

- [ ] **Step 5: Manual check**

Dev app, fresh wizard: no JOBDECK header/tagline anywhere; upload → extract → review shows gap questions with inputs, sectioned editor below (Identity open, correct values); type 2 answers → button reads `Apply (2)` → click → "Merging your answers…" → returns to review with merged fields and zero gap questions; edit a field; Save profile → done step shows `Start →`. Cancel a refine mid-run → lands back on review with draft intact.

- [ ] **Step 6: Commit**

```bash
cd /Users/gil/Stuff/jobdeck && git add app/src/renderer/src/views/onboarding/OnboardingWizard.tsx && git commit -m "feat(wizard): structured review step with gap answers, debrand

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Settings ProfilePanel rework

**Files:**
- Modify: `app/src/renderer/src/views/settings/ProfilePanel.tsx`

**Interfaces:**
- Consumes: `ProfileEditor` (Task 4), `GapAnswers` (Task 5), refine payload (Task 2).

- [ ] **Step 1: Replace JSON draft state with object state**

In `ProfilePanel.tsx`:

Add imports:

```ts
import ProfileEditor from '../../components/profile/ProfileEditor'
import GapAnswers from '../../components/profile/GapAnswers'
```

Replace `const [draftText, setDraftText] = useState<string | null>(null)` with:

```ts
  const [draft, setDraft] = useState<ProfileFile | null>(null)
  const [gapAnswers, setGapAnswers] = useState<Record<string, string>>({})
```

Update the run watcher success branch (it serves both extraction and refine — same consumption path):

```ts
        void call('profile:draft', { runId: meta.id }).then(({ draft: d, error }) => {
          if (d) {
            setDraft(d)
            setGapAnswers({})
            toast(`Draft ready — review, answer gaps, then Save (${meta.summary ?? ''})`, 'success')
          } else if (error) toast(error, 'error')
        })
```

Replace `saveDraft`:

```ts
  const saveDraft = async (): Promise<void> => {
    if (!draft) return
    setBusy(true)
    try {
      const saved = await call('profile:save', { profile: draft })
      setProfile(saved)
      setDraft(null)
      toast(`Profile saved — ${saved.identity.fullName} (${saved.documents.fileBasename}_*)`, 'success')
    } catch (err) {
      setBusy(false)
      toast(String(err), 'error')
      return
    }
    setBusy(false)
  }
```

Add the refine starter:

```ts
  const applyAnswers = async (): Promise<void> => {
    if (!draft) return
    const answers = Object.entries(gapAnswers)
      .map(([question, answer]) => ({ question, answer: answer.trim() }))
      .filter((a) => a.answer)
    if (!answers.length) return
    setBusy(true)
    try {
      const meta = await call('onboard:start', { source: 'refine', draft, answers })
      setExtracting(meta)
      toast('Merging your answers…', 'success')
      void useApp.getState().refreshRuns()
    } catch (err) {
      toast(String(err), 'error')
    } finally {
      setBusy(false)
    }
  }
```

- [ ] **Step 2: Rework the JSX**

Change the Edit button to load the object: `onClick={() => setDraft(profile)}`.

Keep the read-only gaps list only when NOT editing: change its condition from `profile?.gaps.length ?` to `profile?.gaps.length && draft === null ?`.

Replace the entire `draftText !== null && (…)` block with:

```tsx
      {draft !== null && (
        <div className="mt-3">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[11px] font-semibold text-gray-200">
              Draft — answer gaps, edit, then save
            </span>
            <button className="btn btn-green ml-auto px-2 py-0.5 text-[10px]" disabled={busy} onClick={saveDraft}>
              Validate & save
            </button>
            <button className="btn px-2 py-0.5 text-[10px]" onClick={() => setDraft(null)}>
              Discard
            </button>
          </div>
          <GapAnswers
            gaps={draft.gaps}
            answers={gapAnswers}
            onChange={setGapAnswers}
            onApply={() => void applyAnswers()}
            busy={busy || extracting !== null}
          />
          <ProfileEditor value={draft} onChange={setDraft} />
        </div>
      )}
```

- [ ] **Step 3: Typecheck**

Run: `cd /Users/gil/Stuff/jobdeck/app && npm run typecheck`
Expected: exit 0.

- [ ] **Step 4: Manual check**

Settings → Profile: Edit → sectioned editor with saved profile values (no JSON); if profile has gaps → gap inputs + Apply appear; answer one → Apply → run badge appears → merged draft returns with gaps cleared; Validate & save persists (rev bumps); Discard clears editor without saving.

- [ ] **Step 5: Commit**

```bash
cd /Users/gil/Stuff/jobdeck && git add app/src/renderer/src/views/settings/ProfilePanel.tsx && git commit -m "feat(settings): ProfilePanel uses structured editor + gap answers

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck**

Run: `cd /Users/gil/Stuff/jobdeck/app && npm run typecheck`
Expected: exit 0.

- [ ] **Step 2: Grep gates**

Run: `cd /Users/gil/Stuff/jobdeck/app && grep -rn "JOBDECK\|JobDeck\|agent-powered" src/renderer/src/`
Expected: no matches.

Run: `grep -rn "draftText" src/renderer/src/`
Expected: no matches (JSON textarea path fully removed).

- [ ] **Step 3: Full manual pass**

Main-process files changed since dev start → confirm electron relaunched (`--watch`), then run the Task 6 and Task 7 manual checks end-to-end once more, including one full extract → answer → Apply → save cycle. Verify saved `profile.json` in the workspace contains the merged answers and `"gaps": []`.

- [ ] **Step 4: Report**

Report results to the user as pass/fail per check — no commit (nothing changed).

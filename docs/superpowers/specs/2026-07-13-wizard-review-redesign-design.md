# Setup Wizard Review Redesign — Design

Date: 2026-07-13
Status: approved pending user review

## Problem

The onboarding wizard's Review step (and Settings → Profile panel) shows the
extracted profile as a raw JSON textarea, and extraction gaps as a read-only
bullet list with nowhere to answer them. Users must edit JSON by hand.

## Goals

1. Per-gap answer inputs; answers merged into the profile by a short agent run.
2. Structured, human-readable profile editor replaces the JSON textarea, in
   both the wizard Review step and Settings → Profile.
3. Cosmetics: remove in-app branding from the wizard; show uploaded file names
   in the sources step instead of a count.

## Non-goals

- Full sub-forms for every deeply nested schema type (role profiles,
  evaluation dimensions, board configs) — those get a per-section
  "edit as JSON" escape hatch in v1.
- Changing the extraction agent or profile schema.

## Design

### 1. Gap answers → agent merge ("Apply")

- Review step renders each `draft.gaps[]` entry as a question label with a
  one-line text input beneath it. No dismiss button: leaving an answer blank
  means "dismiss".
- A single **Apply** button (enabled when ≥1 answer is non-blank) starts a
  refine agent run:
  - `onboard:start` gains an optional refine payload:
    `{ source: 'refine', draft: ProfileFile, answers: {question, answer}[] }`.
  - `AgentRunner` keeps `kind: 'onboard'`; `buildOnboardPrompt` branches on a
    new refine slot and uses a new template
    `resources/prompts/refine_profile.md`: given current draft JSON + Q/A
    pairs, merge answers into the correct schema fields, clear `gaps`
    entirely (answered = merged, unanswered = dismissed), change nothing
    else, write updated JSON to `OUTPUT_PATH`.
- Run succeeds → existing `profile:draft` fetch replaces the in-editor draft
  (including emptied gaps). Runs list shows it like any onboard run.
- If the user never clicks Apply, remaining gaps persist into the saved
  profile (`profile.gaps`), same as today.

### 2. Structured profile editor (shared)

- New `src/renderer/src/components/profile/ProfileEditor.tsx` plus small
  internal section components. Props: `{ value: ProfileFile, onChange }`.
  Draft state is the parsed object — no JSON string state.
- Collapsible sections in schema order: Identity, Education, Experience,
  Projects, Skills, Certifications, Publications, Awards, Behavioral,
  Narrative & stories, Evaluation, Tailoring, Search config, Documents,
  Custom rules. Each header shows a small count/summary; empty sections start
  collapsed, non-empty ones show content on expand (Identity starts open).
- Field rendering:
  - Scalars → labeled text inputs (grid layout for Identity).
  - String arrays (bullets, skills items, deal-breakers, custom rules…) →
    row-per-item inputs with add/remove.
  - Arrays of objects with flat shapes (education, experience, projects,
    certifications…) → card per entry with the same field rules, add/remove
    entry.
  - Deep nested rarities (tailoring.roleProfiles, evaluation.dimensions,
    searchConfig.boards, jobPostingLanguageMapping) → compact per-section
    "edit as JSON" toggle (small textarea scoped to that section).
- `schema`, `revision`, `updatedAt` never rendered; carried through on save.
- Styling: existing `panel` / `input` / `btn` / `chip` classes; simple, clean.
  Wizard panel widens to ~760px on the review step.

### 3. Wire-up

- `OnboardingWizard` review step: gaps-with-inputs block + Apply, then
  `ProfileEditor`, then Save profile / Back. Draft held as `ProfileFile`
  object; `profile:save` still validates server-side, errors toast.
- `ProfilePanel` (Settings): Edit shows `ProfileEditor` for the saved
  profile; gap block (with Apply) appears when `profile.gaps.length > 0`.
  JSON textarea removed.

### 4. Cosmetics

- Wizard: delete the `JOBDECK` heading and the "agent-powered job application
  pipeline" tagline; the step indicator becomes the top element. Done-step
  button text "Start using JobDeck →" → "Start →".
- `library:upload` returns `{ added: number, names: string[] }`; the sources
  step accumulates and lists uploaded file names (small chips under the Add
  files button) instead of "(N added)".

## Error handling

- Refine run failed/cancelled → toast, inputs and draft untouched.
- `profile:save` validation failure → toast with problems, editor state kept.
- Per-section JSON escape hatch: parse errors block collapse-back with an
  inline error until fixed or reverted.

## Testing

- Manual: fresh wizard run end-to-end (upload → extract → answer some gaps →
  Apply → verify merge + gaps cleared → edit fields → save), Settings edit
  path, refine-run failure path (cancel it), upload-names display.
- `npm run typecheck` clean.

import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { SkillCategory } from '@shared/profile'

/**
 * Chip-based skills editor (Who I am edit mode): each category row shows its
 * items as chips with a hover-revealed remove, a per-category + opens an
 * inline append input (Enter commits, Escape/blur closes), and whole
 * categories can be renamed, added, and removed.
 */
export default function SkillsChipEditor(props: {
  value: SkillCategory[]
  onChange: (skills: SkillCategory[]) => void
}): JSX.Element {
  const skills = props.value ?? []
  // Index of the category whose inline add-skill input is open, plus its text.
  const [addingAt, setAddingAt] = useState<number | null>(null)
  const [draft, setDraft] = useState('')

  const setCategory = (i: number, patch: Partial<SkillCategory>): void => {
    const next = [...skills]
    next[i] = { ...next[i], ...patch }
    props.onChange(next)
  }
  const removeItem = (i: number, j: number): void =>
    setCategory(i, { items: skills[i].items.filter((_, k) => k !== j) })
  const commitDraft = (i: number): void => {
    const item = draft.trim()
    if (item) setCategory(i, { items: [...skills[i].items, item] })
    setDraft('')
  }
  const closeDraft = (): void => {
    setAddingAt(null)
    setDraft('')
  }

  return (
    <div>
      {skills.map((c, i) => (
        <div key={i} className="flex items-start gap-3 border-b border-edge/50 py-2 last:border-b-0">
          <input
            className="input w-36 shrink-0 text-[11px]"
            value={c.category}
            placeholder="Category"
            onChange={(e) => setCategory(i, { category: e.target.value })}
          />
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 pt-1">
            {c.items.map((s, j) => (
              <span key={`${s}-${j}`} className="chip group">
                {s}
                <button
                  type="button"
                  className="invisible -mr-0.5 text-gray-500 hover:text-red-400 group-hover:visible"
                  title="Remove skill"
                  onClick={() => removeItem(i, j)}
                >
                  <X size={10} />
                </button>
              </span>
            ))}
            {addingAt === i ? (
              <input
                className="input w-40 px-2 py-0.5 text-[11px]"
                value={draft}
                placeholder="New skill, Enter to add"
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitDraft(i)
                  if (e.key === 'Escape') closeDraft()
                }}
                onBlur={() => {
                  commitDraft(i)
                  closeDraft()
                }}
              />
            ) : (
              <button
                type="button"
                className="chip text-gray-500 hover:border-gray-500 hover:text-gray-300"
                title="Add a skill to this category"
                onClick={() => {
                  setDraft('')
                  setAddingAt(i)
                }}
              >
                <Plus size={10} />
              </button>
            )}
          </div>
          <button
            type="button"
            className="btn shrink-0 px-1.5 py-0.5 text-[10px] text-gray-500"
            title="Remove this category"
            onClick={() => {
              if (addingAt === i) closeDraft()
              props.onChange(skills.filter((_, k) => k !== i))
            }}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn mt-2 px-2 py-0.5 text-[10px]"
        onClick={() => props.onChange([...skills, { category: '', items: [] }])}
      >
        + category
      </button>
    </div>
  )
}

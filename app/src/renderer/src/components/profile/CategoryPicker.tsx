import { useState } from 'react'
import type { RoleCategory } from './roleTaxonomy'

export interface PickedRole {
  title: string
  priority: number
}

/**
 * Category-browse multi-select for target roles, modeled on Jobright's job-
 * function picker. Left rail = categories, right = role chips for the active
 * category, top = the ordered selection. Selection ORDER is the priority
 * (index 0 = highest), renumbered on every change; custom roles are addable.
 */
export default function CategoryPicker(props: {
  taxonomy: RoleCategory[]
  selected: PickedRole[]
  onChange: (roles: PickedRole[]) => void
}): JSX.Element {
  const [active, setActive] = useState(0)
  const [custom, setCustom] = useState('')
  // Tolerate malformed input (e.g. an extractor that wrote bare strings instead
  // of { title, priority }); render never assumes the object shape.
  const selected: PickedRole[] = ((props.selected ?? []) as unknown[])
    .map((r, i): PickedRole =>
      typeof r === 'string'
        ? { title: r, priority: i + 1 }
        : {
            title: typeof (r as PickedRole)?.title === 'string' ? (r as PickedRole).title : '',
            priority: typeof (r as PickedRole)?.priority === 'number' ? (r as PickedRole).priority : i + 1
          }
    )
    .filter((r) => r.title.trim())
  const chosen = new Set(selected.map((r) => r.title.toLowerCase()))

  const renumber = (list: { title: string }[]): PickedRole[] =>
    list.map((r, i) => ({ title: r.title, priority: i + 1 }))

  const toggle = (title: string): void => {
    if (chosen.has(title.toLowerCase())) {
      props.onChange(renumber(selected.filter((r) => r.title.toLowerCase() !== title.toLowerCase())))
    } else {
      props.onChange(renumber([...selected, { title }]))
    }
  }

  const move = (i: number, dir: -1 | 1): void => {
    const j = i + dir
    if (j < 0 || j >= selected.length) return
    const next = [...selected]
    ;[next[i], next[j]] = [next[j], next[i]]
    props.onChange(renumber(next))
  }

  const addCustom = (): void => {
    const title = custom.trim()
    if (title && !chosen.has(title.toLowerCase())) {
      props.onChange(renumber([...selected, { title }]))
    }
    setCustom('')
  }

  const activeCat = props.taxonomy[active]

  return (
    <div>
      {/* selected, ordered by priority */}
      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {selected.map((r, i) => (
            <span
              key={r.title}
              className="chip flex items-center gap-1 border-cyan-800 bg-cyan-950/50 text-cyan-200"
            >
              <span className="text-[9px] text-cyan-500">{i + 1}</span>
              {r.title}
              <button
                type="button"
                className="text-cyan-500 hover:text-cyan-200"
                title="up"
                onClick={() => move(i, -1)}
              >
                ▲
              </button>
              <button
                type="button"
                className="text-cyan-500 hover:text-cyan-200"
                title="down"
                onClick={() => move(i, 1)}
              >
                ▼
              </button>
              <button
                type="button"
                className="text-cyan-500 hover:text-red-300"
                title="remove"
                onClick={() => toggle(r.title)}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      ) : (
        <div className="text-[10px] text-gray-500">
          No roles yet — pick from the categories below (first picked = top priority).
        </div>
      )}

      {/* browse: categories | roles */}
      <div className="mt-2 flex gap-2 rounded-md border border-gray-800">
        <div className="w-[190px] shrink-0 overflow-auto border-r border-gray-800 py-1">
          {props.taxonomy.map((c, i) => (
            <button
              key={c.category}
              type="button"
              className={`flex w-full items-center justify-between px-2 py-1 text-left text-[11px] ${
                i === active ? 'bg-cyan-950/60 text-cyan-200' : 'text-gray-300 hover:bg-gray-900'
              }`}
              onClick={() => setActive(i)}
            >
              {c.category}
              <span className="text-[9px] text-gray-600">
                {c.roles.filter((r) => chosen.has(r.toLowerCase())).length || ''}
              </span>
            </button>
          ))}
        </div>
        <div className="flex flex-1 flex-wrap content-start gap-1 py-2 pr-2">
          {activeCat?.roles.map((role) => {
            const on = chosen.has(role.toLowerCase())
            return (
              <button
                key={role}
                type="button"
                className={`chip ${
                  on
                    ? 'border-cyan-700 bg-cyan-900/60 text-cyan-100'
                    : 'text-gray-300 hover:border-gray-600'
                }`}
                onClick={() => toggle(role)}
              >
                {on ? '✓ ' : ''}
                {role}
              </button>
            )
          })}
        </div>
      </div>

      {/* custom add */}
      <div className="mt-2 flex items-center gap-1">
        <input
          className="input w-full text-[11px]"
          placeholder="Add a role not listed…"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addCustom()
            }
          }}
        />
        <button type="button" className="btn px-2 py-0.5 text-[10px]" onClick={addCustom}>
          + add
        </button>
      </div>
    </div>
  )
}

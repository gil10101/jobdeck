import { useState } from 'react'
import type { ReactNode } from 'react'

/**
 * Dropdown over a fixed option set. When `allowOther` is set and the current
 * value isn't one of the options (and isn't empty), a free-text input appears
 * so an unusual value is never silently dropped.
 */
export function SelectField(props: {
  label: string
  value: string | null
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  allowOther?: boolean
  placeholder?: string
}): JSX.Element {
  const value = props.value ?? ''
  const known = props.options.some((o) => o.value === value)
  const isOther = props.allowOther && value !== '' && !known
  return (
    <label className="block min-w-0">
      <span className="text-[10px] uppercase tracking-wide text-gray-500">{props.label}</span>
      <select
        className="input mt-0.5 w-full text-[11px]"
        value={isOther ? '__other__' : value}
        onChange={(e) => props.onChange(e.target.value === '__other__' ? ' ' : e.target.value)}
      >
        <option value="">{props.placeholder ?? '— select —'}</option>
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        {props.allowOther && <option value="__other__">Other…</option>}
      </select>
      {isOther && (
        <input
          className="input mt-1 w-full text-[11px]"
          value={value.trimStart()}
          placeholder="Type your own"
          onChange={(e) => props.onChange(e.target.value)}
          autoFocus
        />
      )}
    </label>
  )
}

/** Multi-select as fill-toggle chips (replaces a row of raw checkboxes). */
export function ToggleChips<T extends string>(props: {
  options: { value: T; label: string }[]
  selected: readonly T[]
  onChange: (v: T[]) => void
}): JSX.Element {
  const selected = props.selected ?? []
  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {props.options.map((o) => {
        const on = selected.includes(o.value)
        return (
          <button
            key={o.value}
            type="button"
            className={`chip ${
              on ? 'border-cyan-700 bg-cyan-900/60 text-cyan-200' : 'text-gray-300 hover:border-gray-500'
            }`}
            onClick={() =>
              props.onChange(on ? selected.filter((x) => x !== o.value) : [...selected, o.value])
            }
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** Collapsible editor section. */
export function Section(props: {
  title: string
  summary?: string
  defaultOpen?: boolean
  children: ReactNode
}): JSX.Element {
  const [open, setOpen] = useState(props.defaultOpen ?? false)
  return (
    <div className="border-t border-edge first:border-t-0">
      <button
        type="button"
        className="flex w-full items-center gap-2 py-2.5 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="w-3 text-[10px] text-gray-500">{open ? '▾' : '▸'}</span>
        <span className="text-[11px] font-semibold text-gray-200">{props.title}</span>
        {props.summary && (
          <span className="ml-auto text-[10px] text-gray-500">{props.summary}</span>
        )}
      </button>
      {open && <div className="pb-4">{props.children}</div>}
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
  const items = props.items ?? []
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
      {items.map((item, i) => (
        <div key={i} className="mt-1 flex items-center gap-1">
          <input
            className="input w-full text-[11px]"
            value={item}
            onChange={(e) => set(i, e.target.value)}
          />
          <button
            type="button"
            className="btn px-1.5 py-0.5 text-[10px] text-gray-500"
            onClick={() => props.onChange(items.filter((_, j) => j !== i))}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn mt-1 px-2 py-0.5 text-[10px]"
        onClick={() => props.onChange([...items, ''])}
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
  const items = props.items ?? []
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
        value={draft ?? items.join(', ')}
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
        value={text ?? JSON.stringify(props.value ?? null, null, 2)}
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
  const items = props.items ?? []
  const setAt = (i: number, patch: Partial<T>): void => {
    const next = [...props.items]
    next[i] = { ...next[i], ...patch }
    props.onChange(next)
  }
  return (
    <div>
      {items.map((item, i) => (
        <div key={i} className="mt-2 rounded-lg bg-panel2/50 p-3">
          <div className="flex items-center">
            <span className="text-[11px] font-medium text-gray-300">
              {props.title(item, i) || `#${i + 1}`}
            </span>
            <button
              type="button"
              className="btn ml-auto px-1.5 py-0.5 text-[10px] text-gray-500"
              onClick={() => props.onChange(items.filter((_, j) => j !== i))}
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
        onClick={() => props.onChange([...items, props.makeEmpty()])}
      >
        + {props.addLabel}
      </button>
    </div>
  )
}

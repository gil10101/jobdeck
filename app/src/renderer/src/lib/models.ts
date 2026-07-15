// Model choices offered wherever a Claude model can be picked (assistant
// composer, Settings → Agent runs). Aliases resolve to the latest snapshot;
// pinned ids stay on a specific version. '' means the runtime default.
export interface ModelOption {
  value: string
  label: string
}

export const MODEL_OPTIONS: ModelOption[] = [
  { value: '', label: 'Default' },
  { value: 'sonnet', label: 'Sonnet (latest)' },
  { value: 'opus', label: 'Opus (latest)' },
  { value: 'haiku', label: 'Haiku (latest)' },
  { value: 'claude-opus-4-8', label: 'Opus 4.8' },
  { value: 'claude-sonnet-5', label: 'Sonnet 5' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' }
]

/** The option list plus, when the current value is not in it, that value as a
 *  custom entry — so a hand-set model id survives round-trips through a select. */
export function modelOptionsWith(current: string): ModelOption[] {
  if (!current || MODEL_OPTIONS.some((o) => o.value === current)) return MODEL_OPTIONS
  return [...MODEL_OPTIONS, { value: current, label: `Custom: ${current}` }]
}

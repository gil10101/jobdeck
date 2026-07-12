// Status normalization + the 4-color scheme (mirrors the old applications.xlsx CF rules).
import type { StatusKey } from './types'

export type StatusColor = 'red' | 'yellow' | 'green' | 'blue'

/**
 * Normalize free-text status to a StatusKey.
 * ORDER MATTERS: "NOT yet submitted - CV ready" contains "submitted",
 * so the not-yet family must be checked before the applied family.
 */
export function normalizeStatus(text: string | null | undefined): StatusKey {
  const t = (text ?? '').toLowerCase()
  if (/withdraw/.test(t)) return 'withdrawn'
  if (/reject|no offer|declin|closed/.test(t)) return 'rejected'
  if (/offer/.test(t)) return 'offer'
  if (/interview|in process|screen|assessment|\boa\b|onsite/.test(t)) return 'interview'
  if (/not yet|cv ready|ready|todo|draft/.test(t)) return 'not_applied'
  if (/applied|submitted|sent/.test(t)) return 'applied'
  return 'not_applied'
}

export function statusColor(key: StatusKey): StatusColor {
  switch (key) {
    case 'rejected':
    case 'withdrawn':
      return 'red'
    case 'interview':
    case 'offer':
      return 'blue'
    case 'applied':
      return 'green'
    case 'not_applied':
    default:
      return 'yellow'
  }
}

/** Canonical statusText written when the user picks a StatusKey from the UI. */
export const CANONICAL_STATUS_TEXT: Record<StatusKey, string> = {
  not_applied: 'NOT yet submitted - CV ready',
  applied: 'applied',
  interview: 'interview / in process',
  offer: 'offer received',
  rejected: 'rejected',
  withdrawn: 'withdrawn'
}

export const STATUS_LABELS: Record<StatusKey, string> = {
  not_applied: 'Not applied',
  applied: 'Applied',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn'
}

/** Theme-aware chip colors — the actual values live in styles.css per [data-theme]. */
export const STATUS_COLOR_STYLES: Record<StatusColor, { bg: string; text: string; dot: string }> = {
  red: { bg: 'var(--st-red-bg)', text: 'var(--st-red-fg)', dot: 'var(--st-red-dot)' },
  yellow: { bg: 'var(--st-yellow-bg)', text: 'var(--st-yellow-fg)', dot: 'var(--st-yellow-dot)' },
  green: { bg: 'var(--st-green-bg)', text: 'var(--st-green-fg)', dot: 'var(--st-green-dot)' },
  blue: { bg: 'var(--st-blue-bg)', text: 'var(--st-blue-fg)', dot: 'var(--st-blue-dot)' }
}

export const ALL_STATUS_KEYS: StatusKey[] = [
  'not_applied',
  'applied',
  'interview',
  'offer',
  'rejected',
  'withdrawn'
]

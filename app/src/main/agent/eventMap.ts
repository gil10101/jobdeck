import type { RunEvent } from '@shared/types'

import type { RunStatus } from '@shared/types'

/** Event payloads before the runner stamps seq/ts. */
export type PartialRunEvent =
  | { kind: 'status'; status: RunStatus }
  | { kind: 'init'; model: string; sessionId?: string }
  | { kind: 'text'; text: string; complete: boolean }
  | { kind: 'tool_start'; toolUseId: string; tool: string; summary: string }
  | { kind: 'tool_end'; toolUseId: string; ok: boolean; preview: string }
  | {
      kind: 'result'
      ok: boolean
      costUsd?: number
      durationMs?: number
      numTurns?: number
      errorText?: string
    }

export interface MappedMessage {
  events: PartialRunEvent[]
  /** Raw streaming text delta (coalesced by the runner). */
  textDelta: string | null
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

function toolSummary(tool: string, input: Record<string, unknown>): string {
  const str = (k: string): string => (typeof input[k] === 'string' ? (input[k] as string) : '')
  switch (tool) {
    case 'Bash':
    case 'PowerShell':
      return truncate(str('command') || str('description'), 120)
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return truncate(str('file_path'), 120)
    case 'Glob':
    case 'Grep':
      return truncate(str('pattern'), 120)
    case 'WebFetch':
      return truncate(str('url'), 120)
    case 'WebSearch':
      return truncate(str('query'), 120)
    default:
      try {
        return truncate(JSON.stringify(input), 120)
      } catch {
        return ''
      }
  }
}

function stringifyContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (typeof b === 'string') return b
        const o = b as Record<string, unknown>
        if (typeof o.text === 'string') return o.text
        return ''
      })
      .join(' ')
  }
  return ''
}

/**
 * Map one raw SDK message to UI events. Shape-tolerant by design:
 * SDK minor versions have moved fields (msg.message.content vs msg.content).
 */
export function mapMessage(raw: unknown): MappedMessage {
  const out: MappedMessage = { events: [], textDelta: null }
  const msg = raw as Record<string, unknown>
  if (!msg || typeof msg !== 'object') return out
  const type = msg.type as string

  if (type === 'system') {
    if ((msg.subtype as string) === 'init') {
      out.events.push({
        kind: 'init',
        model: (msg.model as string) ?? 'unknown',
        sessionId: (msg.session_id as string) ?? undefined
      })
    }
    return out
  }

  if (type === 'assistant' || type === 'user') {
    const inner = (msg.message as Record<string, unknown>) ?? msg
    const content = (inner.content ?? msg.content) as unknown
    const blocks: Record<string, unknown>[] = Array.isArray(content)
      ? (content as Record<string, unknown>[])
      : []
    for (const block of blocks) {
      const btype = block.type as string
      if (type === 'assistant' && btype === 'text' && typeof block.text === 'string') {
        if (block.text.trim()) out.events.push({ kind: 'text', text: block.text, complete: true })
      } else if (type === 'assistant' && btype === 'tool_use') {
        const tool = (block.name as string) ?? 'tool'
        out.events.push({
          kind: 'tool_start',
          toolUseId: (block.id as string) ?? '',
          tool,
          summary: toolSummary(tool, (block.input as Record<string, unknown>) ?? {})
        })
      } else if (type === 'user' && btype === 'tool_result') {
        out.events.push({
          kind: 'tool_end',
          toolUseId: (block.tool_use_id as string) ?? '',
          ok: !(block.is_error as boolean),
          preview: truncate(stringifyContent(block.content), 300)
        })
      }
    }
    return out
  }

  if (type === 'stream_event') {
    const ev = msg.event as Record<string, unknown> | undefined
    if (ev && (ev.type as string) === 'content_block_delta') {
      const delta = ev.delta as Record<string, unknown> | undefined
      if (delta && typeof delta.text === 'string') out.textDelta = delta.text
    }
    return out
  }

  if (type === 'result') {
    const subtype = (msg.subtype as string) ?? ''
    const isError = (msg.is_error as boolean) ?? subtype.startsWith('error')
    out.events.push({
      kind: 'result',
      ok: !isError && (subtype === 'success' || subtype === 'end' || subtype === ''),
      costUsd: (msg.total_cost_usd as number) ?? undefined,
      durationMs: (msg.duration_ms as number) ?? undefined,
      numTurns: (msg.num_turns as number) ?? undefined,
      errorText: isError ? ((msg.result as string) || subtype || 'agent errored') : undefined
    })
    return out
  }

  return out
}

export function stamp(seq: number, e: PartialRunEvent): RunEvent {
  return { seq, ts: Date.now(), ...e }
}

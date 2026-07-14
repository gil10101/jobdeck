import { randomUUID } from 'node:crypto'
import type { PermissionResult, SDKMessage, SDKResultMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AssistantConversation, AssistantMessage, AssistantStatus } from '@shared/types'
import { mapMessage, stamp, type PartialRunEvent } from '../agent/eventMap'
import type { RunStore } from '../agent/runStore'
import { REPO_ROOT } from '../paths'
import type { Store } from '../store/Store'
import type { TrackerRepo } from '../store/trackerRepo'
import { emptyUsage, loadConversation, readMemory, saveConversation } from './conversationStore'
import { buildAssistantMcp } from './tools'

// One interactive Claude Agent SDK session bound to a single conversation.
// Streaming-input mode: a single long-lived query() fed by a push-able async
// queue, so every user turn in the conversation shares one context — sibling
// to AgentRunner (one-shot runs), but this one stays alive across turns.
// Owns: the live query handle, its AbortController, the input queue, the
// accumulated token usage, and the pending-approval map.

const TEXT_FLUSH_MS = 100
const TITLE_MAX = 40

export interface SessionDeps {
  store: Store
  tracker: TrackerRepo
  runStore: RunStore
  startScout: (instructions: string) => { id: string }
  send: (channel: string, payload: unknown) => void
}

interface PendingApproval {
  resolve: (allowed: boolean) => void
}

/** First ~40 chars of the opening message, collapsed to one line, for the conversation title. */
function titleFromMessage(text: string): string {
  const collapsed = text.trim().replace(/\s+/g, ' ')
  if (!collapsed) return 'New chat'
  return collapsed.length > TITLE_MAX ? `${collapsed.slice(0, TITLE_MAX)}…` : collapsed
}

export class AssistantSession {
  private conversation: AssistantConversation

  // Streaming-input queue: query() consumes inputStream(), pushUser() feeds it.
  private queue: SDKUserMessage[] = []
  private resolveNext: (() => void) | null = null
  private closed = false
  private running = false

  private controller: AbortController | null = null
  private seq = 0

  // Accumulates events/text for the assistant turn currently in flight.
  private currentAssistantMessage: AssistantMessage | null = null
  private textBuffer = ''
  private flushTimer: NodeJS.Timeout | null = null

  private approvals = new Map<string, PendingApproval>()

  constructor(
    public readonly conversationId: string,
    private deps: SessionDeps
  ) {
    const now = new Date().toISOString()
    this.conversation = loadConversation(conversationId) ?? {
      id: conversationId,
      title: 'New chat',
      createdAt: now,
      updatedAt: now,
      messages: [],
      usage: emptyUsage()
    }
  }

  /** Enqueue a user turn; starts the persistent query loop on the first call. */
  send(text: string): void {
    const userMessage: AssistantMessage = {
      id: randomUUID().slice(0, 8),
      role: 'user',
      text,
      events: [],
      createdAt: new Date().toISOString()
    }
    if (this.conversation.messages.length === 0) {
      this.conversation.title = titleFromMessage(text)
    }
    this.conversation.messages.push(userMessage)
    saveConversation(this.conversation)
    this.deps.send('push:assistantMessage', { conversationId: this.conversationId, message: userMessage })

    this.setState('thinking')
    this.pushUser(text)
    if (!this.running) {
      this.running = true
      void this.run()
    }
  }

  /** Interrupt the live query and deny anything still awaiting approval. */
  stop(): void {
    this.controller?.abort()
    this.closed = true
    this.resolveNext?.()
    this.resolveNext = null
    for (const pending of this.approvals.values()) pending.resolve(false)
    this.approvals.clear()
    this.setState('idle')
  }

  resolveApproval(approvalId: string, decision: 'allow' | 'deny'): void {
    const pending = this.approvals.get(approvalId)
    if (!pending) return
    this.approvals.delete(approvalId)
    pending.resolve(decision === 'allow')
    this.setState('thinking')
  }

  private async *inputStream(): AsyncGenerator<SDKUserMessage> {
    while (!this.closed) {
      if (this.queue.length === 0) await new Promise<void>((r) => (this.resolveNext = r))
      while (this.queue.length) yield this.queue.shift()!
    }
  }

  private pushUser(text: string): void {
    this.queue.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null })
    this.resolveNext?.()
    this.resolveNext = null
  }

  /** The one long-lived query() for this session's whole life; runs until stop() closes the input stream. */
  private async run(): Promise<void> {
    const { query } = await import('@anthropic-ai/claude-agent-sdk')
    const mcp = buildAssistantMcp({
      store: this.deps.store,
      tracker: this.deps.tracker,
      runStore: this.deps.runStore,
      startScout: this.deps.startScout,
      requestApproval: (tool, preview) => this.requestApproval(tool, preview)
    })
    const controller = new AbortController()
    this.controller = controller
    const model = this.deps.store.state.settings.model
    const q = query({
      prompt: this.inputStream(),
      options: {
        cwd: REPO_ROOT,
        systemPrompt: { type: 'preset', preset: 'claude_code', append: this.systemAppend() },
        settingSources: [],
        permissionMode: 'default',
        mcpServers: { deck: mcp },
        canUseTool: (name, input, { signal }) => this.canUse(name, input, signal),
        abortController: controller,
        includePartialMessages: true,
        env: { ...process.env } as Record<string, string>,
        ...(model ? { model } : {})
      }
    })
    this.setState('thinking')
    try {
      for await (const msg of q) {
        this.onMessage(msg)
      }
      this.flushText(true)
      this.closeTurn()
    } catch (err) {
      this.flushText(true)
      if (!controller.signal.aborted) {
        console.error('[assistant] session query failed:', err)
        this.emit({ kind: 'result', ok: false, errorText: String(err) })
      }
      this.closeTurn()
    } finally {
      this.running = false
      this.setState('idle')
    }
  }

  private systemAppend(): string {
    const harness = [
      'You are the jobdeck in-app assistant: a chat panel inside the jobdeck Electron app, helping the user manage their own job-application tracker.',
      'You have "deck" tools to read the app\'s live state (candidate profile, tracked applications, agent runs, scouted candidates, settings) and two approval-gated actions: add_profile_entry (append one entry to the candidate profile) and start_scout (start a scout run). Both require the user\'s explicit approval — call the tool and wait for its result, never assume approval was given.',
      'Use the remember tool sparingly: only to record durable, non-obvious preferences the user states about how they want to work, not routine facts already visible in the app state.'
    ].join('\n\n')
    const memory = readMemory().trim()
    return memory ? `${harness}\n\nWhat you remember about this user:\n${memory}` : harness
  }

  private onMessage(msg: SDKMessage): void {
    const mapped = mapMessage(msg)
    if (mapped.textDelta) {
      this.textBuffer += mapped.textDelta
      if (!this.flushTimer) {
        this.flushTimer = setTimeout(() => {
          this.flushTimer = null
          if (this.textBuffer) this.emitEphemeral({ kind: 'text', text: this.textBuffer, complete: false })
        }, TEXT_FLUSH_MS)
      }
    }
    for (const e of mapped.events) {
      if (e.kind === 'text' && e.complete) {
        // Full assistant text supersedes the partial streaming buffer.
        if (this.flushTimer) {
          clearTimeout(this.flushTimer)
          this.flushTimer = null
        }
        this.textBuffer = ''
      }
      this.emit(e)
      if (e.kind === 'result') {
        if (msg.type === 'result') this.applyUsage(msg)
        this.deps.send('push:assistantUsage', { conversationId: this.conversationId, ...this.conversation.usage })
        this.closeTurn()
      }
    }
  }

  /** Pull token/cost/context-window detail the mapped event doesn't carry — straight off the raw SDK result. */
  private applyUsage(rawMsg: SDKResultMessage): void {
    const usage = this.conversation.usage
    const inputTokens = rawMsg.usage.input_tokens ?? 0
    const cacheTokens = (rawMsg.usage.cache_read_input_tokens ?? 0) + (rawMsg.usage.cache_creation_input_tokens ?? 0)
    usage.inputTokens = inputTokens
    usage.outputTokens = rawMsg.usage.output_tokens ?? 0
    usage.cacheTokens = cacheTokens
    usage.contextTokens = inputTokens + cacheTokens
    usage.costUsd += rawMsg.total_cost_usd ?? 0
    const contextWindow = Object.values(rawMsg.modelUsage ?? {})[0]?.contextWindow
    if (contextWindow) usage.contextWindow = contextWindow
  }

  /** Stamp, buffer into the in-flight assistant message, and push to the renderer. */
  private emit(e: PartialRunEvent): void {
    const event = stamp(++this.seq, e)
    if (!this.currentAssistantMessage) this.currentAssistantMessage = this.newAssistantMessage()
    this.currentAssistantMessage.events.push(event)
    if (event.kind === 'text' && event.complete) {
      this.currentAssistantMessage.text = this.currentAssistantMessage.text
        ? `${this.currentAssistantMessage.text}\n\n${event.text}`
        : event.text
    }
    this.deps.send('push:assistantEvent', { conversationId: this.conversationId, event })
  }

  /** Live streaming-text preview: pushed for display, not buffered (the complete block supersedes it). */
  private emitEphemeral(e: PartialRunEvent): void {
    const event = stamp(++this.seq, e)
    this.deps.send('push:assistantEvent', { conversationId: this.conversationId, event })
  }

  private flushText(complete: boolean): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (!this.textBuffer) return
    this.emit({ kind: 'text', text: this.textBuffer, complete })
    if (complete) this.textBuffer = ''
  }

  private newAssistantMessage(): AssistantMessage {
    return {
      id: randomUUID().slice(0, 8),
      role: 'assistant',
      text: '',
      events: [],
      createdAt: new Date().toISOString()
    }
  }

  /** Close out whatever assistant message is in flight: push it complete, persist, go idle. */
  private closeTurn(): void {
    if (this.currentAssistantMessage) {
      this.conversation.messages.push(this.currentAssistantMessage)
      this.deps.send('push:assistantMessage', {
        conversationId: this.conversationId,
        message: this.currentAssistantMessage
      })
      this.currentAssistantMessage = null
    }
    saveConversation(this.conversation)
    this.setState('idle')
  }

  private setState(status: AssistantStatus): void {
    this.deps.send('push:assistantState', { conversationId: this.conversationId, status })
  }

  /** Read tools + the two action tools all live under mcp__deck__* — everything else (Bash, Write, …) is denied. */
  private async canUse(
    name: string,
    _input: Record<string, unknown>,
    _signal: AbortSignal
  ): Promise<PermissionResult> {
    if (name.startsWith('mcp__deck__')) return { behavior: 'allow' }
    return { behavior: 'deny', message: `tool not allowed in the assistant session: ${name}` }
  }

  /** Bridges an action tool's call into a renderer approval round-trip; resolved by resolveApproval(). */
  private requestApproval(tool: string, preview: string): Promise<boolean> {
    const approvalId = randomUUID().slice(0, 8)
    return new Promise<boolean>((resolve) => {
      this.approvals.set(approvalId, { resolve })
      this.setState('awaiting-approval')
      this.deps.send('push:assistantApproval', {
        approvalId,
        conversationId: this.conversationId,
        tool,
        preview
      })
    })
  }
}

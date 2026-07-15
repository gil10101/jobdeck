import { randomUUID } from 'node:crypto'
import type { PermissionResult, SDKMessage, SDKResultMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AssistantApproval, AssistantConversation, AssistantMessage, AssistantStatus } from '@shared/types'
import { mapMessage, stamp, type PartialRunEvent } from '../agent/eventMap'
import type { RunStore } from '../agent/runStore'
import { REPO_ROOT } from '../paths'
import type { Store } from '../store/Store'
import type { TrackerRepo } from '../store/trackerRepo'
import { emptyUsage, loadConversation, readMemory, saveConversation } from './conversationStore'
import { buildAssistantMcp } from './tools'

// One interactive Claude Agent SDK session bound to a single conversation.
// Streaming-input mode: each active run is one query() fed by a run-local
// async generator that drains the session-owned `pending` texts, so every
// user turn within a run shares one context — sibling to AgentRunner
// (one-shot runs). A generation counter fences superseded runs: a stale
// run's generator can never consume a pending text, and after stop() or
// query death a later send() revives the session with a fresh run that
// drains whatever is still pending.
// Owns: the live query handle, its AbortController, the pending texts, the
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
  // The pushed payload is kept so a conversation opened after the push was
  // dropped (renderer guards pushes by the on-screen conversation) can have
  // its approval re-delivered via resync.
  info: AssistantApproval
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

  // Streaming-input plumbing: each run() owns a fresh generator over `pending`;
  // `generation` fences superseded runs, `wake` re-checks the current one.
  private pending: string[] = []
  private wake: (() => void) | null = null
  private generation = 0
  private runClosed = false
  private running = false
  private disposed = false

  private controller: AbortController | null = null
  private seq = 0
  private lastStatus: AssistantStatus = 'idle'

  // SDK result messages carry session-cumulative usage/cost figures, so
  // conversation totals are run-start baselines plus the latest result.
  private usageBase = { costUsd: 0, inputTokens: 0, outputTokens: 0, cacheTokens: 0 }

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

  /** Enqueue a user turn; starts a run when none is active (including reviving after stop()). */
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
    if (!this.disposed) saveConversation(this.conversation)
    this.deps.send('push:assistantMessage', { conversationId: this.conversationId, message: userMessage })

    this.setState('thinking')
    this.pending.push(text)
    if (this.running) {
      this.wakeInput()
    } else {
      void this.run()
    }
  }

  /** Interrupt the live query and deny anything still awaiting approval; a later send() revives the session. */
  stop(): void {
    this.controller?.abort()
    this.runClosed = true
    this.running = false
    this.wakeInput()
    this.denyPendingApprovals()
    this.setState('idle')
  }

  /** Stop permanently for deletion: the dying run's final save must not
   *  resurrect the conversation file after deleteConversation removes it. */
  dispose(): void {
    this.disposed = true
    this.stop()
  }

  resolveApproval(approvalId: string, decision: 'allow' | 'deny'): void {
    const pending = this.approvals.get(approvalId)
    if (!pending) return
    this.approvals.delete(approvalId)
    pending.resolve(decision === 'allow')
    this.setState('thinking')
  }

  /** Current status + any parked approval, for a renderer (re)opening this conversation. */
  liveState(): { status: AssistantStatus; pendingApproval: AssistantApproval | null } {
    const first = this.approvals.values().next()
    return {
      status: this.lastStatus,
      pendingApproval: first.done ? null : first.value.info
    }
  }

  private wakeInput(): void {
    this.wake?.()
    this.wake = null
  }

  private denyPendingApprovals(): void {
    for (const pending of this.approvals.values()) pending.resolve(false)
    this.approvals.clear()
  }

  /** Run-local input stream: drains `pending`, parks until woken, exits once this run is closed or superseded. */
  private async *inputStream(gen: number): AsyncGenerator<SDKUserMessage> {
    while (!this.runClosed && gen === this.generation) {
      const text = this.pending.shift()
      if (text === undefined) {
        await new Promise<void>((resolve) => (this.wake = resolve))
        continue
      }
      yield { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null }
    }
  }

  /** One query() run: alive while turns flow, ends when stop() closes its input or the query dies. */
  private async run(): Promise<void> {
    this.running = true
    this.generation++
    const gen = this.generation
    this.runClosed = false
    const usage = this.conversation.usage
    this.usageBase = {
      costUsd: usage.costUsd,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheTokens: usage.cacheTokens
    }
    const controller = new AbortController()
    this.controller = controller
    try {
      const { query } = await import('@anthropic-ai/claude-agent-sdk')
      const mcp = buildAssistantMcp({
        store: this.deps.store,
        tracker: this.deps.tracker,
        runStore: this.deps.runStore,
        startScout: this.deps.startScout,
        requestApproval: (tool, preview) => this.requestApproval(tool, preview)
      })
      const model = this.deps.store.state.settings.model
      const q = query({
        prompt: this.inputStream(gen),
        options: {
          cwd: REPO_ROOT,
          systemPrompt: { type: 'preset', preset: 'claude_code', append: this.systemAppend() },
          settingSources: [],
          permissionMode: 'default',
          mcpServers: { app: mcp },
          canUseTool: (name, input, { signal }) => this.canUse(name, input, signal),
          abortController: controller,
          includePartialMessages: true,
          env: { ...process.env } as Record<string, string>,
          ...(model ? { model } : {}),
          // Revived runs (after stop(), a died query, or an app restart) resume
          // the SDK session so the model keeps the conversation's prior context;
          // without this the UI shows one seamless thread the model can't see.
          ...(this.conversation.sdkSessionId ? { resume: this.conversation.sdkSessionId } : {})
        }
      })
      this.setState('thinking')
      for await (const msg of q) {
        if (gen === this.generation) this.onMessage(msg)
      }
      if (gen === this.generation) {
        this.flushText(true)
        this.closeTurn()
      }
    } catch (err) {
      if (gen === this.generation) {
        this.flushText(true)
        if (!controller.signal.aborted) {
          console.error('[assistant] session query failed:', err)
          this.emit({ kind: 'result', ok: false, errorText: String(err) })
          // The failure may be an unresumable session (transcript pruned or
          // corrupt); drop the id so the next run can start fresh instead of
          // failing the same way forever. A fresh id is captured on success.
          this.conversation.sdkSessionId = undefined
        }
        this.closeTurn()
      } else if (!controller.signal.aborted) {
        console.error('[assistant] superseded session query failed:', err)
      }
    } finally {
      // Only the run that still owns the session may tear down shared state.
      if (gen === this.generation) {
        this.runClosed = true
        this.wakeInput()
        this.denyPendingApprovals()
        this.running = false
        this.setState('idle')
      }
    }
  }

  private systemAppend(): string {
    const harness = [
      'You are the in-app assistant: a chat panel inside this job-application desktop app, helping the user manage their own job-application tracker.',
      "Your tools read the app's live state (candidate profile, tracked applications, agent runs, scouted candidates, settings) and offer two approval-gated actions: add_profile_entry (append one entry to the candidate profile) and start_scout (start a scout run). Both require the user's explicit approval — call the tool and wait for its result, never assume approval was given.",
      'Use the remember tool sparingly: only to record durable, non-obvious preferences the user states about how they want to work, not routine facts already visible in the app state.'
    ].join('\n\n')
    // Tail-capped: memory.md grows one line per remember() forever, and the
    // whole excerpt rides along in every system prompt.
    const memory = readMemory().trim().slice(-4000)
    return memory ? `${harness}\n\nWhat you remember about this user:\n${memory}` : harness
  }

  private onMessage(msg: SDKMessage): void {
    // A turn starting after a previous result pushed 'idle' must show as live again.
    if (this.lastStatus === 'idle') this.setState('thinking')
    if ('session_id' in msg && msg.session_id) this.conversation.sdkSessionId = msg.session_id
    // Context size comes from per-step assistant-message usage — the result
    // message's usage is cumulative across the whole query() and would inflate
    // by roughly a full context per tool round-trip.
    if (msg.type === 'assistant' && msg.message.usage) {
      const u = msg.message.usage
      this.conversation.usage.contextTokens =
        (u.input_tokens ?? 0) +
        (u.cache_read_input_tokens ?? 0) +
        (u.cache_creation_input_tokens ?? 0)
    }
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
      // Streamed partial text must land in this turn before the result closes it.
      if (e.kind === 'result') this.flushText(true)
      this.emit(e)
      if (e.kind === 'result') {
        if (msg.type === 'result') this.applyUsage(msg)
        this.deps.send('push:assistantUsage', { conversationId: this.conversationId, ...this.conversation.usage })
        this.closeTurn()
      }
    }
  }

  /** Token/cost/context-window detail off the raw SDK result — figures are session-cumulative, so baseline + assign, never +=. */
  private applyUsage(rawMsg: SDKResultMessage): void {
    const usage = this.conversation.usage
    const inputTokens = rawMsg.usage.input_tokens ?? 0
    const cacheTokens = (rawMsg.usage.cache_read_input_tokens ?? 0) + (rawMsg.usage.cache_creation_input_tokens ?? 0)
    usage.inputTokens = this.usageBase.inputTokens + inputTokens
    usage.outputTokens = this.usageBase.outputTokens + (rawMsg.usage.output_tokens ?? 0)
    usage.cacheTokens = this.usageBase.cacheTokens + cacheTokens
    usage.costUsd = this.usageBase.costUsd + (rawMsg.total_cost_usd ?? 0)
    // A result can report several models (e.g. a background small model); the
    // conversation's window is the largest one. Keep the prior value when absent.
    let contextWindow = 0
    for (const m of Object.values(rawMsg.modelUsage ?? {})) {
      if (m.contextWindow > contextWindow) contextWindow = m.contextWindow
    }
    if (contextWindow > 0) usage.contextWindow = contextWindow
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
    if (!this.disposed) saveConversation(this.conversation)
    this.setState('idle')
  }

  private setState(status: AssistantStatus): void {
    this.lastStatus = status
    this.deps.send('push:assistantState', { conversationId: this.conversationId, status })
  }

  /** Read tools + the two action tools all live under mcp__app__* — everything else (Bash, Write, …) is denied. */
  private async canUse(
    name: string,
    _input: Record<string, unknown>,
    _signal: AbortSignal
  ): Promise<PermissionResult> {
    if (name.startsWith('mcp__app__')) return { behavior: 'allow' }
    return { behavior: 'deny', message: `tool not allowed in the assistant session: ${name}` }
  }

  /** Bridges an action tool's call into a renderer approval round-trip; resolved by resolveApproval(). */
  private requestApproval(tool: string, preview: string): Promise<boolean> {
    const info: AssistantApproval = {
      approvalId: randomUUID().slice(0, 8),
      conversationId: this.conversationId,
      tool,
      preview
    }
    return new Promise<boolean>((resolve) => {
      this.approvals.set(info.approvalId, { info, resolve })
      this.setState('awaiting-approval')
      this.deps.send('push:assistantApproval', info)
    })
  }
}

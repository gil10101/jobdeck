import type { AssistantApproval, AssistantConversation, AssistantStatus, ConversationMeta } from '@shared/types'
import { AssistantSession, type SessionDeps } from './AssistantSession'
import {
  deleteConversation,
  listConversations,
  loadConversation,
  newConversation as createConversation
} from './conversationStore'

// Owns every AssistantSession for the app's lifetime, keyed by conversationId.
// Sessions survive stop() (see AssistantSession), so this map only drops an
// entry on delete() — switching between conversations reuses whichever
// session is already parked here, or lazily creates one on first send().

export class AssistantManager {
  private sessions = new Map<string, AssistantSession>()

  constructor(private deps: SessionDeps) {}

  send({ conversationId, text }: { conversationId: string | null; text: string }): { conversationId: string } {
    // Reject malformed ids (empty included) before a session is mapped for
    // them — the session itself would only fail later, at its first save.
    if (conversationId !== null && !/^[A-Za-z0-9_-]+$/.test(conversationId)) {
      throw new Error(`invalid conversation id: ${conversationId}`)
    }
    const id = conversationId ?? createConversation().id
    const session = this.sessions.get(id) ?? new AssistantSession(id, this.deps)
    this.sessions.set(id, session)
    session.send(text)
    return { conversationId: id }
  }

  stop({ conversationId }: { conversationId: string }): void {
    this.sessions.get(conversationId)?.stop()
  }

  /** Broadcast to every live session — resolveApproval() is a no-op for an unknown approvalId. */
  approve({ approvalId, decision }: { approvalId: string; decision: 'allow' | 'deny' }): void {
    for (const session of this.sessions.values()) session.resolveApproval(approvalId, decision)
  }

  /** Mints an id only — nothing is persisted until the first message, so an
   *  abandoned "new chat" never leaves an empty conversation file behind. */
  newConversation(): { conversationId: string } {
    return { conversationId: createConversation().id }
  }

  list(): ConversationMeta[] {
    return listConversations()
  }

  get(id: string): AssistantConversation | null {
    return loadConversation(id)
  }

  /** Live status + parked approval for a conversation being (re)opened; pushes
   *  only fire on transitions, so this is the renderer's catch-up path. */
  resync({ conversationId }: { conversationId: string }): {
    status: AssistantStatus
    pendingApproval: AssistantApproval | null
  } {
    const session = this.sessions.get(conversationId)
    return session ? session.liveState() : { status: 'idle', pendingApproval: null }
  }

  del(id: string): void {
    this.sessions.get(id)?.dispose()
    this.sessions.delete(id)
    deleteConversation(id)
  }
}

import type { AssistantConversation, ConversationMeta } from '@shared/types'
import { AssistantSession, type SessionDeps } from './AssistantSession'
import {
  deleteConversation,
  listConversations,
  loadConversation,
  newConversation as createConversation,
  saveConversation
} from './conversationStore'

// Owns every AssistantSession for the app's lifetime, keyed by conversationId.
// Sessions survive stop() (see AssistantSession), so this map only drops an
// entry on delete() — switching between conversations reuses whichever
// session is already parked here, or lazily creates one on first send().

export class AssistantManager {
  private sessions = new Map<string, AssistantSession>()

  constructor(private deps: SessionDeps) {}

  send({ conversationId, text }: { conversationId: string | null; text: string }): { conversationId: string } {
    let id = conversationId
    if (!id) {
      const c = createConversation()
      saveConversation(c)
      id = c.id
    }
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

  newConversation(): { conversationId: string } {
    const c = createConversation()
    saveConversation(c)
    return { conversationId: c.id }
  }

  list(): ConversationMeta[] {
    return listConversations()
  }

  get(id: string): AssistantConversation | null {
    return loadConversation(id)
  }

  del(id: string): void {
    this.sessions.get(id)?.stop()
    this.sessions.delete(id)
    deleteConversation(id)
  }
}

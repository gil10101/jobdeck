import { BrowserWindow, Notification } from 'electron'
import type { Store } from '../store/Store'
import { listEvents, markReminded } from './calendarStore'

// Reminder toasts for APPROVED calendar events: one the day before, one
// shortly before start (lead configurable via settings.reminderLeadMinutes).
// Every reminder is stamped in the calendar store BEFORE its toast shows —
// a crash between stamp and toast may drop one notification but can never
// re-notify forever. settings.emailNotifications is the single mute switch
// for all mail + calendar noise.

const TICK_MS = 60_000
const DAY_MS = 24 * 60 * 60 * 1000
/** A tick landing moments after start still reminds ("it just started"). */
const START_GRACE_MS = 5 * 60 * 1000
const MIN_LEAD_MINUTES = 5
const MAX_LEAD_MINUTES = 240

export interface ReminderLoopDeps {
  store: Store
  send: (channel: string, payload: unknown) => void
}

export class ReminderLoop {
  private timer: NodeJS.Timeout | null = null

  constructor(private deps: ReminderLoopDeps) {}

  /** Check every minute; idempotent. */
  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.tick(), TICK_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private leadMs(): number {
    const raw = this.deps.store.state.settings.reminderLeadMinutes
    return Math.min(MAX_LEAD_MINUTES, Math.max(MIN_LEAD_MINUTES, Math.round(raw) || 30)) * 60_000
  }

  /** One pass over approved events; a bad event or toast failure must never
   *  kill the interval. */
  private tick(): void {
    try {
      if (!this.deps.store.state.settings.emailNotifications) return
      if (!Notification.isSupported()) return
      const now = Date.now()
      const lead = this.leadMs()
      for (const event of listEvents()) {
        if (event.state !== 'approved') continue
        const start = Date.parse(event.start)
        if (!Number.isFinite(start)) continue
        const soonDue = now >= start - lead && now < start + START_GRACE_MS && !event.remindedSoon
        if (now >= start - DAY_MS && now < start && !event.remindedDayBefore) {
          markReminded(event.id, 'dayBefore')
          // Inside the soon window a "tomorrow" toast would lie — stamp the
          // day-before reminder silently and let the soon one speak.
          if (!soonDue) this.show('Interview tomorrow', event.title, start, event.meetLink)
        }
        if (soonDue) {
          markReminded(event.id, 'soon')
          this.show('Starting soon', event.title, start, event.meetLink)
        }
      }
    } catch (err) {
      console.error('[calendar] reminder tick failed:', err)
    }
  }

  private show(title: string, eventTitle: string, start: number, meetLink: string | null): void {
    const when = new Date(start).toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    })
    const n = new Notification({
      title,
      body: `${eventTitle} — ${when}${meetLink ? ' · link in app' : ''}`
    })
    n.on('click', () => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win) {
        if (win.isMinimized()) win.restore()
        win.show()
        win.focus()
      }
      this.deps.send('push:calendarFocus', {})
    })
    n.show()
  }
}

import { useEffect, useRef, useState } from 'react'
import type { RunEvent, RunMeta } from '@shared/types'
import { call, onPush } from '../api'

/** Subscribe to a run's live events, seeded with persisted history. */
export function useRunEvents(runId: string | null): { meta: RunMeta | null; events: RunEvent[] } {
  const [meta, setMeta] = useState<RunMeta | null>(null)
  const [events, setEvents] = useState<RunEvent[]>([])
  const seenSeq = useRef<number>(0)

  useEffect(() => {
    setMeta(null)
    setEvents([])
    seenSeq.current = 0
    if (!runId) return

    let alive = true
    void call('runs:get', { runId })
      .then(({ meta, events }) => {
        if (!alive) return
        setMeta(meta)
        setEvents(events)
        seenSeq.current = events.length ? events[events.length - 1].seq : 0
      })
      .catch(() => undefined)

    const offEvent = onPush('push:runEvent', ({ runId: id, event }) => {
      if (id !== runId) return
      setEvents((prev) => {
        // ANY text event (partial or final) replaces a trailing in-progress
        // block — the final version supersedes the streamed preview.
        if (event.kind === 'text') {
          const last = prev[prev.length - 1]
          if (last && last.kind === 'text' && !last.complete) {
            seenSeq.current = Math.max(seenSeq.current, event.seq)
            return [...prev.slice(0, -1), event]
          }
          if (!event.complete && last && last.kind === 'text' && last.complete) {
            // Stale partial arriving after its final (flush race) — drop it.
            return prev
          }
        }
        if (event.seq <= seenSeq.current && event.kind !== 'text') return prev
        seenSeq.current = Math.max(seenSeq.current, event.seq)
        return [...prev, event]
      })
    })
    const offMeta = onPush('push:runChanged', (m) => {
      if (m.id === runId) setMeta(m)
    })
    return () => {
      alive = false
      offEvent()
      offMeta()
    }
  }, [runId])

  return { meta, events }
}

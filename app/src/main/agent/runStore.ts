import fs from 'node:fs'
import path from 'node:path'
import type { RunEvent, RunMeta } from '@shared/types'
import { RUNS_DIR } from '../paths'

/** Persists run metadata + append-only event JSONL so history survives restarts. */
export class RunStore {
  constructor() {
    fs.mkdirSync(RUNS_DIR, { recursive: true })
  }

  private metaPath(runId: string): string {
    return path.join(RUNS_DIR, `${runId}.meta.json`)
  }
  private eventsPath(runId: string): string {
    return path.join(RUNS_DIR, `${runId}.events.jsonl`)
  }
  private stderrPath(runId: string): string {
    return path.join(RUNS_DIR, `${runId}.stderr.log`)
  }

  saveMeta(meta: RunMeta): void {
    try {
      fs.writeFileSync(this.metaPath(meta.id), JSON.stringify(meta, null, 2), 'utf-8')
    } catch (err) {
      console.error('[runs] saveMeta failed:', err)
    }
  }

  appendEvent(runId: string, event: RunEvent): void {
    try {
      fs.appendFileSync(this.eventsPath(runId), JSON.stringify(event) + '\n', 'utf-8')
    } catch (err) {
      console.error('[runs] appendEvent failed:', err)
    }
  }

  appendStderr(runId: string, chunk: string): void {
    try {
      fs.appendFileSync(this.stderrPath(runId), chunk, 'utf-8')
    } catch {
      /* ignore */
    }
  }

  /** Audit trail: the exact filled prompt the agent received. */
  savePrompt(runId: string, prompt: string): void {
    try {
      fs.writeFileSync(path.join(RUNS_DIR, `${runId}.prompt.md`), prompt, 'utf-8')
    } catch {
      /* ignore */
    }
  }

  /** Fill fields added after first release so old metas still render. */
  private migrate(m: RunMeta): RunMeta {
    m.kind ??= 'build'
    m.summary ??= null
    m.problems ??= null
    m.resultPath ??= null
    // Legacy scouts baked the problems list into the summary — split it out.
    if (m.summary && m.summary.includes(' · problems: ')) {
      const idx = m.summary.indexOf(' · problems: ')
      const tail = m.summary.slice(idx + ' · problems: '.length).replace(/\)\s*$/, '')
      m.problems = tail.split('; ').filter(Boolean)
      m.summary = m.summary.slice(0, idx) + ')'
    }
    return m
  }

  list(): RunMeta[] {
    try {
      return fs
        .readdirSync(RUNS_DIR)
        .filter((f) => f.endsWith('.meta.json'))
        .map((f) => {
          try {
            return this.migrate(
              JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), 'utf-8')) as RunMeta
            )
          } catch {
            return null
          }
        })
        .filter((m): m is RunMeta => !!m)
        .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
    } catch {
      return []
    }
  }

  getMeta(runId: string): RunMeta | null {
    try {
      return this.migrate(JSON.parse(fs.readFileSync(this.metaPath(runId), 'utf-8')) as RunMeta)
    } catch {
      return null
    }
  }

  getEvents(runId: string): RunEvent[] {
    try {
      return fs
        .readFileSync(this.eventsPath(runId), 'utf-8')
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line) as RunEvent
          } catch {
            return null
          }
        })
        .filter((e): e is RunEvent => !!e)
        // Streaming partials are ephemeral UI state — drop any that were
        // persisted by older builds so replays don't show duplicate text.
        .filter((e) => !(e.kind === 'text' && !e.complete))
    } catch {
      return []
    }
  }
}

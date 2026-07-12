import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { IntakeItem } from '@shared/types'
import { DONE_PREFIX_RE, TODO_DIR } from '../paths'
import type { Store } from '../store/Store'

const DEBOUNCE_MS = 500

/** First http(s) URL within the first 5 lines of a posting file. */
function detectUrl(text: string): string | null {
  const head = text.split(/\r?\n/).slice(0, 5).join('\n')
  const m = head.match(/https?:\/\/[^\s)>\]]+/)
  return m ? m[0] : null
}

/**
 * Watches documents/applications/TODO for new posting files.
 * fs.watch on Windows fires duplicate/unreliable events, so events only
 * trigger a debounced full-directory rescan diff.
 */
export class TodoWatcher {
  private watcher: fs.FSWatcher | null = null
  private timer: NodeJS.Timeout | null = null

  constructor(
    private store: Store,
    private notifyNew: (item: IntakeItem) => void
  ) {}

  start(): void {
    this.rescan()
    try {
      this.watcher = fs.watch(TODO_DIR, () => this.schedule())
    } catch (err) {
      console.error('[todo] watch failed (manual rescan still works):', err)
    }
  }

  stop(): void {
    this.watcher?.close()
    this.watcher = null
    if (this.timer) clearTimeout(this.timer)
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.rescan()
    }, DEBOUNCE_MS)
  }

  /** Diff the TODO dir against known intake items; add new files as intake items. */
  rescan(): IntakeItem[] {
    let names: string[] = []
    try {
      names = fs.readdirSync(TODO_DIR)
    } catch {
      return []
    }
    const fresh: IntakeItem[] = []
    const known = new Set(
      this.store.state.intake
        .filter((i) => i.kind === 'todo-file' && i.todoFileName)
        .map((i) => i.todoFileName as string)
    )

    for (const name of names) {
      if (!/\.(txt|md)$/i.test(name)) continue
      if (/^readme\.md$/i.test(name)) continue
      if (DONE_PREFIX_RE.test(name)) continue
      if (known.has(name)) continue

      let text = ''
      try {
        text = fs.readFileSync(path.join(TODO_DIR, name), 'utf-8')
      } catch {
        continue
      }
      const base = name.replace(/\.(txt|md)$/i, '')
      const item: IntakeItem = {
        id: randomUUID(),
        kind: 'todo-file',
        todoFileName: name,
        title: base,
        postingText: text,
        imagePaths: [],
        applyUrl: detectUrl(text),
        companyHint: base,
        roleHint: '',
        state: 'new',
        runId: null,
        createdAt: new Date().toISOString()
      }
      fresh.push(item)
    }

    if (fresh.length) {
      this.store.mutate(['intake'], (s) => {
        s.intake.push(...fresh)
      })
      for (const item of fresh) this.notifyNew(item)
    }
    return fresh
  }

  /** Rename a processed TODO file to "[DONE] <name>" (repo convention). */
  markTodoDone(fileName: string): void {
    const from = path.join(TODO_DIR, fileName)
    const to = path.join(TODO_DIR, `[DONE] ${fileName}`)
    try {
      if (fs.existsSync(from) && !fs.existsSync(to)) fs.renameSync(from, to)
    } catch (err) {
      console.error('[todo] rename to [DONE] failed:', err)
    }
  }
}

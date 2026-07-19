import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import type { TrackerStoreFile } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { TRACKER_FILE, ensureAppDataDirs } from '../paths'

export type StoreDomain = 'rows' | 'intake' | 'settings' | 'candidates'

const SAVE_DEBOUNCE_MS = 250

function seedState(): TrackerStoreFile {
  return {
    schema: 'tracker.v1',
    revision: 0,
    rows: [],
    intake: [],
    intakeFolders: [],
    candidates: [],
    settings: { ...DEFAULT_SETTINGS }
  }
}

/**
 * Single-file JSON store with atomic writes (tmp + rename), a single-writer
 * queue, .tmp crash recovery, and a once-a-day backup copy.
 */
export class Store extends EventEmitter {
  private state_: TrackerStoreFile = seedState()
  private saveTimer: NodeJS.Timeout | null = null
  private saveChain: Promise<void> = Promise.resolve()
  private dirty = false

  load(): void {
    ensureAppDataDirs()
    const tmp = TRACKER_FILE + '.tmp'
    try {
      if (!fs.existsSync(TRACKER_FILE) && fs.existsSync(tmp)) {
        // Crash mid-rename: the tmp file is the newest complete write.
        fs.renameSync(tmp, TRACKER_FILE)
      }
      if (fs.existsSync(TRACKER_FILE)) {
        const raw = fs.readFileSync(TRACKER_FILE, 'utf-8')
        const parsed = JSON.parse(raw) as TrackerStoreFile
        if (parsed && parsed.schema === 'tracker.v1' && Array.isArray(parsed.rows)) {
          this.state_ = {
            ...seedState(),
            ...parsed,
            settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) }
          }
          // Migrations for fields added after first release.
          this.state_.candidates ??= []
          this.state_.intakeFolders ??= []
          for (const item of this.state_.intake) {
            item.imagePaths ??= []
            item.folderId ??= null
          }
        }
      }
    } catch (err) {
      // Corrupt store: keep the bad file for forensics, start fresh.
      try {
        fs.copyFileSync(TRACKER_FILE, TRACKER_FILE + `.corrupt-${Date.now()}`)
      } catch {
        /* ignore */
      }
      this.state_ = seedState()
      console.error('[store] failed to load tracker.json, starting fresh:', err)
    }
    this.backupDaily()
  }

  get state(): TrackerStoreFile {
    return this.state_
  }

  /** Apply a mutation, bump revision, schedule an atomic save, emit change. */
  mutate<T>(domains: StoreDomain[], fn: (s: TrackerStoreFile) => T): T {
    const result = fn(this.state_)
    this.state_.revision++
    this.dirty = true
    this.scheduleSave()
    this.emit('changed', domains)
    return result
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.saveNow()
    }, SAVE_DEBOUNCE_MS)
  }

  private saveNow(): Promise<void> {
    // Chain writes so only one is in flight at a time.
    this.saveChain = this.saveChain.then(async () => {
      if (!this.dirty) return
      this.dirty = false
      const json = JSON.stringify(this.state_, null, 2)
      const tmp = TRACKER_FILE + '.tmp'
      await fs.promises.writeFile(tmp, json, 'utf-8')
      await fs.promises.rename(tmp, TRACKER_FILE) // atomic on same volume; replaces on Windows
    })
    return this.saveChain.catch((err) => {
      console.error('[store] save failed:', err)
      this.dirty = true // retry on next mutation/flush
    })
  }

  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    await this.saveNow()
  }

  /** Copy tracker.json → tracker.backup.json at most once per calendar day. */
  private backupDaily(): void {
    try {
      if (!fs.existsSync(TRACKER_FILE)) return
      const backup = path.join(path.dirname(TRACKER_FILE), 'tracker.backup.json')
      const today = new Date().toDateString()
      if (fs.existsSync(backup)) {
        const mtime = fs.statSync(backup).mtime.toDateString()
        if (mtime === today) return
      }
      fs.copyFileSync(TRACKER_FILE, backup)
    } catch (err) {
      console.error('[store] daily backup failed:', err)
    }
  }
}

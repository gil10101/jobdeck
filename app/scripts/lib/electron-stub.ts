// Stand-in for the `electron` module so main-process sources load under plain
// node in the selftests. harness.ts resolves every `electron` import here.
// Recording fakes only: nothing opens a window, touches the keychain or
// relaunches anything. Tests steer dialogs and read recorded calls via `stub`.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const userData = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'electron-stub-'))

export const stub = {
  /** Next dialog.showMessageBox response index; tests set it per scenario. */
  messageBoxResponse: 0,
  /** Next dialog.showOpenDialog result paths (empty = cancelled). */
  openDialogPaths: [] as string[],
  trashed: [] as string[],
  opened: [] as string[],
  relaunched: 0,
  quit: 0,
  handlers: new Map<string, (event: unknown, req: unknown) => unknown>()
}

export const app = {
  isPackaged: false,
  getAppPath: (): string => path.resolve(import.meta.dirname, '..', '..'),
  getPath: (_name: string): string => userData,
  setPath: (): void => {},
  getVersion: (): string => '0.0.0-selftest',
  relaunch: (): void => {
    stub.relaunched++
  },
  quit: (): void => {
    stub.quit++
  },
  on: (): void => {},
  whenReady: (): Promise<void> => Promise.resolve()
}

export const shell = {
  trashItem: async (p: string): Promise<void> => {
    stub.trashed.push(p)
    fs.rmSync(p, { recursive: true, force: true })
  },
  openPath: async (p: string): Promise<string> => {
    stub.opened.push(p)
    return ''
  },
  openExternal: async (): Promise<void> => {}
}

export const dialog = {
  showMessageBox: async (): Promise<{ response: number }> => ({ response: stub.messageBoxResponse }),
  showOpenDialog: async (): Promise<{ canceled: boolean; filePaths: string[] }> => ({
    canceled: stub.openDialogPaths.length === 0,
    filePaths: stub.openDialogPaths
  }),
  showErrorBox: (): void => {}
}

export const ipcMain = {
  handle: (channel: string, fn: (event: unknown, req: unknown) => unknown): void => {
    if (stub.handlers.has(channel)) throw new Error(`second handler for ${channel}`)
    stub.handlers.set(channel, fn)
  },
  on: (): void => {}
}

export class BrowserWindow {
  static getAllWindows(): BrowserWindow[] {
    return []
  }
  isDestroyed(): boolean {
    return false
  }
}

export const safeStorage = {
  isEncryptionAvailable: (): boolean => false,
  encryptString: (s: string): Buffer => Buffer.from(s),
  decryptString: (b: Buffer): string => b.toString()
}

export class Notification {
  show(): void {}
}
export const clipboard = { writeText: (): void => {} }
export const net = { fetch: globalThis.fetch }
export const protocol = { registerSchemesAsPrivileged: (): void => {}, handle: (): void => {} }
export const webContents = { getAllWebContents: (): unknown[] => [] }

export default { app, shell, dialog, ipcMain, BrowserWindow, safeStorage, Notification, clipboard, net, protocol, webContents }

import { clipboard, shell } from 'electron'
import fs from 'node:fs'
import { toAbs } from '../paths'

export function showItem(relPath: string): void {
  const abs = toAbs(relPath)
  if (!fs.existsSync(abs)) throw new Error(`path does not exist: ${relPath}`)
  shell.showItemInFolder(abs)
}

export async function openFolder(relPath: string): Promise<void> {
  const abs = toAbs(relPath)
  if (!fs.existsSync(abs)) throw new Error(`path does not exist: ${relPath}`)
  const err = await shell.openPath(abs)
  if (err) throw new Error(err)
}

export async function openExternal(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) throw new Error('only http(s) URLs can be opened externally')
  await shell.openExternal(url)
}

export function copyText(text: string): void {
  clipboard.writeText(text)
}

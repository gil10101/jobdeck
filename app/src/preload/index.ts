import { contextBridge, ipcRenderer } from 'electron'
import type { IpcChannel, IpcInvokeContract, IpcPushChannel, IpcPushContract } from '@shared/ipc'
import { INVOKE_CHANNELS, PUSH_CHANNELS } from '@shared/ipc'
import type { IpcResult } from '@shared/types'

export interface MissionApi {
  invoke<C extends IpcChannel>(
    channel: C,
    req: IpcInvokeContract[C]['req']
  ): Promise<IpcResult<IpcInvokeContract[C]['res']>>
  on<C extends IpcPushChannel>(channel: C, cb: (payload: IpcPushContract[C]) => void): () => void
}

// The bridge is the only path from renderer to main, so it is also the only
// place a channel name can be constrained: TypeScript is erased at runtime and
// a compromised renderer can call invoke() with any string. Anything outside
// the contract is refused here — main never sees it.
const ALLOWED_INVOKE = new Set<string>(INVOKE_CHANNELS)
const ALLOWED_PUSH = new Set<string>(PUSH_CHANNELS)

const api: MissionApi = {
  invoke: (channel, req) => {
    if (!ALLOWED_INVOKE.has(channel)) {
      console.error(`[preload] blocked invoke on unknown channel: ${String(channel)}`)
      return Promise.resolve({ ok: false, error: `unknown IPC channel: ${String(channel)}` })
    }
    return ipcRenderer.invoke(channel, req)
  },
  on: (channel, cb) => {
    if (!ALLOWED_PUSH.has(channel)) {
      console.error(`[preload] blocked listener on unknown channel: ${String(channel)}`)
      return () => undefined
    }
    const listener = (_event: unknown, payload: never): void => cb(payload)
    ipcRenderer.on(channel, listener as never)
    return () => ipcRenderer.removeListener(channel, listener as never)
  }
}

contextBridge.exposeInMainWorld('api', api)

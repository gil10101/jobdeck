import { contextBridge, ipcRenderer } from 'electron'
import type { IpcChannel, IpcInvokeContract, IpcPushChannel, IpcPushContract } from '@shared/ipc'
import type { IpcResult } from '@shared/types'

export interface MissionApi {
  invoke<C extends IpcChannel>(
    channel: C,
    req: IpcInvokeContract[C]['req']
  ): Promise<IpcResult<IpcInvokeContract[C]['res']>>
  on<C extends IpcPushChannel>(channel: C, cb: (payload: IpcPushContract[C]) => void): () => void
}

const api: MissionApi = {
  invoke: (channel, req) => ipcRenderer.invoke(channel, req),
  on: (channel, cb) => {
    const listener = (_event: unknown, payload: never): void => cb(payload)
    ipcRenderer.on(channel, listener as never)
    return () => ipcRenderer.removeListener(channel, listener as never)
  }
}

contextBridge.exposeInMainWorld('api', api)

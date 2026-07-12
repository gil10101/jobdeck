import type { IpcChannel, IpcInvokeContract } from '@shared/ipc'

/** Invoke an IPC channel and unwrap the {ok,data|error} envelope (throws on error). */
export async function call<C extends IpcChannel>(
  channel: C,
  req: IpcInvokeContract[C]['req']
): Promise<IpcInvokeContract[C]['res']> {
  const result = await window.api.invoke(channel, req)
  if (!result.ok) throw new Error(result.error)
  return result.data
}

export const onPush = window.api.on.bind(window.api)

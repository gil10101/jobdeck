import { useState } from 'react'
import { call } from '../api'
import { useApp } from '../store'

/**
 * M1 minimal first-run: pick/create a workspace, or import a v1 repo by copy.
 * Replaced by the full onboarding wizard in V2-M4.
 */
export default function FirstRunView(): JSX.Element {
  const toast = useApp((s) => s.toast)
  const [busy, setBusy] = useState(false)

  const finish = async (): Promise<void> => {
    await useApp.getState().refreshConfig()
    await useApp.getState().hydrate()
  }

  const createNew = async (): Promise<void> => {
    setBusy(true)
    try {
      const { path } = await call('workspace:choose', {
        title: 'Choose (or create) an empty folder for your JobDeck workspace'
      })
      if (!path) return
      await call('workspace:create', { dir: path })
      toast('Workspace created', 'success')
      await finish()
    } catch (err) {
      toast(String(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const importV1 = async (): Promise<void> => {
    setBusy(true)
    try {
      const { path: repoRoot } = await call('workspace:choose', {
        title: 'Select your v1 folder (the one containing CLAUDE.md and documents/applications)'
      })
      if (!repoRoot) return
      const { path: dir } = await call('workspace:choose', {
        title: 'Choose (or create) a NEW folder for the v2 workspace — data is COPIED into it'
      })
      if (!dir) return
      const summary = await call('workspace:importV1', { repoRoot, dir })
      toast(
        `Imported: ${summary.applicationsCopied} application folders, ${summary.trackerRows} tracker rows`,
        'success'
      )
      for (const w of summary.warnings.slice(0, 3)) toast(w)
      await finish()
    } catch (err) {
      toast(String(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center">
      <div className="panel w-[460px] p-8">
        <div className="text-center">
          <div className="text-lg font-bold tracking-wide text-cyan-300">JOBDECK</div>
          <div className="mt-1 text-xs text-muted">agent-powered job application pipeline</div>
        </div>
        <p className="mt-6 text-xs leading-relaxed text-gray-400">
          JobDeck keeps everything — tracker, tailored documents, agent runs — inside one
          workspace folder you choose. Pick where yours should live.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <button className="btn btn-primary justify-center py-2.5" disabled={busy} onClick={createNew}>
            Create a new workspace…
          </button>
          <button className="btn justify-center py-2.5" disabled={busy} onClick={importV1}>
            Import from a v1 workspace (copies your data)…
          </button>
        </div>
        <p className="mt-4 text-[10px] leading-relaxed text-gray-600">
          The full setup wizard (profile from your résumé, master résumé generation) arrives in a
          later milestone — for now this only picks the folder.
        </p>
      </div>
    </div>
  )
}

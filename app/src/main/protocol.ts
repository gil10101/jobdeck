import { net, protocol } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { REPO_ROOT, workspaceReady } from './paths'

const SCHEME = 'local-file'

/** MUST run before app.whenReady(). */
export function registerLocalFileScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true
      }
    }
  ])
}

/** Call after app.whenReady(). Serves workspace files, jailed to safe roots. */
export function installLocalFileHandler(): void {
  // Jail computed per request — the workspace may not exist yet at install time
  // (first-run), and REPO_ROOT is a live binding that flips at initWorkspace().
  const jailRoots = (): string[] => [
    path.resolve(REPO_ROOT, 'applications'),
    path.resolve(REPO_ROOT, 'master'),
    path.resolve(REPO_ROOT, 'templates'),
    path.resolve(REPO_ROOT, 'intake-images')
  ]

  protocol.handle(SCHEME, async (req) => {
    try {
      if (!workspaceReady()) return new Response('workspace not ready', { status: 403 })
      const url = new URL(req.url)
      // URL form: local-file://app/<url-encoded workspace-relative path>
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      const abs = path.resolve(REPO_ROOT, rel)
      const inJail = jailRoots().some(
        (root) => abs === root || abs.startsWith(root + path.sep)
      )
      if (!inJail) {
        return new Response('forbidden', { status: 403 })
      }
      return await net.fetch(pathToFileURL(abs).toString())
    } catch (err) {
      return new Response(`error: ${String(err)}`, { status: 500 })
    }
  })
}

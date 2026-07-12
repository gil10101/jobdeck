import { net, protocol } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { REPO_ROOT } from './paths'

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

/** Call after app.whenReady(). Serves repo files, jailed to safe roots. */
export function installLocalFileHandler(): void {
  const jailRoots = [
    path.resolve(REPO_ROOT, 'documents', 'applications'),
    path.resolve(REPO_ROOT, 'cv'),
    path.resolve(REPO_ROOT, 'resume_examples'),
    path.resolve(REPO_ROOT, 'cover_letters'),
    path.resolve(REPO_ROOT, 'templates'),
    path.resolve(REPO_ROOT, 'myinfo'),
    path.resolve(REPO_ROOT, 'app-data', 'intake-images') // pasted posting screenshots
  ]

  protocol.handle(SCHEME, async (req) => {
    try {
      const url = new URL(req.url)
      // URL form: local-file://app/<url-encoded repo-relative path>
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      const abs = path.resolve(REPO_ROOT, rel)
      const inJail = jailRoots.some(
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

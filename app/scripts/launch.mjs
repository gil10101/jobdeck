// Runs electron-vite (dev or preview) and starts it again when the app asks to
// relaunch. electron-vite exits with electron's exit code when electron closes,
// so Electron's own app.relaunch() would come back to a dev server that is
// already gone. The app instead exits with RELAUNCH_EXIT_CODE (read from the
// environment variable set here) and this loop restarts the whole toolchain.
//   node scripts/launch.mjs dev --watch
//   node scripts/launch.mjs preview
import { spawn } from 'node:child_process'
import path from 'node:path'

const RELAUNCH_EXIT_CODE = 75
const bin = path.join(
  import.meta.dirname,
  '..',
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron-vite.cmd' : 'electron-vite'
)
const args = process.argv.slice(2)

let child = null

function run() {
  child = spawn(bin, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, OHMO_RELAUNCH_EXIT_CODE: String(RELAUNCH_EXIT_CODE) }
  })
  child.on('exit', (code, signal) => {
    if (code === RELAUNCH_EXIT_CODE) {
      console.log('[launch] restarting to open the selected workspace…')
      run()
      return
    }
    process.exit(signal ? 1 : (code ?? 0))
  })
}

// Ctrl-C reaches electron-vite directly (same process group), so the wrapper
// only has to outlive it. A signal aimed at the wrapper alone is forwarded.
process.on('SIGINT', () => {})
process.on('SIGTERM', () => child?.kill('SIGTERM'))
run()

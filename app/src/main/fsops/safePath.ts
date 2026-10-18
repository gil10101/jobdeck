// Containment for file names that come back from the renderer. Pure (no
// electron import) so the selftests load it under node type stripping.
import path from 'node:path'

/**
 * Absolute path of `name` directly inside `dir`. Renderer-supplied names are
 * plain basenames from a listing the main process produced; anything with a
 * separator, a parent hop, a drive, or a leading dot is refused rather than
 * resolved.
 */
export function safeChildPath(dir: string, name: string): string {
  if (
    !name ||
    name !== path.basename(name) ||
    name.includes('/') ||
    name.includes('\\') ||
    name.startsWith('.') ||
    /^[a-zA-Z]:/.test(name)
  ) {
    throw new Error(`invalid file name: ${name}`)
  }
  return path.join(dir, name)
}

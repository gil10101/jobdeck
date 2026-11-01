// Pure profile-module envelope codec — no electron imports, so plain node
// (scripts/portable-selftest.ts) can exercise it. Relative .ts imports for the
// same reason: node type stripping resolves neither @shared nor extensionless.
import type { ProfileModuleEnvelope, ProfileModuleName } from '../../shared/profile.ts'
import {
  PROFILE_MODULES,
  PROFILE_MODULE_SCHEMA_ID,
  PROFILE_SCHEMA_VERSION
} from '../../shared/profile.ts'
import { validateModule } from './profileSchema.ts'

export function buildEnvelope(
  module: ProfileModuleName,
  schemaVersion: number,
  data: unknown
): ProfileModuleEnvelope {
  return {
    schema: PROFILE_MODULE_SCHEMA_ID,
    module,
    schemaVersion,
    exportedAt: new Date().toISOString(),
    data
  }
}

/** Parse + shape-check a module file; throws descriptive errors, never returns junk. */
export function parseEnvelope(json: string): ProfileModuleEnvelope {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch (err) {
    throw new Error(`not valid JSON: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('profile module file must be a JSON object')
  }
  const o = raw as Record<string, unknown>
  if (o.schema !== PROFILE_MODULE_SCHEMA_ID) {
    throw new Error(
      `unsupported profile module schema: ${String(o.schema)} (expected ${PROFILE_MODULE_SCHEMA_ID})`
    )
  }
  if (typeof o.module !== 'string' || !(PROFILE_MODULES as readonly string[]).includes(o.module)) {
    throw new Error(
      `unknown profile module: ${String(o.module)} (known: ${PROFILE_MODULES.join(', ')})`
    )
  }
  if (typeof o.schemaVersion !== 'number') {
    throw new Error('profile module file has no numeric schemaVersion')
  }
  // A future (or nonsense) content version must not be read as if it were ours.
  if (!Number.isInteger(o.schemaVersion) || o.schemaVersion < 1) {
    throw new Error(`invalid profile module schemaVersion: ${o.schemaVersion}`)
  }
  if (o.schemaVersion > PROFILE_SCHEMA_VERSION) {
    throw new Error(
      `unsupported profile module schemaVersion: ${o.schemaVersion} (this build understands up to ${PROFILE_SCHEMA_VERSION})`
    )
  }
  if (!('data' in o)) throw new Error('profile module file has no data field')
  return {
    schema: PROFILE_MODULE_SCHEMA_ID,
    module: o.module as ProfileModuleName,
    schemaVersion: o.schemaVersion,
    exportedAt: typeof o.exportedAt === 'string' ? o.exportedAt : '',
    data: o.data
  }
}

/** Delegates to the profile schema's single validation path (heals + rejects).
 *  `source` marks the direction: 'file' ingests an outside module (element
 *  identity enforced), 'local' re-serializes data the profile already holds. */
export function validateModuleData(
  module: ProfileModuleName,
  data: unknown,
  source: 'file' | 'local' = 'file'
): { ok: true; data: unknown; healed: string[] } | { ok: false; problems: string[] } {
  return validateModule(module, data, source)
}

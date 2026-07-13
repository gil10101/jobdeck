import fs from 'node:fs'
import type { CompanyInfo } from '@shared/types'
import { COMPANIES_FILE } from '../paths'

interface CompaniesFile {
  schema: 'companies.v1'
  companies: Record<string, CompanyInfo>
}

let cache: Record<string, CompanyInfo> | null = null

/** `" Acme  Corp "` -> `"acme corp"` — the join key used everywhere a company name is stored. */
export function normalizeKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Read once, cache in memory; `{}` when the file is missing or invalid — never throws. */
export function loadCompanies(): Record<string, CompanyInfo> {
  if (cache) return cache
  try {
    if (!fs.existsSync(COMPANIES_FILE)) {
      cache = {}
      return cache
    }
    const raw = JSON.parse(fs.readFileSync(COMPANIES_FILE, 'utf-8')) as Partial<CompaniesFile>
    cache = raw && raw.schema === 'companies.v1' && raw.companies ? raw.companies : {}
  } catch (err) {
    console.error('[companies] load failed:', err)
    cache = {}
  }
  return cache
}

export function getCompany(name: string): CompanyInfo | undefined {
  return loadCompanies()[normalizeKey(name)]
}

/** Atomic write (tmp file + rename), mirroring profileStore.ts's saveProfile. */
export function upsertCompany(info: CompanyInfo): void {
  const companies = loadCompanies()
  companies[normalizeKey(info.name)] = info
  const file: CompaniesFile = { schema: 'companies.v1', companies }
  const tmp = COMPANIES_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2), 'utf-8')
  fs.renameSync(tmp, COMPANIES_FILE)
  cache = companies
}

/** The full cached map (loads from disk first if the cache is cold). */
export function allCompanies(): Record<string, CompanyInfo> {
  return loadCompanies()
}

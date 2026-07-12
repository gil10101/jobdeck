#!/usr/bin/env bun
// Self-contained CLI for Jobright.ai's personalized, AI-fit-scored job feed.
//
// Jobright is an authenticated product: it matches jobs to YOUR profile and
// returns a fit score per posting. This CLI logs in with your own account
// (email + password), caches the session cookie locally, and reads your
// personalized recommendation feed via the site's own swan-api backend.
//
// PERSONAL USE ONLY. This uses your own Jobright account against Jobright's
// private API. Keep volume low, do not share your session, and do not use it
// for bulk data collection. Run it on your own responsibility.
//
// Credentials are read from (in order):
//   1. env vars  JOBRIGHT_EMAIL / JOBRIGHT_PASSWORD
//   2. credentials.json at the skill root (gitignored):
//        { "email": "you@example.com", "password": "..." }
// The session cookie is cached in .session.json at the skill root (gitignored)
// and reused until it expires, at which point the CLI logs in again.

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const API = "https://swan-api.jobright.ai"
const SKILL_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const CREDS_PATH = join(SKILL_ROOT, "credentials.json")
const SESSION_PATH = join(SKILL_ROOT, ".session.json")

const BROWSER_HEADERS: Record<string, string> = {
  Origin: "https://jobright.ai",
  Referer: "https://jobright.ai/",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
}

function fail(error: string, code: string): never {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
  process.exit(1)
}

// ---------- credentials + session ----------

interface Creds {
  email: string
  password: string
}

function loadCreds(): Creds {
  const email = process.env.JOBRIGHT_EMAIL
  const password = process.env.JOBRIGHT_PASSWORD
  if (email && password) return { email, password }
  if (existsSync(CREDS_PATH)) {
    try {
      const c = JSON.parse(readFileSync(CREDS_PATH, "utf-8"))
      if (c.email && c.password) return { email: c.email, password: c.password }
    } catch (e) {
      fail(`credentials.json is not valid JSON: ${(e as Error).message}`, "BAD_CREDS_FILE")
    }
  }
  fail(
    `no Jobright credentials found. Set JOBRIGHT_EMAIL / JOBRIGHT_PASSWORD, or create ${CREDS_PATH} ` +
      `with {"email":"...","password":"..."}`,
    "NO_CREDS",
  )
}

function loadCachedSession(): string | null {
  if (!existsSync(SESSION_PATH)) return null
  try {
    const s = JSON.parse(readFileSync(SESSION_PATH, "utf-8"))
    return typeof s.sessionId === "string" ? s.sessionId : null
  } catch {
    return null
  }
}

function saveSession(sessionId: string): void {
  try {
    writeFileSync(SESSION_PATH, JSON.stringify({ sessionId, savedAt: new Date().toISOString() }, null, 2))
  } catch {
    /* non-fatal: we just log in again next time */
  }
}

function extractSessionId(setCookies: string[]): string | null {
  for (const c of setCookies) {
    const m = c.match(/(?:^|\s)SESSION_ID=([^;]+)/)
    if (m) return m[1]
  }
  return null
}

async function login(creds: Creds): Promise<string> {
  const res = await fetch(`${API}/swan/auth/login/pwd`, {
    method: "POST",
    headers: { ...BROWSER_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({ email: creds.email, password: creds.password }),
  })
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : []
  let body: any = null
  try {
    body = await res.json()
  } catch {
    /* ignore */
  }
  if (!res.ok || !body?.success) {
    const msg = body?.errorMsg || `HTTP ${res.status}`
    fail(`Jobright login failed: ${msg}`, "LOGIN_FAILED")
  }
  const sid = extractSessionId(setCookies)
  if (!sid) fail("Jobright login succeeded but no SESSION_ID cookie was returned", "NO_SESSION_COOKIE")
  saveSession(sid)
  return sid
}

// Perform an authenticated GET, transparently re-logging-in once if the
// cached session is stale.
async function authGet(path: string, sessionId: string, creds: Creds): Promise<{ json: any; sessionId: string }> {
  const doGet = (sid: string) =>
    fetch(`${API}${path}`, { method: "GET", headers: { ...BROWSER_HEADERS, Cookie: `SESSION_ID=${sid}` } })

  let res = await doGet(sessionId)
  let json: any = null
  try {
    json = await res.json()
  } catch {
    /* ignore */
  }
  const unauth = !res.ok || json?.success === false
  if (unauth) {
    // session likely expired — log in fresh and retry once
    const fresh = await login(creds)
    res = await doGet(fresh)
    try {
      json = await res.json()
    } catch {
      json = null
    }
    if (!res.ok || json?.success === false) {
      fail(`Jobright request failed after re-login: ${json?.errorMsg || `HTTP ${res.status}`}`, "REQUEST_FAILED")
    }
    return { json, sessionId: fresh }
  }
  return { json, sessionId }
}

// ---------- normalization ----------

interface JobRow {
  id: string
  title: string
  company: string
  companySize: string
  location: string
  workModel: string
  score: number
  match: string
  seniority: string
  employmentType: string
  salary: string
  date: string
  posted: string
  applicants: number
  h1bSponsor: boolean
  citizenOnly: boolean
  workAuthRequired: boolean
  clearanceRequired: boolean
  summary: string
  skills: string[]
  applyLink: string
  jobrightUrl: string
}

function normalize(item: any): JobRow {
  const j = item.jobResult ?? {}
  const co = item.companyResult ?? {}
  const date = typeof j.publishTime === "string" ? j.publishTime.split(" ")[0] : ""
  return {
    id: j.jobId ?? "",
    title: j.jobTitle ?? j.jobNlpTitle ?? "",
    company: co.companyName ?? "",
    companySize: (co.companySize ?? "").replace(/\s*employees\s*$/i, "").trim(),
    location: j.jobLocation ?? (Array.isArray(j.jobLocations) ? j.jobLocations.join("; ") : ""),
    workModel: j.workModel ?? (j.isRemote ? "Remote" : ""),
    score: typeof item.displayScore === "number" ? Math.round(item.displayScore * 10) / 10 : 0,
    match: item.rankDesc ?? "",
    seniority: j.jobSeniority ?? "",
    employmentType: j.employmentType ?? "",
    salary: j.salaryDesc ?? "",
    date,
    posted: j.publishTimeDesc ?? "",
    applicants: typeof j.applicantsCount === "number" ? j.applicantsCount : 0,
    h1bSponsor: !!j.isH1bSponsor,
    citizenOnly: !!j.isCitizenOnly,
    workAuthRequired: !!j.isWorkAuthRequired,
    clearanceRequired: !!j.isClearanceRequired,
    summary: j.jobSummary ?? "",
    skills: Array.isArray(j.jdCoreSkills)
      ? j.jdCoreSkills.map((s: any) => (typeof s === "string" ? s : (s?.skill ?? ""))).filter(Boolean)
      : [],
    applyLink: j.applyLink || j.originalUrl || (j.jobId ? `https://jobright.ai/jobs/info/${j.jobId}` : ""),
    jobrightUrl: j.jobId ? `https://jobright.ai/jobs/info/${j.jobId}` : "",
  }
}

// ---------- fetch feed ----------

interface FeedOpts {
  limit: number
  refresh: boolean
  sort: number
}

async function fetchFeed(opts: FeedOpts): Promise<JobRow[]> {
  const creds = loadCreds()
  let sessionId = loadCachedSession() ?? (await login(creds))

  const rows: JobRow[] = []
  const seen = new Set<string>()
  const batch = 15
  let position = 0
  // Page through the recommendation feed until we have `limit` unique jobs or
  // the feed stops returning new ones.
  for (let guard = 0; guard < 40 && rows.length < opts.limit; guard++) {
    const params = new URLSearchParams({
      refresh: String(opts.refresh && position === 0),
      sortCondition: String(opts.sort),
      position: String(position),
      count: String(batch),
      syncRerank: "false",
    })
    const { json, sessionId: sid } = await authGet(`/swan/recommend/list/jobs?${params}`, sessionId, creds)
    sessionId = sid
    const list: any[] = json?.result?.jobList ?? []
    if (list.length === 0) break
    let added = 0
    for (const item of list) {
      const row = normalize(item)
      if (!row.id || seen.has(row.id)) continue
      seen.add(row.id)
      rows.push(row)
      added++
    }
    position += list.length
    if (added === 0) break
  }
  return rows.slice(0, opts.limit)
}

// ---------- filters ----------

interface Filters {
  query?: string
  location?: string
  remote?: string
  minScore?: number
  maxAgeDays?: number
  minSize?: number
}

// Parse the upper bound of a company-size string ("11-50", "1001-5000", "10001+").
// Returns null when size is unknown so callers can decide whether to keep it.
function companySizeUpperBound(size: string): number | null {
  if (!size) return null
  if (size.includes("+")) return Infinity
  const nums = (size.match(/\d[\d,]*/g) ?? []).map((n) => parseInt(n.replace(/,/g, ""), 10))
  if (nums.length === 0) return null
  return Math.max(...nums)
}

function applyFilters(rows: JobRow[], f: Filters): JobRow[] {
  let out = rows
  if (f.query) {
    const terms = f.query.toLowerCase().split(/\s+/).filter(Boolean)
    out = out.filter((r) => {
      const hay = `${r.title} ${r.summary} ${r.skills.join(" ")} ${r.seniority}`.toLowerCase()
      return terms.every((t) => hay.includes(t))
    })
  }
  if (f.location) {
    const loc = f.location.toLowerCase()
    out = out.filter((r) => r.location.toLowerCase().includes(loc) || (loc.includes("remote") && /remote/i.test(r.workModel)))
  }
  if (f.remote) {
    const want = f.remote.toLowerCase()
    out = out.filter((r) => r.workModel.toLowerCase().includes(want))
  }
  if (typeof f.minScore === "number") out = out.filter((r) => r.score >= f.minScore!)
  if (typeof f.minSize === "number") {
    // Drop companies whose size range tops out below the threshold (e.g. --min-size 51
    // drops "1-50" and "11-50"). Unknown sizes are kept, but flagged in output as "?".
    out = out.filter((r) => {
      const upper = companySizeUpperBound(r.companySize)
      return upper === null || upper >= f.minSize!
    })
  }
  if (typeof f.maxAgeDays === "number") {
    const cutoff = Date.now() - f.maxAgeDays * 86400_000
    out = out.filter((r) => {
      if (!r.date) return true
      const t = Date.parse(r.date)
      return isNaN(t) ? true : t >= cutoff
    })
  }
  return out
}

// ---------- output ----------

function pad(s: string, n: number): string {
  s = s ?? ""
  return s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n)
}

function printTable(rows: JobRow[]): void {
  const head = `${pad("SCORE", 6)} ${pad("MATCH", 14)} ${pad("TITLE", 32)} ${pad("COMPANY", 22)} ${pad("SIZE", 11)} ${pad("LOCATION", 20)} ${pad("POSTED", 12)} ID`
  process.stdout.write(head + "\n")
  process.stdout.write("-".repeat(head.length) + "\n")
  for (const r of rows) {
    process.stdout.write(
      `${pad(String(r.score), 6)} ${pad(r.match, 14)} ${pad(r.title, 32)} ${pad(r.company, 22)} ${pad(r.companySize || "?", 11)} ${pad(r.location, 20)} ${pad(r.posted, 12)} ${r.id}\n`,
    )
  }
}

function printPlain(rows: JobRow[]): void {
  for (const r of rows) {
    const flags: string[] = []
    if (r.h1bSponsor) flags.push("H1B sponsor")
    if (r.citizenOnly) flags.push("US citizen only")
    if (r.workAuthRequired) flags.push("work auth required")
    if (r.clearanceRequired) flags.push("clearance required")
    process.stdout.write(
      `# ${r.title} — ${r.company}${r.companySize ? ` (${r.companySize} employees)` : ""}\n` +
        `  Fit: ${r.score} (${r.match})   ${r.seniority} · ${r.employmentType} · ${r.workModel}\n` +
        `  Location: ${r.location}\n` +
        (r.salary ? `  Salary: ${r.salary}\n` : "") +
        `  Posted: ${r.posted} (${r.date})   Applicants: ${r.applicants}\n` +
        (flags.length ? `  Flags: ${flags.join(", ")}\n` : "") +
        (r.skills.length ? `  Core skills: ${r.skills.join(", ")}\n` : "") +
        (r.summary ? `  Summary: ${r.summary}\n` : "") +
        `  Jobright: ${r.jobrightUrl}\n` +
        `  Apply: ${r.applyLink}\n\n`,
    )
  }
}

function output(rows: JobRow[], format: string, meta: Record<string, unknown>): void {
  if (format === "table") return printTable(rows)
  if (format === "plain") return printPlain(rows)
  process.stdout.write(JSON.stringify({ results: rows, meta }, null, 2) + "\n")
}

// ---------- arg parsing ----------

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", l: "location", n: "limit" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("-")) {
      const key = alias[a.replace(/^-+/, "")] ?? a.replace(/^-+/, "")
      const next = argv[i + 1]
      if (next === undefined || next.startsWith("-")) flags[key] = true
      else {
        flags[key] = next
        i++
      }
    } else {
      ;(flags._ as string[]).push(a)
    }
  }
  return flags
}

function numFlag(flags: Flags, name: string): number | undefined {
  if (flags[name] === undefined) return undefined
  const v = parseInt(flags[name] as string, 10)
  if (isNaN(v)) fail(`--${name} must be a number, got "${flags[name]}"`, "BAD_ARG")
  return v
}

const HELP = `jobright-cli — your personalized, AI-fit-scored Jobright.ai job feed (personal use only)

USAGE
  bun run src/cli.ts recommend [flags]     # your personalized matched feed (primary)
  bun run src/cli.ts search -q "<terms>"   # recommend + client-side keyword filter

Every result already includes full detail (summary, core skills, salary, work-auth
flags, apply link) — use --format plain to read it. There is no separate detail call.

FLAGS (recommend / search)
  --query, -q <text>   Keep only jobs whose title/summary/skills contain ALL terms.
  --location, -l <t>   Keep only jobs whose location contains <t> (e.g. "New York", "Remote").
  --remote <mode>      remote | hybrid | onsite (matches Jobright's workModel).
  --min-score <n>      Keep only jobs with fit score >= n (0-100).
  --min-size <n>       Drop companies whose size range tops out below n employees
                       (e.g. --min-size 51 drops 1-50 and 11-50; unknown sizes kept, shown as "?").
  --maxage <days>      Keep only jobs posted within N days.
  --limit, -n <n>      Max jobs to return. Default 30.
  --refresh            Ask Jobright to re-rank the feed (slower, freshest).
  --sort <n>           sortCondition passed to Jobright (default 0).
  --format <fmt>       json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts recommend --limit 30 --format table
  bun run src/cli.ts search -q "data analyst" -l "New York" --maxage 14 --format table
  bun run src/cli.ts recommend --min-score 80 --format plain

Credentials: env JOBRIGHT_EMAIL / JOBRIGHT_PASSWORD, or credentials.json at the skill root.
Note: Jobright's feed is already personalized to your profile; "search" filters that feed
locally by keyword — it does not run a separate global search.
`

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2))
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  const format = (["json", "table", "plain"].includes(flags.format as string) ? flags.format : "json") as string

  if (cmd === "recommend" || cmd === "search") {
    const query =
      cmd === "search"
        ? (flags._ as string[])[1] ?? (typeof flags.query === "string" ? flags.query : undefined)
        : typeof flags.query === "string"
          ? flags.query
          : undefined
    if (cmd === "search" && !query) fail('search requires -q "<terms>" (or a positional term)', "NO_QUERY")

    const limit = numFlag(flags, "limit") ?? 30
    const filters: Filters = {
      query,
      location: typeof flags.location === "string" ? flags.location : undefined,
      remote: typeof flags.remote === "string" ? flags.remote : undefined,
      minScore: numFlag(flags, "min-score"),
      maxAgeDays: numFlag(flags, "maxage"),
      minSize: numFlag(flags, "min-size"),
    }

    // Over-fetch when client-side filters are active so filtering still yields ~limit rows.
    const hasFilter = !!(
      filters.query ||
      filters.location ||
      filters.remote ||
      filters.minScore ||
      filters.maxAgeDays ||
      filters.minSize
    )
    const feed = await fetchFeed({
      limit: hasFilter ? Math.min(limit * 4, 120) : limit,
      refresh: !!flags.refresh,
      sort: numFlag(flags, "sort") ?? 0,
    })
    const filtered = applyFilters(feed, filters).slice(0, limit)
    output(filtered, format, {
      source: "jobright",
      command: cmd,
      fetched: feed.length,
      returned: filtered.length,
      filters: hasFilter ? filters : undefined,
      note: "Jobright feed is personalized to your profile; scores are Jobright's AI fit ratings.",
    })
    return 0
  }

  fail(`Unknown command "${cmd}"`, "BAD_CMD")
}

main().then((code) => process.exit(code))

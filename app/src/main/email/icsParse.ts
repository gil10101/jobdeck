// iCalendar (RFC 5545) VEVENT extraction for text/calendar mail parts.
// Pure module: type-only imports, zero runtime imports — the email selftest
// executes it under plain `node` type stripping.
import type { EmailInvite } from '@shared/types'

interface IcsProp {
  name: string
  params: Record<string, string>
  value: string
}

/** Split one content line at the first ':' outside double quotes; the left
 *  side is NAME;PARAM=VAL;... — parameter values may be quoted and may
 *  contain ':' and ';'. */
function parseLine(line: string): IcsProp | null {
  let inQuote = false
  let colon = -1
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') inQuote = !inQuote
    else if (c === ':' && !inQuote) {
      colon = i
      break
    }
  }
  if (colon < 0) return null
  const left = line.slice(0, colon)
  const value = line.slice(colon + 1)
  const segs: string[] = []
  let seg = ''
  inQuote = false
  for (const c of left) {
    if (c === '"') inQuote = !inQuote
    if (c === ';' && !inQuote) {
      segs.push(seg)
      seg = ''
    } else {
      seg += c
    }
  }
  segs.push(seg)
  const name = segs[0].trim().toUpperCase()
  if (!name) return null
  const params: Record<string, string> = {}
  for (const s of segs.slice(1)) {
    const eq = s.indexOf('=')
    if (eq < 0) continue
    const key = s.slice(0, eq).trim().toUpperCase()
    let val = s.slice(eq + 1).trim()
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1)
    params[key] = val
  }
  return { name, params, value }
}

/** TEXT value unescaping: \n → newline, \, \; \\ → literal character. */
function unescapeText(v: string): string {
  return v.replace(/\\(.)/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c))
}

/** Windows TZIDs (Outlook/Exchange invites) → IANA, a CLDR windowsZones
 *  subset covering common US/EU/global business zones. Intl throws on Windows
 *  names, and the catch below would silently reinterpret the wall time in the
 *  machine's zone — hours of error with no warning. */
const WINDOWS_ZONES: Record<string, string> = {
  'Eastern Standard Time': 'America/New_York',
  'US Eastern Standard Time': 'America/Indianapolis',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'US Mountain Standard Time': 'America/Phoenix',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Alaskan Standard Time': 'America/Anchorage',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Atlantic Standard Time': 'America/Halifax',
  'Newfoundland Standard Time': 'America/St_Johns',
  'Canada Central Standard Time': 'America/Regina',
  'Central America Standard Time': 'America/Guatemala',
  'SA Pacific Standard Time': 'America/Bogota',
  'Pacific SA Standard Time': 'America/Santiago',
  'E. South America Standard Time': 'America/Sao_Paulo',
  'Argentina Standard Time': 'America/Buenos_Aires',
  UTC: 'UTC',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'Romance Standard Time': 'Europe/Paris',
  'GTB Standard Time': 'Europe/Bucharest',
  'FLE Standard Time': 'Europe/Kiev',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Russian Standard Time': 'Europe/Moscow',
  'South Africa Standard Time': 'Africa/Johannesburg',
  'Egypt Standard Time': 'Africa/Cairo',
  'Israel Standard Time': 'Asia/Jerusalem',
  'Arab Standard Time': 'Asia/Riyadh',
  'Arabian Standard Time': 'Asia/Dubai',
  'Pakistan Standard Time': 'Asia/Karachi',
  'India Standard Time': 'Asia/Kolkata',
  'Bangladesh Standard Time': 'Asia/Dhaka',
  'SE Asia Standard Time': 'Asia/Bangkok',
  'Singapore Standard Time': 'Asia/Singapore',
  'China Standard Time': 'Asia/Shanghai',
  'Taipei Standard Time': 'Asia/Taipei',
  'Korea Standard Time': 'Asia/Seoul',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'W. Australia Standard Time': 'Australia/Perth',
  'Cen. Australia Standard Time': 'Australia/Adelaide',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'New Zealand Standard Time': 'Pacific/Auckland'
}

/** ±HHMM / ±HHMMSS (RFC 5545 UTC-OFFSET) → milliseconds east of UTC. */
function parseUtcOffset(v: string): number | null {
  const m = /^([+-])(\d{2})(\d{2})(\d{2})?$/.exec(v.trim())
  if (!m) return null
  const sign = m[1] === '-' ? -1 : 1
  return sign * ((Number(m[2]) * 60 + Number(m[3])) * 60 + Number(m[4] ?? '0')) * 1000
}

// One warning per unknown TZID per process — sync re-parses invites every pass.
const warnedTzids = new Set<string>()

/** Convert a wall-clock time in an IANA zone to a UTC ISO string. The zone's
 *  offset for that wall time is found by round-tripping the guess through
 *  Intl.DateTimeFormat — no timezone library. Windows TZIDs map through
 *  WINDOWS_ZONES first; an unknown/invalid zone falls back to the invite's own
 *  VTIMEZONE standard offset when the caller has one, else the machine's local
 *  clock — either fallback logs a warning, never silently. */
export function zonedTimeToIso(
  tzid: string,
  y: number,
  mo: number,
  d: number,
  hh: number,
  mi: number,
  ss: number,
  vtimezoneOffset?: string | null
): string {
  const zone = WINDOWS_ZONES[tzid.trim()] ?? tzid
  let dtf: Intl.DateTimeFormat
  try {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    })
  } catch {
    const offset = vtimezoneOffset ? parseUtcOffset(vtimezoneOffset) : null
    if (!warnedTzids.has(tzid)) {
      warnedTzids.add(tzid)
      console.warn(
        offset !== null
          ? `[email] unknown TZID "${tzid}" — using its VTIMEZONE offset ${vtimezoneOffset}`
          : `[email] unknown TZID "${tzid}" — falling back to the machine's local clock`
      )
    }
    if (offset !== null) return new Date(Date.UTC(y, mo - 1, d, hh, mi, ss) - offset).toISOString()
    return new Date(y, mo - 1, d, hh, mi, ss).toISOString()
  }
  const target = Date.UTC(y, mo - 1, d, hh, mi, ss)
  const wallAt = (t: number): number => {
    const p: Record<string, number> = {}
    for (const part of dtf.formatToParts(new Date(t))) {
      if (part.type !== 'literal') p[part.type] = Number(part.value)
    }
    // Some engines render midnight as hour 24 even with hour12: false.
    const hour = p.hour === 24 ? 0 : p.hour
    return Date.UTC(p.year, p.month - 1, p.day, hour, p.minute, p.second)
  }
  // Two passes pin the offset across DST transitions.
  let t = target - (wallAt(target) - target)
  const drift = wallAt(t) - target
  if (drift !== 0) t -= drift
  return new Date(t).toISOString()
}

/** DATE / DATE-TIME value → UTC ISO string. Handles ...Z (UTC), TZID= (IANA or
 *  Windows zone, with the payload's VTIMEZONE offsets as last resort), floating
 *  (local clock), and VALUE=DATE all-day (local midnight). */
function parseIcsDate(
  value: string,
  params: Record<string, string>,
  tzOffsets?: Record<string, string>
): string | null {
  const v = value.trim()
  if (params.VALUE === 'DATE' || /^\d{8}$/.test(v)) {
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(v)
    if (!m) return null
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toISOString()
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const hh = Number(m[4])
  const mi = Number(m[5])
  const ss = Number(m[6] ?? '0')
  if (m[7]) return new Date(Date.UTC(y, mo - 1, d, hh, mi, ss)).toISOString()
  if (params.TZID) {
    return zonedTimeToIso(params.TZID, y, mo, d, hh, mi, ss, tzOffsets?.[params.TZID.trim()] ?? null)
  }
  return new Date(y, mo - 1, d, hh, mi, ss).toISOString()
}

const MEET_LINK_RE =
  /https:\/\/(?:meet\.google\.com|[a-z0-9.-]*zoom\.us\/j|teams\.microsoft\.com\/l)\/[^\s"'<>]+/i

/** Parse an ICS payload into invite metadata. Only the first VEVENT counts;
 *  nested components inside it (VALARM) are skipped — their SUMMARY and
 *  DESCRIPTION describe the reminder, not the event. VTIMEZONE components are
 *  mined for per-TZID standard offsets, the fallback when a TZID resolves to
 *  no known zone. Returns null when no VEVENT exists. */
export function parseIcs(raw: string): { invite: EmailInvite; uid: string | null } | null {
  // Unfold RFC 5545 continuation lines (CRLF or LF followed by space/tab).
  const lines = raw.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)
  let topMethod: string | null = null
  const vevent: IcsProp[] = []
  let sawVevent = false
  let inVevent = false
  let veventDone = false
  let subDepth = 0
  const tzOffsets: Record<string, string> = {}
  let inTz = false
  let inStandard = false
  let tzName: string | null = null
  let tzStandard: string | null = null
  let tzAny: string | null = null
  for (const line of lines) {
    const prop = parseLine(line)
    if (!prop) continue
    if (!inVevent) {
      const comp =
        prop.name === 'BEGIN' || prop.name === 'END' ? prop.value.trim().toUpperCase() : ''
      if (prop.name === 'BEGIN' && comp === 'VEVENT' && !veventDone) {
        sawVevent = true
        inVevent = true
        inTz = false
        continue
      }
      if (prop.name === 'BEGIN' && comp === 'VTIMEZONE') {
        inTz = true
        inStandard = false
        tzName = null
        tzStandard = null
        tzAny = null
        continue
      }
      if (inTz) {
        // The STANDARD offset is preferred: without expanding transition rules
        // it is the least-wrong single offset for the whole year.
        if (prop.name === 'BEGIN' && comp === 'STANDARD') inStandard = true
        else if (prop.name === 'END' && comp === 'STANDARD') inStandard = false
        else if (prop.name === 'END' && comp === 'VTIMEZONE') {
          const off = tzStandard ?? tzAny
          if (tzName && off) tzOffsets[tzName] = off
          inTz = false
        } else if (prop.name === 'TZID' && !tzName) {
          tzName = prop.value.trim()
        } else if (prop.name === 'TZOFFSETTO') {
          const v = prop.value.trim()
          tzAny ??= v
          if (inStandard) tzStandard ??= v
        }
        continue
      }
      // METHOD lives at the VCALENDAR level, outside any VEVENT.
      if (prop.name === 'METHOD' && topMethod === null) topMethod = prop.value.trim().toUpperCase()
      continue
    }
    if (prop.name === 'BEGIN') {
      subDepth++
      continue
    }
    if (prop.name === 'END') {
      if (subDepth > 0) {
        subDepth--
      } else {
        inVevent = false
        veventDone = true
      }
      continue
    }
    if (subDepth === 0) vevent.push(prop)
  }
  if (!sawVevent) return null

  const get = (name: string): IcsProp | null => vevent.find((p) => p.name === name) ?? null
  const summary = get('SUMMARY')
  const location = get('LOCATION')
  const description = get('DESCRIPTION')
  const organizer = get('ORGANIZER')
  const uidProp = get('UID')
  const status = get('STATUS')
  const dtStart = get('DTSTART')
  const dtEnd = get('DTEND')
  const conference = get('X-GOOGLE-CONFERENCE')

  const locationText = location ? unescapeText(location.value).trim() : null
  const descriptionText = description ? unescapeText(description.value) : null
  let organizerText: string | null = null
  if (organizer) {
    const cn = organizer.params.CN?.trim()
    organizerText = cn ? cn : organizer.value.trim().replace(/^mailto:/i, '') || null
  }
  const meetLink =
    [locationText, descriptionText, conference?.value ?? null]
      .map((s) => (s ? (MEET_LINK_RE.exec(s)?.[0] ?? null) : null))
      .find((s) => s !== null) ?? null
  // A cancellation arrives as METHOD:CANCEL, or (when forwarded without the
  // calendar envelope) as STATUS:CANCELLED on the event itself.
  const method =
    topMethod ?? (status && status.value.trim().toUpperCase() === 'CANCELLED' ? 'CANCEL' : null)
  const invite: EmailInvite = {
    title: summary ? unescapeText(summary.value).trim() || null : null,
    start: dtStart ? parseIcsDate(dtStart.value, dtStart.params, tzOffsets) : null,
    end: dtEnd ? parseIcsDate(dtEnd.value, dtEnd.params, tzOffsets) : null,
    location: locationText || null,
    meetLink,
    organizer: organizerText,
    method
  }
  return { invite, uid: uidProp ? uidProp.value.trim() || null : null }
}

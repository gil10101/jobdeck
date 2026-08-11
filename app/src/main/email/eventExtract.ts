// Conservative natural-language date/time extraction for interview mail with
// no ICS part. A candidate event requires a date and a time within 300
// characters of each other; anything ambiguous returns null — a missed event
// is recoverable from the mail view, a wrong calendar entry is not.
// Pure module: zero runtime imports — the email selftest executes it under
// plain `node` type stripping (which is also why zonedTimeToIso is duplicated
// from icsParse instead of imported).

const PAIR_WINDOW = 300

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12
}

/** Timezone abbreviations → IANA zones. ET/EST/EDT all map to the zone; the
 *  offset actually applied is the zone's real offset for that date.
 *  Deliberately absent: abbreviations that mean different zones in different
 *  countries (IST = India/Ireland/Israel, AST = Atlantic/Arabia, SAST vs SST).
 *  An abbreviation that is not in here is treated as UNKNOWN, not as "no zone"
 *  — see zoneAfter: reinterpreting a stated wall time in the machine's zone
 *  books the event hours off, which this module's contract forbids. */
const ZONES: Record<string, string> = {
  ET: 'America/New_York',
  EST: 'America/New_York',
  EDT: 'America/New_York',
  CT: 'America/Chicago',
  CST: 'America/Chicago',
  CDT: 'America/Chicago',
  MT: 'America/Denver',
  MST: 'America/Denver',
  MDT: 'America/Denver',
  PT: 'America/Los_Angeles',
  PST: 'America/Los_Angeles',
  PDT: 'America/Los_Angeles',
  AKST: 'America/Anchorage',
  AKDT: 'America/Anchorage',
  HST: 'Pacific/Honolulu',
  // Europe
  BST: 'Europe/London',
  CET: 'Europe/Paris',
  CEST: 'Europe/Paris',
  EET: 'Europe/Athens',
  EEST: 'Europe/Athens',
  WET: 'Europe/Lisbon',
  WEST: 'Europe/Lisbon',
  // Asia-Pacific
  JST: 'Asia/Tokyo',
  KST: 'Asia/Seoul',
  SGT: 'Asia/Singapore',
  HKT: 'Asia/Hong_Kong',
  AEST: 'Australia/Sydney',
  AEDT: 'Australia/Sydney',
  ACST: 'Australia/Adelaide',
  ACDT: 'Australia/Adelaide',
  AWST: 'Australia/Perth',
  NZST: 'Pacific/Auckland',
  NZDT: 'Pacific/Auckland'
}

interface DateHit {
  index: number
  end: number
  month: number
  day: number
  year: number | null
}

interface TimeHit {
  index: number
  end: number
  hh: number
  mi: number
  endHh: number | null
  endMi: number | null
  zone: string | null
  /** Fixed GMT/UTC offset in minutes ("(GMT -04:00)" → -240); null = none. */
  offsetMin: number | null
}

/** Same algorithm as icsParse.zonedTimeToIso: wall time in an IANA zone →
 *  UTC ISO, offset found by round-tripping through Intl.DateTimeFormat. */
function zonedTimeToIso(
  tzid: string,
  y: number,
  mo: number,
  d: number,
  hh: number,
  mi: number,
  ss: number
): string {
  let dtf: Intl.DateTimeFormat
  try {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tzid,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    })
  } catch {
    return new Date(y, mo - 1, d, hh, mi, ss).toISOString()
  }
  const target = Date.UTC(y, mo - 1, d, hh, mi, ss)
  const wallAt = (t: number): number => {
    const p: Record<string, number> = {}
    for (const part of dtf.formatToParts(new Date(t))) {
      if (part.type !== 'literal') p[part.type] = Number(part.value)
    }
    const hour = p.hour === 24 ? 0 : p.hour
    return Date.UTC(p.year, p.month - 1, p.day, hour, p.minute, p.second)
  }
  let t = target - (wallAt(target) - target)
  const drift = wallAt(t) - target
  if (drift !== 0) t -= drift
  return new Date(t).toISOString()
}

function to24(h: number, meridiem: string): number {
  const mer = meridiem.toLowerCase()
  if (mer === 'am') return h === 12 ? 0 : h
  return h === 12 ? 12 : h + 12
}

/** Month-name dates (weekday and year optional) plus M/D and M/D/YYYY. */
function findDates(text: string): DateHit[] {
  const hits: DateHit[] = []
  const monthRe =
    /(?:\b(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?,?\s+)?\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/gi
  for (let m = monthRe.exec(text); m; m = monthRe.exec(text)) {
    const month = MONTHS[m[1].slice(0, 3).toLowerCase()]
    const day = Number(m[2])
    if (!month || day < 1 || day > 31) continue
    hits.push({
      index: m.index,
      end: m.index + m[0].length,
      month,
      day,
      year: m[3] ? Number(m[3]) : null
    })
  }
  const numRe = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?\b/g
  for (let m = numRe.exec(text); m; m = numRe.exec(text)) {
    const month = Number(m[1])
    const day = Number(m[2])
    if (month < 1 || month > 12 || day < 1 || day > 31) continue
    // Both fields could be the month: "10/08" is 10 August to a UK/EU sender
    // and 8 October to a US one, and nothing in a mail body says which. The
    // app has no locale input on this path, so a guess would silently book the
    // wrong month — skip it (15/08 and 8/12 stay unambiguous and resolve).
    if (day <= 12) continue
    let year: number | null = m[3] ? Number(m[3]) : null
    if (year !== null && year < 100) year += 2000
    hits.push({ index: m.index, end: m.index + m[0].length, month, day, year })
  }
  return hits
}

/** Timezone token immediately after a time: GMT/UTC with an optional ±HH:MM
 *  offset ("(GMT -04:00)"), or an uppercase-only abbreviation ("PT" must
 *  never match the "pt" in ordinary words). The whole token is consumed so its
 *  offset digits are never re-scanned as a standalone time.
 *  `unknown: true` means an abbreviation WAS stated but this module cannot
 *  resolve it — the caller drops that time rather than silently reinterpreting
 *  the wall clock in the machine's own zone. */
function zoneAfter(
  text: string,
  end: number
): { zone: string | null; offsetMin: number | null; end: number; unknown?: true } | null {
  const g = /^[ \t]*\(?[ \t]*(?:GMT|UTC)(?![A-Za-z])(?:[ \t]?([+-])[ \t]?(\d{1,2})(?::?(\d{2}))?)?[ \t]*\)?/.exec(
    text.slice(end, end + 20)
  )
  if (g) {
    const offsetMin = g[1] ? (g[1] === '-' ? -1 : 1) * (Number(g[2]) * 60 + Number(g[3] ?? '0')) : 0
    return { zone: null, offsetMin, end: end + g[0].length }
  }
  // The trailing (?![A-Za-z]) keeps a longer ordinary word ("CONFIRMED") from
  // being clipped to a token-shaped prefix.
  const m = /^[ \t]*\(?([A-Z]{2,5})\)?(?![A-Za-z])/.exec(text.slice(end, end + 10))
  if (!m) return null
  const zone = ZONES[m[1]]
  if (zone) return { zone, offsetMin: null, end: end + m[0].length }
  // Nearly every English zone abbreviation ends in T ("…Time"); MSK is the one
  // common exception. Anything else after a time is an ordinary word, not a
  // zone we failed to recognize, so it keeps the old no-zone reading.
  if (!/T$/.test(m[1]) && m[1] !== 'MSK') return null
  console.warn(`[email] unrecognized timezone "${m[1]}" after a time — that time is not used`)
  return { zone: null, offsetMin: null, end: end + m[0].length, unknown: true }
}

/** Ranges first (4pm - 4:30pm, 4:00–4:30 PM, 16:00-17:00), then single times
 *  (10am, 10:00 AM, 16:00) outside the range spans. Bare "10 - 12" carries no
 *  meridiem or minutes and is rejected. */
function findTimes(text: string): TimeHit[] {
  const hits: TimeHit[] = []
  const spans: { index: number; end: number }[] = []
  const rangeRe = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*[-–—]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/gi
  for (let m = rangeRe.exec(text); m; m = rangeRe.exec(text)) {
    const h1 = Number(m[1])
    const mi1 = m[2] !== undefined ? Number(m[2]) : null
    let mer1 = m[3] ?? null
    const h2 = Number(m[4])
    const mi2 = m[5] !== undefined ? Number(m[5]) : null
    let mer2 = m[6] ?? null
    if (!mer1 && !mer2) {
      // 24-hour ranges must spell out minutes on both sides.
      if (mi1 === null || mi2 === null || h1 > 23 || h2 > 23) continue
    } else {
      mer1 = mer1 ?? mer2
      mer2 = mer2 ?? mer1
      if (h1 < 1 || h1 > 12 || h2 < 1 || h2 > 12) continue
    }
    if ((mi1 !== null && mi1 > 59) || (mi2 !== null && mi2 > 59)) continue
    let hh = mer1 ? to24(h1, mer1) : h1
    const endHh = mer2 ? to24(h2, mer2) : h2
    const mi = mi1 ?? 0
    const endMi = mi2 ?? 0
    // "11 - 1pm" inherits pm onto 11; the intended reading is 11am.
    if (m[3] === undefined && mer1 && hh * 60 + mi > endHh * 60 + endMi) hh = to24(h1, 'am')
    const end = m.index + m[0].length
    const z = zoneAfter(text, end)
    // The span covers the zone token too: "(GMT -04:00)" digits must not be
    // re-scanned as a spurious standalone time. It is pushed even when the zone
    // is unresolvable, so the dropped range's digits are not picked up as
    // machine-local single times instead.
    spans.push({ index: m.index, end: z?.end ?? end })
    if (z?.unknown) continue
    hits.push({ index: m.index, end, hh, mi, endHh, endMi, zone: z?.zone ?? null, offsetMin: z?.offsetMin ?? null })
  }
  const singleRe = /\b(\d{1,2}):(\d{2})\s*(am|pm)?\b|\b(\d{1,2})\s*(am|pm)\b/gi
  for (let m = singleRe.exec(text); m; m = singleRe.exec(text)) {
    const index = m.index
    const end = index + m[0].length
    if (spans.some((s) => index < s.end && end > s.index)) continue
    let hh: number
    let mi: number
    if (m[1] !== undefined) {
      const h = Number(m[1])
      mi = Number(m[2])
      if (mi > 59) continue
      if (m[3]) {
        if (h < 1 || h > 12) continue
        hh = to24(h, m[3])
      } else {
        if (h > 23) continue
        hh = h
      }
    } else {
      const h = Number(m[4])
      if (h < 1 || h > 12) continue
      hh = to24(h, m[5])
      mi = 0
    }
    const z = zoneAfter(text, end)
    if (z) spans.push({ index: end, end: z.end })
    if (z?.unknown) continue
    hits.push({ index, end, hh, mi, endHh: null, endMi: null, zone: z?.zone ?? null, offsetMin: z?.offsetMin ?? null })
  }
  return hits
}

/** Opening-hours and logistics blurbs sit beside interview times and often
 *  land NEARER the date than the slot itself, so proximity cannot separate
 *  them. Two signals demote a time to an aside: the words introducing it, and
 *  a span no interview occupies. */
const ASIDE_LEAD = /\b(?:office|business|support|opening|store|reception|desk|lobby|arrive|arrival|check[- ]?in|open|available|walk[- ]?in)\b[^.\n]{0,24}$/i
/** Longest plausible interview block; a wider range is opening hours. */
const MAX_EVENT_MS = 4 * 60 * 60 * 1000

/** Whether this time reads as context rather than the appointment: introduced
 *  by an opening-hours phrase, or spanning longer than any interview. */
function isAside(text: string, th: TimeHit, start: string, end: string | null): boolean {
  if (end && Date.parse(end) - Date.parse(start) > MAX_EVENT_MS) return true
  return ASIDE_LEAD.test(text.slice(Math.max(0, th.index - 40), th.index))
}

/** Missing year → the nearest occurrence whose DAY has not fully passed at
 *  `now`, within 12 months (a December mail about "Jan 5" lands in the next
 *  year). Day granularity, resolved once per date hit: a spurious earlier
 *  time on the same day must not push one pair's start a year out. */
function resolveYear(month: number, day: number, now: Date): number {
  const y = now.getFullYear()
  const dayEnd = new Date(y, month - 1, day + 1)
  return dayEnd.getTime() > now.getTime() ? y : y + 1
}

/** Quoted replies, Gmail attribution lines, and forwarded header runs describe
 *  the OLD mail — their dates and times must not pair with the new content.
 *  Matched regions are blanked with spaces (newlines kept) so every surviving
 *  hit keeps its index. */
function stripQuoted(body: string): string {
  const blank = (s: string): string => s.replace(/[^\n]/g, ' ')
  return body
    .replace(/^[ \t]*>[^\n]*/gm, blank)
    .replace(/^[ \t]*On [^\n]{0,200}(?:\n[^\n]{0,200})?wrote:[ \t]*$/gm, blank)
    .replace(/(?:^|(?<=\n))(?:[ \t]*(?:From|Sent|Date|To|Cc|Subject):[^\n]*(?:\n|$)){2,}/gi, blank)
}

/** One wall time → UTC ISO under the hit's zone: fixed GMT/UTC offset, IANA
 *  zone, or the machine's local clock when neither was given. */
function hitToIso(th: TimeHit, year: number, month: number, day: number, hh: number, mi: number): string {
  if (th.offsetMin !== null) {
    return new Date(Date.UTC(year, month - 1, day, hh, mi) - th.offsetMin * 60000).toISOString()
  }
  if (th.zone) return zonedTimeToIso(th.zone, year, month, day, hh, mi, 0)
  return new Date(year, month - 1, day, hh, mi).toISOString()
}

/** Extract one event from an interview mail's subject + body. Returns null
 *  unless exactly one coherent date+time reading exists: pairs of candidate
 *  starts more than a day apart, date-only, and time-only text all fail.
 *  False negatives are fine; false positives are not. */
export function extractEvent(
  subject: string,
  body: string,
  now: Date
): { title: string; start: string; end: string | null } | null {
  // The subject counts as a body prefix for proximity pairing.
  const text = subject + '\n' + stripQuoted(body)
  const dates = findDates(text)
  const times = findTimes(text)
  const pairs: {
    gap: number
    pos: number
    start: string
    end: string | null
    aside: boolean
  }[] = []
  for (const dh of dates) {
    const year = dh.year ?? resolveYear(dh.month, dh.day, now)
    for (const th of times) {
      const gap = dh.index > th.end ? dh.index - th.end : th.index > dh.end ? th.index - dh.end : 0
      if (gap > PAIR_WINDOW) continue
      const start = hitToIso(th, year, dh.month, dh.day, th.hh, th.mi)
      let end: string | null = null
      if (th.endHh !== null) {
        end = hitToIso(th, year, dh.month, dh.day, th.endHh, th.endMi ?? 0)
        if (Date.parse(end) <= Date.parse(start)) end = null
      }
      // The TIME's own position, not min(date,time): with min() every time
      // paired with one date collapses to that date's index, the sort below
      // becomes a no-op, and insertion order decides — and findTimes emits
      // every range before every single time. A trailing "Reception
      // 10:00-11:00" would then outrank the stated "2:00 PM" interview slot.
      pairs.push({ gap, pos: th.index, start, end, aside: isAside(text, th, start, end) })
    }
  }
  if (pairs.length === 0) return null
  const stamps = pairs.map((p) => Date.parse(p.start))
  if (Math.max(...stamps) - Math.min(...stamps) > 24 * 60 * 60 * 1000) return null
  // Asides lose to any real candidate; then nearest time to its date wins, and
  // equal distance falls back to text order. Proximity alone is not enough:
  // "August 12: reception 10:00-11:00, then your interview at 2:00 PM" puts
  // the distractor CLOSER to the date than the slot being scheduled.
  pairs.sort((a, b) => Number(a.aside) - Number(b.aside) || a.gap - b.gap || a.pos - b.pos)
  const title = subject.replace(/^\s*(?:(?:re|fwd?|fw)\s*:\s*)+/i, '').trim() || 'Interview'
  return { title, start: pairs[0].start, end: pairs[0].end }
}

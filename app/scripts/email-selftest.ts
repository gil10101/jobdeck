// Selftest for the pure email parsing modules. Runs under plain node type
// stripping (node >= 23): `node scripts/email-selftest.ts` from app/.
// Fixtures use example.com addresses and placeholder companies only.
import { parseIcs } from '../src/main/email/icsParse.ts'
import { extractEvent } from '../src/main/email/eventExtract.ts'

let pass = 0
let fail = 0

function check(name: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    pass++
  } else {
    fail++
    console.error(`FAIL ${name}`)
    console.error(`  expected: ${JSON.stringify(expected)}`)
    console.error(`  actual:   ${JSON.stringify(actual)}`)
  }
}

// ---- parseIcs ----

const googleInvite = [
  'BEGIN:VCALENDAR',
  'PRODID:-//Example//Calendar//EN',
  'VERSION:2.0',
  'METHOD:REQUEST',
  'BEGIN:VTIMEZONE',
  'TZID:America/New_York',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'DTSTART;TZID=America/New_York:20260810T160000',
  'DTEND;TZID=America/New_York:20260810T163000',
  'ORGANIZER;CN=Acme Recruiting:mailto:recruiting@example.com',
  'UID:abc123@example.com',
  'SUMMARY:Interview with Acme',
  'LOCATION:Google Meet',
  'X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'DESCRIPTION:This is an event reminder',
  'END:VALARM',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n')

const g = parseIcs(googleInvite)
check('google invite parses', g !== null, true)
check('google title', g?.invite.title, 'Interview with Acme')
check('google TZID start (EDT = UTC-4)', g?.invite.start, '2026-08-10T20:00:00.000Z')
check('google TZID end', g?.invite.end, '2026-08-10T20:30:00.000Z')
check('google organizer prefers CN', g?.invite.organizer, 'Acme Recruiting')
check('google uid', g?.uid, 'abc123@example.com')
check('google method', g?.invite.method, 'REQUEST')
check('google meet link from X-GOOGLE-CONFERENCE', g?.invite.meetLink, 'https://meet.google.com/abc-defg-hij')
check('VALARM description does not leak', g?.invite.location, 'Google Meet')

const utcInvite = [
  'BEGIN:VCALENDAR',
  'METHOD:REQUEST',
  'BEGIN:VEVENT',
  'UID:utc1@example.com',
  'DTSTART:20261201T140000Z',
  'DTEND:20261201T150000Z',
  'SUMMARY:Technical screen with the pla',
  ' tform team',
  'LOCATION:Building 4\\, Floor 2\\; Room A',
  'DESCRIPTION:Join here: https://example.zoom.us/j/123456789?pwd=abc\\nAgenda follows',
  'ORGANIZER:mailto:hiring@example.com',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n')

const u = parseIcs(utcInvite)
check('utc Z start', u?.invite.start, '2026-12-01T14:00:00.000Z')
check('folded SUMMARY unfolds', u?.invite.title, 'Technical screen with the platform team')
check('escaped comma/semicolon', u?.invite.location, 'Building 4, Floor 2; Room A')
check('meet link found in DESCRIPTION', u?.invite.meetLink, 'https://example.zoom.us/j/123456789?pwd=abc')
check('organizer falls back to mailto', u?.invite.organizer, 'hiring@example.com')

const allDay = [
  'BEGIN:VCALENDAR',
  'METHOD:REQUEST',
  'BEGIN:VEVENT',
  'UID:allday1@example.com',
  'DTSTART;VALUE=DATE:20260810',
  'DTEND;VALUE=DATE:20260811',
  'SUMMARY:Onsite day',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\n')

const a = parseIcs(allDay)
check('all-day start is local midnight', a?.invite.start, new Date(2026, 7, 10).toISOString())

const cancel = [
  'BEGIN:VCALENDAR',
  'METHOD:CANCEL',
  'BEGIN:VEVENT',
  'UID:abc123@example.com',
  'DTSTART:20260810T200000Z',
  'SUMMARY:Interview with Acme',
  'STATUS:CANCELLED',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n')

check('cancellation method', parseIcs(cancel)?.invite.method, 'CANCEL')
check('no VEVENT returns null', parseIcs('BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nEND:VCALENDAR'), null)

// ---- extractEvent ----

const nowAug = new Date(2026, 7, 5, 12, 0)

const e1 = extractEvent(
  'Interview with Acme',
  'Hi, your interview is scheduled for Aug 12 at 10:00 AM. The team looks forward to meeting you.',
  nowAug
)
check('"Aug 12 ... 10:00 AM" start', e1?.start, new Date(2026, 7, 12, 10, 0).toISOString())
check('"Aug 12" title from subject', e1?.title, 'Interview with Acme')

const e2 = extractEvent(
  'Re: Re: Fwd: Phone screen',
  'Confirming Monday, August 10, 2026 from 4:00–4:30 PM EDT. A calendar invite will follow.',
  nowAug
)
check('range with EDT start', e2?.start, '2026-08-10T20:00:00.000Z')
check('range with EDT end', e2?.end, '2026-08-10T20:30:00.000Z')
check('Re:/Fwd: runs stripped', e2?.title, 'Phone screen')

const e3 = extractEvent('Next steps', 'Are you free on 8/12 at 4pm for a quick call?', nowAug)
check('"8/12 at 4pm" start', e3?.start, new Date(2026, 7, 12, 16, 0).toISOString())

const e4 = extractEvent('', 'We can meet 4pm - 4:30pm on Aug 20.', nowAug)
check('"4pm - 4:30pm" range start', e4?.start, new Date(2026, 7, 20, 16, 0).toISOString())
check('"4pm - 4:30pm" range end', e4?.end, new Date(2026, 7, 20, 16, 30).toISOString())
check('empty subject falls back', e4?.title, 'Interview')

const nowDec = new Date(2026, 11, 15, 9, 0)
const e5 = extractEvent('Onsite', 'Your onsite is on Jan 5 at 10am.', nowDec)
check('December-to-January year rollover', e5?.start, new Date(2027, 0, 5, 10, 0).toISOString())

check(
  'date-only returns null',
  extractEvent('Interview', 'We will see you on August 12. Details to follow.', nowAug),
  null
)
check(
  'time-only returns null',
  extractEvent('Interview', 'Does 4pm work for you tomorrow?', nowAug),
  null
)
check(
  'promo text returns null',
  extractEvent('Huge savings inside', 'Half off everything! Sale ends August 12. Shop before it is gone.', nowAug),
  null
)
check(
  'conflicting date+time pairs return null',
  extractEvent('Scheduling', 'We could do Aug 12 at 10am or Sep 3 at 2pm — let me know.', nowAug),
  null
)

console.log(`PASS ${pass}/${pass + fail}`)
if (fail > 0) process.exit(1)

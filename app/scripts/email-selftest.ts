// Selftest for the pure email parsing modules. Runs under plain node type
// stripping (node >= 23): `node scripts/email-selftest.ts` from app/.
// Fixtures use example.com addresses and placeholder companies only.
import { icsDedupeKey, parseIcs } from '../src/main/email/icsParse.ts'
import { extractEvent } from '../src/main/email/eventExtract.ts'
import { classifyEmail, deriveJobRelated, reviseJobRelated } from '../src/main/email/emailClassify.ts'
import { GmailHttpError, isPermanentFetchFailure } from '../src/main/email/gmailErrors.ts'

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

// Windows TZIDs (Outlook/Exchange) must map to real zones, not silently fall
// back to the machine clock.
const winEuInvite = [
  'BEGIN:VCALENDAR',
  'METHOD:REQUEST',
  'BEGIN:VEVENT',
  'UID:win1@example.com',
  'DTSTART;TZID=W. Europe Standard Time:20260810T140000',
  'DTEND;TZID=W. Europe Standard Time:20260810T150000',
  'SUMMARY:Interview',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n')
const winEu = parseIcs(winEuInvite)
check('Windows EU TZID start (CEST = UTC+2)', winEu?.invite.start, '2026-08-10T12:00:00.000Z')
check('Windows EU TZID end', winEu?.invite.end, '2026-08-10T13:00:00.000Z')

const winUsInvite = [
  'BEGIN:VCALENDAR',
  'METHOD:REQUEST',
  'BEGIN:VEVENT',
  'UID:win2@example.com',
  'DTSTART;TZID=Eastern Standard Time:20260810T100000',
  'SUMMARY:Interview',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n')
check(
  'Windows US TZID honors DST (August EDT = UTC-4)',
  parseIcs(winUsInvite)?.invite.start,
  '2026-08-10T14:00:00.000Z'
)

const winKrInvite = [
  'BEGIN:VCALENDAR',
  'METHOD:REQUEST',
  'BEGIN:VEVENT',
  'UID:win3@example.com',
  'DTSTART;TZID=Korea Standard Time:20260810T180000',
  'SUMMARY:Interview',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n')
check('Windows Asia TZID maps (KST = UTC+9)', parseIcs(winKrInvite)?.invite.start, '2026-08-10T09:00:00.000Z')

// A Windows TZID absent from the map must resolve from the invite's own
// VTIMEZONE standard offset, not the machine clock. DAYLIGHT must not win.
const winUnmappedInvite = [
  'BEGIN:VCALENDAR',
  'METHOD:REQUEST',
  'BEGIN:VTIMEZONE',
  'TZID:Yakutsk Standard Time',
  'BEGIN:DAYLIGHT',
  'TZOFFSETTO:+1000',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETTO:+0900',
  'END:STANDARD',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'UID:win4@example.com',
  'DTSTART;TZID=Yakutsk Standard Time:20260810T180000',
  'SUMMARY:Interview',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n')
check(
  'unmapped Windows TZID falls back to VTIMEZONE standard offset',
  parseIcs(winUnmappedInvite)?.invite.start,
  '2026-08-10T09:00:00.000Z'
)

// A RECURRENCE-ID scopes its message to ONE occurrence. Keyed by the bare UID
// it would update or dismiss the whole series, so it must key separately.
const instanceCancel = [
  'BEGIN:VCALENDAR',
  'METHOD:CANCEL',
  'BEGIN:VEVENT',
  'UID:series1@example.com',
  'RECURRENCE-ID;TZID=America/New_York:20260812T160000',
  'DTSTART;TZID=America/New_York:20260812T160000',
  'SUMMARY:Interview loop',
  'STATUS:CANCELLED',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n')
const inst = parseIcs(instanceCancel)
check('instance-scoped cancel exposes its RECURRENCE-ID', inst?.recurrenceId, '2026-08-12T20:00:00.000Z')
check(
  'instance dedupe key differs from the series UID',
  icsDedupeKey(inst?.uid ?? null, inst?.recurrenceId ?? null),
  'series1@example.com#2026-08-12T20:00:00.000Z'
)
check('series message has no RECURRENCE-ID', parseIcs(googleInvite)?.recurrenceId, null)
check(
  'series dedupe key is the bare UID',
  icsDedupeKey('abc123@example.com', null),
  'abc123@example.com'
)
check('no UID means no dedupe key', icsDedupeKey(null, '2026-08-12T20:00:00.000Z'), null)

// ---- gmailErrors ----

// The backfill sweep stamps completion only when every failure is permanent —
// treating a rate limit as permanent would mark unswept mail as done, and
// treating a deleted message as transient refetches every candidate forever.
check('404 is permanent', isPermanentFetchFailure(new GmailHttpError(404, 'gone')), true)
check('400 is permanent', isPermanentFetchFailure(new GmailHttpError(400, 'bad id')), true)
check('410 is permanent', isPermanentFetchFailure(new GmailHttpError(410, 'gone')), true)
check('429 rate limit is transient', isPermanentFetchFailure(new GmailHttpError(429, 'slow down')), false)
check('403 rate limit is transient', isPermanentFetchFailure(new GmailHttpError(403, 'quota')), false)
check('500 is transient', isPermanentFetchFailure(new GmailHttpError(500, 'server')), false)
check('a network error is transient', isPermanentFetchFailure(new Error('fetch failed')), false)

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

const e3 = extractEvent('Next steps', 'Are you free on 8/20 at 4pm for a quick call?', nowAug)
check('"8/20 at 4pm" start (day > 12 fixes the field order)', e3?.start, new Date(2026, 7, 20, 16, 0).toISOString())
// A numeric date whose first two fields are BOTH <= 12 means one thing to a US
// sender and another to a UK/EU one, and nothing on this path knows which.
check(
  'ambiguous D/M-vs-M/D numeric date returns null rather than guessing US order',
  extractEvent('Interview confirmation', 'Your interview is scheduled for 10/08/2026 at 14:00.', nowAug),
  null
)
check(
  'ambiguous numeric date with no year is skipped too',
  extractEvent('Next steps', 'Are you free on 8/12 at 4pm for a quick call?', nowAug),
  null
)

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
// Proximity alone cannot pick the appointment: opening-hours and arrival
// blurbs routinely sit NEARER the date than the slot being scheduled.
check(
  'a nearer hours blurb does not outrank the stated slot',
  extractEvent('Interview', 'August 12: reception 10:00-11:00, then your interview at 2:00 PM ET.', nowAug)
    ?.start,
  '2026-08-12T18:00:00.000Z'
)
check(
  'an all-day opening-hours range is not the event',
  extractEvent('Interview', 'Interview August 12. Office hours 9:00-5:00. Your slot is 2:00 PM ET.', nowAug)
    ?.start,
  '2026-08-12T18:00:00.000Z'
)
check(
  'a genuine short range is still kept',
  extractEvent('Interview', 'Your panel is August 12, 4:00-4:30 PM ET.', nowAug),
  {
    title: 'Interview',
    start: '2026-08-12T20:00:00.000Z',
    end: '2026-08-12T20:30:00.000Z'
  }
)
check(
  'conflicting date+time pairs return null',
  extractEvent('Scheduling', 'We could do Aug 12 at 10am or Sep 3 at 2pm — let me know.', nowAug),
  null
)

// A year-less date is always resolved FORWARD, so a look-back would otherwise
// book an event most of a year out.
check(
  'a retrospective year-less date is not booked into next year',
  extractEvent(
    'Thank you for your time',
    'It was a pleasure interviewing you on March 3 at 2:00 PM ET. We will be in touch.',
    nowAug
  ),
  null
)
check(
  'a stated year is trusted even far ahead',
  extractEvent('Interview', 'Your interview is on March 3, 2027 at 2:00 PM ET.', nowAug)?.start,
  '2027-03-03T19:00:00.000Z'
)
check(
  'a year-less date inside the horizon still resolves',
  extractEvent('Interview', 'Your interview is on November 20 at 2:00 PM ET.', nowAug)?.start,
  '2026-11-20T19:00:00.000Z'
)

// Zone abbreviations that do not end in T are real zones too — reinterpreting
// their wall time in the machine's zone books the event hours off.
check(
  'a non-T zone abbreviation is dropped, not read as machine-local',
  extractEvent('Interview', 'Your interview is on Aug 12 at 3:00 PM WIB.', nowAug),
  null
)
check(
  'an unrecognized T-suffixed abbreviation is still dropped',
  extractEvent('Interview', 'Your interview is on Aug 12 at 3:00 PM IST.', nowAug),
  null
)

// ---- extractEvent: real-world layouts ----

check(
  'ATS plain-text invite with time range and GMT offset',
  extractEvent(
    'Interview',
    'When: Thursday August 06 at 3:15pm - 4:00pm (GMT -04:00)\n\nAdditional details:\nLocation:',
    nowAug
  ),
  {
    title: 'Interview',
    start: '2026-08-06T19:15:00.000Z',
    end: '2026-08-06T20:00:00.000Z'
  }
)
// The two backfill regressions together: the offset digits must not become a
// spurious 04:00 time, and a clock later the same day must not bump the year.
check(
  'GMT offset survives a same-day afternoon clock',
  extractEvent(
    'Interview',
    'When: Thursday August 06 at 3:15pm - 4:00pm (GMT -04:00)\n\nAdditional details:\nLocation:',
    new Date(2026, 7, 6, 14, 24)
  ),
  {
    title: 'Interview',
    start: '2026-08-06T19:15:00.000Z',
    end: '2026-08-06T20:00:00.000Z'
  }
)
check(
  'earlier-today time keeps this year',
  extractEvent('Interview', 'Your interview is on Aug 6 at 9:00 AM ET.', new Date(2026, 7, 6, 14, 24))
    ?.start,
  '2026-08-06T13:00:00.000Z'
)
check(
  'bare UTC token after a 24h time',
  extractEvent('Interview', 'The panel call is on Aug 12 at 15:00 UTC.', nowAug)?.start,
  '2026-08-12T15:00:00.000Z'
)
check(
  'positive half-hour GMT offset',
  extractEvent('Interview', 'Interview scheduled for Aug 12 at 10:00 GMT+05:30.', nowAug)?.start,
  '2026-08-12T04:30:00.000Z'
)

// ---- extractEvent: quoted / attributed regions ----

check(
  'gmail attribution line does not poison extraction',
  extractEvent(
    'Re: Interview',
    'On Tue, Aug 4, 2026 at 9:15 AM Recruiting Team <recruiting@example.com> wrote:\n> Sounds good, sending times.\nYour interview is confirmed for Aug 10 at 2pm ET.',
    nowAug
  )?.start,
  '2026-08-10T18:00:00.000Z'
)
check(
  'line-wrapped attribution variant is stripped too',
  extractEvent(
    'Re: Interview',
    'On Tue, Aug 4, 2026 at 9:15 AM Recruiting Team\n<recruiting@example.com> wrote:\n\nInterview confirmed for Aug 10 at 2pm ET.',
    nowAug
  )?.start,
  '2026-08-10T18:00:00.000Z'
)
check(
  'forwarded header block is stripped',
  extractEvent(
    'Fwd: Interview',
    '---------- Forwarded message ----------\nFrom: Recruiting <recruiting@example.com>\nDate: Tue, Aug 4, 2026 at 9:15 AM\nSubject: Interview\nTo: candidate@example.com\n\nYour interview is Aug 10 at 2pm ET.',
    nowAug
  )?.start,
  '2026-08-10T18:00:00.000Z'
)
check(
  'quoted-only date/time still returns null',
  extractEvent('Re: Interview', '> The interview was Aug 10 at 2pm ET.\nThanks, that worked great!', nowAug),
  null
)
check(
  'calendar-notification layout with dot separator and en-dash range',
  extractEvent(
    'Updated invitation: Screening call',
    'Person A and Person B\nMonday Aug 10, 2026 ⋅ 4pm – 4:30pm\nEastern Time - New York',
    nowAug
  ),
  {
    title: 'Updated invitation: Screening call',
    start: new Date(2026, 7, 10, 16, 0).toISOString(),
    end: new Date(2026, 7, 10, 16, 30).toISOString()
  }
)

// ---- classifyEmail ----

check(
  'non-gerund rejection phrasing classifies as rejection',
  classifyEmail(
    'no-reply@example.myworkday.com',
    'Update on your application',
    "Thank you for giving us the opportunity to review your application for the Data Analyst position. After review, we've made the decision to not move forward. We appreciate your interest and wish you success."
  ),
  'rejection'
)
check(
  'ATS auto-reply mentioning next steps stays a confirmation',
  classifyEmail(
    '"Acme LLP @ icims" <acme+autoreply@talent.icims.com>',
    'Thank You for Applying at Acme!',
    'We now have your application for the Data Analytics Intern position and will be carefully reviewing your information. We will follow-up with you via email or phone call if selected for next steps.'
  ),
  'confirmation'
)
check(
  'scheduling language still beats confirmation wording',
  classifyEmail(
    'recruiting@example.com',
    'Your Acme application',
    'Thanks for applying! We would like to schedule a call with you this week. Please share your availability.'
  ),
  'interview'
)
check(
  'weak next-steps alone still reads as interview',
  classifyEmail(
    'recruiter@example.com',
    'Following up',
    'Great chatting today. Next steps: the team will be in touch about timing.'
  ),
  'interview'
)
check(
  'calendar-notification body with When: marker is interview',
  classifyEmail(
    'calendar-notification@example.com',
    'Updated invitation: Screening call @ Mon Aug 10',
    'When: Monday Aug 10, 2026 4pm (Eastern Time - New York)\nAttendees: recruiting team'
  ),
  'interview'
)
check(
  'promotional offer still guarded out',
  classifyEmail(
    'deals@offers.example.com',
    'Your exclusive offer ends soon',
    'Half price on everything — schedule your visit today! Limited-time offer ends August 12.'
  ),
  'other'
)

// ---- deriveJobRelated ----

check(
  'interview class from a company domain implies job-related',
  deriveJobRelated(
    'recruiter@example.com',
    'Interview availability',
    'We would like to schedule a call about the role.',
    false,
    'interview',
    false
  ),
  true
)
check(
  'assessment class implies job-related without a sweep hit',
  deriveJobRelated(
    'assessments@example.com',
    'Next step',
    'Complete your online assessment for the analyst position.',
    false,
    'assessment',
    false
  ),
  true
)
check(
  'promotional other is still demoted despite a sweep hit',
  deriveJobRelated(
    'deals@offers.example.com',
    'Your exclusive offer ends soon',
    'Half price on everything — limited-time offer ends August 12.',
    true,
    'other',
    false
  ),
  false
)

// Scheduling language is how ordinary mail talks too: without a job signal an
// 'interview' classification must NOT put personal mail in the Job tab (which
// is also what gates the "Interview email" toast).
check(
  'personal "let\'s schedule a call" is not job mail',
  deriveJobRelated(
    'friend@example.com',
    'Sunday',
    "Hi! Let's schedule a call this weekend to talk about the trip.",
    false,
    'interview',
    false
  ),
  false
)
check(
  'personal "book a time" is not job mail',
  deriveJobRelated(
    'clinic@example.com',
    'Appointment',
    'Please book a time for your annual check-up.',
    false,
    'interview',
    false
  ),
  false
)
check(
  'a family calendar invite is not job mail',
  deriveJobRelated(
    'office@example.com',
    'Parent evening',
    'Calendar invite attached for the parent-teacher meeting on Thursday.',
    false,
    'interview',
    false
  ),
  false
)
// The reason the class-implies-job-mail rule exists: the Gmail sweep only
// searches SUBJECTS, so body-only recruiter outreach never hits it.
check(
  'direct recruiter outreach that misses the subject sweep is still job mail',
  deriveJobRelated(
    'sarah@example.com',
    'Hello from Acme',
    'I came across your profile — could we schedule a call about a Senior Engineer role on our team?',
    false,
    'interview',
    false
  ),
  true
)
check(
  'a tracked company named in the message is a job signal on its own',
  deriveJobRelated(
    'sarah@example.com',
    'Following up',
    'Are you free Thursday at 3pm for a quick chat?',
    false,
    'interview',
    true
  ),
  true
)
check(
  'an ATS sender is job mail regardless of class',
  deriveJobRelated('no-reply@example.greenhouse.io', 'Update', 'Some update.', false, 'other', false),
  true
)

// ---- reviseJobRelated (cached messages: snippet only, body long gone) ----

check(
  'a body-decided job message is not demoted when only its snippet is left',
  reviseJobRelated(
    'sarah@example.com',
    'Hello from Acme',
    'I came across your profile — could we schedule a call this week?',
    false,
    'interview',
    false,
    true
  ),
  true
)
check(
  'a cached personal message stays out of the Job tab',
  reviseJobRelated(
    'friend@example.com',
    'Sunday',
    "Hi! Let's schedule a call this weekend to talk about the trip.",
    false,
    'interview',
    false,
    false
  ),
  false
)
check(
  'a cached promotional message is still demoted',
  reviseJobRelated(
    'deals@offers.example.com',
    'Your exclusive offer ends soon',
    'Half price on everything — limited-time offer ends August 12.',
    true,
    'other',
    false,
    true
  ),
  false
)
check(
  'entering the job sweep later upgrades a cached message',
  reviseJobRelated('someone@example.com', 'Application', 'Some text.', true, 'other', false, false),
  true
)

console.log(`PASS ${pass}/${pass + fail}`)
if (fail > 0) process.exit(1)

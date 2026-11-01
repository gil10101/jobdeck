import type { EmailClassification } from '@shared/types'

// Deterministic mail classification, kept free of runtime imports so the
// selftest can exercise it under plain node type-stripping.

/** Coding-assessment platforms — mail from these IS the assessment. */
export const ASSESSMENT_DOMAINS = [
  'hackerrank.com',
  'codility.com',
  'codesignal.com',
  'karat.com',
  'hirevue.com',
  'testgorilla.com'
]
/** ATS notification senders — always job mail, but the subject picks the class.
 *  Workable routes candidate mail (incl. calendar invites) through
 *  inbound.workablemail.com, which is why interview invites slipped past. */
export const ATS_DOMAINS = [
  'greenhouse.io',
  'lever.co',
  'ashbyhq.com',
  'myworkday.com',
  'icims.com',
  'smartrecruiters.com',
  'workable.com',
  'workablemail.com',
  'jobvite.com'
]

/** True when any address in the From header sits on (a subdomain of) one of
 *  `domains` — assessment invites often come from a mail.* subdomain. */
export function fromDomainMatch(from: string, domains: string[]): boolean {
  const hosts = [...from.toLowerCase().matchAll(/@([a-z0-9-][a-z0-9.-]*)/g)].map((m) => m[1])
  return hosts.some((h) => domains.some((d) => h === d || h.endsWith(`.${d}`)))
}

const REJECTION =
  /unfortunately|we regret|regret to inform|not (be )?(moving|proceeding) forward|will not be moving forward|decided (not )?to (move|proceed)|decision (to )?not (to )?move forward|not to move forward|unable to move forward|(move|moving) forward with other|other candidates|not (been )?selected|no longer under consideration|pursue other (applicants|candidates)|position has been filled/i

/** Unambiguous scheduling/interview language. Calendar markers ("When:",
 *  "Attendees:", "reschedule", "needs-action") and phrasings like "invite you
 *  for a call" carry no "interview" keyword, so match them too. */
const INTERVIEW_STRONG =
  /interview|technical screen|phone screen|screening call|invit(e|ation) (you )?(to|for)|schedule (a|your|some) (call|chat|conversation|meeting|time)|set up (a )?(call|time|chat)|book (a )?time|meet (the|with) (team|us)|hop on a call|speak with you|calendar (invite|invitation)|\bwhen:\s|\battendees:\b|\breschedule\b|needs-action|will call you|call (for|with|regarding).{0,40}\b(job|role|position|opportunity)\b/i

/** Scheduling-adjacent phrases that also appear in plain application
 *  confirmations ("we will follow up via email or phone call on next steps")
 *  — they may only decide the class AFTER the confirmation patterns have had
 *  their chance. */
const INTERVIEW_WEAK = /next steps|your availability|phone (call|conversation)/i

const CONFIRMATION =
  /application (was |has been )?(received|submitted)|(thank you|thanks) for (applying|your application)|we('ve| have) received your application|we now have your application|application confirmation|successfully (applied|submitted)/i

/** Deterministic classification from the subject AND snippet. Order matters:
 *  assessment invites mention interviews, rejections mention everything — most
 *  specific signals first. Weak scheduling phrases ("next steps") rank BELOW
 *  confirmation so an ATS auto-reply that promises follow-up "if selected for
 *  next steps" stays a confirmation. Assessment-platform senders are
 *  'assessment' outright; ATS senders that hit no rule default by whether the
 *  text mentions the application. The snippet is included throughout because
 *  the decisive word often lives in the body, not the subject. */
export function classifyEmail(from: string, subject: string, snippet: string): EmailClassification {
  const s = subject
  const text = `${subject}\n${snippet}`
  // Retail/marketing blasts keyword-collide with job terms ("your OFFER ends
  // soon", "schedule your visit") — unless they come from a real ATS or
  // assessment sender, they are never job mail. Guard first so those terms
  // never reach the class rules below.
  if (
    !fromDomainMatch(from, [...ASSESSMENT_DOMAINS, ...ATS_DOMAINS]) &&
    looksPromotional(from, subject, snippet)
  ) {
    return 'other'
  }
  if (
    fromDomainMatch(from, ASSESSMENT_DOMAINS) ||
    /\bassessment\b|hackerrank|codility|codesignal|coding (challenge|test|exercise)|take[- ]home|\bonline assessment\b|personality (test|assessment)|\boa\b/i.test(
      text
    )
  ) {
    return 'assessment'
  }
  if (/offer letter|job offer|offer of employment|employment offer|pleased to (extend|offer)|extend(ing)? (you )?an offer|excited to offer you|we('d| would) (be happy to |like to )?offer you/i.test(text)) {
    return 'offer'
  }
  if (REJECTION.test(text)) return 'rejection'
  if (INTERVIEW_STRONG.test(text)) return 'interview'
  if (CONFIRMATION.test(text)) return 'confirmation'
  if (INTERVIEW_WEAK.test(text)) return 'interview'
  if (fromDomainMatch(from, ATS_DOMAINS)) {
    return /application/i.test(text) ? 'confirmation' : 'other'
  }
  if (/recruit|talent acquisition|sourcing|hiring team/i.test(from) || /\b(opportunity|opening|role at|position at)\b/i.test(s)) {
    return 'recruiter'
  }
  return 'other'
}

/** Marketing/promotional mail that keyword-matched the job sweep by accident
 *  ("your half price OFFER ends soon"). Only an unambiguous marketing sender
 *  subdomain, or a clearly promo-shaped subject/snippet, counts — generic
 *  labels (mail., email., news.) are excluded because real companies send
 *  legitimate hiring mail from them. */
export function looksPromotional(from: string, subject: string, snippet: string): boolean {
  const host = from.toLowerCase().match(/@([a-z0-9.-]+)/)?.[1] ?? ''
  if (/(^|\.)(offers?|usoffers|deals?|promo|promotions?|marketing|newsletters?|eblast)\./.test(host)) {
    return true
  }
  const text = `${subject} ${snippet}`.toLowerCase()
  return /\b\d+%\s*(off|discount)\b|half price|\bcoupon\b|promo code|limited[- ]time|(offer|deal|sale|discount) ends|flash sale|shop now|free (month|trial|shipping)/.test(
    text
  )
}

/** Hiring vocabulary anywhere in the sender, subject, or scanned text. The
 *  scheduling phrases that drive an 'interview' classification ("schedule a
 *  call", "your availability", "next steps") are exactly how ordinary personal
 *  mail talks too, so the class alone cannot mean job mail — one of these words
 *  must appear as well. Kept narrow: words that in isolation are also everyday
 *  English ("team", "offer", "meeting") are deliberately absent. */
const JOB_CONTEXT =
  /\b(?:job|jobs|role|roles|position|positions|opening|openings|vacanc(?:y|ies)|opportunit(?:y|ies)|hiring|hire|recruit(?:er|ers|ing|ment)?|talent acquisition|sourcing|candidate|candidacy|applicant|application|applications|apply|applying|applied|r[ée]sum[ée]|cv|interview|interviews|interviewing|screening|phone screen|technical screen|onsite|offer letter|job offer|compensation|salary|career|careers|employment|internship|new grad)\b/i

/** Some evidence — beyond scheduling words — that a message is about the job
 *  search: the Gmail job sweep matched it, it came from an ATS/assessment
 *  sender, a tracked company is named in it, or it simply uses hiring
 *  vocabulary. The last one is what keeps direct recruiter mail from a company
 *  domain working: the sweep only searches SUBJECTS, so "Hello from Acme" with
 *  the role in the body never hits it. */
function hasJobSignal(
  from: string,
  subject: string,
  text: string,
  jobHit: boolean,
  trackerHit: boolean
): boolean {
  if (jobHit || trackerHit) return true
  if (fromDomainMatch(from, [...ATS_DOMAINS, ...ASSESSMENT_DOMAINS])) return true
  return JOB_CONTEXT.test(`${from}\n${subject}\n${text}`)
}

/** True if a message belongs in the Job tab. ATS/assessment senders are always
 *  job mail. An interview/assessment classification counts as evidence only
 *  alongside a job signal — direct recruiter mail from a company domain must
 *  not need the Gmail job sweep to count, but "let's schedule a call" from a
 *  friend must not land in the tab (or raise an "Interview email" toast).
 *  Otherwise it must have hit the job sweep — and mail the classifier could
 *  only call 'other' is dropped when it looks promotional, so a retail
 *  "offer"/"schedule" blast that snuck into the sweep does not pollute the
 *  tab. */
export function deriveJobRelated(
  from: string,
  subject: string,
  snippet: string,
  jobHit: boolean,
  classification: EmailClassification,
  trackerHit: boolean
): boolean {
  if (fromDomainMatch(from, [...ATS_DOMAINS, ...ASSESSMENT_DOMAINS])) return true
  if (classification === 'other' && looksPromotional(from, subject, snippet)) return false
  if (
    (classification === 'interview' || classification === 'assessment') &&
    hasJobSignal(from, subject, snippet, jobHit, trackerHit)
  ) {
    return true
  }
  return jobHit
}

/** Re-derivation for an ALREADY CACHED message. Bodies are never stored, so
 *  this only ever sees the snippet — and a message the ingest pass judged job
 *  mail from its full body (the role named past the ~200-char preview) must
 *  not be demoted just because the evidence is out of scope now. Only a
 *  promotional match, which reads the same at both points, can take it back. */
export function reviseJobRelated(
  from: string,
  subject: string,
  snippet: string,
  jobHit: boolean,
  classification: EmailClassification,
  trackerHit: boolean,
  wasJobRelated: boolean
): boolean {
  if (classification === 'other' && looksPromotional(from, subject, snippet)) return false
  if (wasJobRelated) return true
  return deriveJobRelated(from, subject, snippet, jobHit, classification, trackerHit)
}

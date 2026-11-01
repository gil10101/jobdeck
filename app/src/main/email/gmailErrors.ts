// Gmail transport error shape, split out of gmailClient so it stays a pure
// module: the email selftest executes it under plain node type stripping.

/** A non-2xx Gmail API response, carrying the status the caller must branch on. */
export class GmailHttpError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'GmailHttpError'
    this.status = status
  }
}

/** Statuses no retry can heal: the message is gone server-side or the id is
 *  malformed. Everything else — rate limits (Gmail answers 403 AND 429 for
 *  those), 5xx, and plain network failures — is transient and must be retried,
 *  or one bad hour would permanently mark work as done. */
const PERMANENT_STATUSES = new Set([400, 404, 410])

/** True when refetching this message can never succeed, so a sweep may record
 *  it and move on instead of blocking its completion stamp forever. */
export function isPermanentFetchFailure(err: unknown): boolean {
  return err instanceof GmailHttpError && PERMANENT_STATUSES.has(err.status)
}

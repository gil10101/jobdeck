# Security

## Reporting a vulnerability

Please report suspected vulnerabilities through GitHub's private vulnerability
reporting (the **Security** tab → **Report a vulnerability**) rather than a
public issue, so a fix can ship before the details are public.

Include what you did, what happened, and what you expected. A proof of concept
helps but is not required.

## What this app handles

This is a local-first desktop app. It runs on your machine, and there is no
server operated by this project — nothing to breach centrally, but it does hold
sensitive material locally:

- **Your career data** — profile, applications, generated documents, tracker,
  and run transcripts live as plain files in the workspace folder you choose.
  Anything with read access to that folder can read them.
- **Job-board credentials** — stored encrypted via the OS keychain, never in the
  workspace, never in the repository.
- **Gmail access** — read-only OAuth scope through an OAuth client *you* create.
  The refresh token and client secret are keychain-encrypted; cached message
  headers are written with owner-only permissions; message bodies are never
  written to disk; signing out wipes the cache.
- **Workspace exports** — the export archive deliberately excludes credentials,
  tokens, and cached sessions. Export files still contain your career data, so
  treat them as personal documents.

## Trust boundaries worth knowing

- **Job postings and email are untrusted input.** They are third-party text that
  reaches an AI agent, so they are handled as data, never as instructions.
  Report anything that looks like it could escape that boundary.
- **Embedded pages are isolated.** The Apply and browsing views load real sites
  in `<webview>` guests with no preload, context isolation on, and sandboxed
  popups; guests cannot reach the app's IPC bridge.
- **Agent actions are gated.** Actions the in-app assistant can take are
  presented for explicit approval rather than executed silently.

## Your own keys

Model-provider API keys (when not using a Claude subscription) are stored
encrypted locally. No key, credential, or document is transmitted anywhere
except to the provider you configured and the sites you asked the app to visit.

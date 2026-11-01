# Contributing

## Getting set up

```bash
cd app
npm install
npm run dev
```

Requirements are listed in the [README](README.md#requirements). Node 22.18+ is
the floor: the self-test scripts execute TypeScript directly, which Node runs
without a flag from 22.18 and 23.6 onward.

You do not need an Anthropic account to contribute. `npm install` fetches the
Claude Code agent runtime (`@anthropic-ai/claude-agent-sdk-<platform>-<arch>`),
which every provider needs, but the model behind it can be Gemini or a local
Ollama model — pick it in first-run setup or in Settings → Model provider.
Typecheck and the self-tests run no agents at all and need no credentials.

The app is Electron + React + TypeScript:

- `app/src/main` — main process: agent runner, IPC handlers, stores, email and
  calendar services, job-board bridge
- `app/src/preload` — the typed IPC bridge, the only channel between processes
- `app/src/renderer` — the React UI
- `app/src/shared` — the IPC contract and types both sides import
- `app/resources` — agent prompt templates and the bundled job-board CLIs

## Before you open a pull request

```bash
cd app
npm run typecheck            # must report zero errors
node scripts/email-selftest.ts     # email/calendar parsing
node scripts/portable-selftest.ts  # workspace archive + profile modules
```

There is no test runner; the self-test scripts are plain Node programs that
assert against fixtures and exit non-zero on failure. If you change parsing,
extraction, or archive logic, add cases to the matching self-test — a fix
without a case that fails before it is not finished.

## Conventions

- **No personal data anywhere**, including comments, fixtures, and prompt
  templates. Use `example.com` addresses and placeholder companies. This is a
  generic product: everything user-specific comes from the workspace at runtime,
  never from the source tree.
- **Comments state constraints and invariants** — why the code must be this way.
  Do not narrate history ("used to", "now", "per review") or reference versions;
  the next reader has no access to that context.
- **Style**: no semicolons, single quotes, two-space indent, explicit return
  types on functions. Match the surrounding file.
- **Theme safety**: the UI supports light and dark. Only theme-safe Tailwind
  classes are allowed (`cyan-200`–`950`, `gray-100`–`600`, `amber-*`, and the
  CSS-variable classes `panel`/`panel2`/`edge`/`bg`/`muted`). `gray-700`/`800`/
  `900` and `cyan-100` are fixed-dark and break light mode.
- **New IPC channels** go in `app/src/shared/ipc.ts` and are implemented in the
  main process; the renderer never reaches Node directly.
- **Third-party text is data, not instructions.** Job postings, emails, and page
  content reach agents as untrusted input. Keep it that way.

## Reporting bugs

Include your OS, Node version, which model provider you were using, and what the
app showed. For anything security-sensitive, follow [SECURITY.md](SECURITY.md)
instead of opening a public issue.

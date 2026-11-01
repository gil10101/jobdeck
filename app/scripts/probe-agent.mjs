// Agent probe: dump raw SDKMessages + verify project settings actually load.
// Usage: npm run probe:agent   (from app/)
import { query } from '@anthropic-ai/claude-agent-sdk'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..')

// The probe answers only from the prompt itself: a reply proves the SDK round
// trip works, and settingSources omission means no instructions file is read.
const PROMPT =
  'Without using any tools, reply with exactly one line: OK. Nothing else.'

const messages = []
let finalText = ''

console.log('[probe] repo root:', REPO_ROOT)
console.log('[probe] starting query()…')

try {
  const q = query({
    prompt: PROMPT,
    options: {
      cwd: REPO_ROOT,
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      settingSources: ['project'],
      permissionMode: 'bypassPermissions',
      maxTurns: 4,
      env: { ...process.env }
    }
  })

  for await (const msg of q) {
    messages.push(msg)
    const compact = JSON.stringify(msg)
    console.log('---', msg.type, compact.length > 400 ? compact.slice(0, 400) + '…' : compact)
    if (msg.type === 'assistant') {
      const content = msg.message?.content ?? msg.content ?? []
      for (const block of Array.isArray(content) ? content : []) {
        if (block.type === 'text') finalText += block.text
      }
    }
  }
} catch (err) {
  console.error('[probe] FAILED:', err)
  process.exitCode = 1
}

const dumpPath = path.join(__dirname, 'probe-dump.json')
writeFileSync(dumpPath, JSON.stringify(messages, null, 2), 'utf-8')
console.log('\n[probe] full dump →', dumpPath)
console.log('[probe] assistant text:', JSON.stringify(finalText.trim()))
// Optionally assert the response contains an expected string (e.g. an email you
// know is in the loaded project instructions): PROBE_EXPECT=you@example.com npm run probe:agent
const expect = process.env.PROBE_EXPECT ?? ''
if (expect) {
  console.log(
    finalText.includes(expect)
      ? '[probe] ✓ project instructions LOADED (expected string found)'
      : '[probe] ✗ project instructions NOT loaded — check systemPrompt preset + settingSources'
  )
}

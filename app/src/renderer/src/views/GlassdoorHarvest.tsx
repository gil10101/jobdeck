import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, Loader2, Radar, X } from 'lucide-react'
import type { WebviewElement } from '../types.d'
import { call } from '../api'

// Drives the in-app browser (the user's real, logged-in Glassdoor session) over
// their target searches and captures the raw job JSON off each loaded page —
// the only safe way to reach Glassdoor (a real session clears its bot check; a
// headless/replayed scraper gets blocked and risks the account). Runs BEFORE a
// scout so the feed is fresh. The user watches it and can ALSO drive manually:
// navigate the view and hit Capture, e.g. after solving a login/Cloudflare wall
// the auto pass could not. Normalization is main-side (tested parser); the
// renderer just hands over whatever page state it found.

const MAX_SEARCHES = 8
const SETTLE_MS = 2200
const PACE_MS = 2500

// Grabs Glassdoor's embedded app state (Apollo cache / __NEXT_DATA__ / json
// scripts mentioning a job listing) and reports a Cloudflare/login challenge.
// Kept as a string so it survives executeJavaScript's clone boundary. This is
// the one piece that may need adjusting when Glassdoor moves its data.
const EXTRACTOR = `(function(){
  try {
    var title = (document.title||'').toLowerCase();
    var body = (document.body ? document.body.innerText : '') || '';
    if (title.indexOf('just a moment')>=0 || title.indexOf('attention required')>=0 ||
        /verifying you are (a )?human/i.test(body) || /needs to review the security/i.test(body)) {
      return JSON.stringify({ status: 'challenge' });
    }
    var out = [];
    try { if (window.__APOLLO_STATE__) out.push(window.__APOLLO_STATE__); } catch(e){}
    try { if (window.appCache) out.push(window.appCache); } catch(e){}
    var scripts = document.querySelectorAll('script[type="application/json"], script#__NEXT_DATA__');
    for (var i=0;i<scripts.length;i++){
      var t = scripts[i].textContent || '';
      if (t.indexOf('jobListing')>=0 || t.indexOf('jobTitleText')>=0 || t.indexOf('listingId')>=0) {
        try { out.push(JSON.parse(t)); } catch(e){}
      }
    }
    return JSON.stringify({ status: out.length ? 'ok' : 'empty', payloads: out });
  } catch(e) { return JSON.stringify({ status: 'error', message: String(e) }); }
})()`

type SearchState = 'pending' | 'loading' | 'done' | 'empty' | 'challenge' | 'error'

interface Row {
  url: string
  label: string
  state: SearchState
}

function searchLabel(url: string): string {
  try {
    return new URL(url).searchParams.get('sc.keyword') || new URL(url).pathname
  } catch {
    return url
  }
}

/** Harvest overlay. Auto-drives the searches then waits at "idle" so the user
 *  can add manual captures; the footer Scout button writes the feed from
 *  everything accumulated and hands off to the scout launch. */
export default function GlassdoorHarvest({
  searches,
  onDone,
  onSkip,
  onCancel
}: {
  searches: string[]
  onDone: (count: number) => void
  onSkip: () => void
  onCancel: () => void
}): JSX.Element {
  const webviewRef = useRef<WebviewElement | null>(null)
  const payloadsRef = useRef<unknown[]>([])
  const resumeRef = useRef<(() => void) | null>(null)
  // Stable for the overlay's lifetime — recomputing per render would restart
  // the drive effect endlessly.
  const targetsRef = useRef(searches.slice(0, MAX_SEARCHES))
  const targets = targetsRef.current

  const [rows, setRows] = useState<Row[]>(
    targets.map((u) => ({ url: u, label: searchLabel(u), state: 'pending' as SearchState }))
  )
  const [phase, setPhase] = useState<'running' | 'challenge' | 'idle' | 'writing'>('running')
  const [captured, setCaptured] = useState(0)
  const [manualUrl, setManualUrl] = useState('')
  const [capturing, setCapturing] = useState(false)

  const extract = async (): Promise<{ status: string; payloads?: unknown[] }> => {
    const wv = webviewRef.current
    if (!wv) return { status: 'error' }
    try {
      return JSON.parse((await wv.executeJavaScript(EXTRACTOR)) as string)
    } catch {
      return { status: 'error' }
    }
  }

  const addPayloads = (payloads: unknown[]): void => {
    payloadsRef.current.push(...payloads)
    setCaptured(payloadsRef.current.length)
  }

  useEffect(() => {
    let cancelled = false
    const wv = webviewRef.current
    if (!wv) return

    const setRow = (i: number, state: SearchState): void =>
      setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, state } : r)))
    const once = (event: string, ms = 0): Promise<void> =>
      new Promise((resolve) => {
        let settled = false
        const done = (): void => {
          if (settled) return
          settled = true
          wv.removeEventListener(event, done)
          resolve()
        }
        wv.addEventListener(event, done)
        if (ms) setTimeout(done, ms)
      })
    const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

    const run = async (): Promise<void> => {
      await once('dom-ready', 3000) // let the <webview> attach
      for (let i = 0; i < targets.length && !cancelled; i++) {
        setRow(i, 'loading')
        try {
          await wv.loadURL(targets[i])
        } catch {
          /* a failed nav surfaces as empty/challenge below */
        }
        await once('did-stop-loading', 15_000)
        await sleep(SETTLE_MS)
        if (cancelled) return

        let result = await extract()
        if (result.status === 'challenge') {
          setRow(i, 'challenge')
          setPhase('challenge')
          await new Promise<void>((resolve) => {
            resumeRef.current = resolve
          })
          resumeRef.current = null
          if (cancelled) return
          setPhase('running')
          await sleep(SETTLE_MS)
          result = await extract()
        }
        if (result.status === 'ok' && result.payloads?.length) {
          addPayloads(result.payloads)
          setRow(i, 'done')
        } else {
          setRow(i, result.status === 'error' ? 'error' : 'empty')
        }
        if (i < targets.length - 1) await sleep(PACE_MS)
      }
      if (!cancelled) setPhase('idle')
    }

    void run()
    return () => {
      cancelled = true
      resumeRef.current?.()
    }
    // Runs once — targets is a stable ref, handlers close over stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const navigate = (): void => {
    let u = manualUrl.trim()
    if (!u) return
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u
    void webviewRef.current?.loadURL(u).catch(() => undefined)
  }

  const captureCurrent = async (): Promise<void> => {
    setCapturing(true)
    try {
      const result = await extract()
      if (result.status === 'ok' && result.payloads?.length) addPayloads(result.payloads)
    } finally {
      setCapturing(false)
    }
  }

  const finish = async (): Promise<void> => {
    setPhase('writing')
    try {
      const res = await call('glassdoor:writeFeed', { searches: targets, payloads: payloadsRef.current })
      onDone(res.count)
    } catch {
      onDone(0)
    }
  }

  const busy = phase === 'running' || phase === 'writing'

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-6">
      <div className="flex h-[85vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-edge bg-panel shadow-2xl">
        <div className="flex items-center gap-2 border-b border-edge px-4 py-2.5">
          <Radar size={14} className="text-cyan-300" />
          <span className="text-sm font-semibold text-gray-100">Harvesting Glassdoor</span>
          <span className="text-[11px] text-gray-500">
            your logged-in session — nothing is sent, jobs feed the scout
          </span>
          <span className="ml-auto text-[11px] text-gray-400">{captured} captured</span>
          <button
            className="btn btn-primary"
            disabled={phase === 'writing'}
            title="Write the feed and start the scout with what has been captured"
            onClick={() => void finish()}
          >
            {phase === 'writing' ? 'Writing…' : `Scout ${captured} →`}
          </button>
          <button className="btn" title="Skip Glassdoor, scout the other boards" onClick={onSkip}>
            Skip
          </button>
          <button className="p-1 text-gray-500 hover:text-gray-300" title="Cancel" onClick={onCancel}>
            <X size={14} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="flex w-64 shrink-0 flex-col border-r border-edge">
            <div className="overflow-auto p-2">
              {rows.map((r, i) => (
                <div key={i} className="flex items-center gap-2 px-2 py-1.5 text-xs">
                  <span className="shrink-0">
                    {r.state === 'loading' && <Loader2 size={12} className="animate-spin text-cyan-300" />}
                    {r.state === 'done' && <Check size={12} className="text-green-300" />}
                    {r.state === 'challenge' && <AlertTriangle size={12} className="text-amber-300" />}
                    {(r.state === 'empty' || r.state === 'error') && <X size={12} className="text-gray-500" />}
                    {r.state === 'pending' && (
                      <span className="inline-block h-3 w-3 rounded-full border border-edge" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-gray-300" title={r.url}>
                    {r.label}
                  </span>
                  {r.state === 'empty' && <span className="text-[10px] text-gray-600">none</span>}
                </div>
              ))}
            </div>
            <div className="mt-auto border-t border-edge p-2 text-[10px] leading-relaxed text-gray-500">
              {phase === 'running'
                ? 'Auto-harvesting your searches — paced and sequential.'
                : 'Auto pass done. Not enough? Type a Glassdoor search below, browse it, and Capture.'}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center gap-2 border-b border-edge bg-panel px-2 py-1.5">
              <input
                className="input flex-1 font-mono text-[11px]"
                placeholder="Drive it yourself: paste a Glassdoor search URL, Enter to go"
                value={manualUrl}
                onChange={(e) => setManualUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && navigate()}
              />
              <button className="btn px-2 py-1 text-[11px]" onClick={navigate}>
                Go
              </button>
              <button
                className="btn btn-primary px-2 py-1 text-[11px]"
                disabled={capturing}
                title="Capture the jobs on the page currently shown"
                onClick={() => void captureCurrent()}
              >
                {capturing ? 'Capturing…' : 'Capture page'}
              </button>
            </div>
            <div className="relative min-h-0 flex-1 bg-white">
              <webview
                ref={webviewRef as React.RefObject<HTMLElement>}
                src="https://www.glassdoor.com/Job/index.htm"
                partition="persist:apply"
                allowpopups={'true' as unknown as boolean}
                className="h-full w-full"
                style={{ display: 'flex', height: '100%', width: '100%' }}
              />
              {phase === 'challenge' && (
                <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 border-t border-edge bg-panel px-4 py-2.5">
                  <AlertTriangle size={14} className="shrink-0 text-amber-300" />
                  <span className="min-w-0 flex-1 text-xs text-amber-200">
                    Glassdoor wants a human check (or a login) — do it in the view above, then Resume.
                  </span>
                  <button className="btn btn-primary shrink-0" onClick={() => resumeRef.current?.()}>
                    Resume
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {busy && (
          <div className="border-t border-edge px-4 py-1.5 text-[10px] text-gray-600">
            Paced and sequential by design — this takes a moment per search.
          </div>
        )}
      </div>
    </div>
  )
}

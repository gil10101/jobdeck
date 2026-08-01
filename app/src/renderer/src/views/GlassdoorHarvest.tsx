import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, Loader2, X } from 'lucide-react'
import type { WebviewElement } from '../types.d'
import { call } from '../api'

// Drives the in-app browser (the user's real, logged-in Glassdoor session) over
// their target searches and captures the raw job JSON off each loaded page —
// the only safe way to reach Glassdoor (a real session clears its bot check;
// a headless/replayed scraper gets blocked and risks the account). Runs BEFORE
// a scout so the harvested feed is fresh. The user watches it and solves any
// Cloudflare check inline. Normalization happens main-side (tested parser); the
// renderer just hands over whatever page state it found.

const MAX_SEARCHES = 8
const SETTLE_MS = 2200
const PACE_MS = 2500

// Grabs Glassdoor's embedded app state (Apollo cache / __NEXT_DATA__ / json
// scripts mentioning a job listing) and reports a Cloudflare challenge. Kept as
// a string so it survives executeJavaScript's structured-clone boundary. This
// is the one piece that may need adjusting when Glassdoor moves its data.
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
  count: number
}

function searchLabel(url: string): string {
  try {
    const kw = new URL(url).searchParams.get('sc.keyword')
    return kw || new URL(url).pathname
  } catch {
    return url
  }
}

/** Harvest overlay. Runs to completion then calls onDone(count); the caller
 *  (the scout trigger) launches the scout afterward. onSkip continues to scout
 *  without a harvest; onCancel aborts the whole thing. */
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
  const startedRef = useRef(false)
  const resumeRef = useRef<(() => void) | null>(null)
  const targets = searches.slice(0, MAX_SEARCHES)
  const [rows, setRows] = useState<Row[]>(
    targets.map((u) => ({ url: u, label: searchLabel(u), state: 'pending', count: 0 }))
  )
  const [phase, setPhase] = useState<'running' | 'challenge' | 'writing' | 'done'>('running')
  const [captured, setCaptured] = useState(0)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    let cancelled = false

    const wv = webviewRef.current
    if (!wv) return

    const setRow = (i: number, patch: Partial<Row>): void =>
      setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))

    const waitLoad = (): Promise<void> =>
      new Promise((resolve) => {
        const done = (): void => {
          wv.removeEventListener('did-stop-loading', done)
          resolve()
        }
        wv.addEventListener('did-stop-loading', done)
      })

    const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

    const extract = async (): Promise<{ status: string; payloads?: unknown[] }> => {
      try {
        const raw = (await wv.executeJavaScript(EXTRACTOR)) as string
        return JSON.parse(raw)
      } catch {
        return { status: 'error' }
      }
    }

    // The <webview> needs a tick to attach before loadURL is safe.
    const waitReady = (): Promise<void> =>
      new Promise((resolve) => {
        let settled = false
        const done = (): void => {
          if (settled) return
          settled = true
          wv.removeEventListener('dom-ready', done)
          resolve()
        }
        wv.addEventListener('dom-ready', done)
        setTimeout(done, 3000)
      })

    const run = async (): Promise<void> => {
      await waitReady()
      if (cancelled) return
      const payloads: unknown[] = []
      for (let i = 0; i < targets.length; i++) {
        if (cancelled) return
        setRow(i, { state: 'loading' })
        try {
          await wv.loadURL(targets[i])
        } catch {
          /* navigation errors surface as an empty/failed extract below */
        }
        await waitLoad()
        await sleep(SETTLE_MS)
        if (cancelled) return

        let result = await extract()
        // Cloudflare: pause and let the user solve it in the visible view.
        if (result.status === 'challenge') {
          setRow(i, { state: 'challenge' })
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
          payloads.push(...result.payloads)
          // A rough per-search count for the UI (the real dedupe is main-side).
          const before = payloads.length
          setRow(i, { state: 'done', count: before })
        } else {
          setRow(i, { state: result.status === 'error' ? 'error' : 'empty' })
        }
        if (i < targets.length - 1) await sleep(PACE_MS)
      }

      if (cancelled) return
      setPhase('writing')
      try {
        const res = await call('glassdoor:writeFeed', { searches: targets, payloads })
        setCaptured(res.count)
      } catch {
        setCaptured(0)
      }
      setPhase('done')
    }

    void run()
    return () => {
      cancelled = true
      resumeRef.current?.()
    }
  }, [targets])

  const busy = phase === 'running' || phase === 'writing'

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-6">
      <div className="flex h-[80vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-edge bg-panel shadow-2xl">
        <div className="flex items-center gap-2 border-b border-edge px-4 py-2.5">
          <span className="text-sm font-semibold text-gray-100">Harvesting Glassdoor</span>
          <span className="text-[11px] text-gray-500">
            your logged-in session — nothing is sent, jobs feed the scout
          </span>
          {phase === 'done' ? (
            <button className="btn btn-primary ml-auto" onClick={() => onDone(captured)}>
              Scout {captured} jobs
            </button>
          ) : (
            <button className="btn ml-auto" title="Skip Glassdoor, scout the other boards" onClick={onSkip}>
              Skip
            </button>
          )}
          <button className="p-1 text-gray-500 hover:text-gray-300" title="Cancel" onClick={onCancel}>
            <X size={14} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="w-72 shrink-0 overflow-auto border-r border-edge p-2">
            {rows.map((r, i) => (
              <div key={i} className="flex items-center gap-2 px-2 py-1.5 text-xs">
                <span className="shrink-0">
                  {r.state === 'loading' && <Loader2 size={12} className="animate-spin text-cyan-300" />}
                  {r.state === 'done' && <Check size={12} className="text-green-300" />}
                  {r.state === 'challenge' && <AlertTriangle size={12} className="text-amber-300" />}
                  {(r.state === 'empty' || r.state === 'error') && <X size={12} className="text-gray-500" />}
                  {r.state === 'pending' && <span className="inline-block h-3 w-3 rounded-full border border-edge" />}
                </span>
                <span className="min-w-0 flex-1 truncate text-gray-300" title={r.url}>
                  {r.label}
                </span>
                {r.state === 'done' && <span className="text-gray-500">{r.count}</span>}
                {r.state === 'empty' && <span className="text-[10px] text-gray-600">none</span>}
              </div>
            ))}
            {phase === 'writing' && (
              <div className="mt-2 px-2 text-[11px] text-gray-500">Writing feed…</div>
            )}
            {phase === 'done' && (
              <div className="mt-2 px-2 text-[11px] text-green-300">Captured {captured} jobs. Ready to scout.</div>
            )}
          </div>

          <div className="relative min-h-0 flex-1 bg-white">
            <webview
              ref={webviewRef as React.RefObject<HTMLElement>}
              src="about:blank"
              partition="persist:apply"
              allowpopups={'true' as unknown as boolean}
              className="h-full w-full"
              style={{ display: 'flex', height: '100%', width: '100%' }}
            />
            {phase === 'challenge' && (
              <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 border-t border-edge bg-panel px-4 py-2.5">
                <AlertTriangle size={14} className="shrink-0 text-amber-300" />
                <span className="min-w-0 flex-1 text-xs text-amber-200">
                  Glassdoor wants a quick human check — solve it in the view above, then Resume.
                </span>
                <button className="btn btn-primary shrink-0" onClick={() => resumeRef.current?.()}>
                  Resume
                </button>
              </div>
            )}
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

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
    // Collect id -> jobLink so the detail API can be called with the same
    // queryString the frontend sends. Two sources: (1) embedded payloads (older
    // server-rendered pages), (2) the rendered result-card anchors — Glassdoor's
    // current search page is a client-side SPA that embeds NO job JSON, so the
    // DOM links are the only ids there, and the detail API returns 400 without a
    // queryString, so the href is REQUIRED (verified against the live site).
    var links = {};
    var setLink = function(id, link){
      if (!/^[0-9]{6,}$/.test(String(id))) return;
      id = String(id);
      if (!(id in links) || (link && !links[id])) links[id] = String(link || '');
    };
    (function collect(n,d){
      if (!n || typeof n !== 'object' || d > 8) return;
      var lid = n.jobListingId != null ? n.jobListingId : n.listingId;
      if (lid != null) setLink(lid, n.jobLink || (n.header && n.header.jobLink) || n.serpUrlForJobListing || '');
      for (var k in n) { try { collect(n[k], d+1); } catch(e){} }
    })(out, 0);
    try {
      var anchors = document.querySelectorAll('a[href*="jobListingId="], a[href*="jl="], a[href*="/job-listing/"]');
      for (var a=0; a<anchors.length; a++){
        var h = anchors[a].getAttribute('href') || '';
        var m = h.match(/[?&](?:jobListingId|jl)=([0-9]{6,})/) || h.match(/JV[^"']*?jl=([0-9]{6,})/);
        if (m) setLink(m[1], h);
      }
    } catch(e){}
    var idCount = 0; for (var kk in links) idCount++;
    return JSON.stringify({ status: (out.length || idCount) ? 'ok' : 'empty', payloads: out, links: links });
  } catch(e) { return JSON.stringify({ status: 'error', message: String(e) }); }
})()`

// Fetch one job's full detail JSON from the SAME origin the logged-in session is
// on — Glassdoor's own frontend uses this endpoint, so replaying it in-page
// inherits the cleared session and returns the denormalized posting (with the
// description the search rows lack). Params mirror the real request the browser
// makes (no CSRF header — it is a plain cookie'd GET): jobListingId, the job's
// jobLink as queryString, pageTypeEnum, countryId.
function detailFetchJs(id: string, jobLink: string): string {
  const qs = jobLink ? `&queryString=${encodeURIComponent(jobLink)}` : ''
  const url = `/job-listing/api/job-details?jobListingId=${id}&pageTypeEnum=SERP${qs}&countryId=1`
  return `(async function(){
    try {
      var r = await fetch(${JSON.stringify(url)}, { credentials: 'include' });
      if (!r.ok) return JSON.stringify({ ok: false });
      var j = await r.json();
      return JSON.stringify({ ok: true, data: j });
    } catch(e) { return JSON.stringify({ ok: false }); }
  })()`
}

const ENRICH_CAP = 60
const ENRICH_PACE_MS = 500

type SearchState = 'pending' | 'loading' | 'done' | 'empty' | 'challenge' | 'error'

interface Row {
  url: string
  label: string
  state: SearchState
}

function titleCase(s: string): string {
  return s
    .replace(/-/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Human label for a Glassdoor search URL: "Role · Location" from a SRCH URL's
 *  slug offsets, the keyword from an ?sc.keyword= URL, else the location alone. */
function searchLabel(url: string): string {
  try {
    const u = new URL(url)
    const kw = u.searchParams.get('sc.keyword')
    if (kw) return titleCase(kw)
    const m = u.pathname.match(/\/Job\/(.+?)-SRCH_IL\.(\d+),(\d+)(?:_IC\d+)?(?:_KO(\d+),(\d+))?/)
    if (m) {
      const slug = m[1]
      const loc = titleCase(slug.slice(Number(m[2]), Number(m[3])))
      const role = m[4] ? titleCase(slug.slice(Number(m[4]), Number(m[5]))) : ''
      return role ? `${role} · ${loc}` : loc
    }
    return u.pathname
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
  const [phase, setPhase] = useState<'running' | 'challenge' | 'enriching' | 'idle' | 'writing'>(
    'running'
  )
  const [captured, setCaptured] = useState(0)
  const [enrich, setEnrich] = useState({ done: 0, total: 0 })
  const [manualUrl, setManualUrl] = useState('')
  const [capturing, setCapturing] = useState(false)

  const extract = async (): Promise<{
    status: string
    payloads?: unknown[]
    links?: Record<string, string>
  }> => {
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

    const linkById = new Map<string, string>()
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
        // The current search page is a client-side SPA — result cards render a
        // beat after load, so an empty first pass gets one retry.
        if (result.status === 'empty') {
          await sleep(2500)
          result = await extract()
        }
        if (result.status === 'ok') {
          // Embedded payloads (older pages) feed rows directly; DOM-scraped ids
          // (SPA pages) feed rows via the enrichment pass below.
          if (result.payloads?.length) addPayloads(result.payloads)
          for (const [id, link] of Object.entries(result.links ?? {})) {
            if (!linkById.has(id) || (link && !linkById.get(id))) linkById.set(id, link)
          }
          setRow(i, 'done')
        } else {
          setRow(i, result.status === 'error' ? 'error' : 'empty')
        }
        if (i < targets.length - 1) await sleep(PACE_MS)
      }
      // Enrich: pull each listing's full detail JSON (with the description the
      // search rows lack) from the same-origin API the logged-in session can
      // reach. Best-effort and capped; failures just leave that row metadata-only.
      const ids = [...linkById.keys()].slice(0, ENRICH_CAP)
      if (ids.length && !cancelled) {
        setPhase('enriching')
        setEnrich({ done: 0, total: ids.length })
        for (let j = 0; j < ids.length && !cancelled; j++) {
          try {
            const js = detailFetchJs(ids[j], linkById.get(ids[j]) ?? '')
            const res = JSON.parse((await wv.executeJavaScript(js)) as string)
            if (res.ok && res.data) addPayloads([res.data])
          } catch {
            /* skip this one */
          }
          setEnrich({ done: j + 1, total: ids.length })
          await sleep(ENRICH_PACE_MS)
        }
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

  const busy = phase === 'running' || phase === 'writing' || phase === 'enriching'

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
                : phase === 'enriching'
                  ? `Reading full postings for descriptions… ${enrich.done}/${enrich.total}`
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
                // about:blank loads instantly; the run loop drives it to the
                // first search — starting on a real URL just gets aborted
                // mid-load (the harmless GUEST_VIEW_MANAGER -3 in the console).
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

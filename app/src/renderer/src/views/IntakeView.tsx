import { useState } from 'react'
import type { IntakeItem } from '@shared/types'
import { localFileUrl } from '@shared/ipc'
import { call } from '../api'
import { useApp } from '../store'

interface PastedImage {
  dataUrl: string
  base64: string
}

function readImagesFromClipboard(e: React.ClipboardEvent): Promise<PastedImage[]> {
  const files: File[] = []
  for (const item of Array.from(e.clipboardData.items)) {
    if (item.type.startsWith('image/')) {
      const f = item.getAsFile()
      if (f) files.push(f)
    }
  }
  return Promise.all(
    files.map(
      (f) =>
        new Promise<PastedImage>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => {
            const dataUrl = String(reader.result)
            resolve({ dataUrl, base64: dataUrl.split(',', 2)[1] ?? '' })
          }
          reader.onerror = () => reject(reader.error)
          reader.readAsDataURL(f)
        })
    )
  )
}

const STATE_STYLE: Record<IntakeItem['state'], string> = {
  new: 'text-yellow-300 border-yellow-800 bg-yellow-950/40',
  building: 'text-cyan-300 border-cyan-800 bg-cyan-950/40',
  built: 'text-green-300 border-green-800 bg-green-950/40',
  failed: 'text-red-300 border-red-900 bg-red-950/40',
  dismissed: 'text-gray-500 border-edge bg-panel2'
}

function IntakeCard({ item }: { item: IntakeItem }): JSX.Element {
  const [company, setCompany] = useState(item.companyHint)
  const [role, setRole] = useState(item.roleHint)
  const toast = useApp((s) => s.toast)
  const navigate = useApp((s) => s.navigate)

  const build = async (): Promise<void> => {
    try {
      const meta = await call('runs:start', {
        intakeId: item.id,
        postingText: item.postingText,
        applyUrl: item.applyUrl ?? undefined,
        companyHint: company,
        roleHint: role
      })
      toast(`Build queued: ${meta.slug}`)
      navigate({ view: 'runs', runId: meta.id })
    } catch (err) {
      toast(`Failed to start build: ${String(err)}`, 'error')
    }
  }

  const dismiss = async (): Promise<void> => {
    await call('intake:dismiss', { id: item.id }).catch(() => undefined)
    void useApp.getState().refreshIntake()
  }

  return (
    <div className="panel p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-gray-100">{item.title}</span>
            <span className={`chip ${STATE_STYLE[item.state]}`}>{item.state}</span>
            {item.kind === 'todo-file' && <span className="chip">TODO file</span>}
          </div>
          {item.applyUrl && (
            <div className="mt-1 truncate text-[11px] text-cyan-500">{item.applyUrl}</div>
          )}
          {item.imagePaths.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {item.imagePaths.map((p) => (
                <img
                  key={p}
                  src={localFileUrl(p)}
                  className="h-20 rounded border border-edge object-cover"
                  alt="posting screenshot"
                />
              ))}
            </div>
          )}
          {item.postingText.trim() && (
            <div className="mt-1.5 line-clamp-3 whitespace-pre-wrap text-[11px] leading-relaxed text-gray-500">
              {item.postingText.slice(0, 400)}
            </div>
          )}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <input
          className="input flex-1"
          placeholder="Company"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
        />
        <input
          className="input flex-1"
          placeholder="Role title"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        />
        {item.state === 'new' || item.state === 'failed' ? (
          <button className="btn btn-primary shrink-0" onClick={build}>
            ▶ Build
          </button>
        ) : item.runId ? (
          <button
            className="btn shrink-0"
            onClick={() => useApp.getState().navigate({ view: 'runs', runId: item.runId! })}
          >
            View run
          </button>
        ) : null}
        <button className="btn shrink-0 text-gray-500" onClick={dismiss}>
          Dismiss
        </button>
      </div>
    </div>
  )
}

export default function IntakeView(): JSX.Element {
  const intake = useApp((s) => s.intake)
  const toast = useApp((s) => s.toast)
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [company, setCompany] = useState('')
  const [role, setRole] = useState('')
  const [images, setImages] = useState<PastedImage[]>([])

  const todoItems = intake.filter((i) => i.kind === 'todo-file' && i.state !== 'dismissed')
  const pastedItems = intake.filter((i) => i.kind === 'pasted' && i.state !== 'dismissed')

  const onPaste = async (e: React.ClipboardEvent): Promise<void> => {
    const pasted = await readImagesFromClipboard(e)
    if (pasted.length) {
      setImages((prev) => [...prev, ...pasted])
      toast(`${pasted.length} screenshot${pasted.length > 1 ? 's' : ''} attached`)
    }
  }

  const addPasted = async (): Promise<void> => {
    if (!text.trim() && images.length === 0) {
      toast('Paste the job posting text or a screenshot first', 'error')
      return
    }
    try {
      await call('intake:addPasted', {
        text,
        url: url || undefined,
        company,
        role,
        imagesBase64: images.length ? images.map((i) => i.base64) : undefined
      })
    } catch (err) {
      toast(String(err), 'error')
      return
    }
    setText('')
    setUrl('')
    setCompany('')
    setRole('')
    setImages([])
    void useApp.getState().refreshIntake()
    toast('Added to intake')
  }

  const rescan = async (): Promise<void> => {
    await call('todo:rescan', undefined)
    void useApp.getState().refreshIntake()
  }

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="flex items-center gap-2 border-b border-edge bg-panel px-4 py-2.5">
        <h1 className="text-sm font-semibold text-gray-100">Intake</h1>
        <span className="text-[11px] text-muted">
          drop .txt files into documents/applications/TODO/ or paste below
        </span>
        <button className="btn ml-auto" onClick={rescan}>
          ⟳ Rescan TODO
        </button>
      </div>

      <div className="grid flex-1 grid-cols-2 gap-4 overflow-auto p-4">
        <div className="flex flex-col gap-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">
            TODO folder ({todoItems.length})
          </div>
          {todoItems.length === 0 && (
            <div className="panel p-6 text-center text-xs text-gray-600">
              No pending files. Drop a job posting .txt into documents/applications/TODO/ and it
              appears here automatically.
            </div>
          )}
          {todoItems.map((item) => (
            <IntakeCard key={item.id} item={item} />
          ))}

          <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Pasted ({pastedItems.length})
          </div>
          {pastedItems.map((item) => (
            <IntakeCard key={item.id} item={item} />
          ))}
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">
            Paste a posting
          </div>
          <div className="panel flex flex-col gap-2 p-3">
            <textarea
              className="input min-h-[280px] w-full resize-y font-mono text-[11px] leading-relaxed"
              placeholder="Paste the full job posting text here — or paste screenshot(s) of the posting (Ctrl+V works for both)…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={(e) => void onPaste(e)}
            />
            {images.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {images.map((img, i) => (
                  <div key={i} className="group relative">
                    <img
                      src={img.dataUrl}
                      className="h-24 rounded border border-edge object-cover"
                      alt={`screenshot ${i + 1}`}
                    />
                    <button
                      className="absolute -right-1.5 -top-1.5 hidden h-5 w-5 items-center justify-center rounded-full border border-red-600 bg-red-950 text-[10px] text-red-300 group-hover:flex"
                      title="Remove screenshot"
                      onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            <input
              className="input"
              placeholder="Apply URL (optional)"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <div className="flex gap-2">
              <input
                className="input flex-1"
                placeholder="Company"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              />
              <input
                className="input flex-1"
                placeholder="Role title"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              />
            </div>
            <button className="btn btn-primary self-start" onClick={addPasted}>
              + Add to intake
            </button>
          </div>
          <div className="text-[11px] leading-relaxed text-gray-600">
            Building an application spawns a Claude agent that tailors the résumé and cover letter,
            compiles both to exactly one page, writes the answers file, and adds a tracker row.
            Everything lands in documents/applications/&lt;slug&gt;/ exactly like the manual
            workflow.
          </div>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import type { LibraryCategory, LibraryFile } from '@shared/types'
import { localFileUrl } from '@shared/ipc'
import { FolderIcon } from '../components/icons'
import { call } from '../api'
import { useApp } from '../store'

const KIND_BADGE: Record<LibraryFile['kind'], string> = {
  pdf: 'PDF',
  image: 'IMG',
  text: 'TXT',
  other: '···'
}

function Preview({ file }: { file: LibraryFile | null }): JSX.Element {
  const toast = useApp((s) => s.toast)
  const [text, setText] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setText(null)
    setError(null)
    setTruncated(false)
    if (file?.kind === 'text') {
      call('library:read', { relPath: file.relPath })
        .then((res) => {
          setText(res.content)
          setTruncated(res.truncated)
        })
        .catch((err) => setError(String(err)))
    }
  }, [file?.relPath])

  if (!file) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-600">
        Select a file to preview it
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-edge bg-panel px-3 py-2">
        <span className="chip">{KIND_BADGE[file.kind]}</span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-gray-200" title={file.relPath}>
          {file.relPath}
        </span>
        <span className="text-[10px] text-gray-600">{file.sizeKb} KB</span>
        <button
          className="btn px-2 py-0.5 text-[10px]"
          title="Copy absolute path"
          onClick={() =>
            void call('app:absPath', { relPath: file.relPath })
              .then(({ absPath }) => call('app:copy', { text: absPath }))
              .catch((err) => toast(String(err), 'error'))
          }
        >
          Copy path
        </button>
        <button
          className="btn px-2 py-0.5 text-[10px]"
          title="Reveal in Explorer"
          onClick={() =>
            void call('app:showItem', { relPath: file.relPath }).catch((err) =>
              toast(String(err), 'error')
            )
          }
        >
          <FolderIcon size={11} />
        </button>
      </div>
      <div className="min-h-0 flex-1 bg-panel2">
        {file.kind === 'pdf' && (
          <iframe
            key={file.relPath}
            src={localFileUrl(file.relPath)}
            className="h-full w-full border-0"
            title={file.name}
          />
        )}
        {file.kind === 'image' && (
          <div className="flex h-full items-center justify-center overflow-auto bg-bg p-4">
            <img
              src={localFileUrl(file.relPath)}
              alt={file.name}
              className="max-h-full max-w-full rounded border border-edge"
            />
          </div>
        )}
        {file.kind === 'text' && (
          <div className="h-full overflow-auto bg-bg p-4">
            {error ? (
              <div className="text-xs text-red-300">{error}</div>
            ) : text === null ? (
              <div className="text-xs text-gray-600">Loading…</div>
            ) : (
              <>
                {truncated && (
                  <div className="mb-2 text-[10px] text-amber-300">
                    (large file — showing the first 400 KB)
                  </div>
                )}
                <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-gray-300">
                  {text}
                </pre>
              </>
            )}
          </div>
        )}
        {file.kind === 'other' && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-gray-600">
            No in-app preview for this file type.
            <button
              className="btn"
              onClick={() =>
                void call('app:showItem', { relPath: file.relPath }).catch((err) =>
                  toast(String(err), 'error')
                )
              }
            >
              <FolderIcon /> Reveal in Explorer
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function LibraryView(): JSX.Element {
  const [categories, setCategories] = useState<LibraryCategory[]>([])
  const [selected, setSelected] = useState<LibraryFile | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toast = useApp((s) => s.toast)

  const load = (): void => {
    call('library:list', undefined)
      .then((cats) => {
        setCategories(cats)
        // Default selection: the master résumé PDF if present.
        if (!selected) {
          const master = cats
            .flatMap((c) => c.files)
            .find((f) => f.relPath.startsWith('cv/') && f.kind === 'pdf')
          if (master) setSelected(master)
        }
      })
      .catch((err) => toast(String(err), 'error'))
  }
  useEffect(load, [])

  const toggle = (title: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(title)) next.delete(title)
      else next.add(title)
      return next
    })
  }

  return (
    <div className="flex h-full">
      <div className="flex w-72 shrink-0 flex-col border-r border-edge bg-panel">
        <div className="flex items-center gap-1.5 border-b border-edge px-3 py-2.5">
          <h1 className="mr-auto text-sm font-semibold text-gray-100">Library</h1>
          <button
            className="btn btn-primary px-2 py-0.5 text-[10px]"
            title="Add anything: old CVs, résumés, cover letters, certificates, notes — agents use all of it"
            onClick={() =>
              void call('library:upload', undefined)
                .then(({ added }) => {
                  if (added) {
                    toast(`${added} file${added === 1 ? '' : 's'} added`, 'success')
                    load()
                  }
                })
                .catch((err) => toast(String(err), 'error'))
            }
          >
            ⇪ Add files
          </button>
          <button className="btn px-2 py-0.5 text-[10px]" onClick={load} title="Refresh file list">
            ⟳
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto py-1">
          {categories.map((cat) => (
            <div key={cat.title}>
              <button
                className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-muted hover:text-gray-300"
                onClick={() => toggle(cat.title)}
              >
                <span>{collapsed.has(cat.title) ? '▸' : '▾'}</span>
                {cat.title}
                <span className="font-normal text-gray-600">{cat.files.length}</span>
              </button>
              {!collapsed.has(cat.title) &&
                cat.files.map((f) => (
                  <button
                    key={f.relPath}
                    onClick={() => setSelected(f)}
                    className={`flex w-full items-center gap-2 px-4 py-1 text-left text-xs ${
                      selected?.relPath === f.relPath
                        ? 'bg-cyan-950/60 text-cyan-200'
                        : 'text-gray-300 hover:bg-panel2'
                    }`}
                    title={f.relPath}
                  >
                    <span className="w-7 shrink-0 text-[9px] font-bold text-gray-600">
                      {KIND_BADGE[f.kind]}
                    </span>
                    <span className="truncate">{f.name}</span>
                  </button>
                ))}
            </div>
          ))}
          {categories.length === 0 && (
            <div className="px-4 py-8 text-center text-xs text-gray-600">No files found.</div>
          )}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <Preview file={selected} />
      </div>
    </div>
  )
}

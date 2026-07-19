import {
  Bookmark,
  Briefcase,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Clock,
  Flag,
  Folder,
  FolderPlus,
  Globe,
  GraduationCap,
  Heart,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  Star,
  Target,
  Trash2,
  Zap,
  type LucideIcon
} from 'lucide-react'
import { useState } from 'react'
import type { IntakeFolder, IntakeItem } from '@shared/types'
import { localFileUrl } from '@shared/ipc'
import { call } from '../api'
import { useApp, companyKey } from '../store'
import RatingBadge from '../components/RatingBadge'

/** Icons a custom folder can be created with; keys are persisted on the folder. */
const FOLDER_ICONS: Record<string, LucideIcon> = {
  folder: Folder,
  star: Star,
  heart: Heart,
  briefcase: Briefcase,
  building: Building2,
  rocket: Rocket,
  target: Target,
  flag: Flag,
  bookmark: Bookmark,
  zap: Zap,
  gradcap: GraduationCap,
  globe: Globe
}

function folderIcon(name: string): LucideIcon {
  return FOLDER_ICONS[name] ?? Folder
}

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
  const info = useApp((s) => s.companies[companyKey(item.companyHint)])
  const [dragged, setDragged] = useState(false)

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
    <div
      className={`panel cursor-grab p-3 active:cursor-grabbing ${dragged ? 'opacity-40' : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-intake-id', item.id)
        e.dataTransfer.effectAllowed = 'move'
        setDragged(true)
      }}
      onDragEnd={() => setDragged(false)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-gray-100">{item.title}</span>
            <span className={`chip ${STATE_STYLE[item.state]}`}>{item.state}</span>
            {item.kind === 'todo-file' && <span className="chip">TODO file</span>}
            {info && <RatingBadge rating={info.rating} url={info.url} />}
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

/** Collapsible group of intake cards; a drop target when onDropItem is set. */
function FolderSection({
  title,
  Icon,
  items,
  onDropItem,
  onDelete,
  defaultOpen = true
}: {
  title: string
  Icon: LucideIcon
  items: IntakeItem[]
  onDropItem?: (itemId: string) => void
  onDelete?: () => void
  defaultOpen?: boolean
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  const [dragOver, setDragOver] = useState(false)

  const dropProps = onDropItem
    ? {
        onDragOver: (e: React.DragEvent): void => {
          if (e.dataTransfer.types.includes('application/x-intake-id')) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            setDragOver(true)
          }
        },
        onDragLeave: (): void => setDragOver(false),
        onDrop: (e: React.DragEvent): void => {
          e.preventDefault()
          setDragOver(false)
          const id = e.dataTransfer.getData('application/x-intake-id')
          if (id) onDropItem(id)
        }
      }
    : {}

  return (
    <div
      className={`rounded-lg transition-shadow ${dragOver ? 'ring-2 ring-cyan-600' : ''}`}
      {...dropProps}
    >
      <div className="group flex items-center gap-1.5 py-1">
        <button
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted hover:text-gray-300"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <Icon size={13} strokeWidth={1.75} className="shrink-0" />
          <span className="truncate">{title}</span>
          <span className="font-normal normal-case">({items.length})</span>
          {dragOver && <Plus size={12} className="text-cyan-400" />}
        </button>
        {onDelete && (
          <button
            className="invisible p-1 text-gray-500 hover:text-red-400 group-hover:visible"
            onClick={onDelete}
            title="Delete folder (items return to date grouping)"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
      {open && (
        <div className="flex flex-col gap-3 pb-2">
          {items.length === 0 && (
            <div
              className={`rounded-md border border-dashed border-edge p-3 text-center text-[11px] ${
                dragOver ? 'text-cyan-300' : 'text-gray-600'
              }`}
            >
              drag postings here
            </div>
          )}
          {items.map((item) => (
            <IntakeCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function IntakeView(): JSX.Element {
  const intake = useApp((s) => s.intake)
  const intakeFolders = useApp((s) => s.intakeFolders)
  const toast = useApp((s) => s.toast)
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [company, setCompany] = useState('')
  const [role, setRole] = useState('')
  const [images, setImages] = useState<PastedImage[]>([])

  const visible = intake.filter((i) => i.state !== 'dismissed')
  const DAY_MS = 24 * 60 * 60 * 1000
  const now = Date.now()
  const unfoldered = visible.filter((i) => !i.folderId)
  const recents = unfoldered.filter((i) => now - new Date(i.createdAt).getTime() < DAY_MS)
  // Older unfoldered items group by calendar day, newest day first.
  const byDay = new Map<string, IntakeItem[]>()
  for (const item of unfoldered) {
    if (now - new Date(item.createdAt).getTime() < DAY_MS) continue
    const label = new Date(item.createdAt).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
    byDay.set(label, [...(byDay.get(label) ?? []), item])
  }
  const dayGroups = [...byDay.entries()].sort(
    (a, b) => new Date(b[1][0].createdAt).getTime() - new Date(a[1][0].createdAt).getTime()
  )
  const pendingCount = visible.filter((i) => i.state === 'new').length

  const moveToFolder = async (itemId: string, folderId: string | null): Promise<void> => {
    try {
      await call('intake:moveToFolder', { id: itemId, folderId })
      void useApp.getState().refreshIntake()
    } catch (err) {
      toast(String(err), 'error')
    }
  }

  const deleteFolder = async (folder: IntakeFolder): Promise<void> => {
    try {
      await call('intake:deleteFolder', { id: folder.id })
      void useApp.getState().refreshIntake()
      toast(`Folder "${folder.name}" deleted — items back in date grouping`)
    } catch (err) {
      toast(String(err), 'error')
    }
  }

  const [creatingFolder, setCreatingFolder] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [folderIconKey, setFolderIconKey] = useState('folder')
  const createFolder = async (): Promise<void> => {
    if (!folderName.trim()) return
    try {
      await call('intake:createFolder', { name: folderName.trim(), icon: folderIconKey })
      setCreatingFolder(false)
      setFolderName('')
      setFolderIconKey('folder')
      void useApp.getState().refreshIntake()
    } catch (err) {
      toast(String(err), 'error')
    }
  }

  const [buildingAll, setBuildingAll] = useState(false)
  const buildAll = async (): Promise<void> => {
    const pending = visible.filter((i) => i.state === 'new')
    if (!pending.length) return
    setBuildingAll(true)
    let queued = 0
    for (const item of pending) {
      try {
        await call('runs:start', {
          intakeId: item.id,
          postingText: item.postingText,
          applyUrl: item.applyUrl ?? undefined,
          companyHint: item.companyHint,
          roleHint: item.roleHint
        })
        queued++
      } catch (err) {
        toast(`${item.title}: ${String(err)}`, 'error')
      }
    }
    setBuildingAll(false)
    toast(`Queued ${queued} build${queued === 1 ? '' : 's'}`)
    void useApp.getState().refreshIntake()
  }

  const onPaste = async (e: React.ClipboardEvent): Promise<void> => {
    const pasted = await readImagesFromClipboard(e)
    if (pasted.length) {
      setImages((prev) => [...prev, ...pasted])
      toast(`${pasted.length} screenshot${pasted.length > 1 ? 's' : ''} attached`)
    }
  }

  const [fetchUrl, setFetchUrl] = useState('')
  const [fetching, setFetching] = useState(false)
  const addFromUrl = async (): Promise<void> => {
    const u = fetchUrl.trim()
    if (!u) return
    setFetching(true)
    try {
      const item = await call('intake:fromUrl', { url: u })
      setFetchUrl('')
      toast(`Captured: ${item.title}`, 'success')
      void useApp.getState().refreshIntake()
    } catch (err) {
      toast(String(err), 'error')
    } finally {
      setFetching(false)
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
          drop .txt files into applications/TODO/ in your workspace, or paste below
        </span>
        <button
          className="btn btn-primary ml-auto"
          disabled={buildingAll || pendingCount === 0}
          onClick={() => void buildAll()}
          title="Queue a build run for every pending posting"
        >
          <Play size={12} className="mr-1 inline" />
          {buildingAll ? 'Queuing…' : `Build all (${pendingCount})`}
        </button>
        <button className="btn" onClick={() => setCreatingFolder((v) => !v)}>
          <FolderPlus size={12} className="mr-1 inline" />
          New folder
        </button>
        <button className="btn" onClick={rescan} title="Rescan the TODO folder">
          <RefreshCw size={12} />
        </button>
      </div>

      <div className="grid flex-1 grid-cols-2 gap-4 overflow-auto p-4">
        <div className="flex flex-col gap-2">
          {creatingFolder && (
            <div className="panel flex flex-col gap-2 p-3">
              <div className="flex gap-2">
                <input
                  className="input flex-1"
                  placeholder="Folder name"
                  value={folderName}
                  autoFocus
                  onChange={(e) => setFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void createFolder()
                    if (e.key === 'Escape') setCreatingFolder(false)
                  }}
                />
                <button
                  className="btn btn-primary shrink-0"
                  disabled={!folderName.trim()}
                  onClick={() => void createFolder()}
                >
                  Create
                </button>
              </div>
              <div className="flex flex-wrap gap-1">
                {Object.entries(FOLDER_ICONS).map(([key, Icon]) => (
                  <button
                    key={key}
                    className={`flex h-7 w-7 items-center justify-center rounded-md border ${
                      folderIconKey === key
                        ? 'border-cyan-600 bg-cyan-950/50 text-cyan-300'
                        : 'border-edge text-gray-400 hover:bg-panel2'
                    }`}
                    onClick={() => setFolderIconKey(key)}
                    title={key}
                  >
                    <Icon size={14} strokeWidth={1.75} />
                  </button>
                ))}
              </div>
            </div>
          )}

          <FolderSection
            title="Recents"
            Icon={Clock}
            items={recents}
            onDropItem={(id) => void moveToFolder(id, null)}
          />

          {intakeFolders.map((f) => (
            <FolderSection
              key={f.id}
              title={f.name}
              Icon={folderIcon(f.icon)}
              items={visible.filter((i) => i.folderId === f.id)}
              onDropItem={(id) => void moveToFolder(id, f.id)}
              onDelete={() => void deleteFolder(f)}
            />
          ))}

          {dayGroups.map(([label, items]) => (
            <FolderSection
              key={label}
              title={label}
              Icon={CalendarDays}
              items={items}
              onDropItem={(id) => void moveToFolder(id, null)}
              defaultOpen={false}
            />
          ))}

          {visible.length === 0 && (
            <div className="panel p-6 text-center text-xs text-gray-600">
              Nothing in intake. Fetch a posting by URL, paste one, or drop a .txt into
              applications/TODO/ in your workspace.
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">
            Add by URL
          </div>
          <div className="panel flex flex-col gap-1.5 p-3">
            <div className="flex gap-2">
              <input
                className="input flex-1"
                placeholder="https://… job posting link"
                value={fetchUrl}
                onChange={(e) => setFetchUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !fetching) void addFromUrl()
                }}
              />
              <button
                className="btn btn-primary shrink-0"
                disabled={fetching || !fetchUrl.trim()}
                onClick={() => void addFromUrl()}
              >
                {fetching ? 'Fetching…' : 'Fetch'}
              </button>
            </div>
            <div className="text-[10px] leading-relaxed text-gray-600">
              Reads the structured JobPosting data most job pages embed (jobright, LinkedIn,
              Greenhouse, Lever, company sites) — no copy-paste needed. If a page has none,
              paste the text below instead.
            </div>
          </div>

          <div className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted">
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
            Everything lands in applications/&lt;slug&gt;/ inside your workspace.
          </div>
        </div>
      </div>
    </div>
  )
}

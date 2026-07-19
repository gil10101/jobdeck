import {
  FolderOpen,
  Inbox,
  LayoutList,
  Moon,
  Play,
  Search,
  Settings,
  Sun
} from 'lucide-react'
import { useApp } from '../store'

const NAV = [
  { view: 'tracker', label: 'Tracker', Icon: LayoutList },
  { view: 'scout', label: 'Scout', Icon: Search },
  { view: 'intake', label: 'Intake', Icon: Inbox },
  { view: 'runs', label: 'Runs', Icon: Play },
  { view: 'library', label: 'Library', Icon: FolderOpen }
] as const

export default function Sidebar(): JSX.Element {
  const route = useApp((s) => s.route)
  const runs = useApp((s) => s.runs)
  const candidates = useApp((s) => s.candidates)
  const navigate = useApp((s) => s.navigate)
  const theme = useApp((s) => s.settings?.theme ?? 'dark')
  const liveRuns = runs.filter((r) => r.status === 'running' || r.status === 'queued').length
  const newCandidates = candidates.filter((c) => c.state === 'new').length

  return (
    <div className="flex h-full w-44 shrink-0 flex-col border-r border-edge bg-panel">
      <div className="px-4 py-4">
        <div className="text-sm font-bold tracking-wide text-cyan-300">ohmo</div>
      </div>
      <nav className="flex flex-col gap-1 px-2">
        {NAV.map((item) => {
          const active = route.view === item.view
          return (
            <button
              key={item.view}
              onClick={() => navigate({ view: item.view } as never)}
              className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-left text-xs font-medium transition-colors ${
                active
                  ? 'bg-cyan-950/60 text-cyan-200'
                  : 'text-gray-400 hover:bg-panel2 hover:text-gray-200'
              }`}
            >
              <item.Icon size={15} strokeWidth={1.75} className="shrink-0" />
              {item.label}
              {item.view === 'runs' && liveRuns > 0 && (
                <span className="ml-auto flex items-center gap-1 rounded-full bg-cyan-900/70 px-1.5 py-0.5 text-[10px] text-cyan-200">
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
                  {liveRuns}
                </span>
              )}
              {item.view === 'scout' && newCandidates > 0 && (
                <span className="ml-auto rounded-full bg-green-900/70 px-1.5 py-0.5 text-[10px] text-green-300">
                  {newCandidates}
                </span>
              )}
            </button>
          )
        })}
      </nav>
      <div className="mt-auto flex flex-col gap-1 px-2 py-3">
        <button
          onClick={() => navigate({ view: 'settings' })}
          className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-left text-xs font-medium transition-colors ${
            route.view === 'settings'
              ? 'bg-cyan-950/60 text-cyan-200'
              : 'text-gray-400 hover:bg-panel2 hover:text-gray-200'
          }`}
        >
          <Settings size={15} strokeWidth={1.75} className="shrink-0" />
          Settings
        </button>
        <button
          className="btn justify-center"
          onClick={() => void useApp.getState().toggleTheme()}
          title="Toggle light/dark theme"
        >
          {theme === 'light' ? <Moon size={13} /> : <Sun size={13} />}
          {theme === 'light' ? 'Dark' : 'Light'}
        </button>
      </div>
    </div>
  )
}

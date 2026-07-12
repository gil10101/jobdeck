import Sidebar from './components/Sidebar'
import ToastHost from './components/Toast'
import ApplyView from './views/ApplyView'
import DetailView from './views/DetailView'
import FirstRunView from './views/FirstRunView'
import IntakeView from './views/IntakeView'
import LibraryView from './views/LibraryView'
import RunsView from './views/RunsView'
import SettingsView from './views/SettingsView'
import ScoutView from './views/ScoutView'
import TrackerView from './views/TrackerView'
import { useApp } from './store'

export default function App(): JSX.Element {
  const route = useApp((s) => s.route)
  const config = useApp((s) => s.config)

  // First-run gate: no workspace chosen yet → setup takes the whole window.
  if (config && !config.workspacePath) {
    return (
      <div className="h-full">
        <FirstRunView />
        <ToastHost />
      </div>
    )
  }

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-hidden">
        {route.view === 'tracker' && <TrackerView />}
        {route.view === 'scout' && <ScoutView />}
        {route.view === 'intake' && <IntakeView />}
        {route.view === 'runs' && <RunsView runId={route.runId} />}
        {route.view === 'library' && <LibraryView />}
        {route.view === 'settings' && <SettingsView />}
        {route.view === 'detail' && <DetailView rowId={route.rowId} />}
        {route.view === 'apply' && <ApplyView rowId={route.rowId} />}
      </main>
      <ToastHost />
    </div>
  )
}

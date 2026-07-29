import { useRef } from 'react'
import Sidebar from './components/Sidebar'
import ToastHost from './components/Toast'
import ApplyView from './views/ApplyView'
import AssistantFab from './views/assistant/AssistantFab'
import BrowserView from './views/BrowserView'
import EmailView from './views/EmailView'
import HistoryView from './views/HistoryView'
import DetailView from './views/DetailView'
import OnboardingWizard from './views/onboarding/OnboardingWizard'
import IntakeView from './views/IntakeView'
import LibraryView from './views/LibraryView'
import RunsView from './views/RunsView'
import SettingsView from './views/SettingsView'
import ScoutView from './views/ScoutView'
import TrackerView from './views/TrackerView'
import WhoAmIView from './views/WhoAmIView'
import { useApp } from './store'

export default function App(): JSX.Element {
  const route = useApp((s) => s.route)
  const config = useApp((s) => s.config)
  // The browser stays mounted once visited: unmounting destroys its webview
  // guests, and with them per-tab navigation history and page state.
  const browserVisited = useRef(false)
  if (route.view === 'browser') browserVisited.current = true

  // First-run gate: setup wizard until a workspace exists AND onboarding finished.
  if (config && (!config.workspacePath || !config.onboardedAt)) {
    return (
      <div className="h-full">
        <OnboardingWizard />
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
        {route.view === 'history' && <HistoryView />}
        {browserVisited.current && (
          <div className={route.view === 'browser' ? 'h-full' : 'hidden'}>
            <BrowserView />
          </div>
        )}
        {route.view === 'email' && <EmailView />}
        {route.view === 'runs' && <RunsView runId={route.runId} />}
        {route.view === 'library' && <LibraryView />}
        {route.view === 'whoami' && <WhoAmIView />}
        {route.view === 'settings' && <SettingsView />}
        {route.view === 'detail' && <DetailView rowId={route.rowId} />}
        {route.view === 'apply' && <ApplyView rowId={route.rowId} />}
      </main>
      <ToastHost />
      <AssistantFab />
    </div>
  )
}

import { useRef } from 'react'
import Sidebar from './components/Sidebar'
import GlassdoorHarvest from './views/GlassdoorHarvest'
import ToastHost from './components/Toast'
import ApplyView from './views/ApplyView'
import AssistantFab from './views/assistant/AssistantFab'
import BrowserView from './views/BrowserView'
import CalendarView from './views/CalendarView'
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
  const configLoadError = useApp((s) => s.configLoadError)
  // The browser stays mounted once visited: unmounting destroys its webview
  // guests, and with them per-tab navigation history and page state.
  const browserVisited = useRef(false)
  if (route.view === 'browser') browserVisited.current = true

  // Nothing to route on until config:get answers: rendering the main UI here
  // would fire workspace calls before main has said a workspace exists.
  if (!config) {
    return (
      <div className="flex h-full items-center justify-center">
        {configLoadError ? (
          <div className="panel w-[460px] p-6 text-xs leading-relaxed text-gray-400">
            <div className="text-sm font-semibold text-red-400">The app could not load its settings</div>
            <p className="mt-2">{configLoadError}</p>
            <button
              className="btn btn-primary mt-4"
              onClick={() => void useApp.getState().hydrate()}
            >
              Retry
            </button>
          </div>
        ) : (
          <span className="text-xs text-gray-500">Loading…</span>
        )}
        <ToastHost />
      </div>
    )
  }

  // First-run gate: setup wizard until a workspace exists AND onboarding finished.
  if (!config.workspacePath || !config.onboardedAt) {
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
        {route.view === 'calendar' && <CalendarView />}
        {route.view === 'runs' && <RunsView runId={route.runId} />}
        {route.view === 'library' && <LibraryView />}
        {route.view === 'whoami' && <WhoAmIView />}
        {route.view === 'settings' && <SettingsView />}
        {route.view === 'detail' && <DetailView rowId={route.rowId} />}
        {route.view === 'apply' && <ApplyView rowId={route.rowId} />}
      </main>
      <ToastHost />
      <AssistantFab />
      <ScoutHarvestHost />
    </div>
  )
}

/** App-level host for the pre-scout Glassdoor harvest, so any scout launch
 *  (Scout button OR History rerun) runs it — driven by store state. */
function ScoutHarvestHost(): JSX.Element | null {
  const harvest = useApp((s) => s.scoutHarvest)
  const clear = useApp((s) => s.clearScoutHarvest)
  const launch = useApp((s) => s.launchScout)
  if (!harvest) return null
  const finish = (): void => {
    const instructions = harvest.instructions
    clear()
    void launch(instructions)
  }
  return (
    <GlassdoorHarvest
      searches={harvest.searches}
      onDone={(count) => {
        if (count > 0) useApp.getState().toast(`Harvested ${count} Glassdoor jobs`, 'success')
        finish()
      }}
      onSkip={finish}
      onCancel={clear}
    />
  )
}

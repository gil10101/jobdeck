import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { onPush } from './api'
import { useApp } from './store'
import './styles.css'

// Push subscriptions (coarse refresh; cheap at this data size).
onPush('push:storeChanged', ({ domains }) => {
  const s = useApp.getState()
  if (domains.includes('rows')) void s.refreshRows()
  if (domains.includes('intake')) void s.refreshIntake()
  if (domains.includes('candidates')) void s.refreshCandidates()
  if (domains.includes('settings')) void s.refreshSettings()
})

onPush('push:runChanged', (meta) => {
  const s = useApp.getState()
  s.upsertRunMeta(meta)
  if (meta.status === 'succeeded') s.toast(`Build finished: ${meta.slug}`, 'success')
  if (meta.status === 'failed') s.toast(`Build FAILED: ${meta.slug} — ${meta.errorText ?? ''}`, 'error')
})

onPush('push:todoNew', (item) => {
  const s = useApp.getState()
  void s.refreshIntake()
  s.toast(`New TODO posting: ${item.title}`)
})

void useApp.getState().hydrate()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

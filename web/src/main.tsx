import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import AppErrorBoundary from './components/AppErrorBoundary'
import './index.css'
import { migrateBrandPreferences } from './lib/brandCompatibility'
migrateBrandPreferences()
// Set this before the lazy whiteboard engine loads. Fonts stay on this origin.
Object.assign(window, { EXCALIDRAW_ASSET_PATH: new URL(import.meta.env.DEV ? '/node_modules/@excalidraw/excalidraw/dist/prod/' : '/assets/excalidraw/', window.location.origin).href })
// configure() MUST run before any other endpoints-module import touches
// localStorage so existing user state under 'vulos.office.endpoints.v1'
// survives (do NOT change the key — that would wipe office users' cached
// endpoints). First-party module — see src/lib/endpoints/index.js.
import { configure } from './lib/endpoints/index.js'
configure({ lsKeyPrefix: 'vulos.office.endpoints.v1', healthPath: '/api/auth/status' })
// OFFICE-11: import/export fidelity round-trip checks (self-executes in dev mode).
// Loaded lazily so the `xlsx` import it pulls in stays OUT of the production
// graph entirely. Dev-only means production never pulls that weight.
if (import.meta.env.DEV) {
  // Dev-only diagnostic; a chunk-load failure here should never break the
  // app, just be visible in the console.
  import('./lib/roundTripCheck.js').catch((err: unknown) => {
    console.warn('[dev] roundTripCheck failed to load:', err)
  })
}
// OFFICE-OFFLINE-01: register the app-shell SW (+ prime cloud↔LAN failover +
// update detection) via the guarded PWA helper. No-op in dev, when embedded in
// the OS hub, or on unsupported browsers — see src/lib/pwa.js.
import { registerServiceWorker } from './lib/pwa.js'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary><BrowserRouter>
      <App />
    </BrowserRouter></AppErrorBoundary>
  </React.StrictMode>
)

registerServiceWorker()

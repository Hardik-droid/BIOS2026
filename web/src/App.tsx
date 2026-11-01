import { lazy, Suspense, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
import LoginScreen from './components/LoginScreen'
import Layout from './components/Layout'
import { LoadingState } from './components/ui'
import Home from './components/Home'
import AppHome from './components/AppHome'
import InstallPrompt from './lib/InstallPrompt'
import SearchCommandPalette from './components/SearchCommandPalette'
import { useTheme } from './components/ui'

// Do not execute every office engine just to show the file list. The offline
// build still bundles and precaches all chunks for later use without internet.
const DocsEditor = lazy(() => import('./apps/docs/DocsEditor'))
const SheetsEditor = lazy(() => import('./apps/sheets/SheetsEditor'))
const SlidesEditor = lazy(() => import('./apps/slides/SlidesEditor'))
const WhiteboardEditor = lazy(() => import('./apps/whiteboard/WhiteboardEditor'))
const PDFEditor = lazy(() => import('./apps/pdf/PDFEditor'))
const SigningSetup = lazy(() => import('./apps/pdf/SigningSetup'))
const Settings = lazy(() => import('./components/Settings'))
const SignView = lazy(() => import('./apps/pdf/SignView'))
const EnvelopeDashboard = lazy(() => import('./components/EnvelopeDashboard'))
const Verify = lazy(() => import('./components/Verify'))
const AnonDocView = lazy(() => import('./components/AnonDocView'))

// Office is documents-only. Chat/video and calendar/contacts are THIRD-PARTY
// (not Vulos products) and are deliberately not launched or redirected to from
// here — Office ships no first-party Talk/Meet/Mail coupling.

// Public routes that bypass Vulos auth entirely.
// External signers and external verifiers have no Vulos account; anonymous
// share-link viewers ("/view/:token") are gated only by the unguessable token.
const PUBLIC_PREFIXES = ['/sign/', '/verify', '/view/']

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))
}

export default function App() {
  useTheme()
  const { status, loading, fetchStatus, fetchIdentity } = useAuthStore()
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => { void fetchStatus() }, [])
  // Resolve "who am I" for share/ownership UI (best-effort, independent of auth
  // gating). Re-runs when the authenticated status flips (e.g. after login).
  useEffect(() => {
    if (status?.authenticated !== false) void fetchIdentity()
  }, [status?.authenticated])

  // ── Protocol handler + deep-link ?goto= param ─────────────────────────────
  useEffect(() => {
    // Register localfirst:// protocol handler (web+ prefix required by browsers).
    // TS's lib.dom types only the current 2-arg spec signature; the trailing
    // title arg is a harmless legacy 3rd param some older engines still read
    // (extra JS call args are simply ignored where unsupported), so widen the
    // call's type locally rather than drop the argument.
    try {
      type RegisterProtocolHandlerLegacy = (scheme: string, url: string, title?: string) => void
      // BUG FIX: registerProtocolHandler is a WebIDL platform-object method —
      // extracting it as a bare reference and calling it unbound throws
      // "TypeError: Illegal invocation" in every browser (the same class of
      // bug as an unbound RTCDataChannel.send elsewhere in this fleet), which
      // this try/catch was silently swallowing as "unsupported browser". The
      // protocol handler registration was therefore never actually
      // succeeding anywhere — .bind(navigator) keeps the receiver so the
      // real call can succeed (or genuinely fail on an unsupporting browser,
      // which is what the catch below is actually for).
      // VERIFIED TOOL DISAGREEMENT: no-unnecessary-type-assertion claims this
      // cast is a no-op, but removing it makes `tsc --noEmit` fail with
      // "Expected 2 arguments, but got 3" on the call below — .bind() keeps
      // registerProtocolHandler's real (spec) 2-arg signature, and this
      // widening is exactly what lets the legacy 3-arg call through.
      // Confirmed by direct removal.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      const registerProtocolHandlerLegacy = navigator.registerProtocolHandler.bind(navigator) as RegisterProtocolHandlerLegacy
      registerProtocolHandlerLegacy('web+localfirst', window.location.origin + '/?goto=%s', 'LocalFirst')
    } catch { /* unsupported browser */ }

    // Handle incoming deep-link ?goto= param
    // e.g. OS rewrites web+localfirst://docs/abc123 → https://app.vulos.org/?goto=docs%2Fabc123
    const params = new URLSearchParams(window.location.search)
    const goto = params.get('goto')
    if (goto) {
      const clean = goto.replace(/^\/+/, '')
      window.history.replaceState({}, '', window.location.pathname) // remove ?goto from URL
      if (clean) void navigate('/' + clean, { replace: true })
    }
  }, []) // eslint-disable-line

  // Render public routes immediately — no auth check, no Layout shell.
  if (isPublicRoute(location.pathname)) {
    return (
      <Suspense fallback={<LoadingState label="Opening document…" />}><Routes>
        <Route path="/sign/:token" element={<SignView />} />
        <Route path="/verify" element={<Verify />} />
        <Route path="/view/:token" element={<AnonDocView />} />
      </Routes></Suspense>
    )
  }

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-bg">
        <LoadingState label="Loading LocalFirst…" />
      </div>
    )
  }

  if (status?.enabled && !status?.authenticated) {
    return <LoginScreen />
  }

  return (
    <Layout>
      <Suspense fallback={<LoadingState label="Opening workspace…" />}><Routes>
        <Route path="/" element={<Home />} />
        <Route path="/docs" element={<AppHome type="doc" />} />
        <Route path="/sheets" element={<AppHome type="sheet" />} />
        <Route path="/slides" element={<AppHome type="slide" />} />
        <Route path="/whiteboards" element={<AppHome type="whiteboard" />} />
        <Route path="/docs/:id" element={<DocsEditor />} />
        <Route path="/sheets/:id" element={<SheetsEditor />} />
        <Route path="/slides/:id" element={<SlidesEditor />} />
        <Route path="/whiteboards/:id" element={<WhiteboardEditor />} />
        <Route path="/pdf" element={<AppHome type="pdf" />} />
        <Route path="/pdf-editor" element={<PDFEditor />} />
        <Route path="/signing-setup" element={<SigningSetup />} />
        <Route path="/envelopes" element={<EnvelopeDashboard />} />
        <Route path="/pdf/:id" element={<PDFEditor />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes></Suspense>
      <InstallPrompt />
      <SearchCommandPalette />
    </Layout>
  )
}

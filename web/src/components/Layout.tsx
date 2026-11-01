/** LocalFirst workspace shell. Navigation changes views; it never copies files. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Bell, Check, ChevronDown, ChevronRight, ChevronsUpDown, Clock3, CloudOff, FileSearch, FileText, FolderOpen, Home, LayoutGrid, LogOut, Menu, PanelLeftClose, PanelLeftOpen, PenTool, Plus, Presentation, Search, Settings as SettingsIcon, Share2, Star, Table2, Trash2, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { useFilesStore } from '../store/filesStore'
import { useNotificationsStore } from '../store/notificationsStore'
import { OFFLINE_ONLY } from '../lib/offline/mode'
import OfflineWorkspaceBar from './OfflineWorkspaceBar'
import NewFileModal from './NewFileModal'
import NotificationsPanel from './NotificationsPanel'
import { Button, IconButton, Input, LocalFirstLogo, Modal, Tooltip, useDialogA11y } from './ui'

type SidebarMode = 'expanded' | 'mini' | 'hidden'
type WorkspaceView = 'home' | 'recent' | 'favorites' | 'all' | 'shared' | 'offline' | 'trash'
const VIEW_LINKS: { view: WorkspaceView; label: string; Icon: LucideIcon }[] = [
  { view: 'home', label: 'Home', Icon: Home },
  { view: 'recent', label: 'Recent', Icon: Clock3 },
  { view: 'favorites', label: 'Favorites', Icon: Star },
  { view: 'all', label: 'My files', Icon: FolderOpen },
  { view: 'shared', label: 'Shared files', Icon: Share2 },
  { view: 'offline', label: 'Offline files', Icon: CloudOff },
  { view: 'trash', label: 'Trash', Icon: Trash2 },
]
const APPS: { label: string; route: string; Icon: LucideIcon; tint: string }[] = [
  { label: 'Documents', route: '/docs', Icon: FileText, tint: 'text-app-docs' },
  { label: 'Spreadsheets', route: '/sheets', Icon: Table2, tint: 'text-app-sheets' },
  { label: 'Presentations', route: '/slides', Icon: Presentation, tint: 'text-app-slides' },
  { label: 'Whiteboards', route: '/whiteboards', Icon: PenTool, tint: 'text-app-board' },
  { label: 'PDF Studio', route: '/pdf', Icon: FileSearch, tint: 'text-app-pdf' },
]
const viewPath = (view: WorkspaceView) => view === 'home' ? '/' : `/?view=${view}`
const openSearch = () => window.dispatchEvent(new CustomEvent('localfirst:open-search'))
function stored(key: string, fallback = ''): string { try { return localStorage.getItem(key) || fallback } catch { return fallback } }
function identityName(): string {
  try { return (JSON.parse(localStorage.getItem('presence_identity') || '{}') as { displayName?: string }).displayName || 'Personal workspace' } catch { return 'Personal workspace' }
}
function initials(name: string): string { return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'LF' }

interface NavigationProps {
  collapsed: boolean
  workspaceName: string
  onRename: () => void
  onNew: () => void
  onNavigate?: (() => void) | undefined
  onCollapse?: (() => void) | undefined
}

function WorkspaceNavigation({ collapsed, workspaceName, onRename, onNew, onNavigate, onCollapse }: NavigationProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const { status, logout } = useAuthStore()
  const files = useFilesStore(state => state.files)
  const { items, fetch: fetchNotifications } = useNotificationsStore()
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => stored('localfirst_notifications_enabled', 'true') !== 'false')
  const priorNotifications = useRef<Set<string> | null>(null)
  const view = new URLSearchParams(location.search).get('view') || 'home'
  const unread = items.filter(item => !item.read).length
  const nav = (destination: string) => { void navigate(destination); onNavigate?.() }
  const row = 'flex items-center gap-3 rounded-lg px-3 min-h-9 text-[13px] font-medium transition-colors duration-fast'
  const quiet = 'text-ink-muted hover:bg-bg-elev2 hover:text-ink'

  useEffect(() => {
    const sync = () => setNotificationsEnabled(stored('localfirst_notifications_enabled', 'true') !== 'false')
    window.addEventListener('localfirst:preferences-changed', sync)
    return () => window.removeEventListener('localfirst:preferences-changed', sync)
  }, [])
  useEffect(() => {
    // The persistent navigation owns polling, including on mobile. The drawer
    // is a second presentation and must never duplicate desktop alerts.
    if (OFFLINE_ONLY || !notificationsEnabled || onNavigate) return
    let live = true
    const refresh = async () => {
      await fetchNotifications()
      if (!live) return
      const current = useNotificationsStore.getState().items
      if (priorNotifications.current && stored('localfirst_desktop_notifications') === 'true' && 'Notification' in window && Notification.permission === 'granted') {
        for (const notification of current.filter(item => !item.read && !priorNotifications.current!.has(item.id))) {
          try {
            const alert = new Notification('LocalFirst', { body: `${notification.actor || 'Someone'} mentioned you${notification.file_name ? ` in ${notification.file_name}` : ''}.`, tag: notification.id, icon: '/icons/icon-192.png' })
            alert.onclick = () => { window.focus(); alert.close(); if (notification.file_id) { const type = useFilesStore.getState().files.find(file => file.id === notification.file_id)?.type; const route: Record<string, string> = { doc: 'docs', sheet: 'sheets', slide: 'slides', whiteboard: 'whiteboards', pdf: 'pdf' }; void navigate(`/${route[type || 'doc'] || 'docs'}/${notification.file_id}`) } }
          } catch { /* The browser may disallow desktop notifications on this platform. */ }
        }
      }
      priorNotifications.current = new Set(current.map(item => item.id))
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 60000)
    return () => { live = false; window.clearInterval(timer) }
  }, [fetchNotifications, notificationsEnabled, onNavigate, navigate])
  useEffect(() => {
    if (!workspaceOpen && !notificationsOpen) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { setWorkspaceOpen(false); setNotificationsOpen(false) } }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [workspaceOpen, notificationsOpen])

  return <>
    <div className={`flex items-center h-[76px] flex-shrink-0 ${collapsed ? 'justify-center px-3' : 'px-5 gap-2.5'}`}>
      <NavLink to="/" onClick={onNavigate} aria-label="LocalFirst home" className="flex items-center gap-2.5 min-w-0">
        <LocalFirstLogo size={33} className="flex-shrink-0" />
        {!collapsed && <span className="text-[21px] font-bold tracking-[-0.055em] text-ink">LocalFirst<span className="text-accent">.</span></span>}
      </NavLink>
      {!collapsed && onCollapse && <IconButton title="Collapse sidebar" aria-label="Collapse sidebar" size="sm" onClick={onCollapse} className="ml-auto"><PanelLeftClose size={16} /></IconButton>}
    </div>
    <div className={`relative flex-shrink-0 ${collapsed ? 'px-3' : 'px-4'}`}>
      <button type="button" onClick={() => setWorkspaceOpen(value => !value)} aria-label="Choose workspace" aria-expanded={workspaceOpen} aria-haspopup="menu" title={workspaceName} className={`flex items-center w-full gap-2.5 rounded-lg border border-line bg-bg/60 py-2.5 text-left ${collapsed ? 'justify-center' : 'px-2.5'}`}>
        <span className="flex items-center justify-center w-7 h-7 flex-shrink-0 rounded-md bg-accent-tint text-accent-press text-xs font-semibold">{initials(workspaceName)}</span>
        {!collapsed && <><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-ink">{workspaceName}</span><span className="block text-[10px] text-ink-faint mt-0.5">{OFFLINE_ONLY ? 'On this device' : 'Personal workspace'}</span></span><ChevronsUpDown size={13} className="text-ink-faint" /></>}
      </button>
      {workspaceOpen && <><button className="fixed inset-0 z-30 cursor-default" tabIndex={-1} aria-label="Close workspace menu" onClick={() => setWorkspaceOpen(false)} /><div role="menu" aria-label="Workspaces" className={`absolute top-full mt-2 p-1.5 z-40 w-56 rounded-xl border border-line bg-paper shadow-e2 ${collapsed ? 'left-3' : 'left-4'}`}>
        <button role="menuitem" onClick={() => setWorkspaceOpen(false)} className="flex items-center w-full gap-2 px-2.5 py-2 text-xs text-ink rounded-md hover:bg-bg-elev2"><LayoutGrid size={14} /><span className="truncate flex-1 text-left">{workspaceName}</span><Check size={14} className="text-accent" /></button>
        <button role="menuitem" onClick={() => { setWorkspaceOpen(false); onRename(); onNavigate?.() }} className="flex items-center w-full gap-2 px-2.5 py-2 text-xs text-ink-muted rounded-md hover:bg-bg-elev2"><SettingsIcon size={14} />Workspace settings</button>
      </div></>}
    </div>
    <div className={`pt-4 flex-shrink-0 ${collapsed ? 'px-3' : 'px-4'}`}>
      <button onClick={() => { onNew(); onNavigate?.() }} title="New file" aria-label="New file" className={`flex items-center gap-2.5 w-full h-10 rounded-lg bg-accent text-white shadow-e1 hover:bg-accent-hover transition-colors text-xs font-semibold ${collapsed ? 'justify-center' : 'px-3'}`}><Plus size={17} />{!collapsed && <><span>New file</span><ChevronDown size={13} className="ml-auto opacity-70" /></>}</button>
    </div>
    <nav aria-label="Workspace" className={`flex-1 min-h-0 overflow-y-auto pt-4 pb-5 ${collapsed ? 'px-3' : 'px-4'}`}>
      <button title="Search (Ctrl+K)" onClick={() => { openSearch(); onNavigate?.() }} className={`${row} ${quiet} w-full ${collapsed ? 'justify-center px-0' : ''}`}><Search size={17} />{!collapsed && <><span>Search</span><kbd className="ml-auto rounded border border-line px-1 py-0.5 text-[9px] font-sans text-ink-faint">Ctrl K</kbd></>}</button>
      <div className="mt-1 space-y-0.5">
        {VIEW_LINKS.map(({ view: key, label, Icon }) => {
          const active = location.pathname === '/' && view === key
          return <button key={key} title={label} aria-current={active ? 'page' : undefined} onClick={() => nav(viewPath(key))} className={`${row} w-full ${collapsed ? 'justify-center px-0' : ''} ${active ? 'bg-accent-tint text-accent-press' : quiet}`}><Icon size={17} strokeWidth={active ? 2 : 1.7} />{!collapsed && <span>{label}</span>}{!collapsed && key === 'trash' && files.some(file => file.trashed) && <span className="ml-auto text-[10px] text-ink-faint">{files.filter(file => file.trashed).length}</span>}</button>
        })}
      </div>
      <div className={`border-t border-line mt-5 pt-4 ${collapsed ? '' : 'space-y-0.5'}`}>
        {!collapsed && <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-faint px-3 mb-2">Create &amp; collaborate</p>}
        {APPS.map(({ label, route, Icon, tint }) => <NavLink key={route} to={route} title={label} onClick={onNavigate} className={({ isActive }) => `${row} ${collapsed ? 'justify-center px-0' : ''} ${isActive ? 'bg-accent-tint text-accent-press' : quiet}`}><Icon size={17} strokeWidth={1.7} className={tint} />{!collapsed && <span>{label}</span>}</NavLink>)}
      </div>
    </nav>
    <div className={`flex-shrink-0 border-t border-line py-3 ${collapsed ? 'px-3' : 'px-4'}`}>
      <div className="relative">
        <button title={OFFLINE_ONLY ? 'Notifications are available in hosted workspaces' : 'Notifications'} disabled={OFFLINE_ONLY || !notificationsEnabled} onClick={() => setNotificationsOpen(value => !value)} aria-expanded={notificationsOpen} className={`${row} ${quiet} w-full disabled:opacity-45 disabled:cursor-not-allowed ${collapsed ? 'justify-center px-0' : ''}`}><Bell size={17} />{!collapsed && <span>Notifications</span>}{!OFFLINE_ONLY && notificationsEnabled && unread > 0 && <span className={`${collapsed ? 'absolute top-0 right-0' : 'ml-auto'} rounded-full bg-accent text-white min-w-4 h-4 px-1 text-[9px] flex items-center justify-center`}>{unread > 9 ? '9+' : unread}</span>}</button>
        {notificationsOpen && <><button className="fixed inset-0 z-40 cursor-default" tabIndex={-1} aria-label="Close notifications" onClick={() => setNotificationsOpen(false)} /><div className="absolute left-0 bottom-full mb-2 z-50"><NotificationsPanel onClose={() => setNotificationsOpen(false)} fileTypeOf={id => files.find(file => file.id === id)?.type} /></div></>}
      </div>
      <NavLink to="/settings" title="Settings" onClick={onNavigate} className={({ isActive }) => `${row} ${collapsed ? 'justify-center px-0' : ''} ${isActive ? 'bg-accent-tint text-accent-press' : quiet}`}><SettingsIcon size={17} />{!collapsed && <span>Settings</span>}</NavLink>
      {status?.enabled && <button title="Sign out" onClick={() => { void logout(); onNavigate?.() }} className={`${row} ${quiet} w-full hover:text-danger ${collapsed ? 'justify-center px-0' : ''}`}><LogOut size={17} />{!collapsed && <span>Sign out</span>}</button>}
      {!collapsed && <p className="px-3 pt-4 text-[10px] text-ink-faint">A little more focus. A lot more yours.</p>}
    </div>
  </>
}

function MobileNavigation({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useDialogA11y(ref, onClose)
  return <div ref={ref} role="dialog" aria-modal="true" aria-label="Navigation" className="fixed inset-0 z-50 lg:hidden">
    <div className="absolute inset-0 bg-black/35 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
    <aside className="relative flex flex-col h-full w-[280px] max-w-[85vw] bg-paper shadow-e3 animate-drawer-in">
      <IconButton title="Close navigation" aria-label="Close navigation" onClick={onClose} className="absolute right-2 top-6 z-10"><X size={16} /></IconButton>
      {children}
    </aside>
  </div>
}

export default function Layout({ children }: { children?: ReactNode }) {
  const location = useLocation()
  const [mode, setMode] = useState<SidebarMode>(() => { const value = stored('localfirst.sidebar', 'expanded'); return value === 'mini' || value === 'hidden' ? value : 'expanded' })
  const [mobileOpen, setMobileOpen] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [workspaceName, setWorkspaceName] = useState(() => stored('localfirst.workspace-name', 'My workspace'))
  const [renaming, setRenaming] = useState(false)
  const [workspaceDraft, setWorkspaceDraft] = useState(workspaceName)
  const [workspaceError, setWorkspaceError] = useState('')
  const [displayName, setDisplayName] = useState(identityName)
  const closeMobile = useCallback(() => setMobileOpen(false), [])
  const collapsed = mode === 'mini'
  const currentView = new URLSearchParams(location.search).get('view') || 'home'
  const currentApp = APPS.find(app => location.pathname.startsWith(app.route))
  const isEditor = /^\/(docs|sheets|slides|whiteboards|pdf)\/[^/]+/.test(location.pathname)
  const section = location.pathname === '/settings' ? 'Settings' : currentApp?.label || VIEW_LINKS.find(link => link.view === currentView)?.label || 'Home'
  const applyMode = (value: SidebarMode) => { setMode(value); try { localStorage.setItem('localfirst.sidebar', value) } catch { /* The temporary UI preference still works. */ } }
  const rename = () => { setWorkspaceDraft(workspaceName); setWorkspaceError(''); setRenaming(true) }
  const saveWorkspace = () => {
    const next = workspaceDraft.trim()
    if (!next) { setWorkspaceError('Give your workspace a name.'); return }
    try { localStorage.setItem('localfirst.workspace-name', next); setWorkspaceName(next); setRenaming(false); window.dispatchEvent(new CustomEvent('localfirst:workspace-changed')) } catch { setWorkspaceError('This browser could not save the workspace name. Please allow site storage and try again.') }
  }
  useEffect(() => { const update = () => setDisplayName(identityName()); window.addEventListener('localfirst:identity-changed', update); return () => window.removeEventListener('localfirst:identity-changed', update) }, [])
  const navigation = (mobile = false) => <WorkspaceNavigation collapsed={mobile ? false : collapsed} workspaceName={workspaceName} onRename={rename} onNew={() => setShowNew(true)} onNavigate={mobile ? closeMobile : undefined} onCollapse={mobile ? undefined : () => applyMode(collapsed ? 'expanded' : 'mini')} />

  return <div className="flex h-screen overflow-hidden bg-bg text-ink">
    <a href="#workspace-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:bg-paper focus:rounded-lg focus:p-3 focus:shadow-e2">Skip to content</a>
    <aside aria-label="Workspace navigation" className={`hidden lg:flex flex-col flex-shrink-0 bg-paper border-r border-line transition-[width] duration-base ${mode === 'hidden' ? 'w-0 border-r-0 overflow-hidden' : collapsed ? 'w-[72px]' : 'w-[248px]'}`} aria-hidden={mode === 'hidden' || undefined}>
      {navigation()}
      {collapsed && <div className="border-t border-line px-3 py-3"><Tooltip label="Expand sidebar" side="right"><IconButton title="Expand sidebar" aria-label="Expand sidebar" onClick={() => applyMode('expanded')} className="w-full"><PanelLeftOpen size={17} /></IconButton></Tooltip></div>}
    </aside>
    {mobileOpen && <MobileNavigation onClose={closeMobile}>{navigation(true)}</MobileNavigation>}
    <main className="relative min-w-0 flex flex-1 flex-col overflow-hidden">
      <header className={`flex flex-shrink-0 items-center gap-3 h-14 px-4 sm:px-6 border-b border-line bg-paper ${isEditor ? 'lg:hidden' : ''}`}>
        <IconButton className="lg:hidden" title="Open navigation" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={19} /></IconButton>
        {mode === 'hidden' && <IconButton className="hidden lg:inline-flex" title="Show sidebar" aria-label="Show sidebar" onClick={() => applyMode('expanded')}><PanelLeftOpen size={18} /></IconButton>}
        <LocalFirstLogo size={27} className="lg:hidden" />
        <nav aria-label="Breadcrumb" className="hidden lg:flex items-center gap-2 text-xs min-w-0"><NavLink to="/" className="text-ink-faint hover:text-ink truncate max-w-36">{workspaceName}</NavLink><ChevronRight size={12} className="text-ink-ghost flex-shrink-0" /><span className="text-ink font-medium truncate">{section}</span></nav>
        <span className="text-sm font-semibold lg:hidden">LocalFirst</span>
        <div className="flex-1" />
        <button onClick={openSearch} aria-label="Search files and commands" className="hidden sm:flex items-center gap-2 w-52 rounded-lg border border-line bg-bg/60 h-8 px-2.5 text-xs text-ink-faint hover:border-line-strong hover:text-ink-muted transition-colors"><Search size={14} /><span>Search anything...</span><kbd className="ml-auto rounded border border-line bg-paper px-1 text-[9px]">Ctrl K</kbd></button>
        <IconButton onClick={openSearch} className="sm:hidden" title="Search files and commands" aria-label="Search files and commands"><Search size={18} /></IconButton>
        <NavLink to="/settings" title={`Settings for ${displayName}`} aria-label="Open account settings" className="flex items-center justify-center w-8 h-8 rounded-full bg-accent-tint text-accent-press text-[10px] font-bold border border-accent-tint-2">{initials(displayName)}</NavLink>
      </header>
      {mode === 'hidden' && isEditor && <div className="hidden lg:block absolute top-2 left-2 z-30"><IconButton title="Show sidebar" aria-label="Show sidebar" onClick={() => applyMode('expanded')} className="border border-line bg-paper shadow-e1"><PanelLeftOpen size={17} /></IconButton></div>}
      <div id="workspace-content" tabIndex={-1} className="flex-1 flex flex-col min-h-0 overflow-hidden">{children}</div>
      {OFFLINE_ONLY && <OfflineWorkspaceBar />}
    </main>
    {showNew && <NewFileModal onClose={() => setShowNew(false)} />}
    <Modal open={renaming} title="Workspace settings" onClose={() => setRenaming(false)}>
      <Modal.Body><p className="text-sm text-ink-muted mb-5">Make this space feel like yours. The name is saved in this browser; your files stay in the current workspace.</p><Input label="Workspace name" value={workspaceDraft} onChange={event => setWorkspaceDraft(event.target.value)} maxLength={60} autoFocus error={workspaceError} onKeyDown={event => { if (event.key === 'Enter') saveWorkspace() }} /></Modal.Body>
      <Modal.Footer><Button onClick={() => setRenaming(false)}>Cancel</Button><Button variant="primary" onClick={saveWorkspace}>Save workspace</Button></Modal.Footer>
    </Modal>
  </div>
}

/** Workspace preferences and live storage facts. Device data stays opt-in. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowUpRight, Bell, Bluetooth, Check, CheckCircle2, Cloud, Download, Eye, EyeOff, HardDrive, Info, Keyboard, Loader2, Monitor, Moon, Palette, RefreshCw, Save, Shield, SlidersHorizontal, Sun, Upload } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { api } from '../lib/api'
import { OFFLINE_ONLY } from '../lib/offline/mode'
import { downloadJson } from '../lib/offline/download'
import { exportLocalWorkspace, importLocalWorkspace, MAX_BACKUP_BYTES, parseWorkspaceBackup } from '../lib/offline/workspace'
import { useAuthStore } from '../store/authStore'
import { useFilesStore } from '../store/filesStore'
import { useNotificationsStore } from '../store/notificationsStore'
import { Button, Card, Input, LocalFirstLogo, Modal, useToast } from './ui'
import { useTheme } from './ui/useTheme'
import NearbyBluetooth from './NearbyBluetooth'
import { InvitesPanel, AuditPanel } from '../apps/admin/AdminApp.jsx'

interface SystemInfo { account_id?: string; version?: string; is_admin?: boolean; integration_mode?: string; auth?: { mode?: string; user_count?: number }; storage?: { backend?: string; data_dir?: string; uploads_dir?: string; object_store?: { active?: boolean; kind?: string } } }
type Section = 'appearance' | 'editor' | 'storage' | 'backup' | 'connections' | 'notifications' | 'shortcuts' | 'privacy' | 'about'
const SECTIONS: { id: Section; label: string; description: string; Icon: LucideIcon }[] = [
  { id: 'appearance', label: 'Appearance', description: 'A workspace that feels like you.', Icon: Palette },
  { id: 'editor', label: 'Editor', description: 'Set your pace and keep your focus.', Icon: SlidersHorizontal },
  { id: 'storage', label: 'Storage', description: 'Understand where your work lives.', Icon: HardDrive },
  { id: 'backup', label: 'Backup & restore', description: 'Keep a separate copy of your work.', Icon: Download },
  { id: 'connections', label: 'Connections', description: 'Connect your workspace and nearby devices.', Icon: Bluetooth },
  { id: 'notifications', label: 'Notifications', description: 'Choose what deserves your attention.', Icon: Bell },
  { id: 'shortcuts', label: 'Keyboard shortcuts', description: 'Less clicking. More creating.', Icon: Keyboard },
  { id: 'privacy', label: 'Privacy & security', description: 'Control access to your work.', Icon: Shield },
  { id: 'about', label: 'About LocalFirst', description: 'Your workspace. Your tools. Your way.', Icon: Info },
]
function stored(key: string, fallback = ''): string { try { return localStorage.getItem(key) || fallback } catch { return fallback } }
function errorText(error: unknown): string { return error instanceof Error ? error.message : 'The action could not finish. Please try again.' }
function bytes(value: number): string { return value >= 1073741824 ? `${(value / 1073741824).toFixed(1)} GB` : `${(value / 1048576).toFixed(1)} MB` }
function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4 p-5 sm:p-6 border-b border-line last:border-b-0"><div className="min-w-0 flex-1"><p className="text-sm font-medium text-ink">{label}</p>{hint && <p className="text-xs leading-relaxed text-ink-faint mt-1 max-w-md">{hint}</p>}</div><div className="flex-shrink-0 max-w-full">{children}</div></div>
}
function Toggle({ value, onChange, label, disabled }: { value: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-label={label} aria-checked={value} disabled={disabled} onClick={() => onChange(!value)} className={`relative flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${value ? 'bg-accent' : 'bg-line-strong'}`}><span className={`h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform ${value ? 'translate-x-[23px]' : 'translate-x-[3px]'}`} /></button>
}
function Hint({ children }: { children: ReactNode }) { return <div className="rounded-xl border border-line bg-bg/60 p-4 text-xs text-ink-muted leading-relaxed">{children}</div> }

export default function Settings() {
  const [searchParams, setSearchParams] = useSearchParams()
  const active = (SECTIONS.find(section => section.id === searchParams.get('section')) || SECTIONS[0])
  const { theme, setTheme } = useTheme()
  const { status, logout } = useAuthStore()
  const { showToast, toast } = useToast()
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const [infoLoading, setInfoLoading] = useState(true)
  const [infoError, setInfoError] = useState('')
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null)
  const [persistent, setPersistent] = useState<boolean | null>(null)
  const [storageBusy, setStorageBusy] = useState(false)
  const [autosaveDelay, setAutosaveDelay] = useState(() => Number(stored('localfirst_autosave_delay', stored('vulos_autosave_delay', '2000'))))
  const [spellcheck, setSpellcheck] = useState(() => stored('localfirst_spellcheck', stored('vulos_spellcheck', 'true')) !== 'false')
  const [defaultView, setDefaultView] = useState(() => stored('localfirst_default_view', stored('vulos_default_view', 'list')))
  const [notifications, setNotifications] = useState(() => stored('localfirst_notifications_enabled', 'true') !== 'false')
  const [desktopNotifications, setDesktopNotifications] = useState(() => stored('localfirst_desktop_notifications') === 'true')
  const [notificationPermission, setNotificationPermission] = useState(() => typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
  const [name, setName] = useState(() => { try { return (JSON.parse(stored('presence_identity', '{}')) as { displayName?: string }).displayName || 'You' } catch { return 'You' } })
  const [curPw, setCurPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [savingPw, setSavingPw] = useState(false)
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupError, setBackupError] = useState('')
  const [backupNotice, setBackupNotice] = useState('')
  const [pending, setPending] = useState<{ json: string; name: string; files: number; folders: number } | null>(null)
  const backupInput = useRef<HTMLInputElement>(null)
  const markAllRead = useNotificationsStore(state => state.markAllRead)
  const notifyPreferences = useCallback((detail?: Record<string, unknown>) => window.dispatchEvent(new CustomEvent('localfirst:preferences-changed', { detail })), [])

  useEffect(() => {
    let live = true
    api.systemInfo().then(value => { if (live) setInfo(value as SystemInfo) }).catch(error => { if (live) setInfoError(errorText(error)) }).finally(() => { if (live) setInfoLoading(false) })
    return () => { live = false }
  }, [])
  const inspectStorage = useCallback(async () => {
    try {
      const [storage, protection] = await Promise.all([navigator.storage?.estimate?.(), navigator.storage?.persisted?.()])
      if (storage?.quota) setEstimate({ usage: storage.usage || 0, quota: storage.quota })
      if (typeof protection === 'boolean') setPersistent(protection)
    } catch { /* Optional browser estimates do not determine save success. */ }
  }, [])
  useEffect(() => { void inspectStorage() }, [inspectStorage])

  const saveEditor = () => {
    try {
      localStorage.setItem('localfirst_autosave_delay', String(autosaveDelay))
      localStorage.setItem('localfirst_spellcheck', String(spellcheck))
      localStorage.setItem('localfirst_default_view', defaultView)
      notifyPreferences({ autosaveDelay, spellcheck, defaultView })
      showToast('Editor preferences saved', 'success')
    } catch { showToast('Your browser could not save preferences. Allow site storage and try again.', 'error') }
  }
  const saveName = () => {
    if (!name.trim()) { showToast('Enter a display name.', 'error'); return }
    try { const identity = JSON.parse(stored('presence_identity', '{}')) as Record<string, unknown>; localStorage.setItem('presence_identity', JSON.stringify({ ...identity, displayName: name.trim() })); window.dispatchEvent(new CustomEvent('localfirst:identity-changed')); showToast('Display name updated', 'success') } catch { showToast('Your browser could not save the display name.', 'error') }
  }
  const protectStorage = async () => {
    if (!navigator.storage?.persist) { showToast('This browser does not support storage protection. Export a backup instead.', 'info'); return }
    setStorageBusy(true)
    try { const kept = await navigator.storage.persist(); setPersistent(kept); showToast(kept ? 'Storage protection enabled. Keep a separate backup too.' : 'The browser declined storage protection. Your saved files are still here.', kept ? 'success' : 'info') } catch (error) { showToast(errorText(error), 'error') } finally { setStorageBusy(false) }
  }
  const setNotificationPreference = (enabled: boolean) => { try { localStorage.setItem('localfirst_notifications_enabled', String(enabled)); setNotifications(enabled); notifyPreferences() } catch { showToast('The notification preference could not be saved.', 'error') } }
  const setDesktopPreference = async () => {
    if (desktopNotifications) { try { localStorage.setItem('localfirst_desktop_notifications', 'false'); setDesktopNotifications(false); notifyPreferences() } catch { showToast('The preference could not be saved.', 'error') }; return }
    if (typeof Notification === 'undefined') return
    try { const permission = await Notification.requestPermission(); setNotificationPermission(permission); if (permission === 'granted') { localStorage.setItem('localfirst_desktop_notifications', 'true'); setDesktopNotifications(true); notifyPreferences(); showToast('Desktop alerts enabled for new mentions.', 'success') } else { showToast('Desktop alerts were not enabled. You can change this in browser settings.', 'info') } } catch (error) { showToast(errorText(error), 'error') }
  }
  const exportBackup = async () => {
    setBackupBusy(true); setBackupError(''); setBackupNotice('')
    try {
      if (OFFLINE_ONLY) downloadJson(await exportLocalWorkspace(), `localfirst-workspace-${new Date().toISOString().slice(0, 10)}.json`)
      else {
        const entries = await api.listFiles() as { id: string }[]
        const files: unknown[] = []
        for (const entry of entries) files.push(await api.getFile(entry.id))
        downloadJson(JSON.stringify({ format: 'localfirst-server-export', version: 1, exported_at: new Date().toISOString(), files }, null, 2), `localfirst-files-${new Date().toISOString().slice(0, 10)}.json`)
      }
      setBackupNotice(OFFLINE_ONLY ? 'Backup download started. Saved files, folders and history are included.' : 'File export download started. This export contains current file contents; server version history and account credentials are excluded.')
    } catch (error) { setBackupError(errorText(error)) } finally { setBackupBusy(false) }
  }
  const chooseBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return
    setBackupBusy(true); setPending(null); setBackupError(''); setBackupNotice('')
    try { if (file.size > MAX_BACKUP_BYTES) throw new Error('Choose a workspace backup smaller than 32 MB.'); const json = await file.text(); const parsed = parseWorkspaceBackup(json); if (!parsed.files.length && !parsed.folders.length) throw new Error('This backup is empty. Existing files have not changed.'); setPending({ json, name: file.name, files: parsed.files.length, folders: parsed.folders.length }) } catch (error) { setBackupError(errorText(error)) } finally { setBackupBusy(false) }
  }
  const restoreBackup = async () => {
    if (!pending || backupBusy) return
    setBackupBusy(true); setBackupError('')
    try { const result = await importLocalWorkspace(pending.json); await useFilesStore.getState().fetchFiles(); await useFilesStore.getState().fetchFolders(); setPending(null); setBackupNotice(`Restored ${result.files} files and ${result.folders} folders as new copies. Existing work was preserved.`) } catch (error) { setBackupError(errorText(error)) } finally { setBackupBusy(false) }
  }
  const changePassword = async () => {
    if (newPw.length < 10) { showToast('Use at least 10 characters for your new password.', 'error'); return }
    if (newPw !== confirmPw) { showToast('The new passwords do not match.', 'error'); return }
    setSavingPw(true)
    try { await api.changePassword(curPw, newPw); setCurPw(''); setNewPw(''); setConfirmPw(''); showToast('Password updated', 'success') } catch (error) { showToast(errorText(error), 'error') } finally { setSavingPw(false) }
  }
  const usagePercent = estimate ? Math.min(100, estimate.usage / estimate.quota * 100) : 0
  const authMode = info?.auth?.mode

  return <div className="flex-1 min-h-0 overflow-auto bg-bg">
    <div className="max-w-[1120px] mx-auto px-5 sm:px-8 lg:px-10 py-8 sm:py-10">
      <div className="mb-8"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-accent-press mb-2">Make yourself at home</p><h1 className="text-[30px] font-semibold tracking-display text-ink">Settings</h1><p className="text-sm text-ink-muted mt-2">Thoughtful defaults. A workspace that works for you.</p></div>
      <div className="flex flex-col md:flex-row gap-6 lg:gap-10 items-start">
        <nav aria-label="Settings sections" className="md:w-[190px] flex-shrink-0 w-full flex md:flex-col gap-1 overflow-x-auto pb-2 md:sticky md:top-0">
          {SECTIONS.map(({ id, label, Icon }) => <button key={id} type="button" aria-current={active.id === id ? 'page' : undefined} onClick={() => setSearchParams({ section: id })} className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-xs font-medium whitespace-nowrap text-left transition-colors ${active.id === id ? 'bg-accent-tint text-accent-press' : 'text-ink-muted hover:bg-bg-elev2 hover:text-ink'}`}><Icon size={16} />{label}</button>)}
        </nav>
        <section aria-labelledby="settings-section-title" className="flex-1 min-w-0 w-full space-y-5">
          <div className="pb-1"><h2 id="settings-section-title" className="text-lg font-semibold tracking-tightish text-ink">{active.label}</h2><p className="text-xs text-ink-faint mt-1">{active.description}</p></div>

          {active.id === 'appearance' && <>
            <Card><div className="p-5 sm:p-6"><h3 className="text-sm font-medium text-ink">Color theme</h3><p className="text-xs text-ink-faint mt-1 mb-5">Choose a look, or let your device decide.</p><div className="grid grid-cols-3 gap-3">
              {[{ value: 'light', label: 'Light', Icon: Sun }, { value: 'dark', label: 'Dark', Icon: Moon }, { value: 'system', label: 'System', Icon: Monitor }].map(({ value, label, Icon }) => <button key={value} type="button" onClick={() => setTheme(value)} aria-pressed={theme === value} aria-label={`${label} theme`} className={`p-2.5 rounded-xl border-2 text-left transition-colors ${theme === value ? 'border-accent bg-accent-tint/30' : 'border-line hover:border-line-strong bg-paper'}`}><div className={`h-20 rounded-md border border-line overflow-hidden flex ${value === 'dark' ? 'bg-slate-900' : 'bg-slate-50'}`}><div className={`w-1/4 border-r ${value === 'dark' ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`} /><div className="flex-1 p-2.5 space-y-1.5"><div className={`h-1.5 w-2/3 rounded ${value === 'dark' ? 'bg-slate-600' : 'bg-slate-200'}`} /><div className={`h-9 rounded border ${value === 'dark' ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`} /></div></div><span className="flex items-center gap-1.5 mt-3 text-xs font-medium"><Icon size={13} />{label}{theme === value && <Check size={13} className="ml-auto text-accent" />}</span></button>)}
            </div></div><Row label="Default file layout" hint="Applies to file browsers when you next open them."><div className="inline-flex rounded-lg border border-line bg-bg p-1">{['grid', 'list'].map(value => <button key={value} aria-pressed={defaultView === value} onClick={() => { setDefaultView(value); try { localStorage.setItem('localfirst_default_view', value); notifyPreferences({ defaultView: value }); showToast('File layout updated', 'success') } catch { showToast('File layout could not be saved.', 'error') } }} className={`px-4 py-1.5 rounded-md text-xs capitalize ${defaultView === value ? 'bg-paper text-ink shadow-e1' : 'text-ink-faint'}`}>{value}</button>)}</div></Row></Card>
            <Hint>Appearance preferences are saved on this device. Themes update your workspace immediately and keep document contents unchanged.</Hint>
          </>}

          {active.id === 'editor' && <><Card><Row label="Autosave delay" hint={OFFLINE_ONLY ? 'Controls hosted snapshot saving. Offline edits continue to commit promptly for recovery.' : 'Time after typing stops before saving a document snapshot.'}><select aria-label="Autosave delay" value={autosaveDelay} onChange={event => setAutosaveDelay(Number(event.target.value))} className="h-9 px-3 bg-paper border border-line rounded-lg text-xs">{[1000, 2000, 3000, 5000].map(delay => <option key={delay} value={delay}>{delay / 1000} {delay === 1000 ? 'second' : 'seconds'}</option>)}</select></Row><Row label="Spell check" hint="Use the browser's spelling suggestions inside document editors."><Toggle value={spellcheck} onChange={setSpellcheck} label="Spell check" /></Row><div className="p-5 flex justify-end bg-bg/50 border-t border-line"><Button variant="primary" onClick={saveEditor}><Save size={14} />Save preferences</Button></div></Card><Hint>Your editor saves work locally before reporting a successful save. Sharing and peer acknowledgement are shown separately.</Hint></>}

          {active.id === 'storage' && <><Card><div className="p-5 sm:p-6"><div className="flex items-center gap-3 mb-5"><span className="w-10 h-10 flex items-center justify-center bg-accent-tint rounded-xl text-accent"><HardDrive size={20} /></span><div><h3 className="text-sm font-semibold">This browser's storage</h3><p className="text-xs text-ink-faint mt-1">{estimate ? `${bytes(estimate.usage)} used of an estimated ${bytes(estimate.quota)}` : 'An estimate is not available in this browser.'}</p></div></div><div className="h-2 bg-bg-elev2 rounded-full overflow-hidden"><div className="h-full rounded-full bg-accent" style={{ width: `${usagePercent}%` }} /></div><p className="text-[10px] text-ink-faint mt-3">This is the site's browser quota, not your computer's free disk space.</p></div><Row label="Storage protection" hint="Ask the browser to keep local files when it frees temporary storage. Clearing site data still removes them.">{persistent ? <span className="flex items-center gap-1.5 text-xs text-success"><CheckCircle2 size={14} />Allowed</span> : <Button disabled={storageBusy} onClick={() => void protectStorage()}>{storageBusy ? <Loader2 size={14} className="animate-spin" /> : <Shield size={14} />}Protect local storage</Button>}</Row><Row label="Refresh estimate" hint="Read the current storage estimate from your browser."><Button onClick={() => void inspectStorage()}><RefreshCw size={14} />Refresh</Button></Row></Card><Card><Row label="Document store" hint={OFFLINE_ONLY ? 'Committed files and history are kept in this browser profile.' : 'The connected server reports this storage backend.'}><span className="text-xs font-medium">{OFFLINE_ONLY ? 'Local browser storage' : infoLoading ? 'Checking...' : info?.storage?.backend || 'Unavailable'}</span></Row>{!OFFLINE_ONLY && info?.storage?.object_store?.active && <Row label="Attachment storage"><span className="text-xs">{info.storage.object_store.kind || 'Object storage'}</span></Row>}</Card><Hint>Use the same browser, profile and workspace address to reopen local files. Private browsing or clearing site data can remove access. Keep an exported backup of important work.</Hint></>}

          {active.id === 'backup' && <><Card><div className="p-6"><div className="flex gap-4 items-start"><span className="p-3 rounded-xl bg-accent-tint text-accent"><Download size={21} /></span><div className="flex-1"><h3 className="text-sm font-semibold">{OFFLINE_ONLY ? 'Export your workspace' : 'Export your files'}</h3><p className="text-xs leading-relaxed text-ink-faint mt-2 max-w-md">{OFFLINE_ONLY ? 'Download saved files, folders and version history in one JSON backup. Save current edits before exporting.' : 'Download the current contents of files available to your account as JSON. The export does not include server version history or credentials.'}</p><Button variant="primary" className="mt-4" disabled={backupBusy} onClick={() => void exportBackup()}>{backupBusy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}{OFFLINE_ONLY ? 'Export workspace' : 'Export files'}</Button></div></div></div><div className="p-6 border-t border-line"><div className="flex gap-4 items-start"><span className="p-3 rounded-xl bg-bg-elev2 text-ink-muted"><Upload size={21} /></span><div className="flex-1"><h3 className="text-sm font-semibold">Restore a workspace backup</h3><p className="text-xs leading-relaxed text-ink-faint mt-2 max-w-md">{OFFLINE_ONLY ? 'Add files as new copies from a LocalFirst workspace backup, up to 32 MB. Existing files stay in place. Previous-brand backups are supported.' : 'Workspace backup restore is available in the Windows offline app. Server exports can be inspected as JSON; they are not workspace-restore files.'}</p><Button className="mt-4" disabled={!OFFLINE_ONLY || backupBusy} onClick={() => backupInput.current?.click()}><Upload size={14} />Choose backup</Button><input ref={backupInput} type="file" accept=".json,application/json" className="sr-only" aria-label="Choose workspace backup" tabIndex={-1} onChange={event => void chooseBackup(event)} /></div></div></div></Card>{backupError && <p role="alert" className="text-sm text-danger">{backupError}</p>}{backupNotice && <p role="status" className="text-sm text-success">{backupNotice}</p>}<Hint>Backup files contain readable document contents. Keep them somewhere you trust. A workspace backup is different from a Bluetooth invitation.</Hint></>}

          {active.id === 'connections' && <><Card><Row label="Workspace connection" hint={OFFLINE_ONLY ? 'Document APIs run locally. Internet access is disabled for this build.' : 'The browser uses your current workspace server.'}><span className="inline-flex items-center gap-2 text-xs font-medium text-ink"><span className="w-1.5 h-1.5 rounded-full bg-success" />{OFFLINE_ONLY ? 'Local workspace' : location.origin}</span></Row><Row label="Nearby Bluetooth" hint={OFFLINE_ONLY ? 'Share a saved document directly with another paired Windows laptop. Both laptops need the Windows package.' : 'Native Bluetooth sharing is available through the Windows offline launcher.'}>{OFFLINE_ONLY ? <NearbyBluetooth /> : <span className="text-xs text-ink-faint">Windows app required</span>}</Row></Card><Hint>For a nearby connection, pair the laptops in Windows Settings and verify the matching Windows pairing numbers. Four-digit LocalFirst codes require explicit host approval. A connected radio is separate from a document's synchronization acknowledgement.</Hint></>}

          {active.id === 'notifications' && <><Card><Row label="In-app notifications" hint={OFFLINE_ONLY ? 'Mention notifications are available in hosted workspaces.' : 'Show mention badges and check for new notifications while the app is open.'}><Toggle label="In-app notifications" value={notifications && !OFFLINE_ONLY} disabled={OFFLINE_ONLY} onChange={setNotificationPreference} /></Row><Row label="Desktop alerts" hint={notificationPermission === 'unsupported' ? 'This browser does not support desktop notifications.' : 'Show a browser alert when a new mention arrives while LocalFirst is open.'}><Button disabled={OFFLINE_ONLY || !notifications || notificationPermission === 'unsupported' || notificationPermission === 'denied'} onClick={() => void setDesktopPreference()}>{desktopNotifications && notificationPermission === 'granted' ? 'Turn off alerts' : notificationPermission === 'denied' ? 'Blocked by browser' : 'Enable desktop alerts'}</Button></Row><Row label="Unread mentions" hint="Mark the current account's existing mentions as read."><Button disabled={OFFLINE_ONLY} onClick={() => void markAllRead().then(() => showToast('Notifications marked as read', 'success'))}>Mark all as read</Button></Row></Card>{notificationPermission === 'denied' && <Hint>Desktop alerts were blocked in browser settings. You can change the permission using the site controls beside the address bar.</Hint>}</>}

          {active.id === 'shortcuts' && <><Card>{[{ label: 'Search files and commands', keys: ['Ctrl / Cmd', 'K'] }, { label: 'Save the current document', keys: ['Ctrl / Cmd', 'S'] }, { label: 'Undo', keys: ['Ctrl / Cmd', 'Z'] }, { label: 'Redo', keys: ['Ctrl / Cmd', 'Shift', 'Z'] }, { label: 'Bold selected text', keys: ['Ctrl / Cmd', 'B'] }, { label: 'Italic selected text', keys: ['Ctrl / Cmd', 'I'] }, { label: 'Close an open dialog', keys: ['Esc'] }].map(shortcut => <Row key={shortcut.label} label={shortcut.label}><div className="flex items-center gap-1.5">{shortcut.keys.map(key => <kbd key={key} className="px-2 py-1 text-[10px] rounded-md bg-bg border border-line text-ink-muted">{key}</kbd>)}</div></Row>)}</Card><Hint>Editing shortcuts apply when the document editor has focus. On macOS, use Command in place of Control.</Hint></>}

          {active.id === 'privacy' && <><Card><Row label="Access protection" hint={OFFLINE_ONLY ? 'Your unlocked browser profile can read its local workspace.' : 'The current server reports this authentication mode.'}><span className="text-xs font-medium">{OFFLINE_ONLY ? 'Device and browser profile' : infoLoading ? 'Checking...' : authMode === 'per-user' ? 'Individual accounts' : authMode === 'shared' ? 'Workspace password' : authMode === 'disabled' ? 'Login disabled' : 'Unavailable'}</span></Row><Row label="Display name" hint="Your name in presence and collaboration. Saved on this device."><div className="flex flex-wrap gap-2"><Input aria-label="Display name" value={name} maxLength={80} onChange={event => setName(event.target.value)} className="w-40" /><Button onClick={saveName}>Save name</Button></div></Row>{status?.enabled && <Row label="Current session" hint="Sign out of this workspace in the current browser."><Button variant="destructive" onClick={() => void logout()}>Sign out</Button></Row>}</Card>{authMode === 'per-user' && <Card><div className="p-6"><h3 className="text-sm font-semibold mb-4">Change password</h3><div className="space-y-3"><Input label="Current password" autoComplete="current-password" type={showPw ? 'text' : 'password'} value={curPw} onChange={event => setCurPw(event.target.value)} /><Input label="New password" hint="Use at least 10 characters." autoComplete="new-password" type={showPw ? 'text' : 'password'} value={newPw} onChange={event => setNewPw(event.target.value)} /><Input label="Confirm new password" autoComplete="new-password" type={showPw ? 'text' : 'password'} value={confirmPw} onChange={event => setConfirmPw(event.target.value)} /><div className="flex items-center justify-between gap-3"><button type="button" onClick={() => setShowPw(value => !value)} className="inline-flex items-center gap-1.5 text-xs text-ink-muted">{showPw ? <EyeOff size={14} /> : <Eye size={14} />}{showPw ? 'Hide passwords' : 'Show passwords'}</button><Button variant="primary" disabled={!curPw || !newPw || !confirmPw || savingPw} onClick={() => void changePassword()}>{savingPw && <Loader2 size={14} className="animate-spin" />}Update password</Button></div></div></div></Card>}<Hint>Local browser files and JSON backups are not encrypted at rest by this app. Bluetooth document traffic uses the authenticated TLS connection. Keep your device locked and approve only the intended paired laptop.</Hint>{info?.is_admin && <details className="rounded-xl border border-line bg-paper p-5"><summary className="cursor-pointer text-sm font-medium">Workspace administration</summary><div className="space-y-7 pt-5"><section><h3 className="text-xs font-semibold mb-3">Registration invites</h3><InvitesPanel onError={(message: string) => message && showToast(message, 'error')} /></section><section><h3 className="text-xs font-semibold mb-3">Audit log</h3><AuditPanel onError={(message: string) => message && showToast(message, 'error')} /></section></div></details>}</>}

          {active.id === 'about' && <><Card><div className="p-7 sm:p-9 flex flex-col items-center text-center"><LocalFirstLogo size={56} /><h3 className="text-2xl tracking-display font-semibold mt-5">LocalFirst</h3><p className="text-sm text-ink-muted mt-2">A calmer place for your best work.</p><p className="text-xs text-ink-faint mt-4">{infoLoading ? 'Reading instance version...' : `Instance version: ${info?.version || 'Unavailable'}`}</p><span className="inline-flex items-center gap-1.5 rounded-full bg-accent-tint text-accent-press px-3 py-1.5 text-[10px] font-medium mt-4">{OFFLINE_ONLY ? <HardDrive size={12} /> : <Cloud size={12} />}{OFFLINE_ONLY ? 'Windows offline workspace' : 'Connected workspace'}</span></div><Row label="Open-source software" hint="Includes open-source office engines and libraries, with their original licenses and attribution."><a href="/licenses.txt" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">Third-party licenses<ArrowUpRight size={13} /></a></Row><Row label="Workspace address"><code className="text-[11px] text-ink-muted break-all">{location.origin}</code></Row></Card>{infoError && <p role="alert" className="text-xs text-danger">Instance information could not be loaded: {infoError}</p>}</>}
        </section>
      </div>
    </div>
    <Modal open={!!pending} title="Restore workspace backup" onClose={() => { if (!backupBusy) setPending(null) }}><Modal.Body><p className="text-sm font-medium break-words">{pending?.name}</p><p className="text-sm text-ink-muted mt-3">This backup contains {pending?.files} files and {pending?.folders} folders. Restore adds new copies and preserves existing work.</p>{backupError && <p role="alert" className="text-sm text-danger mt-3">{backupError}</p>}</Modal.Body><Modal.Footer><Button disabled={backupBusy} onClick={() => setPending(null)}>Cancel</Button><Button variant="primary" disabled={backupBusy} onClick={() => void restoreBackup()}>{backupBusy ? 'Restoring...' : 'Restore as new copies'}</Button></Modal.Footer></Modal>
    {toast}
  </div>
}

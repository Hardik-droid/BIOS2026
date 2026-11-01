import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FileText, Table2, Presentation, FileSearch, PenTool, Clock, Search, ArrowUpRight, ArrowRight, FolderSearch, FolderOpen, HardDrive, RefreshCw, Loader2, Plus, LayoutGrid, List, X, Upload, Star, MoreHorizontal, Pencil, Trash2, RotateCcw, Share2, Users, Check } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useFilesStore } from '../store/filesStore'
import type { LocalFirstFile } from '../store/filesStore'
import { useLocalFilesStore } from '../store/localFilesStore'
import type { LocalFileEntry } from '../store/localFilesStore'
import { useAuthStore } from '../store/authStore'
import { importFromUrl, importFile, detectType } from '../lib/importFile'
import { timeAgo, formatBytes } from '../lib/format'
import { OFFLINE_ONLY } from '../lib/offline/mode'
import NewFileModal from './NewFileModal'
import AccountShareModal from './AccountShareModal'
import { Card, Button, Menu, Modal, Input, useToast, Skeleton, DocThumb } from './ui'

interface TypeInfo { icon: LucideIcon; iconCn: string; bgCn: string; route: string; label: string; singular: string; description: string }
const TYPES: Record<string, TypeInfo> = {
  doc: { icon: FileText, iconCn: 'text-app-docs', bgCn: 'bg-app-docs-bg', route: 'docs', label: 'Documents', singular: 'Document', description: 'Turn a thought into something worth sharing.' },
  sheet: { icon: Table2, iconCn: 'text-app-sheets', bgCn: 'bg-app-sheets-bg', route: 'sheets', label: 'Spreadsheets', singular: 'Spreadsheet', description: 'Find the story behind your numbers.' },
  slide: { icon: Presentation, iconCn: 'text-app-slides', bgCn: 'bg-app-slides-bg', route: 'slides', label: 'Presentations', singular: 'Presentation', description: 'Give your next big idea a little stage.' },
  whiteboard: { icon: PenTool, iconCn: 'text-app-board', bgCn: 'bg-app-board-bg', route: 'whiteboards', label: 'Whiteboards', singular: 'Whiteboard', description: 'A little more space to think freely.' },
  pdf: { icon: FileSearch, iconCn: 'text-app-pdf', bgCn: 'bg-app-pdf-bg', route: 'pdf', label: 'PDF Studio', singular: 'PDF', description: 'Open, annotate, and work with your PDFs.' },
}
const VIEWS = ['recent', 'favorites', 'all', 'shared', 'offline', 'trash'] as const
type View = typeof VIEWS[number]
const VIEW_COPY: Record<View, { heading: string; description: string; empty: string }> = {
  recent: { heading: 'Good work starts here.', description: 'A little space to write, plan, and bring your ideas together.', empty: 'Make this space your own' },
  favorites: { heading: 'The files you keep close.', description: 'Your starred work, together in one easy-to-find place.', empty: 'Keep the important things close' },
  all: { heading: 'Everything, in its place.', description: 'A clear view of the documents and ideas in your workspace.', empty: 'Your next idea belongs here' },
  shared: { heading: 'Better work, together.', description: 'Files shared with your account by other people.', empty: 'A space for shared ideas' },
  offline: { heading: 'Ready when you are.', description: 'Work saved on this device, available without an internet connection.', empty: 'Take your work with you' },
  trash: { heading: 'A little room to reset.', description: 'Restore a file you still need, or remove it permanently.', empty: 'All clear in here' },
}
type LocalEntry = LocalFileEntry & { ext: string; appType: string; modified: string }

export default function Home() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const rawView = params.get('view') || 'recent'
  const view: View = VIEWS.includes(rawView as View) ? rawView as View : 'recent'
  const query = params.get('q') || ''
  const { files, loading, loadError, fetchFiles, sharedWithMe, fetchSharedWithMe, toggleStar, renameFile, trashFile, restoreFile, deleteFile } = useFilesStore()
  const { files: localFiles, loading: localLoading, scanned, scan } = useLocalFilesStore()
  const accountId = useAuthStore(state => state.accountId)
  const { showToast, toast } = useToast()
  const [showNew, setShowNew] = useState(false)
  const [newType, setNewType] = useState('doc')
  const [typeFilter, setTypeFilter] = useState('all')
  const [sort, setSort] = useState('modified')
  const [viewMode, setViewMode] = useState<'list' | 'grid'>(() => {
    try { return (localStorage.getItem('localfirst_default_view') || localStorage.getItem('vulos_default_view')) === 'grid' ? 'grid' : 'list' }
    catch { return 'list' }
  })
  const [importing, setImporting] = useState<string | null>(null)
  const [showLocalAll, setShowLocalAll] = useState(false)
  const [renameTarget, setRenameTarget] = useState<LocalFirstFile | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<LocalFirstFile | null>(null)
  const [sharing, setSharing] = useState<LocalFirstFile | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [actionMenuAlign, setActionMenuAlign] = useState<'left' | 'right'>('right')
  const fileInput = useRef<HTMLInputElement>(null)
  const pdfInput = useRef<HTMLInputElement>(null)

  useEffect(() => { void fetchFiles(); if (!OFFLINE_ONLY) void fetchSharedWithMe() }, [fetchFiles, fetchSharedWithMe])
  useEffect(() => { if (!OFFLINE_ONLY && !scanned) void scan() }, [scanned, scan])
  useEffect(() => { setTypeFilter('all'); setActionError('') }, [view])
  useEffect(() => {
    const applyPreferences = (event: Event) => {
      const preferred = (event as CustomEvent<{ defaultView?: string }>).detail?.defaultView
      if (preferred === 'grid' || preferred === 'list') setViewMode(preferred)
    }
    window.addEventListener('localfirst:preferences-changed', applyPreferences)
    return () => window.removeEventListener('localfirst:preferences-changed', applyPreferences)
  }, [])
  const setQuery = (value: string) => { const next = new URLSearchParams(params); if (value) next.set('q', value); else next.delete('q'); setParams(next, { replace: true }) }
  const setView = (nextView: View) => { const next = new URLSearchParams(params); next.set('view', nextView); setParams(next) }
  const openNew = (type = 'doc') => { setNewType(type); setShowNew(true) }
  const openFile = (file: LocalFirstFile) => { const info = TYPES[file.type]; if (info && !file.trashed) void navigate(`/${info.route}/${encodeURIComponent(file.id)}`) }
  const handleImport = async (file?: File) => {
    if (!file || importing) return
    setImporting('__upload__')
    try { if (!detectType(file.name)) throw new Error('This file type is not supported.'); await importFile(file, navigate) }
    catch (reason) { showToast(`Could not open ${file.name}: ${reason instanceof Error ? reason.message : String(reason)}`, 'error') }
    finally { setImporting(null) }
  }
  const handleLocalOpen = async (file: LocalEntry) => {
    setImporting(file.path)
    try { await importFromUrl(file, navigate) }
    catch (reason) { showToast(`Could not open ${file.name}: ${reason instanceof Error ? reason.message : String(reason)}`, 'error') }
    finally { setImporting(null) }
  }
  const fileAction = async (work: () => Promise<unknown>) => {
    try { await work() }
    catch (reason) { showToast(reason instanceof Error ? reason.message : 'This action could not be completed.', 'error') }
  }
  const submitDialog = async (work: () => Promise<unknown>, close: () => void) => {
    if (actionBusy) return
    setActionBusy(true); setActionError('')
    try { await work(); close() }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : 'The change could not be saved. Your file has been kept.') }
    finally { setActionBusy(false) }
  }

  const availableFiles = useMemo(() => {
    const base = view === 'shared' ? sharedWithMe || [] : files
    return base.filter(file => {
      if (!TYPES[file.type]) return false
      if (view === 'trash') return !!file.trashed
      if (file.trashed) return false
      if (view === 'favorites' && !file.starred) return false
      // Hosted records are not advertised as offline copies without verified local storage.
      if (view === 'offline' && !OFFLINE_ONLY) return false
      return true
    })
  }, [files, sharedWithMe, view])
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const matches = availableFiles.filter(file => (typeFilter === 'all' || file.type === typeFilter) && `${file.name} ${TYPES[file.type].label}`.toLocaleLowerCase().includes(normalizedQuery)).sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name)
    if (sort === 'type') return TYPES[a.type].label.localeCompare(TYPES[b.type].label) || a.name.localeCompare(b.name)
    return (Date.parse(b.updated_at || '') || 0) - (Date.parse(a.updated_at || '') || 0)
  })
  const visibleFiles = view === 'recent' && !normalizedQuery && typeFilter === 'all' ? matches.slice(0, 8) : matches
  const matchingLocal = localFiles.filter(file => `${file.name} ${TYPES[file.appType || '']?.label || ''}`.toLocaleLowerCase().includes(normalizedQuery))
  const visibleLocal = (showLocalAll ? matchingLocal : matchingLocal.slice(0, 6)) as LocalEntry[]
  const panelHeading = normalizedQuery ? 'Search results' : view === 'recent' ? 'Recent files' : view === 'favorites' ? 'Favorites' : view === 'shared' ? 'Shared with me' : view === 'offline' ? 'Available offline' : view === 'trash' ? 'Deleted files' : 'All files'

  const actions = (file: LocalFirstFile) => <Menu align={actionMenuAlign} width="w-48" trigger={<button type="button" aria-label={`Actions for ${file.name}`} onClick={event => setActionMenuAlign(event.currentTarget.getBoundingClientRect().right < 208 ? 'left' : 'right')} onKeyDown={event => setActionMenuAlign(event.currentTarget.getBoundingClientRect().right < 208 ? 'left' : 'right')} className="h-8 w-8 rounded-lg flex items-center justify-center text-ink-faint hover:bg-bg-elev2 hover:text-ink focus-visible:shadow-focus"><MoreHorizontal size={17} /></button>}>
    {!file.trashed && <Menu.Item onClick={() => openFile(file)}><ArrowUpRight size={14} />Open file</Menu.Item>}
    {view !== 'shared' && <>{!file.trashed ? <>
      <Menu.Item onClick={() => void fileAction(() => toggleStar(file.id))}><Star size={14} fill={file.starred ? 'currentColor' : 'none'} />{file.starred ? 'Remove favorite' : 'Add to favorites'}</Menu.Item>
      <Menu.Item onClick={() => { setRenameTarget(file); setRenameValue(file.name); setActionError('') }}><Pencil size={14} />Rename</Menu.Item>
      {(!OFFLINE_ONLY || file.type === 'doc') && <Menu.Item onClick={() => OFFLINE_ONLY ? void navigate(`/docs/${file.id}?bluetooth=share`) : setSharing(file)}><Share2 size={14} />{OFFLINE_ONLY ? 'Share via Bluetooth' : 'Share file'}</Menu.Item>}
      <Menu.Item className="text-danger" onClick={() => void fileAction(() => trashFile(file.id))}><Trash2 size={14} />Move to trash</Menu.Item>
    </> : <>
      <Menu.Item onClick={() => void fileAction(() => restoreFile(file.id))}><RotateCcw size={14} />Restore file</Menu.Item>
      <Menu.Item className="text-danger" onClick={() => { setDeleteTarget(file); setActionError('') }}><Trash2 size={14} />Delete permanently</Menu.Item>
    </>}</>}
  </Menu>

  return <div className="flex-1 min-w-0 overflow-auto bg-bg">
    <div className="max-w-[1280px] mx-auto px-5 sm:px-8 lg:px-10 pt-7 sm:pt-9 pb-8">
      <header className="flex items-start sm:items-center justify-between gap-4 mb-7 sm:mb-9">
        <div className="min-w-0"><p className="text-[11px] text-ink-faint font-medium mb-2">{OFFLINE_ONLY ? 'Your local workspace' : 'Your personal workspace'}</p><h1 className="font-display text-[27px] sm:text-[34px] leading-tight font-semibold tracking-[-0.04em] text-ink">{VIEW_COPY[view].heading}</h1><p className="text-xs sm:text-sm text-ink-muted mt-2 leading-relaxed max-w-xl">{VIEW_COPY[view].description}</p></div>
        <div className="flex items-center gap-2 shrink-0 pt-1"><Button className="hidden sm:inline-flex" onClick={() => fileInput.current?.click()} disabled={!!importing}>{importing === '__upload__' ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}Open file</Button><Button variant="primary" onClick={() => openNew()} aria-label="New file"><Plus size={16} /><span className="hidden sm:inline">New file</span></Button></div>
      </header>

      {view === 'recent' && !normalizedQuery && <section aria-labelledby="create-heading" className="mb-8 sm:mb-10"><div className="flex items-center justify-between gap-2 mb-3.5"><h2 id="create-heading" className="font-semibold text-[13px] text-ink">Create something new</h2><span className="text-[11px] text-ink-faint hidden sm:block">Big ideas start with a blank page</span></div><div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">{Object.entries(TYPES).map(([type, info]) => {
        const Icon = info.icon
        return <button key={type} aria-label={type === 'pdf' ? 'Open PDF' : `New ${info.singular}`} onClick={() => type === 'pdf' ? pdfInput.current?.click() : openNew(type)} className="group min-w-0 rounded-xl border border-line bg-paper p-4 text-left hover:border-accent hover:shadow-e1 transition-[border-color,box-shadow] focus-visible:shadow-focus"><div className="flex items-center justify-between mb-4"><span className={`w-10 h-10 rounded-xl flex items-center justify-center ${info.bgCn}`}><Icon size={21} strokeWidth={1.7} className={info.iconCn} /></span><ArrowUpRight size={14} className="text-ink-faint group-hover:text-accent transition-colors" /></div><h3 className="font-semibold text-[12px] text-ink">{info.label}</h3><p className="text-[10px] text-ink-faint mt-1.5 leading-relaxed">{info.description}</p></button>
      })}</div></section>}

      <section aria-labelledby="files-heading">
        <div className="flex items-center justify-between gap-3 mb-4"><div className="flex items-center gap-2.5"><h2 id="files-heading" className="text-[15px] font-semibold tracking-tight text-ink">{panelHeading}</h2><span className="text-[10px] font-medium text-ink-faint bg-paper border border-line rounded-full px-2 py-0.5">{matches.length}</span></div>{view === 'recent' && files.some(file => !file.trashed) && <button onClick={() => setView('all')} className="text-[11px] text-accent font-medium inline-flex items-center gap-1.5 hover:underline">View all files<ArrowRight size={12} /></button>}</div>
        <div className="flex flex-wrap items-center gap-2.5 mb-4">
          <div className="relative flex-1 min-w-[160px] sm:max-w-[340px]"><Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" /><input type="search" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setQuery('') }} placeholder="Search files by name or type…" aria-label="Search workspace files" className="w-full h-10 rounded-lg bg-paper border border-line pl-10 pr-9 text-xs text-ink focus:border-accent focus:outline-none" />{query && <button aria-label="Clear search" onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-ink-faint rounded hover:bg-bg-elev2"><X size={13} /></button>}</div>
          <select aria-label="Filter files by type" value={typeFilter} onChange={event => setTypeFilter(event.target.value)} className="h-10 bg-paper border border-line rounded-lg px-2.5 text-[11px] text-ink-muted max-w-[150px]"><option value="all">All file types</option>{Object.entries(TYPES).map(([key, info]) => <option key={key} value={key}>{info.label}</option>)}</select>
          <select aria-label="Sort files" value={sort} onChange={event => setSort(event.target.value)} className="h-10 bg-paper border border-line rounded-lg px-2.5 text-[11px] text-ink-muted max-w-[145px]"><option value="modified">Last modified</option><option value="name">Name A–Z</option><option value="type">File type</option></select>
          <div className="flex items-center gap-0.5 p-0.5 rounded-lg border border-line bg-paper ml-auto" role="group" aria-label="File view"><button type="button" aria-label="List view" aria-pressed={viewMode === 'list'} onClick={() => setViewMode('list')} className={`h-8 w-8 rounded-md flex items-center justify-center ${viewMode === 'list' ? 'bg-accent-tint text-accent' : 'text-ink-faint hover:text-ink'}`}><List size={15} /></button><button type="button" aria-label="Grid view" aria-pressed={viewMode === 'grid'} onClick={() => setViewMode('grid')} className={`h-8 w-8 rounded-md flex items-center justify-center ${viewMode === 'grid' ? 'bg-accent-tint text-accent' : 'text-ink-faint hover:text-ink'}`}><LayoutGrid size={14} /></button></div>
        </div>

        {loadError && <div role="alert" className="p-4 border border-danger rounded-xl text-sm text-danger bg-paper"><p>Your files could not be opened. {loadError}</p><Button className="mt-3" onClick={() => void fetchFiles()}>Try opening files again</Button></div>}
        {loading && <Card role="status" aria-label="Loading files">{Array.from({ length: 3 }, (_, index) => <div key={index} className="flex gap-3 p-5 border-b last:border-b-0 border-line"><Skeleton className="w-10 h-10" /><div className="flex-1 space-y-2 pt-1"><Skeleton className="h-3 w-2/5" /><Skeleton className="h-2.5 w-1/5" /></div></div>)}</Card>}
        {!loading && !loadError && visibleFiles.length === 0 && <Card className="px-5 py-10 sm:py-12 text-center"><div className="mx-auto w-14 h-14 rounded-2xl border border-line bg-bg flex items-center justify-center text-accent mb-4">{view === 'favorites' ? <Star size={24} strokeWidth={1.5} /> : view === 'shared' ? <Users size={24} strokeWidth={1.5} /> : view === 'trash' ? <Trash2 size={24} strokeWidth={1.5} /> : view === 'offline' ? <HardDrive size={24} strokeWidth={1.5} /> : <FolderOpen size={25} strokeWidth={1.5} />}</div><h3 className="font-semibold text-ink text-sm">{normalizedQuery || typeFilter !== 'all' ? 'No files match this view' : VIEW_COPY[view].empty}</h3><p className="text-xs text-ink-muted leading-relaxed max-w-sm mx-auto mt-2 mb-5">{normalizedQuery || typeFilter !== 'all' ? 'Try another name or choose a different file type.' : view === 'favorites' ? 'Choose Add to favorites from a file’s menu to find it here.' : view === 'shared' ? OFFLINE_ONLY ? 'Account sharing is available in the connected workspace. Use Bluetooth from a document to share with a paired laptop.' : 'When someone shares a file with your account, it will appear here.' : view === 'offline' && !OFFLINE_ONLY ? 'Open the installed LocalFirst offline workspace to work with files stored on this device. Hosted files are not automatically saved offline.' : view === 'trash' ? 'Files you move to trash appear here. You can restore them whenever you need.' : 'A note, a plan, an idea worth keeping. Create your first file and make this workspace your own.'}</p>{normalizedQuery || typeFilter !== 'all' ? <Button onClick={() => { setQuery(''); setTypeFilter('all') }}>Clear filters</Button> : view === 'favorites' || view === 'trash' || view === 'shared' || (view === 'offline' && !OFFLINE_ONLY) ? <Button onClick={() => setView('all')}>Browse all files<ArrowRight size={13} /></Button> : <Button variant="primary" onClick={() => openNew()}><Plus size={14} />New file</Button>}</Card>}

        {!loading && visibleFiles.length > 0 && (viewMode === 'grid' ? <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">{visibleFiles.map(file => {
          const info = TYPES[file.type]
          return <div key={file.id} className="group bg-paper border border-line rounded-xl hover:border-line-strong hover:shadow-e1 transition-[border-color,box-shadow]"><button disabled={!!file.trashed} onClick={() => openFile(file)} aria-label={`Open ${file.name}`} className="w-full block overflow-hidden h-32 rounded-t-xl border-b border-line bg-bg disabled:cursor-default"><DocThumb type={file.type as 'doc' | 'sheet' | 'slide' | 'whiteboard' | 'pdf'} className="h-full" /></button><div className="p-3.5"><div className="flex gap-1 items-center"><button disabled={!!file.trashed} onClick={() => openFile(file)} className="text-xs font-medium text-ink text-left truncate min-w-0 flex-1 disabled:cursor-default">{file.name}</button>{actions(file)}</div><div className="flex items-center justify-between gap-2 mt-1 text-[10px] text-ink-faint"><span className="truncate">{info.singular}</span><span className="shrink-0 flex items-center gap-1">{file.starred && <Star size={10} className="text-warning" fill="currentColor" />}{timeAgo(file.updated_at)}</span></div></div></div>
        })}</div> : <Card style={{ overflow: 'visible' }}>
          <div className="hidden sm:grid grid-cols-[minmax(0,1fr)_110px_120px_36px] items-center gap-4 px-5 py-3 bg-bg-elev2 border-b border-line rounded-t-xl text-[10px] uppercase tracking-[0.08em] font-semibold text-ink-faint"><span>Name</span><span>Type</span><span>Last modified</span><span /></div>
          {visibleFiles.map(file => {
            const info = TYPES[file.type]
            const Icon = info.icon
            return <div key={file.id} className="group grid grid-cols-[minmax(0,1fr)_36px] sm:grid-cols-[minmax(0,1fr)_110px_120px_36px] gap-3 sm:gap-4 items-center px-4 sm:px-5 py-3 border-b last:border-b-0 border-line hover:bg-bg-elev2 transition-colors first:rounded-t-xl last:rounded-b-xl"><button disabled={!!file.trashed} onClick={() => openFile(file)} className="flex items-center gap-3 min-w-0 text-left py-0.5 disabled:cursor-default" aria-label={`Open ${file.name}`}><span className={`w-9 h-10 rounded-lg flex items-center justify-center shrink-0 ${info.bgCn}`}><Icon size={18} className={info.iconCn} strokeWidth={1.65} /></span><span className="min-w-0"><span className="flex items-center gap-1.5"><span className="truncate text-xs font-medium text-ink">{file.name}</span>{file.starred && <Star size={11} className="shrink-0 text-warning" fill="currentColor" />}</span><span className="sm:hidden block text-[10px] text-ink-faint mt-1">{info.singular} · {timeAgo(file.updated_at)}</span>{view === 'shared' && <span className="block text-[10px] text-ink-faint mt-1">Shared by {file.owner || 'another account'}</span>}</span></button><span className="hidden sm:block text-[11px] text-ink-muted">{info.singular}</span><span className="hidden sm:flex text-[11px] text-ink-muted items-center gap-1.5"><Clock size={11} className="text-ink-faint" />{timeAgo(file.updated_at)}</span>{actions(file)}</div>
          })}
        </Card>)}
        {!loading && visibleFiles.length > 0 && <div className="flex justify-between items-center gap-3 mt-3 text-[10px] text-ink-faint"><span>{view === 'recent' && visibleFiles.length < matches.length ? `Showing ${visibleFiles.length} of ${matches.length} files` : `${matches.length} ${matches.length === 1 ? 'file' : 'files'}`}</span><span className="flex items-center gap-1.5">{OFFLINE_ONLY ? <><HardDrive size={11} />Stored on this device</> : <><Check size={11} />Your workspace files</>}</span></div>}
      </section>

      {!OFFLINE_ONLY && (view === 'recent' || view === 'all') && <section className="mt-9" aria-labelledby="computer-heading"><div className="flex items-center justify-between gap-3 mb-4"><div className="flex items-center gap-2"><HardDrive size={15} className="text-ink-faint" /><h2 id="computer-heading" className="text-[13px] font-semibold text-ink">On your computer</h2></div><button disabled={localLoading} onClick={() => void scan()} className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted hover:text-accent disabled:opacity-50 p-1"><RefreshCw size={12} className={localLoading ? 'animate-spin' : ''} />{localLoading ? 'Scanning…' : 'Rescan'}</button></div>{localLoading && !scanned && <Card className="p-6 flex items-center gap-3 text-xs text-ink-muted" role="status"><FolderSearch size={18} className="text-ink-faint animate-pulse" />Scanning Documents, Downloads &amp; Desktop…</Card>}{scanned && matchingLocal.length === 0 && <Card className="p-6 flex items-center gap-4"><span className="w-11 h-11 rounded-xl bg-bg border border-line flex items-center justify-center shrink-0"><FolderSearch size={20} className="text-ink-faint" /></span><div><p className="text-xs font-medium text-ink">{normalizedQuery ? 'No computer files match your search' : 'Bring your existing work along'}</p><p className="text-[11px] text-ink-faint mt-1">{normalizedQuery ? 'Try another file name.' : 'No supported files found in Documents, Downloads or Desktop.'}</p></div></Card>}{visibleLocal.length > 0 && <Card>{visibleLocal.map(file => {
        const info = TYPES[file.appType]
        if (!info) return null
        const Icon = info.icon
        return <button key={file.path} onClick={() => void handleLocalOpen(file)} disabled={!!importing} className="w-full flex items-center gap-3 p-4 text-left group border-b last:border-b-0 border-line hover:bg-bg-elev2 disabled:opacity-60"><span className={`w-9 h-10 rounded-lg flex items-center justify-center shrink-0 ${info.bgCn}`}><Icon size={17} className={info.iconCn} /></span><span className="min-w-0 flex-1"><span className="block text-xs font-medium text-ink truncate">{file.name}</span><span className="block text-[10px] text-ink-faint truncate mt-1">{file.path.replace(/\/Users\/[^/]+/, '~')}</span></span><span className="hidden sm:block text-[10px] text-ink-faint">{formatBytes(file.size)} · {timeAgo(file.modified)}</span>{importing === file.path ? <Loader2 size={14} className="animate-spin text-accent" /> : <ArrowUpRight size={14} className="text-ink-faint group-hover:text-accent" />}</button>
      })}</Card>}{matchingLocal.length > 6 && <button onClick={() => setShowLocalAll(value => !value)} className="mt-3 text-xs text-accent hover:underline">{showLocalAll ? 'Show fewer files' : `Show all ${matchingLocal.length} files`}</button>}</section>}

      <footer className="flex items-center justify-between gap-3 pt-7 mt-8 border-t border-line text-[10px] text-ink-faint"><span>LocalFirst · Space for your best work.</span><span className="hidden sm:block">Documents, ideas, and everything in between.</span></footer>
    </div>
    <input ref={fileInput} type="file" accept=".docx,.txt,.md,.rtf,.html,.htm,.odt,.xlsx,.xls,.csv,.tsv,.ods,.pptx,.odp,.pdf,.excalidraw" className="sr-only" tabIndex={-1} aria-label="Import a file" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void handleImport(file) }} />
    <input ref={pdfInput} type="file" accept=".pdf" className="sr-only" tabIndex={-1} aria-label="Open a PDF file" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void handleImport(file) }} />
    {showNew && <NewFileModal defaultType={newType as 'doc' | 'sheet' | 'slide' | 'whiteboard'} onClose={() => setShowNew(false)} />}
    {sharing && <AccountShareModal open file={sharing} me={accountId || undefined} onClose={() => { setSharing(null); void fetchSharedWithMe() }} />}
    <Modal open={!!renameTarget} title="Rename file" onClose={() => { if (!actionBusy) setRenameTarget(null) }}><Modal.Body><form id="rename-workspace-file" onSubmit={event => { event.preventDefault(); if (renameTarget && renameValue.trim()) void submitDialog(() => renameFile(renameTarget.id, renameValue.trim()), () => setRenameTarget(null)) }}><Input label="File name" autoFocus value={renameValue} onChange={event => setRenameValue(event.target.value)} maxLength={512} required />{actionError && <p role="alert" className="mt-3 text-xs text-danger">{actionError}</p>}</form></Modal.Body><Modal.Footer><Button disabled={actionBusy} onClick={() => setRenameTarget(null)}>Cancel</Button><Button type="submit" form="rename-workspace-file" variant="primary" disabled={actionBusy || !renameValue.trim()}>{actionBusy ? 'Saving…' : 'Save name'}</Button></Modal.Footer></Modal>
    <Modal open={!!deleteTarget} title="Delete this file permanently?" onClose={() => { if (!actionBusy) setDeleteTarget(null) }}><Modal.Body className="space-y-3 text-sm"><p className="font-medium break-words">{deleteTarget?.name}</p><p className="text-ink-muted">This removes the file and its version history. You will need a backup to recover it.</p>{actionError && <p role="alert" className="text-danger">{actionError}</p>}</Modal.Body><Modal.Footer><Button disabled={actionBusy} onClick={() => setDeleteTarget(null)}>Cancel</Button><Button variant="destructive" disabled={actionBusy} onClick={() => { if (deleteTarget) void submitDialog(() => deleteFile(deleteTarget.id), () => setDeleteTarget(null)) }}>{actionBusy ? 'Deleting…' : 'Delete permanently'}</Button></Modal.Footer></Modal>
    {toast}
  </div>
}

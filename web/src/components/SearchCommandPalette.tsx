import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, FileText, Table2, Presentation, PenTool, Settings, ArrowUpRight, FileSearch } from 'lucide-react'
import { useFilesStore } from '../store/filesStore'
import { Modal } from './ui'

const destinations = [
  { name: 'Documents', route: '/docs', icon: FileText },
  { name: 'Spreadsheets', route: '/sheets', icon: Table2 },
  { name: 'Presentations', route: '/slides', icon: Presentation },
  { name: 'Whiteboards', route: '/whiteboards', icon: PenTool },
  { name: 'PDF Studio', route: '/pdf', icon: FileSearch },
  { name: 'Settings', route: '/settings', icon: Settings },
]
const paths: Record<string, string> = { doc: 'docs', sheet: 'sheets', slide: 'slides', whiteboard: 'whiteboards', pdf: 'pdf' }
export default function SearchCommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const files = useFilesStore(state => state.files)
  const navigate = useNavigate()
  const matches = files.filter(file => !file.trashed && file.name.toLowerCase().includes(query.toLowerCase())).slice(0, 8)
  const actions = destinations.filter(item => item.name.toLowerCase().includes(query.toLowerCase()))
  const results = [...matches.map(file => ({ name: file.name, route: `/${paths[file.type] || 'docs'}/${file.id}`, icon: FileText })), ...actions]
  const go = (route: string) => { setOpen(false); void navigate(route) }
  useEffect(() => {
    const show = () => { setQuery(''); setSelected(0); setOpen(true); void useFilesStore.getState().fetchFiles() }
    const keyboard = (event: KeyboardEvent) => {
      // Rich-text engines already own Ctrl/Cmd+K for inserting a link.
      // Keep that editing shortcut; workspace search remains available in chrome.
      if (event.defaultPrevented || (event.target instanceof HTMLElement && event.target.closest('[contenteditable="true"]'))) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); show() }
    }
    window.addEventListener('keydown', keyboard)
    window.addEventListener('localfirst:open-search', show)
    return () => { window.removeEventListener('keydown', keyboard); window.removeEventListener('localfirst:open-search', show) }
  }, [])
  useEffect(() => { if (open) input.current?.focus() }, [open])
  return <Modal open={open} onClose={() => setOpen(false)} title="Search your workspace" size="lg">
    <Modal.Body>
      <div className="flex items-center gap-3 border border-line rounded-lg px-3 bg-bg">
        <Search size={18} className="text-ink-faint" aria-hidden="true" />
        <input ref={input} data-autofocus value={query} onChange={event => { setQuery(event.target.value); setSelected(0) }} aria-label="Search files and applications" placeholder="Find a file, app or setting…" className="min-w-0 w-full bg-transparent py-3 outline-none" aria-controls="workspace-search-results" aria-activedescendant={results[selected] ? `workspace-result-${selected}` : undefined} role="combobox" aria-expanded="true" aria-autocomplete="list" onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setSelected(value => results.length ? (value + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length : 0) }
          if (event.key === 'Enter') { event.preventDefault(); if (results[selected]) go(results[selected].route); else go(`/?q=${encodeURIComponent(query)}`) }
        }} />
        <kbd className="text-xs text-ink-faint">Esc</kbd>
      </div>
      <div id="workspace-search-results" role="listbox" aria-label="Search results" className="mt-3 max-h-80 overflow-auto space-y-1">
        {results.map(({ name, route, icon: Icon }, index) => <button key={route} id={`workspace-result-${index}`} role="option" aria-selected={selected === index} onMouseEnter={() => setSelected(index)} onClick={() => go(route)} className={`flex w-full items-center gap-3 rounded-lg p-3 text-left text-sm ${index === selected ? 'bg-accent-tint text-accent' : 'text-ink-muted hover:bg-bg'}`}>
          <Icon size={17} aria-hidden="true" /><span className="flex-1 truncate">{name}</span><ArrowUpRight size={14} aria-hidden="true" />
        </button>)}
        {!results.length && <p className="p-6 text-center text-sm text-ink-muted">No matching files. Try another name.</p>}
      </div>
      <p className="mt-3 text-xs text-ink-faint">↑ ↓ to move · Enter to open · Ctrl/Cmd+K in the workspace</p>
    </Modal.Body>
  </Modal>
}

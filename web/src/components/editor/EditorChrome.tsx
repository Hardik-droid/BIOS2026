import type { ReactNode } from 'react'
import { FileText, Table2, Presentation, PenTool, FileSearch, Minus, Plus } from 'lucide-react'
import './editor.css'

export type EditorKind = 'doc' | 'sheet' | 'slide' | 'whiteboard' | 'pdf'

const apps = {
  doc: { icon: FileText, label: 'Documents' },
  sheet: { icon: Table2, label: 'Spreadsheets' },
  slide: { icon: Presentation, label: 'Presentations' },
  whiteboard: { icon: PenTool, label: 'Whiteboards' },
  pdf: { icon: FileSearch, label: 'PDF Studio' },
}

export function EditorIdentity({ kind }: { kind: EditorKind }) {
  const Icon = apps[kind].icon
  return <span className={`lf-editor-identity lf-editor-identity--${kind}`} title={apps[kind].label} aria-hidden="true"><Icon size={20} strokeWidth={1.8} /></span>
}

export function EditorTitle({ kind, value, onChange, label, placeholder, readOnly, maxLength }: {
  kind: EditorKind
  value: string
  onChange?: (value: string) => void
  label: string
  placeholder?: string
  readOnly?: boolean
  maxLength?: number
}) {
  return <div className="lf-editor-title">
    <span className="lf-editor-breadcrumb">{apps[kind].label}<span aria-hidden="true">/</span><span>LocalFirst</span></span>
    <input aria-label={label} value={value} onChange={event => onChange?.(event.target.value)} readOnly={readOnly} maxLength={maxLength} placeholder={placeholder} />
  </div>
}

export function EditorStatusBar({ leading, children }: { leading?: ReactNode; children?: ReactNode }) {
  return <footer className="lf-editor-status" aria-label="Editor information">
    <div className="lf-editor-status-leading">{leading}</div>
    <div className="lf-editor-status-actions">{children}</div>
  </footer>
}

export function EditorZoom({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return <div className="lf-editor-zoom" role="group" aria-label="Document zoom">
    <button type="button" aria-label="Zoom out" title="Zoom out" disabled={value <= 50} onClick={() => onChange(Math.max(50, value - 25))}><Minus size={13} /></button>
    <select aria-label="Zoom percentage" value={value} onChange={event => onChange(Number(event.target.value))}>
      {[50, 75, 100, 125, 150].map(percent => <option key={percent} value={percent}>{percent}%</option>)}
    </select>
    <button type="button" aria-label="Zoom in" title="Zoom in" disabled={value >= 150} onClick={() => onChange(Math.min(150, value + 25))}><Plus size={13} /></button>
  </div>
}

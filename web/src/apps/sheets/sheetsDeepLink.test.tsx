/**
 * sheetsDeepLink.test.jsx — opening a spreadsheet by URL (deep link / refresh)
 * must actually render the document's cells.
 *
 * FortuneSheet's <Workbook> is UNCONTROLLED: it reads `data` at MOUNT and ignores
 * later changes to the prop. When a sheet is opened directly (a bookmark, a hard
 * refresh, the screenshotter), the file is not yet in the store, so the editor
 * mounts on the empty fallback sheet and only afterwards does api.getFile resolve.
 * The resulting setData was silently dropped by the grid, and the user saw an
 * EMPTY spreadsheet — as though their data were gone.
 *
 * The mock below reproduces exactly that semantics (it records the data it was
 * given at mount, and ignores prop updates), so this test fails against the old
 * code and passes only when a wholesale load remounts the grid.
 */
import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Minimal shape of the plain-data sheet the mocked Workbook is handed — a
// deliberately small local slice, not the real (large, mostly-required)
// FortuneSheet Sheet type, since this mock replaces the whole module.
type MockCell = { r: number; c: number; v?: { v?: string | number } }
type MockSheet = { celldata?: MockCell[] }

// Records the `data` each Workbook MOUNT was given — never prop updates.
const mounts: (MockSheet[] | undefined)[] = []

vi.mock('@fortune-sheet/react', () => ({
  // Faithful stand-in for FortuneSheet's UNCONTROLLED grid: it snapshots `data`
  // at mount (useState initialiser) and ignores every later change to the prop.
  // Without that, the mock would happily re-render on the new data and the test
  // would pass against the very bug it exists to catch.
  Workbook: ({ data }: { data?: MockSheet[] }) => {
    const [mountData] = useState(data)
    if (!mounts.includes(mountData)) mounts.push(mountData)
    const cells = (mountData?.[0]?.celldata || []).map((c) => c?.v?.v).filter(Boolean)
    return <div data-testid="grid">{cells.join('|')}</div>
  },
}))
vi.mock('@fortune-sheet/react/dist/index.css', () => ({}))

const SHEET = {
  id: 'demo-sheet',
  name: 'Revenue Tracker H1 2026',
  type: 'sheet',
  content: [{
    name: 'Revenue',
    row: 10,
    column: 6,
    celldata: [
      { r: 0, c: 0, v: { v: 'Month', m: 'Month', t: 's' } },
      { r: 1, c: 0, v: { v: 'January', m: 'January', t: 's' } },
    ],
  }],
}

vi.mock('../../lib/api', () => ({
  api: {
    // The file is NOT in the store (deep link), so the editor must fetch it.
    getFile: vi.fn(() => Promise.resolve(SHEET)),
    updateFile: vi.fn(() => Promise.resolve(SHEET)),
    listFiles: vi.fn(() => Promise.resolve([])),
  },
}))

describe('Sheets deep link (open by URL / refresh)', () => {
  beforeEach(() => { mounts.length = 0 })

  it('renders the fetched document, not the empty fallback sheet', async () => {
    const { default: SheetsEditor } = await import('./SheetsEditor.jsx')

    render(
      <MemoryRouter initialEntries={['/sheets/demo-sheet']}>
        <Routes>
          <Route path="/sheets/:id" element={<SheetsEditor />} />
        </Routes>
      </MemoryRouter>,
    )

    // The document's cells must reach the grid. Before the fix the workbook
    // stayed mounted on the fallback sheet and this never appeared.
    await waitFor(() => {
      expect(screen.getByTestId('grid').textContent).toContain('January')
    })

    // And the grid must have been REMOUNTED with the loaded document — the only
    // way an uncontrolled workbook can ever show it.
    const loaded = mounts.some((d) => (d?.[0]?.celldata || []).some((c) => c?.v?.v === 'January'))
    expect(loaded).toBe(true)
  })
})

describe('Fortune matrix persistence boundary', () => {
  it('round-trips dense edited cells without dropping formulas, formats, zero or false', async () => {
    const { normalizeSheets } = await import('./SheetsEditor.jsx')
    const formula = { v: 0, m: '0', f: '=1-1', ct: { fa: '0.00', t: 'n' } }
    const normalized = normalizeSheets([{
      name: 'Saved workbook',
      data: [[null, formula, false], [0, { v: 'January', m: 'January' }, null]],
      celldata: [{ r: 0, c: 0, v: { v: 'stale sparse value' } }],
    }])
    expect(normalized[0]?.data).toBeUndefined()
    expect(normalized[0]?.celldata).toEqual([
      { r: 0, c: 1, v: formula },
      { r: 0, c: 2, v: false },
      { r: 1, c: 0, v: 0 },
      { r: 1, c: 1, v: { v: 'January', m: 'January' } },
    ])
    expect(normalizeSheets(JSON.parse(JSON.stringify(normalized)))).toEqual(normalized)
  })

  it('keeps explicit matrix deletions authoritative over older sparse values', async () => {
    const { normalizeSheets } = await import('./SheetsEditor.jsx')
    for (const data of [[], [[null, null], [null, null]]]) {
      const normalized = normalizeSheets([{ celldata: [{ r: 0, c: 0, v: { v: 'deleted' } }], data }])
      expect(normalized[0]?.celldata).toEqual([])
      expect(normalized[0]?.data).toBeUndefined()
      expect(normalizeSheets(JSON.parse(JSON.stringify(normalized)))[0]?.celldata).toEqual([])
    }
  })

  it('keeps sparse-only imports authoritative when no matrix was saved', async () => {
    const { normalizeSheets } = await import('./SheetsEditor.jsx')
    const imported = [{ r: 2, c: 3, v: { v: 42, m: '42' } }]
    expect(normalizeSheets([{ celldata: imported }])[0]?.celldata).toEqual(imported)
  })
})

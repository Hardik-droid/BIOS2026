import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import AppErrorBoundary from '../AppErrorBoundary'
import { useFilesStore } from '../../store/filesStore'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
describe('screen failure recovery', () => {
  it('shows recovery actions without resetting existing file state when a child crashes', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    useFilesStore.setState({ files: [{ id: 'saved-file', name: 'Saved work', type: 'doc', rev: 2 }] })
    function BrokenScreen(): never { throw new Error('Editor failed to render') }
    render(<AppErrorBoundary><BrokenScreen /></AppErrorBoundary>)
    expect(screen.getByRole('alert').textContent).toContain('Do not clear browser data')
    expect(screen.getByRole('button', { name: 'Reload app' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Return to files' })).toBeDefined()
    expect(useFilesStore.getState().files[0].name).toBe('Saved work')
  })
})

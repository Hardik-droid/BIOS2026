import { describe, expect, it, vi } from 'vitest'
vi.mock('../../lib/api', () => ({ api: { updateFile: vi.fn() } }))
vi.mock('../../lib/draftStore', () => ({ writeDraft: vi.fn().mockResolvedValue('draft-token'), clearDraft: vi.fn().mockResolvedValue(undefined) }))
import { api } from '../../lib/api'
import { getSaveState, useFilesStore } from '../filesStore'

describe('save acknowledgements and typing during a pending save', () => {
  it('keeps the document unsaved when a newer edit arrived before an older save completed', async () => {
    let finish!: (value: unknown) => void
    vi.mocked(api.updateFile).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const id = crypto.randomUUID()
    useFilesStore.setState({ files: [{ id, name: 'Document', type: 'doc', content: 'original', rev: 1 }] })
    useFilesStore.getState().markDirty(id)
    const saving = useFilesStore.getState().saveFileWithDraft(id, 'Document', 'first edit')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    useFilesStore.getState().markDirty(id)
    finish({ id, name: 'Document', type: 'doc', content: 'first edit', rev: 2 })
    await saving
    expect(getSaveState(id).status).toBe('dirty')
    vi.mocked(api.updateFile).mockResolvedValueOnce({ id, name: 'Document', type: 'doc', content: 'latest edit', rev: 3 })
    await useFilesStore.getState().saveFileWithDraft(id, 'Document', 'latest edit')
    expect(getSaveState(id).status).toBe('saved')
  })
})

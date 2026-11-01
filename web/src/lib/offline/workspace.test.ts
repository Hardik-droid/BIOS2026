import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { clearDraft, readDraft, writeDraft } from '../draftStore'
import { localRequest } from './localApi'
import { closeWorkspace, createLocalFile, deviceMetadata, exportLocalWorkspace, getLocalFile, listLocalVersions, moveLocalFile, updateLocalFile, enableLocalReplica, acceptLocalReplica } from './workspace'

beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()) })
afterEach(async () => { await closeWorkspace(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const create = () => createLocalFile({ name: 'Local document', type: 'doc', content: { text: 'initial' } })

describe('transactional local workspace', () => {
  it('prevents an older snapshot editor from overwriting a document after replica migration', async () => {
    const file = await create()
    await enableLocalReplica(file.id)
    await expect(updateLocalFile(file.id, { content: { text: 'stale editor' }, rev: 1 })).rejects.toMatchObject({ status: 409 })
    expect((await getLocalFile(file.id)).content).toEqual(file.content)
    expect((await updateLocalFile(file.id, { content: { text: 'replica snapshot' }, rev: 1, replica: true })).rev).toBe(2)
  })
  it('receiving an offer cannot overwrite an unrelated existing local file', async () => {
    const file = await create()
    await expect(acceptLocalReplica(file.id, 'Incoming offer')).rejects.toMatchObject({ status: 409 })
    expect((await getLocalFile(file.id)).name).toBe(file.name)
    await enableLocalReplica(file.id)
    expect((await acceptLocalReplica(file.id, 'Incoming offer')).content).toEqual(file.content)
  })
  it('creates an awaiting replica only after explicit acceptance of a valid offer', async () => {
    const file = await acceptLocalReplica(crypto.randomUUID(), 'Shared document')
    expect(file.nearby_enabled).toBe(true)
    expect(file.nearby_initial).toBe(true)
    expect((await getLocalFile(file.id)).name).toBe('Shared document')
  })
  it('does not advance the revision when an editor hydrates unchanged content', async () => {
    const file = await create()
    expect((await updateLocalFile(file.id, { name: file.name, content: file.content, rev: file.rev })).rev).toBe(1)
    expect(await listLocalVersions(file.id)).toEqual([])
  })
  it('survives a connection close and reopen with the same committed content', async () => {
    const file = await create()
    const updated = await updateLocalFile(file.id, { name: 'Edited', content: { text: 'offline work' }, rev: file.rev })
    await closeWorkspace()
    expect(await getLocalFile(file.id)).toEqual(updated)
    expect(updated.rev).toBe(2)
  })
  it('allows only one simultaneous writer for a revision and preserves the other work as a conflict', async () => {
    const file = await create()
    const writes = await Promise.allSettled([
      updateLocalFile(file.id, { content: { text: 'A' }, rev: 1 }),
      updateLocalFile(file.id, { content: { text: 'B' }, rev: 1 }),
    ])
    expect(writes.filter(write => write.status === 'fulfilled')).toHaveLength(1)
    const rejected = writes.find(write => write.status === 'rejected')
    expect(rejected?.status === 'rejected' && rejected.reason.status).toBe(409)
    expect((await getLocalFile(file.id)).rev).toBe(2)
    expect(await listLocalVersions(file.id)).toHaveLength(1)
  })
  it('aborts the file and history together when a write hits a quota error', async () => {
    const file = await create()
    const original = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'files') throw new DOMException('Storage full', 'QuotaExceededError')
      return original.apply(this, args)
    })
    await expect(updateLocalFile(file.id, { content: { text: 'must not be reported saved' }, rev: 1 })).rejects.toThrow('Storage full')
    expect((await getLocalFile(file.id)).content).toEqual({ text: 'initial' })
    expect(await listLocalVersions(file.id)).toEqual([])
  })
  it('keeps the last 50 versions in revision order even when timestamps collide', async () => {
    const file = await create()
    for (let rev = 1; rev <= 60; rev++) await updateLocalFile(file.id, { content: { text: String(rev) }, rev })
    const versions = await listLocalVersions(file.id)
    expect(versions).toHaveLength(50)
    expect(versions[0].rev).toBe(60)
    expect(versions.at(-1)?.rev).toBe(11)
  })
  it('restores a local version without deleting its history', async () => {
    const file = await create()
    await updateLocalFile(file.id, { content: { text: 'later' }, rev: 1 })
    const [version] = await listLocalVersions(file.id)
    await localRequest(`/files/${file.id}/versions/${version.id}/restore`, { method: 'POST' })
    expect((await getLocalFile(file.id)).content).toEqual({ text: 'initial' })
    expect((await getLocalFile(file.id)).rev).toBe(3)
    expect(await listLocalVersions(file.id)).toHaveLength(2)
  })
  it('does not move a document into a missing folder', async () => {
    const file = await create()
    await expect(moveLocalFile(file.id, { parent_id: 'missing' })).rejects.toMatchObject({ status: 404 })
    expect((await getLocalFile(file.id)).parent_id).toBe('')
  })
  it('creates one persistent device identity under concurrent initialization', async () => {
    const [a, b] = await Promise.all([deviceMetadata(), deviceMetadata()])
    expect(a.id).toBe(b.id)
    await closeWorkspace()
    expect((await deviceMetadata()).id).toBe(a.id)
  })
  it('exports actual committed records and history in one local backup', async () => {
    const file = await create()
    await updateLocalFile(file.id, { content: { text: 'backed up' }, rev: 1 })
    const backup = JSON.parse(await exportLocalWorkspace()) as { format: string; files: Array<{ content: unknown }>; versions: unknown[] }
    expect(backup.format).toBe('localfirst-local-workspace')
    expect(backup.files[0].content).toEqual({ text: 'backed up' })
    expect(backup.versions).toHaveLength(1)
  })
  it('rejects unsupported features and malformed data without using fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await expect(localRequest('/auth/login', { method: 'POST', body: '{}' })).rejects.toMatchObject({ status: 501 })
    await expect(localRequest('/files', { method: 'POST', body: JSON.stringify({ name: '', type: 'doc' }) })).rejects.toMatchObject({ status: 400 })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('recovery draft acknowledgement', () => {
  it('never clears a newer draft when an older save finishes', async () => {
    const older = await writeDraft('same-doc', 'A', { text: 'first' })
    const newer = await writeDraft('same-doc', 'A', { text: 'second' })
    expect(older).toBeTruthy()
    expect(newer).toBeTruthy()
    await clearDraft('same-doc', older!)
    expect((await readDraft('same-doc'))?.content).toEqual({ text: 'second' })
    await clearDraft('same-doc', newer!)
    expect(await readDraft('same-doc')).toBeNull()
  })
})

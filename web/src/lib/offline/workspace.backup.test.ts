import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { closeWorkspace, createLocalFile, createLocalFolder, deleteLocalFolder, deviceMetadata, exportLocalWorkspace, getLocalFile, importLocalWorkspace, listLocalFiles, listLocalFolders, listLocalVersions, moveLocalFile, parseWorkspaceBackup, updateLocalFile, updateLocalFolder } from './workspace'

beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()) })
afterEach(async () => { await closeWorkspace(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const content = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const create = () => createLocalFile({ name: 'Notes العربية हिन्दी', type: 'doc', content: content('original') })

describe('safe backup restoration', () => {
  it('round-trips imported HTML documents without requiring the editor to convert them first', async () => {
    await createLocalFile({ name: 'Imported HTML', type: 'doc', content: { _html: '<p>Local imported text</p>' } })
    await importLocalWorkspace(await exportLocalWorkspace())
    expect((await listLocalFiles()).filter(file => (file.content as { _html?: string })._html === '<p>Local imported text</p>')).toHaveLength(2)
  })
  it('restores new copies with history and folders while preserving existing work and device identity', async () => {
    const device = await deviceMetadata()
    const file = await create()
    const folder = await createLocalFolder('My folder', '')
    await moveLocalFile(file.id, { parent_id: folder.id, starred: true })
    await updateLocalFile(file.id, { content: content('saved offline'), rev: 1 })
    const json = await exportLocalWorkspace()
    await updateLocalFile(file.id, { content: content('newer local work'), rev: 2 })
    expect(await importLocalWorkspace(json)).toEqual({ files: 1, folders: 1 })
    expect((await getLocalFile(file.id)).content).toEqual(content('newer local work'))
    const copy = (await listLocalFiles()).find(entry => entry.id !== file.id)!
    expect(copy.content).toEqual(content('saved offline'))
    expect(copy.starred).toBe(true)
    expect(copy.parent_id).not.toBe(folder.id)
    expect((await listLocalFolders()).find(entry => entry.id === copy.parent_id)?.name).toBe(folder.name)
    expect((await listLocalVersions(copy.id))[0].content).toEqual(content('original'))
    expect(await deviceMetadata()).toEqual(device)
  })
  it('validates every record before any import write', async () => {
    await create()
    const backup = JSON.parse(await exportLocalWorkspace())
    backup.files.push({ ...backup.files[0], id: 'bad-record', name: '' })
    await expect(importLocalWorkspace(JSON.stringify(backup))).rejects.toMatchObject({ status: 400 })
    expect(await listLocalFiles()).toHaveLength(1)
  })
  it('rolls back all imported records on quota failure', async () => {
    await create()
    await createLocalFolder('Folder', '')
    const json = await exportLocalWorkspace()
    const original = IDBObjectStore.prototype.add
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['add']>) {
      if (this.name === 'files') throw new DOMException('Storage full', 'QuotaExceededError')
      return original.apply(this, args)
    })
    await expect(importLocalWorkspace(json)).rejects.toThrow('Storage full')
    expect(await listLocalFiles()).toHaveLength(1)
    expect(await listLocalFolders()).toHaveLength(1)
  })
  it.each(['not json', '{}', '{"format":"diwan-local-workspace","version":99}'])('rejects invalid or unsupported backup %s', async json => {
    await expect(importLocalWorkspace(json)).rejects.toMatchObject({ status: 400 })
    expect(await listLocalFiles()).toEqual([])
  })
  it('rejects duplicate IDs and folder cycles', async () => {
    await create()
    const folder = await createLocalFolder('Folder', '')
    const backup = JSON.parse(await exportLocalWorkspace())
    expect(() => parseWorkspaceBackup(JSON.stringify({ ...backup, files: [...backup.files, backup.files[0]] }))).toThrow('duplicate')
    backup.folders[0].parent_id = folder.id
    expect(() => parseWorkspaceBackup(JSON.stringify(backup))).toThrow('loop')
  })
  it('rejects orphan history, unknown document types and malformed content', async () => {
    const file = await create()
    await updateLocalFile(file.id, { content: content('later'), rev: 1 })
    const backup = JSON.parse(await exportLocalWorkspace())
    expect(() => parseWorkspaceBackup(JSON.stringify({ ...backup, versions: [{ ...backup.versions[0], file_id: 'missing' }] }))).toThrow('missing')
    expect(() => parseWorkspaceBackup(JSON.stringify({ ...backup, files: [{ ...backup.files[0], type: 'unknown' }] }))).toThrow('unknown')
    expect(() => parseWorkspaceBackup(JSON.stringify({ ...backup, files: [{ ...backup.files[0], content: { type: 'doc', content: [null] } }] }))).toThrow('invalid')
  })
  it('rejects excessive nesting before it reaches an editor', async () => {
    await create()
    const backup = JSON.parse(await exportLocalWorkspace())
    let nested: unknown = { type: 'paragraph' }
    for (let i = 0; i < 70; i++) nested = { type: 'blockquote', content: [nested] }
    backup.files[0].content = { type: 'doc', content: [nested] }
    expect(() => parseWorkspaceBackup(JSON.stringify(backup))).toThrow('too complex')
  })
})

describe('folder lifecycle does not orphan documents', () => {
  it('renames, trashes, restores and removes a folder without deleting its contents', async () => {
    const folder = await createLocalFolder('Folder', '')
    const child = await createLocalFolder('Child', folder.id)
    const file = await create()
    await moveLocalFile(file.id, { parent_id: folder.id })
    expect((await updateLocalFolder(folder.id, { name: 'Renamed' })).name).toBe('Renamed')
    expect((await updateLocalFolder(folder.id, { trashed: true })).trashed).toBe(true)
    expect((await updateLocalFolder(folder.id, { trashed: false })).trashed).toBe(false)
    await deleteLocalFolder(folder.id)
    expect((await getLocalFile(file.id)).parent_id).toBe('')
    expect((await listLocalFolders()).find(entry => entry.id === child.id)?.parent_id).toBe('')
  })
})

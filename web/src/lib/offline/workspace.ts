import { LEGACY } from '../brandCompatibility'
/** Local document storage. Success is reported only after an IndexedDB commit. */
export const WORKSPACE_DB = LEGACY.workspaceDatabase
export const MAX_BACKUP_BYTES = 32 * 1024 * 1024
const DB_VERSION = 1
const VERSION_LIMIT = 50
const MAX_CONTENT_BYTES = 16 * 1024 * 1024

export interface LocalFile {
  [key: string]: unknown
  id: string
  name: string
  type: string
  content: unknown
  rev: number
  owner: string
  parent_id: string
  starred: boolean
  trashed: boolean
  created_at: string
  updated_at: string
  nearby_enabled?: boolean
  nearby_initial?: boolean
}
export interface LocalFolder { id: string; name: string; parent_id: string; trashed: boolean; created_at: string }
export interface LocalVersion { id: string; file_id: string; name: string; content: unknown; rev: number; created_at: string; label: string }
export interface DeviceMetadata { key: string; id: string; created_at: string }

export class WorkspaceError extends Error {
  constructor(message: string, public status: number, public current?: LocalFile) { super(message); this.name = 'WorkspaceError' }
}

let connection: Promise<IDBDatabase> | undefined
export function openWorkspace(): Promise<IDBDatabase> {
  if (connection) return connection
  connection = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(WORKSPACE_DB, DB_VERSION)
    let expired = false
    const timeout = setTimeout(() => { expired = true; reject(new Error('Local storage is blocked. Close other LocalFirst tabs, then try again.')) }, 10000)
    request.onupgradeneeded = () => {
      const db = request.result
      db.createObjectStore('files', { keyPath: 'id' })
      db.createObjectStore('folders', { keyPath: 'id' })
      db.createObjectStore('metadata', { keyPath: 'key' })
      const versions = db.createObjectStore('versions', { keyPath: 'id' })
      versions.createIndex('file_id', 'file_id')
    }
    request.onerror = () => { clearTimeout(timeout); reject(request.error || new Error('Local storage could not be opened.')) }
    request.onsuccess = () => {
      clearTimeout(timeout)
      const db = request.result
      if (expired) { db.close(); return }
      db.onversionchange = () => { db.close(); connection = undefined }
      resolve(db)
    }
  }).catch((error: unknown) => { connection = undefined; throw error })
  return connection
}

export async function closeWorkspace(): Promise<void> {
  const current = connection
  connection = undefined
  if (current) (await current).close()
}

function read<T>(request: IDBRequest<T>, fail: (error: Error) => void, callback: (value: T) => void): void {
  request.onsuccess = () => {
    try { callback(request.result) }
    catch (error) { fail(error instanceof Error ? error : new Error(String(error))) }
  }
}

function transaction<T>(db: IDBDatabase, stores: string[], mode: IDBTransactionMode, run: (tx: IDBTransaction, result: (value: T) => void, fail: (error: Error) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode, mode === 'readwrite' ? { durability: 'strict' } : {})
    let value: T
    let failure: Error | undefined
    tx.oncomplete = () => resolve(value)
    tx.onabort = () => reject(failure || tx.error || new Error('Local storage transaction was aborted.'))
    tx.onerror = () => { failure ||= tx.error || new Error('Local storage write failed.') }
    const fail = (error: Error) => { failure = error; tx.abort() }
    try { run(tx, result => { value = result }, fail) } catch (error) { fail(error instanceof Error ? error : new Error(String(error))) }
  })
}

function name(value: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 512) throw new WorkspaceError('A name between 1 and 512 characters is required.', 400)
  return value.trim()
}
function validateContent(content: unknown): void {
  if (new TextEncoder().encode(JSON.stringify(content) || 'null').length > MAX_CONTENT_BYTES) throw new WorkspaceError('This document exceeds the current 16 MiB local document limit.', 413)
}

export async function listLocalFiles(): Promise<LocalFile[]> {
  const db = await openWorkspace()
  return transaction(db, ['files'], 'readonly', (tx, result) => {
    tx.objectStore('files').getAll().onsuccess = event => result((event.target as IDBRequest<LocalFile[]>).result)
  })
}
export async function getLocalFile(id: string): Promise<LocalFile> {
  const db = await openWorkspace()
  return transaction(db, ['files'], 'readonly', (tx, result, fail) => {
    tx.objectStore('files').get(id).onsuccess = event => {
      const file = (event.target as IDBRequest<LocalFile | undefined>).result
      if (!file) fail(new WorkspaceError('Document not found on this device.', 404))
      else result(file)
    }
  })
}

/** Opt-in migration; unshared documents keep their existing snapshot behavior. */
export async function enableLocalReplica(id: string): Promise<LocalFile> {
  const db = await openWorkspace()
  return transaction(db, ['files'], 'readwrite', (tx, result, fail) => {
    const files = tx.objectStore('files')
    read(files.get(id) as IDBRequest<LocalFile | undefined>, fail, file => {
      if (!file || file.type !== 'doc' || file.trashed) return fail(new WorkspaceError('Open a saved document before sharing.', 400))
      const updated = { ...file, nearby_enabled: true }
      files.put(updated); result(updated)
    })
  })
}

export async function acceptLocalReplica(id: string, title: string): Promise<LocalFile> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new WorkspaceError('Invalid shared document identifier.', 400)
  const documentName = name(title)
  const db = await openWorkspace()
  return transaction(db, ['files'], 'readwrite', (tx, result, fail) => {
    const files = tx.objectStore('files')
    read(files.get(id) as IDBRequest<LocalFile | undefined>, fail, old => {
      if (old) {
        if (!old.nearby_enabled || old.trashed || old.type !== 'doc') return fail(new WorkspaceError('A different local file already uses this identifier. Existing work has not been replaced.', 409))
        result(old); return
      }
      const now = new Date().toISOString()
      const file: LocalFile = { id, name: documentName, type: 'doc', content: { type: 'doc', content: [{ type: 'paragraph' }] }, rev: 1, owner: 'self', parent_id: '', starred: false, trashed: false, created_at: now, updated_at: now, nearby_enabled: true, nearby_initial: true }
      files.add(file); result(file)
    })
  })
}
export async function createLocalFile(input: { name: string; type: string; content: unknown }): Promise<LocalFile> {
  const title = name(input.name)
  if (!['doc', 'sheet', 'slide', 'whiteboard', 'pdf'].includes(input.type)) throw new WorkspaceError('Unknown document type.', 400)
  validateContent(input.content)
  const now = new Date().toISOString()
  const file: LocalFile = { id: crypto.randomUUID(), name: title, type: input.type, content: input.content, rev: 1, owner: 'self', parent_id: '', starred: false, trashed: false, created_at: now, updated_at: now }
  const db = await openWorkspace()
  return transaction(db, ['files'], 'readwrite', (tx, result) => { tx.objectStore('files').add(file); result(file) })
}
export async function updateLocalFile(id: string, patch: { name?: string; content?: unknown; rev: number; replica?: boolean }): Promise<LocalFile> {
  if (patch.name !== undefined) name(patch.name)
  if ('content' in patch) validateContent(patch.content)
  const db = await openWorkspace()
  return transaction(db, ['files', 'versions'], 'readwrite', (tx, result, fail) => {
    const files = tx.objectStore('files')
    read(files.get(id) as IDBRequest<LocalFile | undefined>, fail, old => {
      if (!old) return fail(new WorkspaceError('Document not found on this device.', 404))
      if (old.nearby_enabled && !patch.replica) return fail(new WorkspaceError('This document now uses a shared replica. Download a recovery copy from this older editor, then close and reopen the document.', 409, old))
      if (patch.rev !== old.rev) return fail(new WorkspaceError('Another tab saved a newer version. Download a recovery copy of your work before reopening this document.', 409, old))
      const nextName = patch.name === undefined ? old.name : name(patch.name)
      const nextContent = 'content' in patch ? patch.content : old.content
      if (nextName === old.name && JSON.stringify(nextContent) === JSON.stringify(old.content)) { result(old); return }
      const updated = { ...old, name: nextName, content: nextContent, rev: old.rev + 1, updated_at: new Date().toISOString() }
      const versions = tx.objectStore('versions')
      versions.add({ id: crypto.randomUUID(), file_id: id, name: old.name, content: old.content, rev: old.rev, created_at: updated.updated_at, label: '' } satisfies LocalVersion)
      versions.index('file_id').getAll(id).onsuccess = entries => {
        const history = (entries.target as IDBRequest<LocalVersion[]>).result.sort((a, b) => a.rev - b.rev)
        for (const version of history.slice(0, Math.max(0, history.length - VERSION_LIMIT))) versions.delete(version.id)
      }
      files.put(updated)
      result(updated)
    })
  })
}
export async function deleteLocalFile(id: string): Promise<{ message: string }> {
  const db = await openWorkspace()
  return transaction(db, ['files', 'versions'], 'readwrite', (tx, result) => {
    tx.objectStore('files').delete(id)
    const versions = tx.objectStore('versions')
    versions.index('file_id').getAllKeys(id).onsuccess = event => {
      for (const key of (event.target as IDBRequest<IDBValidKey[]>).result) versions.delete(key)
    }
    result({ message: 'deleted' })
  })
}
export async function listLocalVersions(id: string): Promise<LocalVersion[]> {
  const db = await openWorkspace()
  return transaction(db, ['versions'], 'readonly', (tx, result) => {
    tx.objectStore('versions').index('file_id').getAll(id).onsuccess = event => result((event.target as IDBRequest<LocalVersion[]>).result.sort((a, b) => b.rev - a.rev))
  })
}
export async function listLocalFolders(): Promise<LocalFolder[]> {
  const db = await openWorkspace()
  return transaction(db, ['folders'], 'readonly', (tx, result) => { tx.objectStore('folders').getAll().onsuccess = event => result((event.target as IDBRequest<LocalFolder[]>).result) })
}
export async function createLocalFolder(title: string, parentId: string): Promise<LocalFolder> {
  const folder: LocalFolder = { id: crypto.randomUUID(), name: name(title), parent_id: parentId, trashed: false, created_at: new Date().toISOString() }
  const db = await openWorkspace()
  return transaction(db, ['folders'], 'readwrite', (tx, result, fail) => {
    const folders = tx.objectStore('folders')
    const add = () => { folders.add(folder); result(folder) }
    if (!parentId) add()
    else read(folders.get(parentId) as IDBRequest<LocalFolder | undefined>, fail, parent => {
      if (!parent) fail(new WorkspaceError('Parent folder not found.', 404))
      else add()
    })
  })
}
export async function updateLocalFolder(id: string, patch: { name?: string; trashed?: boolean }): Promise<LocalFolder> {
  if (patch.name !== undefined) name(patch.name)
  const db = await openWorkspace()
  return transaction(db, ['folders'], 'readwrite', (tx, result, fail) => {
    const folders = tx.objectStore('folders')
    read(folders.get(id) as IDBRequest<LocalFolder | undefined>, fail, folder => {
      if (!folder) return fail(new WorkspaceError('Folder not found on this device.', 404))
      const updated = { ...folder, ...patch, name: patch.name === undefined ? folder.name : name(patch.name) }
      folders.put(updated)
      result(updated)
    })
  })
}
export async function deleteLocalFolder(id: string): Promise<{ message: string }> {
  const db = await openWorkspace()
  return transaction(db, ['files', 'folders'], 'readwrite', (tx, result, fail) => {
    const folders = tx.objectStore('folders')
    read(folders.get(id) as IDBRequest<LocalFolder | undefined>, fail, folder => {
      if (!folder) return fail(new WorkspaceError('Folder not found on this device.', 404))
      for (const store of ['files', 'folders']) read(tx.objectStore(store).getAll() as IDBRequest<Array<LocalFile | LocalFolder>>, fail, entries => {
        for (const entry of entries) if (entry.parent_id === id) tx.objectStore(store).put({ ...entry, parent_id: '' })
      })
      folders.delete(id)
      result({ message: 'deleted' })
    })
  })
}
export async function moveLocalFile(id: string, patch: { parent_id?: string; starred?: boolean; trashed?: boolean }): Promise<LocalFile> {
  const db = await openWorkspace()
  return transaction(db, ['files', 'folders'], 'readwrite', (tx, result, fail) => {
    const files = tx.objectStore('files')
    read(files.get(id) as IDBRequest<LocalFile | undefined>, fail, file => {
      if (!file) return fail(new WorkspaceError('Document not found.', 404))
      const save = () => { const updated = { ...file, ...patch }; files.put(updated); result(updated) }
      if (patch.parent_id) read(tx.objectStore('folders').get(patch.parent_id) as IDBRequest<LocalFolder | undefined>, fail, parent => {
        if (!parent) fail(new WorkspaceError('Folder not found.', 404))
        else save()
      })
      else save()
    })
  })
}
export async function deviceMetadata(): Promise<DeviceMetadata> {
  const db = await openWorkspace()
  return transaction(db, ['metadata'], 'readwrite', (tx, result, fail) => {
    const store = tx.objectStore('metadata')
    read(store.get('device') as IDBRequest<DeviceMetadata | undefined>, fail, existing => {
      const device = existing || { key: 'device', id: crypto.randomUUID(), created_at: new Date().toISOString() }
      if (!existing) store.add(device)
      result(device)
    })
  })
}
export async function exportLocalWorkspace(): Promise<string> {
  const db = await openWorkspace()
  const backup = await transaction<Record<string, unknown>>(db, ['files', 'folders', 'versions', 'metadata'], 'readonly', (tx, result) => {
    const data: Record<string, unknown> = { format: 'localfirst-local-workspace', version: DB_VERSION, exported_at: new Date().toISOString() }
    for (const store of ['files', 'folders', 'versions', 'metadata']) tx.objectStore(store).getAll().onsuccess = event => { data[store] = (event.target as IDBRequest<unknown[]>).result }
    result(data)
  })
  return JSON.stringify(backup)
}

export interface WorkspaceBackup { format: 'localfirst-local-workspace'; version: 1; files: LocalFile[]; folders: LocalFolder[]; versions: LocalVersion[] }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WorkspaceError('The backup contains an invalid record.', 400)
  return value as Record<string, unknown>
}
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 128) throw new WorkspaceError('The backup contains an invalid identifier.', 400)
  return value
}
function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new WorkspaceError('The backup contains an invalid date.', 400)
  return new Date(value).toISOString()
}
function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new WorkspaceError('The backup contains an invalid revision.', 400)
  return value
}
function flag(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new WorkspaceError('The backup contains an invalid file state.', 400)
  return value
}
function backupContent(value: unknown, type: string): unknown {
  validateContent(value)
  // Guard nested/corrupt inputs before handing them to any editor. Only copy
  // whitelisted record fields; imported metadata never replaces device keys.
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]
  let count = 0
  while (pending.length) {
    const item = pending.pop()!
    if (++count > 200000 || item.depth > 64) throw new WorkspaceError('A document in this backup is too complex to restore safely.', 413)
    if (item.value && typeof item.value === 'object') {
      for (const child of Object.values(item.value)) pending.push({ value: child, depth: item.depth + 1 })
    }
  }
  if (type === 'doc') {
    const doc = record(value)
    // HTML/DOCX imports use this legacy representation; the editor's existing
    // sanitizeDocHtml boundary still runs before displaying this markup.
    if (typeof doc._html === 'string') return value
    if (doc.type !== 'doc' || !Array.isArray(doc.content)) throw new WorkspaceError('A document in this backup has invalid content.', 400)
    const nodes = [...doc.content] as unknown[]
    while (nodes.length) {
      const node = record(nodes.pop())
      if (typeof node.type !== 'string' || ('content' in node && !Array.isArray(node.content)) || ('text' in node && typeof node.text !== 'string')) throw new WorkspaceError('A document in this backup has invalid text nodes.', 400)
      if (Array.isArray(node.content)) for (const child of node.content) nodes.push(child)
    }
  }
  return value
}

/** Parse and validate the entire backup before opening any write transaction. */
export function parseWorkspaceBackup(json: string): WorkspaceBackup {
  if (new TextEncoder().encode(json).length > MAX_BACKUP_BYTES) throw new WorkspaceError('This backup exceeds the 32 MiB restore limit. Restore a smaller backup.', 413)
  let data: Record<string, unknown>
  try { data = record(JSON.parse(json)) } catch { throw new WorkspaceError('Choose a valid LocalFirst workspace JSON backup.', 400) }
  if ((data.format !== 'localfirst-local-workspace' && data.format !== LEGACY.backupFormat) || data.version !== 1) throw new WorkspaceError('This backup format or version is not supported.', 400)
  if (!Array.isArray(data.files) || !Array.isArray(data.folders) || !Array.isArray(data.versions) || data.files.length > 1000 || data.folders.length > 1000 || data.versions.length > 50000) throw new WorkspaceError('This backup has invalid or too many records.', 400)
  const files = data.files.map(value => {
    const entry = record(value)
    if (typeof entry.type !== 'string' || !['doc', 'sheet', 'slide', 'whiteboard', 'pdf'].includes(entry.type)) throw new WorkspaceError('The backup contains an unknown document type.', 400)
    return { id: identifier(entry.id), name: name(entry.name as string), type: entry.type, content: backupContent(entry.content, entry.type), rev: revision(entry.rev), owner: 'self', parent_id: entry.parent_id === '' ? '' : identifier(entry.parent_id), starred: flag(entry.starred), trashed: flag(entry.trashed), created_at: timestamp(entry.created_at), updated_at: timestamp(entry.updated_at) } satisfies LocalFile
  })
  const folders = data.folders.map(value => {
    const entry = record(value)
    return { id: identifier(entry.id), name: name(entry.name as string), parent_id: entry.parent_id === '' ? '' : identifier(entry.parent_id), trashed: flag(entry.trashed), created_at: timestamp(entry.created_at) } satisfies LocalFolder
  })
  const byFile = new Map(files.map(file => [file.id, file]))
  const byFolder = new Map(folders.map(folder => [folder.id, folder]))
  if (byFile.size !== files.length || byFolder.size !== folders.length) throw new WorkspaceError('The backup contains duplicate identifiers.', 400)
  for (const entry of [...files, ...folders]) if (entry.parent_id && !byFolder.has(entry.parent_id)) throw new WorkspaceError('The backup refers to a missing folder.', 400)
  for (const folder of folders) {
    const visited = new Set([folder.id])
    let parent = folder.parent_id
    while (parent) {
      if (visited.has(parent)) throw new WorkspaceError('The backup contains a folder loop.', 400)
      visited.add(parent)
      parent = byFolder.get(parent)!.parent_id
    }
  }
  const versions = data.versions.map(value => {
    const entry = record(value)
    const file = byFile.get(identifier(entry.file_id))
    if (!file) throw new WorkspaceError('The backup contains history for a missing document.', 400)
    const rev = revision(entry.rev)
    if (rev >= file.rev) throw new WorkspaceError('The backup contains invalid version history.', 400)
    return { id: identifier(entry.id), file_id: file.id, name: name(entry.name as string), content: backupContent(entry.content, file.type), rev, created_at: timestamp(entry.created_at), label: typeof entry.label === 'string' ? entry.label.slice(0, 512) : '' } satisfies LocalVersion
  })
  if (new Set(versions.map(version => version.id)).size !== versions.length || new Set(versions.map(version => `${version.file_id}:${version.rev}`)).size !== versions.length) throw new WorkspaceError('The backup contains duplicate version identifiers or revisions.', 400)
  return { format: 'localfirst-local-workspace', version: 1, files, folders, versions }
}

/** Restore as new copies. Existing records and this device's identity survive. */
export async function importLocalWorkspace(json: string): Promise<{ files: number; folders: number }> {
  const backup = parseWorkspaceBackup(json)
  const fileIds = new Map(backup.files.map(file => [file.id, crypto.randomUUID()]))
  const folderIds = new Map(backup.folders.map(folder => [folder.id, crypto.randomUUID()]))
  const db = await openWorkspace()
  return transaction(db, ['files', 'folders', 'versions'], 'readwrite', (tx, result) => {
    for (const folder of backup.folders) tx.objectStore('folders').add({ ...folder, id: folderIds.get(folder.id)!, parent_id: folderIds.get(folder.parent_id) || '' })
    for (const file of backup.files) tx.objectStore('files').add({ ...file, id: fileIds.get(file.id)!, parent_id: folderIds.get(file.parent_id) || '' })
    const histories = new Map<string, LocalVersion[]>()
    for (const version of backup.versions) {
      const history = histories.get(version.file_id) || []
      history.push(version)
      histories.set(version.file_id, history)
    }
    for (const history of histories.values()) for (const version of history.sort((a, b) => b.rev - a.rev).slice(0, VERSION_LIMIT)) tx.objectStore('versions').add({ ...version, id: crypto.randomUUID(), file_id: fileIds.get(version.file_id)! })
    result({ files: backup.files.length, folders: backup.folders.length })
  })
}

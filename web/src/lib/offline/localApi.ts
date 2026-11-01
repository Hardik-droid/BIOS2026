import {
  createLocalFile, createLocalFolder, deleteLocalFile, deleteLocalFolder, deviceMetadata, getLocalFile,
  listLocalFiles, listLocalFolders, listLocalVersions, moveLocalFile, updateLocalFile, updateLocalFolder,
  WorkspaceError, WORKSPACE_DB,
} from './workspace'

/** Explicit local operations. Unsupported operations never fall through to HTTP. */
export async function localRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = options.method || 'GET'
  const url = new URL(path, 'https://local.invalid')
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  let body: Record<string, unknown> = {}
  if (options.body !== undefined) {
    if (typeof options.body !== 'string') throw new WorkspaceError('This operation is not available in the local workspace.', 501)
    const parsed: unknown = JSON.parse(options.body)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new WorkspaceError('Invalid local request.', 400)
    body = parsed as Record<string, unknown>
  }
  const text = (key: string): string => {
    if (typeof body[key] !== 'string') throw new WorkspaceError(`${key} is required.`, 400)
    return body[key]
  }
  let value: unknown
  if (path === '/auth/status' && method === 'GET') value = { enabled: false, authenticated: true, mode: 'local-device' }
  else if (path === '/system/info' && method === 'GET') {
    const device = await deviceMetadata()
    value = { account_id: 'self', is_admin: false, version: 'offline-foundation', integration_mode: 'local-device', device_id: device.id, auth: { mode: 'local-device', user_count: 1 }, storage: { backend: 'indexeddb', data_dir: WORKSPACE_DB, uploads_dir: 'not-enabled', object_store: { active: false } } }
  } else if (parts[0] === 'files' && parts.length === 1 && method === 'GET') value = await listLocalFiles()
  else if (parts[0] === 'files' && parts.length === 1 && method === 'POST') value = await createLocalFile({ name: text('name'), type: text('type'), content: body.content })
  else if (parts[0] === 'files' && parts.length === 2 && method === 'GET') value = await getLocalFile(parts[1])
  else if (parts[0] === 'files' && parts.length === 2 && method === 'PUT') {
    if (typeof body.rev !== 'number' || !Number.isSafeInteger(body.rev) || body.rev < 1) throw new WorkspaceError('A valid document revision is required for a local save.', 409)
    value = await updateLocalFile(parts[1], { name: text('name'), content: body.content, rev: body.rev, replica: body.replica === true })
  } else if (parts[0] === 'files' && parts.length === 2 && method === 'DELETE') value = await deleteLocalFile(parts[1])
  else if (parts[0] === 'files' && parts[2] === 'move' && parts.length === 3 && method === 'POST') {
    const patch: { parent_id?: string; starred?: boolean; trashed?: boolean } = {}
    if ('parent_id' in body) patch.parent_id = text('parent_id')
    for (const key of ['starred', 'trashed'] as const) {
      if (key in body) {
        if (typeof body[key] !== 'boolean') throw new WorkspaceError(`Invalid ${key} value.`, 400)
        patch[key] = body[key]
      }
    }
    value = await moveLocalFile(parts[1], patch)
  } else if (parts[0] === 'files' && parts[2] === 'versions' && parts.length === 3 && method === 'GET') value = await listLocalVersions(parts[1])
  else if (parts[0] === 'files' && parts[2] === 'versions' && parts[4] === 'restore' && parts.length === 5 && method === 'POST') {
    const versions = await listLocalVersions(parts[1])
    const version = versions.find(entry => entry.id === parts[3])
    if (!version) throw new WorkspaceError('Version not found on this device.', 404)
    const file = await getLocalFile(parts[1])
    value = await updateLocalFile(file.id, { name: version.name, content: version.content, rev: file.rev })
  } else if (path === '/folders' && method === 'GET') value = await listLocalFolders()
  else if (path === '/folders' && method === 'POST') value = await createLocalFolder(text('name'), typeof body.parent_id === 'string' ? body.parent_id : '')
  else if (parts[0] === 'folders' && parts.length === 2 && method === 'PUT') value = await updateLocalFolder(parts[1], { name: text('name') })
  else if (parts[0] === 'folders' && parts.length === 2 && method === 'DELETE') value = await deleteLocalFolder(parts[1])
  else if (parts[0] === 'folders' && parts.length === 3 && parts[2] === 'trash' && method === 'POST') {
    if (typeof body.trashed !== 'boolean') throw new WorkspaceError('Invalid folder state.', 400)
    value = await updateLocalFolder(parts[1], { trashed: body.trashed })
  }
  else if (parts[0] === 'search' && method === 'GET') {
    const query = (url.searchParams.get('q') || '').trim().toLocaleLowerCase()
    const type = url.searchParams.get('type')
    const files = await listLocalFiles()
    value = { query, results: query ? files.filter(file => !file.trashed && (!type || file.type === type) && `${file.name} ${JSON.stringify(file.content)}`.toLocaleLowerCase().includes(query)).map(file => ({ id: file.id, name: file.name, type: file.type, owner: 'self', shared: false, snippet: file.name })) : [] }
  } else throw new WorkspaceError('This feature is not available in the offline workspace yet.', 501)
  return value as T
}

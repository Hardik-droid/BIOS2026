import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { LEGACY, migrateBrandPreferences } from './brandCompatibility'
import { closeWorkspace, createLocalFile, exportLocalWorkspace, getLocalFile, importLocalWorkspace } from './offline/workspace'
import { createBluetoothInvitationFile, parseBluetoothInvitation } from './nearby/invitation'

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  const storage = Object.create(null) as Storage
  Object.defineProperties(storage, {
    getItem: { value: (key: string) => Object.hasOwn(storage, key) ? storage[key] as string : null },
    setItem: { value: (key: string, value: string) => Object.defineProperty(storage, key, { value: String(value), enumerable: true, configurable: true, writable: true }) },
  })
  vi.stubGlobal('localStorage', storage)
})
afterEach(async () => { await closeWorkspace(); vi.unstubAllGlobals() })

describe('LocalFirst data compatibility', () => {
  it('copies old preferences once, preserves the original, and keeps an explicit new choice', () => {
    localStorage.setItem('diwan.theme', 'dark')
    localStorage.setItem('diwan.sidebar', 'mini')
    migrateBrandPreferences()
    expect(localStorage.getItem('localfirst.theme')).toBe('dark')
    expect(localStorage.getItem('localfirst.sidebar')).toBe('mini')
    expect(localStorage.getItem('diwan.theme')).toBe('dark')
    localStorage.setItem('localfirst.theme', 'light')
    migrateBrandPreferences()
    expect(localStorage.getItem('localfirst.theme')).toBe('light')
  })

  it('restores an old workspace backup while keeping existing IDs and newly saved content', async () => {
    const file = await createLocalFile({ name: 'Existing work', type: 'doc', content: { type: 'doc', content: [{ type: 'paragraph' }] } })
    const backup = JSON.parse(await exportLocalWorkspace())
    expect(backup.format).toBe('localfirst-local-workspace')
    backup.format = LEGACY.backupFormat
    expect(await importLocalWorkspace(JSON.stringify(backup))).toEqual({ files: 1, folders: 0 })
    expect((await getLocalFile(file.id)).name).toBe('Existing work')
  })

  it('accepts old invitation files while generating only the new download format', () => {
    const invitation = 'DBT1-' + 'A'.repeat(86)
    expect(parseBluetoothInvitation(JSON.stringify({ format: LEGACY.invitationFormat, version: 1, invitation }))).toBe(invitation)
    expect(JSON.parse(createBluetoothInvitationFile(invitation)).format).toBe('localfirst-bluetooth-invitation')
  })
})

/** Persisted contracts intentionally retain their original bytes. Never rename
 * databases or encryption domain labels just to change the displayed brand. */
export const LEGACY = {
  workspaceDatabase: 'diwan-local-workspace',
  draftsDatabase: 'diwan-drafts',
  replicasDatabase: 'diwan-replicas',
  replicaOrigin: 'diwan-replica-replay',
  replicaChannel: 'diwan-replica-',
  documentMetadata: 'diwan-meta',
  gridEngine: 'diwan/grid-lww-lamport@1',
  roomAAD: 'diwan-p2p-room-v1',
  keyEncryption: 'diwan-p2p/enc',
  keyMAC: 'diwan-p2p/mac-rw',
  keyRoomID: 'diwan-p2p/roomid',
  dataChannel: 'diwan-fabric',
  backupFormat: 'diwan-local-workspace',
  invitationFormat: 'diwan-bluetooth-invitation',
  connectionFormat: 'diwan-bluetooth-connection-report',
} as const

/** Copy preferences without deleting the original: old tabs can still finish
 * saving. Durable documents stay in the same database, profile and origin. */
export function migrateBrandPreferences(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (!/^diwan[._-]/.test(key)) continue
      const canonical = key.replace(/^diwan/, 'localfirst')
      const value = localStorage.getItem(key)
      if (value !== null && localStorage.getItem(canonical) === null) localStorage.setItem(canonical, value)
    }
    for (const suffix of ['autosave_delay', 'spellcheck', 'default_view', 'pdf_sigs']) {
      const value = localStorage.getItem(`vulos_${suffix}`)
      if (value !== null && localStorage.getItem(`localfirst_${suffix}`) === null) localStorage.setItem(`localfirst_${suffix}`, value)
    }
  } catch { /* Restricted preferences must never prevent document access. */ }
}

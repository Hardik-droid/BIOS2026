import { Y, applyRemoteUpdate, isFragmentEmpty, seedUpdateFromPMJSON, SEED_ORIGIN, REMOTE_ORIGIN, MAX_SNAPSHOT_BYTES, type YContext } from '../crdt/ydoc'

const DB_NAME = 'diwan-replicas'
const REPLAY = 'diwan-replica-replay'
interface UpdateRecord { seq?: number; fileId: string; data: Uint8Array }
interface Checkpoint { fileId: string; data: Uint8Array }

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('checkpoints', { keyPath: 'fileId' })
      request.result.createObjectStore('updates', { keyPath: 'seq', autoIncrement: true }).createIndex('fileId', 'fileId')
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result) }
  })
}
function transaction<T>(db: IDBDatabase, mode: IDBTransactionMode, work: (tx: IDBTransaction, result: (value: T) => void, fail: (error: unknown) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['checkpoints', 'updates'], mode, mode === 'readwrite' ? { durability: 'strict' } : {})
    let value: T
    let failure: unknown
    tx.oncomplete = () => resolve(value)
    tx.onabort = () => reject(failure || tx.error || new Error('Local replica write was interrupted.'))
    tx.onerror = () => reject(tx.error || new Error('Local replica storage failed.'))
    const fail = (error: unknown) => { failure = error; tx.abort() }
    try { work(tx, result => { value = result }, fail) } catch (error) { fail(error) }
  })
}

/** Append before acknowledging a peer. Checkpoint and log pruning commit together. */
export class LocalReplica {
  private tail: Promise<void> = Promise.resolve()
  private failure: Error | null = null
  private replaying = false
  private closed = false
  private count = 0
  private channel: BroadcastChannel | null = null
  private persisted = new Set<(update: Uint8Array) => void>()
  private onUpdate: (update: Uint8Array, origin: unknown) => void
  private constructor(public readonly context: YContext, public readonly fileId: string, private db: IDBDatabase, private changed: () => void, private failed: (error: Error) => void) {
    this.onUpdate = (update, origin) => {
      if (this.replaying || this.closed) return
      const copy = update.slice()
      const write = this.tail.then(async () => {
        if (this.failure) throw this.failure
        if (copy.length > MAX_SNAPSHOT_BYTES || Y.encodeStateAsUpdate(context.ydoc).length > MAX_SNAPSHOT_BYTES) throw new Error('This Bluetooth document reached the 1 MiB replica limit. Download a recovery copy before continuing.')
        await transaction<void>(db, 'readwrite', (tx, _result, fail) => {
          tx.objectStore('updates').add({ fileId, data: copy } satisfies UpdateRecord)
          if (++this.count >= 128) {
            // Another tab may have committed an update not delivered to this
            // Y.Doc yet. Merge every committed record inside this transaction
            // before pruning, rather than checkpointing this tab alone.
            let old: Checkpoint | undefined
            let entries: UpdateRecord[] | null = null
            let gotCheckpoint = false
            const compact = () => {
              if (!gotCheckpoint || !entries) return
              try {
                const all = [Y.encodeStateAsUpdate(context.ydoc), ...(old ? [old.data] : []), ...entries.map(entry => entry.data)]
                const merged = Y.mergeUpdates(all.map(bytes => new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)))
                if (merged.length > MAX_SNAPSHOT_BYTES) throw new Error('The shared replica reached its 1 MiB checkpoint limit. Download a recovery copy.')
                tx.objectStore('checkpoints').put({ fileId, data: merged } satisfies Checkpoint)
                for (const entry of entries) if (entry.seq !== undefined) tx.objectStore('updates').delete(entry.seq)
              } catch (reason) { fail(reason) }
            }
            tx.objectStore('checkpoints').get(fileId).onsuccess = event => { old = (event.target as IDBRequest<Checkpoint | undefined>).result; gotCheckpoint = true; compact() }
            tx.objectStore('updates').index('fileId').getAll(fileId).onsuccess = event => { entries = (event.target as IDBRequest<UpdateRecord[]>).result; compact() }
            this.count = 0
          }
        })
        this.changed()
        // Radio edits must reach other tabs too. Broadcast consumers replay an
        // already committed update rather than writing/broadcasting it again.
        this.channel?.postMessage(copy)
        if (origin !== REMOTE_ORIGIN) for (const listener of this.persisted) listener(copy)
      })
      this.tail = write.catch((reason: unknown) => {
        this.failure = reason instanceof Error ? reason : new Error('Local replica storage failed.')
        this.failed(this.failure)
      })
    }
  }
  static async open(context: YContext, fileId: string, seed: Record<string, unknown> | null, title: string, changed: () => void, failed: (error: Error) => void, metadata?: Record<string, unknown>): Promise<LocalReplica> {
    const db = await database()
    const replica = new LocalReplica(context, fileId, db, changed, failed)
    try {
      const found = await replica.pull()
      if (!found && seed) {
        Y.applyUpdate(context.ydoc, seedUpdateFromPMJSON(context.schema, seed), SEED_ORIGIN)
        context.ydoc.getMap('diwan-meta').set('title', title)
        for (const key of ['pageSetup', 'headerFooter']) if (metadata?.[key] && typeof metadata[key] === 'object') context.ydoc.getMap('diwan-meta').set(key, metadata[key])
      }
      const snapshot = Y.encodeStateAsUpdate(context.ydoc)
      if (snapshot.length > MAX_SNAPSHOT_BYTES) throw new Error('Bluetooth sharing currently supports documents up to 1 MiB of replica data.')
      if (!found) {
        // Two first opens can both observe an empty journal before either
        // initializes it. Merge inside the write transaction so neither seed
        // can overwrite a checkpoint or update committed by the other tab.
        await transaction<void>(db, 'readwrite', (tx, _result, fail) => {
          let old: Checkpoint | undefined
          let entries: UpdateRecord[] | null = null
          let gotCheckpoint = false
          const initialize = () => {
            if (!gotCheckpoint || !entries) return
            try {
              const merged = Y.mergeUpdates([snapshot, ...(old ? [old.data] : []), ...entries.map(entry => entry.data)].map(bytes => new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)))
              if (merged.length > MAX_SNAPSHOT_BYTES) throw new Error('The shared replica reached its 1 MiB checkpoint limit. Download a recovery copy.')
              tx.objectStore('checkpoints').put({ fileId, data: merged } satisfies Checkpoint)
            } catch (reason) { fail(reason) }
          }
          tx.objectStore('checkpoints').get(fileId).onsuccess = event => { old = (event.target as IDBRequest<Checkpoint | undefined>).result; gotCheckpoint = true; initialize() }
          tx.objectStore('updates').index('fileId').getAll(fileId).onsuccess = event => { entries = (event.target as IDBRequest<UpdateRecord[]>).result; initialize() }
        })
        await replica.pull()
      }
      context.ydoc.on('update', replica.onUpdate)
      if (typeof BroadcastChannel !== 'undefined') {
        replica.channel = new BroadcastChannel(`diwan-replica-${fileId}`)
        replica.channel.onmessage = event => {
          const update = event.data
          if (ArrayBuffer.isView(update) && 'BYTES_PER_ELEMENT' in update && update.BYTES_PER_ELEMENT === 1 && update.byteLength <= MAX_SNAPSHOT_BYTES) {
            const bytes = new Uint8Array(update.buffer, update.byteOffset, update.byteLength)
            replica.replaying = true
            let applied: ReturnType<typeof applyRemoteUpdate>
            try {
              applied = applyRemoteUpdate(context, bytes)
            } finally { replica.replaying = false }
            if (!applied.applied) failed(new Error('A local replica update was rejected: ' + applied.reason))
            else { changed(); for (const listener of replica.persisted) listener(bytes) }
          }
        }
      }
      return replica
    } catch (error) { db.close(); throw error }
  }
  async pull(): Promise<boolean> {
    const before = Y.encodeStateVector(this.context.ydoc)
    const records = await transaction<{ checkpoint?: Checkpoint; updates: UpdateRecord[] }>(this.db, 'readonly', (tx, result) => {
      const data: { checkpoint?: Checkpoint; updates: UpdateRecord[] } = { updates: [] }
      tx.objectStore('checkpoints').get(this.fileId).onsuccess = event => { const entry = (event.target as IDBRequest<Checkpoint | undefined>).result; if (entry) data.checkpoint = entry }
      tx.objectStore('updates').index('fileId').getAll(this.fileId).onsuccess = event => { data.updates = (event.target as IDBRequest<UpdateRecord[]>).result }
      result(data)
    })
    this.replaying = true
    this.count = Math.max(this.count, records.updates.length)
    try {
      for (const update of [records.checkpoint?.data, ...records.updates.map(entry => entry.data)]) {
        if (!update) continue
        if (!ArrayBuffer.isView(update) || update.BYTES_PER_ELEMENT !== 1 || update.byteLength > MAX_SNAPSHOT_BYTES) throw new Error('Invalid local replica checkpoint.')
        const bytes = new Uint8Array(update.buffer, update.byteOffset, update.byteLength)
        // An empty awaiting replica is valid, but not yet editable.
        if (bytes.length <= 2 && isFragmentEmpty(this.context.ydoc)) { Y.applyUpdate(this.context.ydoc, bytes, REPLAY); continue }
        const applied = applyRemoteUpdate(this.context, bytes)
        if (!applied.applied) throw new Error('Local replica recovery failed: ' + applied.reason)
      }
    } finally { this.replaying = false }
    const recovered = Y.encodeStateAsUpdate(this.context.ydoc, before)
    if (recovered.length > 2) for (const listener of this.persisted) listener(recovered)
    return !!records.checkpoint || records.updates.length > 0
  }
  get hasContent(): boolean { return !isFragmentEmpty(this.context.ydoc) }
  onPersisted(listener: (update: Uint8Array) => void): () => void { this.persisted.add(listener); return () => { this.persisted.delete(listener) } }
  async flush(): Promise<void> {
    // A local edit can append another write while an earlier commit is being
    // awaited. ACK state must describe the fully drained durable document.
    let tail: Promise<void>
    do { tail = this.tail; await tail; if (this.failure) throw this.failure } while (tail !== this.tail)
  }
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.context.ydoc.off('update', this.onUpdate)
    this.channel?.close(); this.channel = null; this.persisted.clear()
    await this.tail
    this.db.close()
  }
}

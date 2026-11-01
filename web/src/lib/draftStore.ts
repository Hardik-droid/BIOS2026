import { LEGACY } from './brandCompatibility'
/** Last-resort recovery drafts. Old save acknowledgements cannot clear newer drafts. */
const DB_NAME = LEGACY.draftsDatabase
const STORE_NAME = 'drafts'
export type Draft = { id: string; name: string; content: unknown; ts: number; token?: string }

async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode)
      let value: T
      tx.oncomplete = () => resolve(value)
      tx.onabort = () => reject(tx.error || new Error('Draft transaction aborted.'))
      tx.onerror = () => reject(tx.error || new Error('Draft transaction failed.'))
      try { run(tx.objectStore(STORE_NAME), result => { value = result }) }
      catch (error) { tx.abort(); reject(error) }
    })
  } finally { db.close() }
}

export async function writeDraft(id: string, name: string, content: unknown): Promise<string | null> {
  try {
    const token = crypto.randomUUID()
    return await transaction('readwrite', (store, result) => {
      store.put({ id, name, content, ts: Date.now(), token } satisfies Draft)
      result(token)
    })
  } catch { return null }
}

/** With a token, clear only that draft. Without one, this is explicit discard. */
export async function clearDraft(id: string, token?: string): Promise<void> {
  try {
    await transaction<void>('readwrite', (store, result) => {
      if (token === undefined) { store.delete(id); result(undefined); return }
      store.get(id).onsuccess = event => {
        const draft = (event.target as IDBRequest<Draft | undefined>).result
        if (draft?.token === token) store.delete(id)
        result(undefined)
      }
    })
  } catch { /* A failed cleanup preserves the recovery draft. */ }
}

export async function readDraft(id: string): Promise<Draft | null> {
  try {
    return await transaction('readonly', (store, result) => {
      store.get(id).onsuccess = event => result((event.target as IDBRequest<Draft | undefined>).result || null)
    })
  } catch { return null }
}

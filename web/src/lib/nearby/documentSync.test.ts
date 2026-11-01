import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { Schema } from '@tiptap/pm/model'
import { Y, Y_FRAGMENT, createYContext, bytesToB64 } from '../crdt/ydoc'
import { LocalReplica } from './replica'
import { NearbyDocumentSync, type SyncState } from './documentSync'
import type { NearbyMessage, NearbyStatus, NearbyWire } from './nativeBridge'

const schema = new Schema({ nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*', toDOM: () => ['p', 0] }, text: { group: 'inline' } } })
const id = '97a562f0-0751-4ee1-8634-78b80914077d'
const seed = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original' }] }] }
const replicas: LocalReplica[] = []
const sessions: NearbyDocumentSync[] = []
beforeEach(() => { vi.stubGlobal('BroadcastChannel', undefined) })
afterEach(async () => {
  sessions.splice(0).forEach(session => session.close())
  for (const replica of replicas.splice(0)) await replica.close()
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})
class TestWire implements NearbyWire {
  peer!: TestWire
  state: NearbyStatus = { state: 'idle' }
  sent: NearbyMessage[] = []
  held: NearbyMessage[] = []
  hold: ((message: NearbyMessage) => boolean) | undefined
  messages = new Set<(message: NearbyMessage) => void>()
  statuses = new Set<(status: NearbyStatus) => void>()
  status = () => this.state
  send = async (message: NearbyMessage) => {
    this.sent.push(message)
    if (this.hold?.(message)) { this.held.push(message); return }
    queueMicrotask(() => this.deliver(message))
  }
  deliver(message: NearbyMessage) { if (this.state.state === 'connected' && this.peer.state.state === 'connected') for (const listener of this.peer.messages) listener(message) }
  onMessage = (fn: (message: NearbyMessage) => void) => { this.messages.add(fn); return () => { this.messages.delete(fn) } }
  onStatus = (fn: (status: NearbyStatus) => void) => { this.statuses.add(fn); return () => { this.statuses.delete(fn) } }
  set(connected: boolean) {
    this.state = connected ? { state: 'connected', session: 'unit-test-session', document: { id, name: 'Test' } } : { state: 'idle' }
    for (const listener of this.statuses) listener(this.state)
  }
}
async function open(factory: IDBFactory, initial: typeof seed | null) {
  vi.stubGlobal('indexedDB', factory)
  const context = createYContext(schema)
  const failures: Error[] = []
  const replica = await LocalReplica.open(context, id, initial, 'Test', () => {}, error => failures.push(error))
  replicas.push(replica)
  return { context, replica, failures }
}
function text(replica: LocalReplica): string { return replica.context.ydoc.getXmlFragment(Y_FRAGMENT).toString() }
function append(replica: LocalReplica, value: string) {
  const paragraph = replica.context.ydoc.getXmlFragment(Y_FRAGMENT).get(0) as Y.XmlElement
  const node = paragraph.get(0) as Y.XmlText
  node.insert(node.length, value)
}
function linked(a: LocalReplica, b: LocalReplica) {
  const wa = new TestWire(), wb = new TestWire(); wa.peer = wb; wb.peer = wa
  let stateA: SyncState = { phase: 'local' }, stateB: SyncState = { phase: 'local' }
  const sa = new NearbyDocumentSync(a, wa, value => { stateA = value }), sb = new NearbyDocumentSync(b, wb, value => { stateB = value })
  sessions.push(sa, sb)
  wa.set(true); wb.set(true)
  return { wa, wb, sa, sb, a: () => stateA, b: () => stateB }
}

describe('durable document protocol (in-memory test wire, not a radio test)', () => {
  it('transfers initial content and metadata, then acknowledges durable edits on the other replica', async () => {
    const a = await open(new IDBFactory(), seed), b = await open(new IDBFactory(), null)
    const link = linked(a.replica, b.replica)
    await vi.waitFor(() => expect(text(b.replica)).toContain('Original'))
    append(a.replica, ' हिन्दी العربية 🙂')
    a.context.ydoc.getMap('diwan-meta').set('title', 'Shared title')
    await vi.waitFor(() => expect(text(b.replica)).toContain('हिन्दी العربية 🙂'))
    await vi.waitFor(() => expect(link.a().phase).toBe('acknowledged'))
    expect(b.context.ydoc.getMap('diwan-meta').get('title')).toBe('Shared title')
    await b.replica.flush()
    expect(b.failures).toEqual([])
  })
  it('merges disconnected edits after both replicas completely close and reopen', async () => {
    const fa = new IDBFactory(), fb = new IDBFactory()
    let a = await open(fa, seed), b = await open(fb, null)
    const first = linked(a.replica, b.replica)
    await vi.waitFor(() => expect(text(b.replica)).toContain('Original'))
    first.wa.set(false); first.wb.set(false)
    append(a.replica, ' laptop A'); append(b.replica, ' laptop B')
    await a.replica.flush(); await b.replica.flush()
    first.sa.close(); first.sb.close(); await a.replica.close(); await b.replica.close()
    a = await open(fa, seed); b = await open(fb, null)
    expect(text(a.replica)).toContain('laptop A'); expect(text(b.replica)).toContain('laptop B')
    const second = linked(a.replica, b.replica)
    await vi.waitFor(() => { expect(text(a.replica)).toContain('laptop B'); expect(text(b.replica)).toContain('laptop A'); expect(text(a.replica)).toBe(text(b.replica)) })
    await vi.waitFor(() => expect(second.a().phase).toBe('acknowledged'))
  })
  it('never acknowledges an update whose destination journal failed to commit', async () => {
    const a = await open(new IDBFactory(), seed), b = await open(new IDBFactory(), null)
    const link = linked(a.replica, b.replica)
    await vi.waitFor(() => expect(link.a().phase).toBe('acknowledged'))
    link.wa.set(false); link.wb.set(false)
    append(a.replica, ' must commit remotely')
    await a.replica.flush()
    const original = IDBObjectStore.prototype.add
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['add']>) {
      if (this.name === 'updates') throw new DOMException('Storage full', 'QuotaExceededError')
      return original.apply(this, args)
    })
    link.wa.set(true); link.wb.set(true)
    await vi.waitFor(() => expect(b.failures.length).toBeGreaterThan(0))
    await vi.waitFor(() => expect(link.b().phase).toBe('error'))
    expect(link.a().phase).not.toBe('acknowledged')
  })
  it('rejects malformed peer updates without changing the live document', async () => {
    const a = await open(new IDBFactory(), seed), b = await open(new IDBFactory(), null)
    const link = linked(a.replica, b.replica)
    await vi.waitFor(() => expect(text(b.replica)).toContain('Original'))
    const before = text(b.replica)
    await link.wa.send({ fileId: id, kind: 'update', id: crypto.randomUUID(), data: bytesToB64(new Uint8Array([255, 255, 255])) })
    await vi.waitFor(() => expect(link.b().phase).toBe('error'))
    expect(text(b.replica)).toBe(before)
  })
  it('replays a compacted checkpoint and later updates after restart', async () => {
    const factory = new IDBFactory()
    let a = await open(factory, seed)
    for (let i = 0; i < 140; i++) append(a.replica, String(i % 10))
    await a.replica.flush()
    const before = text(a.replica)
    await a.replica.close()
    a = await open(factory, seed)
    expect(text(a.replica)).toBe(before)
  })
  it('compaction cannot discard a committed edit from another local tab whose broadcast has not arrived', async () => {
    const factory = new IDBFactory()
    const a = await open(factory, seed), b = await open(factory, seed)
    append(b.replica, ' other tab must survive')
    await b.replica.flush()
    expect(text(a.replica)).not.toContain('other tab')
    for (let i = 0; i < 128; i++) append(a.replica, 'x')
    await a.replica.flush()
    await a.replica.close(); await b.replica.close()
    const recovered = await open(factory, seed)
    expect(text(recovered.replica)).toContain('other tab must survive')
    expect(text(recovered.replica)).toContain('x'.repeat(128))
  })
  it('preserves both seeds when two tabs initialize the journal concurrently', async () => {
    const factory = new IDBFactory()
    const pull = LocalReplica.prototype.pull
    let initialReads = 0
    let release!: () => void
    const bothRead = new Promise<void>(resolve => { release = resolve })
    vi.spyOn(LocalReplica.prototype, 'pull').mockImplementation(async function (this: LocalReplica) {
      const found = await pull.call(this)
      if (!found && initialReads < 2) { if (++initialReads === 2) release(); await bothRead }
      return found
    })
    const other = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Other initial content' }] }] }
    const [a, b] = await Promise.all([open(factory, seed), open(factory, other)])
    await a.replica.close(); await b.replica.close()
    const recovered = await open(factory, null)
    expect(text(recovered.replica)).toContain('Original')
    expect(text(recovered.replica)).toContain('Other initial content')
  })
  it('flush drains an edit queued by a preceding commit notification', async () => {
    const a = await open(new IDBFactory(), seed)
    let committed = 0
    a.replica.onPersisted(() => { if (++committed === 1) append(a.replica, ' second') })
    append(a.replica, ' first')
    await a.replica.flush()
    expect(committed).toBe(2)
    expect(a.failures).toEqual([])
  })
  it('does not acknowledge a newer deletion when only an earlier insertion was acknowledged', async () => {
    const a = await open(new IDBFactory(), seed), b = await open(new IDBFactory(), null)
    const link = linked(a.replica, b.replica)
    await vi.waitFor(() => expect(link.a().phase).toBe('acknowledged'))
    link.wb.hold = message => message.kind === 'ack'
    append(a.replica, ' temporary')
    await vi.waitFor(() => expect(link.wb.held.length).toBe(1))
    link.wa.hold = message => message.kind === 'update'
    const node = (a.context.ydoc.getXmlFragment(Y_FRAGMENT).get(0) as Y.XmlElement).get(0) as Y.XmlText
    node.delete(node.length - 10, 10)
    await vi.waitFor(() => expect(link.wa.held.length).toBe(1))
    const flush = vi.spyOn(a.replica, 'flush')
    link.wb.deliver(link.wb.held.shift()!)
    await vi.waitFor(() => expect(flush).toHaveBeenCalled())
    expect(link.a().phase).toBe('syncing')
    expect(text(b.replica)).toContain(' temporary')
    link.wa.deliver(link.wa.held.shift()!)
    await vi.waitFor(() => expect(link.wb.held.length).toBe(1))
    link.wb.deliver(link.wb.held.shift()!)
    await vi.waitFor(() => expect(link.a().phase).toBe('acknowledged'))
    expect(text(a.replica)).toBe(text(b.replica))
  })
  it('retires a lost older acknowledgement after a later state-vector response commits', async () => {
    const a = await open(new IDBFactory(), seed), b = await open(new IDBFactory(), null)
    const link = linked(a.replica, b.replica)
    await vi.waitFor(() => expect(link.a().phase).toBe('acknowledged'))
    link.wb.hold = message => message.kind === 'ack'
    append(a.replica, ' committed with a lost ACK')
    await vi.waitFor(() => expect(link.wb.held.length).toBe(1))
    link.wb.hold = undefined
    await link.sb.resync()
    await vi.waitFor(() => expect(link.a().phase).toBe('acknowledged'))
  })
  it('does not send a queued resync after its document session closes', async () => {
    const a = await open(new IDBFactory(), seed), b = await open(new IDBFactory(), null)
    const link = linked(a.replica, b.replica)
    await vi.waitFor(() => expect(link.a().phase).toBe('acknowledged'))
    let release!: () => void
    vi.spyOn(a.replica, 'flush').mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
    const sent = link.wa.sent.length
    const syncing = link.sa.resync()
    link.sa.close(); release()
    await syncing
    expect(link.wa.sent).toHaveLength(sent)
  })
  it('replays a durable radio edit to another local tab without rebroadcasting it', async () => {
    const channels = new Set<LocalChannel>()
    let posts = 0
    class LocalChannel {
      readonly storage = indexedDB
      onmessage: ((event: { data: Uint8Array }) => void) | null = null
      constructor(readonly name: string) { channels.add(this) }
      postMessage(data: Uint8Array) {
        posts++
        for (const channel of channels) if (channel !== this && channel.name === this.name && channel.storage === this.storage) queueMicrotask(() => channel.onmessage?.({ data: data.slice() }))
      }
      close() { channels.delete(this) }
    }
    vi.stubGlobal('BroadcastChannel', LocalChannel)
    const local = new IDBFactory()
    const a = await open(local, seed), tab = await open(local, seed), peer = await open(new IDBFactory(), null)
    const link = linked(a.replica, peer.replica)
    await vi.waitFor(() => expect(link.a().phase).toBe('acknowledged'))
    const before = posts
    append(peer.replica, ' remote edit in both tabs')
    await vi.waitFor(() => expect(text(tab.replica)).toContain('remote edit in both tabs'))
    await a.replica.flush(); await tab.replica.flush(); await peer.replica.flush()
    expect(posts - before).toBe(2) // One journal commit per laptop; tab replay is already durable.
  })
})

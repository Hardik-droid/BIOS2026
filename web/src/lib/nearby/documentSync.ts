import { Y, applyRemoteUpdate, bytesToB64, b64ToBytes, MAX_SNAPSHOT_BYTES } from '../crdt/ydoc'
import type { LocalReplica } from './replica'
import type { NearbyMessage, NearbyStatus, NearbyWire } from './nativeBridge'

export type SyncPhase = 'local' | 'syncing' | 'acknowledged' | 'error'
export interface SyncState { phase: SyncPhase; error?: string; lastAcknowledged?: number }

/** Native transport is injected so protocol tests never masquerade as radio tests. */
export class NearbyDocumentSync {
  private unsubscribe: Array<() => void> = []
  private pending: Uint8Array[] = []
  private sending = false
  private closed = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private heartbeat: ReturnType<typeof setInterval>
  private chain: Promise<void> = Promise.resolve()
  private outstanding = new Map<string, { sequence: number; coversEarlier: boolean }>()
  private sequence = 0
  private generation = 0
  private session = ''
  constructor(private replica: LocalReplica, private wire: NearbyWire, private changed: (state: SyncState) => void) {
    this.unsubscribe.push(replica.onPersisted(update => {
      this.changed({ phase: 'syncing' })
      if (!this.connected()) { this.changed({ phase: 'local' }); return }
      this.pending.push(update)
      if (!this.timer) this.timer = setTimeout(() => { this.timer = undefined; void this.flushOutgoing() }, 25)
    }))
    this.unsubscribe.push(wire.onMessage(message => {
      if (message.fileId !== replica.fileId || !this.connected()) return
      const generation = this.generation
      this.chain = this.chain.then(() => this.receive(message, generation)).catch(reason => { if (this.current(generation)) this.error(reason) })
    }))
    this.unsubscribe.push(wire.onStatus(status => this.connection(status)))
    this.heartbeat = setInterval(() => { if (this.connected()) void this.resync() }, 8000)
    this.connection(wire.status())
  }
  private connected() { const status = this.wire.status(); return !this.closed && status.state === 'connected' && status.document?.id === this.replica.fileId }
  private current(generation: number) { return generation === this.generation && this.connected() }
  private error(reason: unknown) { if (!this.closed) this.changed({ phase: 'error', error: reason instanceof Error ? reason.message : 'Bluetooth synchronization failed.' }) }
  private connection(status: NearbyStatus) {
    if (this.closed) return
    if (!this.connected()) { this.generation++; this.session = ''; this.outstanding.clear(); this.changed({ phase: 'local' }); return }
    const session = status.session || 'connected'
    if (this.session !== session || status.needsResync) {
      this.generation++
      this.session = session
      this.pending = []; this.outstanding.clear()
      this.changed({ phase: 'syncing' })
      void this.resync()
    }
  }
  private async sendUpdate(data: Uint8Array, generation: number, coversEarlier = false) {
    if (!this.current(generation)) return
    if (this.outstanding.size >= 128) {
      // Replace tracking only with a full-state durability barrier. State
      // vectors omit deletions, so silently forgetting unacknowledged deltas
      // could otherwise report a newer deletion as saved on the peer.
      data = Y.encodeStateAsUpdate(this.replica.context.ydoc)
      coversEarlier = true
      this.outstanding.clear()
    }
    if (data.length > MAX_SNAPSHOT_BYTES) throw new Error('This Bluetooth update is too large. Keep a recovery copy on this device.')
    const id = crypto.randomUUID()
    this.outstanding.set(id, { sequence: ++this.sequence, coversEarlier })
    await this.wire.send({ fileId: this.replica.fileId, kind: 'update', id, data: bytesToB64(data) })
  }
  async resync(): Promise<void> {
    if (!this.connected()) return
    const generation = this.generation
    try {
      await this.replica.flush()
      if (!this.current(generation)) return
      await this.wire.send({ fileId: this.replica.fileId, kind: 'vector', data: bytesToB64(Y.encodeStateVector(this.replica.context.ydoc)) })
    } catch (reason) { if (this.current(generation)) this.error(reason) }
  }
  private async flushOutgoing() {
    if (this.sending || !this.connected() || !this.pending.length) return
    this.sending = true
    const generation = this.generation
    try {
      while (this.pending.length && this.current(generation)) {
        await this.replica.flush()
        if (!this.current(generation)) return
        const updates = this.pending.splice(0)
        await this.sendUpdate(Y.mergeUpdates(updates), generation)
      }
    } catch (reason) { if (this.current(generation)) this.error(reason) }
    finally {
      this.sending = false
      if (generation !== this.generation && this.pending.length && this.connected()) void this.flushOutgoing()
    }
  }
  private async receive(message: NearbyMessage, generation: number) {
    if (!this.current(generation)) return
    if (typeof message.data !== 'string' || message.data.length > Math.ceil(MAX_SNAPSHOT_BYTES / 3) * 4) throw new Error('Rejected oversized Bluetooth update data.')
    const data = b64ToBytes(message.data)
    if (!data || data.length > MAX_SNAPSHOT_BYTES) throw new Error('Rejected invalid Bluetooth update data.')
    if (message.kind === 'vector') {
      if (data.length > 65536) throw new Error('Rejected oversized Bluetooth state vector.')
      await this.replica.flush()
      if (!this.current(generation)) return
      const delta = Y.encodeStateAsUpdate(this.replica.context.ydoc, data)
      // This delta plus the peer's durable vector covers all our preceding
      // sends, including delete sets. Its ACK can retire a lost older ACK.
      await this.sendUpdate(delta, generation, true)
    } else if (message.kind === 'update') {
      if (!message.id || !/^[0-9a-f-]{36}$/i.test(message.id)) throw new Error('Bluetooth update has no valid acknowledgement ID.')
      const result = applyRemoteUpdate(this.replica.context, data)
      if (!result.applied) throw new Error('Rejected an invalid document update: ' + result.reason)
      // This acknowledgement follows the durable journal commit, not receipt.
      await this.replica.flush()
      if (!this.current(generation)) return
      await this.wire.send({ fileId: this.replica.fileId, kind: 'ack', id: message.id, data: bytesToB64(Y.encodeStateVector(this.replica.context.ydoc)) })
    } else if (message.kind === 'ack') {
      if (!message.id) return
      const sent = this.outstanding.get(message.id)
      if (!sent) return
      await this.replica.flush()
      if (!this.current(generation)) return
      this.outstanding.delete(message.id)
      if (sent.coversEarlier) for (const [id, update] of this.outstanding) if (update.sequence <= sent.sequence) this.outstanding.delete(id)
      if (!this.outstanding.size && !this.pending.length && bytesToB64(Y.encodeStateVector(this.replica.context.ydoc)) === message.data) this.changed({ phase: 'acknowledged', lastAcknowledged: Date.now() })
    } else throw new Error('Unsupported Bluetooth document message.')
  }
  close() {
    this.closed = true
    this.generation++
    clearTimeout(this.timer); clearInterval(this.heartbeat)
    for (const unsubscribe of this.unsubscribe) unsubscribe()
    this.pending = []; this.outstanding.clear()
  }
}

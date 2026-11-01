/** BLE packet framing only. This does not discover, pair, encrypt, or connect radios. */
export const HEADER_BYTES = 9
export const MAX_MESSAGE_BYTES = 256 * 1024
const MAX_PACKET_BYTES = 512
const MAX_PARTS = 32768
const MAGIC = 0xd1

export function fragmentMessage(message: Uint8Array, transferId: number, maxPacketBytes: number): Uint8Array[] {
  if (!Number.isInteger(transferId) || transferId < 1 || transferId > 0xffffffff) throw new Error('Invalid transfer ID.')
  if (!Number.isInteger(maxPacketBytes) || maxPacketBytes < 20 || maxPacketBytes > MAX_PACKET_BYTES) throw new Error('Invalid BLE payload size.')
  if (!message.length || message.length > MAX_MESSAGE_BYTES) throw new Error('Message size is outside the supported bounds.')
  const payloadBytes = maxPacketBytes - HEADER_BYTES
  const count = Math.ceil(message.length / payloadBytes)
  if (count > MAX_PARTS) throw new Error('Too many fragments.')
  const packets = []
  for (let index = 0; index < count; index++) {
    const payload = message.subarray(index * payloadBytes, (index + 1) * payloadBytes)
    const packet = new Uint8Array(HEADER_BYTES + payload.length)
    const header = new DataView(packet.buffer)
    header.setUint8(0, MAGIC)
    header.setUint32(1, transferId)
    header.setUint16(5, index)
    header.setUint16(7, count)
    packet.set(payload, HEADER_BYTES)
    packets.push(packet)
  }
  return packets
}

interface Transfer { count: number; parts: Map<number, Uint8Array>; bytes: number; lastProgress: number; started: number }
export class MessageAssembler {
  private transfers = new Map<number, Transfer>()
  private completed = new Map<number, number>()
  private buffered = 0
  constructor(private clock: () => number = Date.now, private idleTimeout = 60000) {}
  get bufferedBytes(): number { return this.buffered }
  private drop(id: number): void {
    const transfer = this.transfers.get(id)
    if (transfer) this.buffered -= transfer.bytes
    this.transfers.delete(id)
  }
  expire(): void {
    const now = this.clock()
    for (const [id, transfer] of this.transfers) if (now - transfer.lastProgress >= this.idleTimeout || now - transfer.started >= 300000) this.drop(id)
    for (const [id, when] of this.completed) if (now - when >= this.idleTimeout) this.completed.delete(id)
  }
  push(packet: Uint8Array): { transferId: number; data: Uint8Array } | null {
    this.expire()
    if (packet.length <= HEADER_BYTES || packet.length > MAX_PACKET_BYTES) throw new Error('Invalid fragment size.')
    const header = new DataView(packet.buffer, packet.byteOffset, packet.byteLength)
    if (header.getUint8(0) !== MAGIC) throw new Error('Unsupported nearby protocol version.')
    const id = header.getUint32(1), index = header.getUint16(5), count = header.getUint16(7)
    if (!id || !count || count > MAX_PARTS || index >= count) throw new Error('Invalid fragment header.')
    if (this.completed.has(id)) return null
    let transfer = this.transfers.get(id)
    if (!transfer) {
      if (this.transfers.size >= 4) throw new Error('Too many incomplete transfers.')
      transfer = { count, parts: new Map(), bytes: 0, lastProgress: this.clock(), started: this.clock() }
      this.transfers.set(id, transfer)
    }
    if (count !== transfer.count) { this.drop(id); throw new Error('Conflicting fragment count.') }
    const data = packet.subarray(HEADER_BYTES)
    const previous = transfer.parts.get(index)
    if (previous) {
      if (previous.length !== data.length || previous.some((byte, offset) => byte !== data[offset])) { this.drop(id); throw new Error('Conflicting duplicate fragment.') }
      return null
    }
    if (transfer.bytes + data.length > MAX_MESSAGE_BYTES || this.buffered + data.length > MAX_MESSAGE_BYTES * 4) { this.drop(id); throw new Error('Reassembly buffer limit exceeded.') }
    transfer.parts.set(index, data.slice())
    transfer.bytes += data.length
    transfer.lastProgress = this.clock()
    this.buffered += data.length
    if (transfer.parts.size !== count) return null
    const message = new Uint8Array(transfer.bytes)
    let offset = 0
    for (let part = 0; part < count; part++) {
      const fragment = transfer.parts.get(part)!
      message.set(fragment, offset)
      offset += fragment.length
    }
    this.drop(id)
    if (this.completed.size >= 256) this.completed.delete(this.completed.keys().next().value!)
    this.completed.set(id, this.clock())
    return { transferId: id, data: message }
  }
}

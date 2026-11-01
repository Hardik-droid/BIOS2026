import { describe, expect, it } from 'vitest'
import { fragmentMessage, MessageAssembler, MAX_MESSAGE_BYTES } from './framing'

describe('nearby frame boundaries (no radio simulation)', () => {
  it.each([20, 64, 244, 512])('reassembles reordered and duplicated fragments at payload %i', size => {
    const bytes = Uint8Array.from({ length: 8193 }, (_, index) => index % 251)
    const packets = fragmentMessage(bytes, 17, size).reverse()
    const assembler = new MessageAssembler()
    let result = null
    for (const packet of packets) { result = assembler.push(packet) || result; assembler.push(packet) }
    expect(result?.data).toEqual(bytes)
    expect(result?.transferId).toBe(17)
    expect(assembler.bufferedBytes).toBe(0)
  })
  it('rejects an altered duplicate and releases buffered bytes', () => {
    const packets = fragmentMessage(new Uint8Array(100), 9, 20)
    const assembler = new MessageAssembler()
    assembler.push(packets[0])
    const altered = packets[0].slice()
    altered[altered.length - 1] = 1
    expect(() => assembler.push(altered)).toThrow('Conflicting duplicate')
    expect(assembler.bufferedBytes).toBe(0)
  })
  it('expires stalled transfers without allowing duplicate packets to keep them alive', () => {
    let now = 0
    const assembler = new MessageAssembler(() => now, 100)
    const packet = fragmentMessage(new Uint8Array(100), 1, 20)[0]
    assembler.push(packet)
    now = 90
    assembler.push(packet)
    now = 101
    assembler.expire()
    expect(assembler.bufferedBytes).toBe(0)
  })
  it('bounds concurrent incomplete transfers', () => {
    const assembler = new MessageAssembler()
    for (let id = 1; id <= 4; id++) assembler.push(fragmentMessage(new Uint8Array(100), id, 20)[0])
    expect(() => assembler.push(fragmentMessage(new Uint8Array(100), 5, 20)[0])).toThrow('Too many')
  })
  it('respects a DataView subarray offset', () => {
    const packet = fragmentMessage(new Uint8Array([1, 2, 3]), 77, 20)[0]
    const backing = new Uint8Array(packet.length + 6)
    backing.set(packet, 3)
    expect(new MessageAssembler().push(backing.subarray(3, 3 + packet.length))?.data).toEqual(new Uint8Array([1, 2, 3]))
  })
  it('rejects unsupported protocol, malformed headers and oversized messages', () => {
    const packet = fragmentMessage(new Uint8Array([1]), 1, 20)[0]
    packet[0] = 0
    expect(() => new MessageAssembler().push(packet)).toThrow('protocol')
    expect(() => fragmentMessage(new Uint8Array(MAX_MESSAGE_BYTES + 1), 1, 20)).toThrow('size')
    expect(() => fragmentMessage(new Uint8Array([1]), 0, 20)).toThrow('ID')
    expect(() => fragmentMessage(new Uint8Array([1]), 1, 19)).toThrow('payload')
    expect(() => new MessageAssembler().push(new Uint8Array(9))).toThrow('size')
  })
})

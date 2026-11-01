import { describe, expect, it, vi } from 'vitest'
import { createBluetoothInvitationFile, MAX_INVITATION_FILE_BYTES, normalizeBluetoothInvitation, normalizeBluetoothPairingCode, parseBluetoothInvitation, readBluetoothInvitationFile } from './invitation'

// Fixed protocol fixture, not a live session secret.
const code = 'DBT1-' + 'A'.repeat(86)
const exported = JSON.stringify({ format: 'localfirst-bluetooth-invitation', version: 1, invitation: code })

describe('Bluetooth invitation interoperability and rejection', () => {
  it.each(['0000', '0123', '9999'])('accepts a four-digit direct pairing code without losing leading zeros: %s', value => {
    expect(normalizeBluetoothPairingCode(' \n' + value + '\t')).toBe(value)
    expect(parseBluetoothInvitation(' \n' + value + '\t')).toBe(value)
  })

  it.each(['', '123', '12345', 'ABC', '12 34', '12\n34', '１２３４', '١٢٣٤', '+123', '12.3', 'code: 0123'])('rejects malformed short pairing code %j', value => {
    expect(() => normalizeBluetoothPairingCode(value)).toThrow()
    expect(() => parseBluetoothInvitation(value)).toThrow()
  })

  it('keeps short codes out of full-invitation files and pinned identities', () => {
    expect(() => normalizeBluetoothInvitation('0123')).toThrow()
    expect(() => createBluetoothInvitationFile('0123')).toThrow()
    expect(() => parseBluetoothInvitation(JSON.stringify({ format: 'localfirst-bluetooth-invitation', version: 1, invitation: '0123' }))).toThrow()
  })

  it('loads both the original v1 export and the exact new export without changing identity bytes', () => {
    expect(parseBluetoothInvitation(exported)).toBe(code)
    expect(parseBluetoothInvitation(createBluetoothInvitationFile(code))).toBe(code)
  })

  it('accepts UTF-8 BOM, outer whitespace and line wrapping without extracting a code from other text', () => {
    expect(parseBluetoothInvitation('\uFEFF \r\n' + exported + '\r\n')).toBe(code)
    const wrapped = code.slice(0, 40) + '\r\n' + code.slice(40)
    expect(parseBluetoothInvitation('\uFEFF ' + wrapped + '\t')).toBe(code)
    expect(normalizeBluetoothInvitation(' ' + wrapped + '\n')).toBe(code)
    expect(() => parseBluetoothInvitation('Copied from laptop: ' + code)).toThrow('could not be read')
  })

  it('accepts a complete plain-text or JSON-string invitation', () => {
    expect(parseBluetoothInvitation(code)).toBe(code)
    expect(parseBluetoothInvitation(JSON.stringify(code))).toBe(code)
  })

  it.each([
    ['workspace backup', { format: 'diwan-local-workspace', version: 1, files: [] }],
    ['connection report', { format: 'localfirst-bluetooth-connection-report', state: 'idle' }],
  ])('identifies a %s and explains where to create the correct file', (description, entry) => {
    try { parseBluetoothInvitation(JSON.stringify(entry)); throw new Error('unexpected acceptance') }
    catch (error) {
      expect((error as Error).message).toContain(description)
      expect((error as Error).message).toContain('Share this document → Save invitation file')
      expect((error as Error).message).toContain('Downloads')
    }
  })

  it.each([null, [], 42, {}, { invitation: code }, { format: 'localfirst-bluetooth-invitation', version: 1, invitation: 42 }])('rejects invalid JSON structure %j', entry => {
    expect(() => parseBluetoothInvitation(JSON.stringify(entry))).toThrow()
  })

  it.each([0, 2, '1', null])('rejects unsupported file version %j with an update instruction', version => {
    expect(() => parseBluetoothInvitation(JSON.stringify({ format: 'localfirst-bluetooth-invitation', version, invitation: code }))).toThrow('same updated offline package')
  })

  it('identifies a different wire version without accepting it', () => {
    expect(() => parseBluetoothInvitation(code.replace('DBT1-', 'DBT2-'))).toThrow('different Bluetooth version')
  })

  it.each(['', 'DBT1-', code.slice(0, -1), code + 'A', code.replace(/A$/, '!'), '{broken'])('rejects empty, malformed or truncated input %j', value => {
    expect(() => parseBluetoothInvitation(value)).toThrow()
  })

  it('bounds text by UTF-8 bytes and checks file size before reading it', async () => {
    expect(() => parseBluetoothInvitation(' '.repeat(MAX_INVITATION_FILE_BYTES + 1))).toThrow('small Bluetooth invitation file')
    expect(() => parseBluetoothInvitation('界'.repeat(1400))).toThrow('small Bluetooth invitation file')
    const text = vi.fn().mockResolvedValue(exported)
    await expect(readBluetoothInvitationFile({ size: MAX_INVITATION_FILE_BYTES + 1, text })).rejects.toThrow('small Bluetooth invitation file')
    expect(text).not.toHaveBeenCalled()
  })

  it('reads a valid file and converts filesystem failures into a useful message', async () => {
    expect(await readBluetoothInvitationFile({ size: exported.length, text: async () => exported })).toBe(code)
    await expect(readBluetoothInvitationFile({ size: 100, text: async () => { throw new DOMException('Cannot read', 'NotReadableError') } })).rejects.toThrow('Copy it to this laptop')
  })

  it('never includes invitation secrets in parse errors', () => {
    const invalid = code + 'secret'
    try { parseBluetoothInvitation(invalid); throw new Error('unexpected acceptance') }
    catch (error) { expect((error as Error).message).not.toContain(invalid) }
  })
})
